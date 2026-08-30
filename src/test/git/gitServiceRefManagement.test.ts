import * as assert from "node:assert";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { PorcelainErrorCode } from "../../git/errors";
import { GitService } from "../../git/gitService";
import { GitTestRepo } from "./gitTestRepo";

const execFileAsync = promisify(execFile);

function serviceFor(repo: GitTestRepo): GitService {
  return new GitService({
    workTreeRoot: repo.rootPath,
    gitDir: path.join(repo.rootPath, ".git"),
    commonDir: path.join(repo.rootPath, ".git"),
  });
}

async function commitFile(
  repo: GitTestRepo,
  file: string,
  content: string,
  subject: string,
): Promise<void> {
  await repo.writeFile(file, content);
  await repo.git("add", file);
  await repo.git("commit", "-m", subject);
}

describe("gitService.getRecentBranches", () => {
  it("lists branches by most recent checkout, newest first, without hashes", async () => {
    const repo = await GitTestRepo.create();
    await commitFile(repo, "a.txt", "a\n", "base");
    await repo.git("checkout", "-b", "alpha");
    await repo.git("checkout", "main");
    await repo.git("checkout", "-b", "beta");
    const head = (await repo.git("rev-parse", "HEAD")).trim();
    // A detached checkout records a hash, which is not a branch to offer.
    await repo.git("checkout", head);
    await repo.git("checkout", "beta");
    const service = serviceFor(repo);

    const recent = await service.getRecentBranches();

    assert.strictEqual(recent[0], "beta");
    assert.ok(recent.includes("alpha"));
    assert.ok(recent.includes("main"));
    assert.ok(
      !recent.some((name) => /^[0-9a-f]{7,64}$/i.test(name)),
      `raw hashes leaked into recent branches: ${recent.join(", ")}`,
    );
    // Each branch appears once even though beta was checked out twice.
    assert.strictEqual(recent.filter((n) => n === "beta").length, 1);
  });
});

describe("gitService.checkout and smartCheckout", () => {
  it("reports blocking local changes with a typed code", async () => {
    const repo = await GitTestRepo.create();
    await commitFile(repo, "a.txt", "base\n", "base");
    await repo.git("checkout", "-b", "other");
    await commitFile(repo, "a.txt", "other\n", "other edit");
    await repo.git("checkout", "main");
    await repo.writeFile("a.txt", "uncommitted\n");
    const service = serviceFor(repo);

    await assert.rejects(
      () => service.checkout("other"),
      (error: { code?: string }) =>
        error.code === PorcelainErrorCode.LOCAL_CHANGES_WOULD_BE_OVERWRITTEN,
    );
    // The working tree is untouched by the failed attempt.
    assert.strictEqual(
      (await repo.git("rev-parse", "--abbrev-ref", "HEAD")).trim(),
      "main",
    );
  });

  it("stashes, switches, and restores in one step", async () => {
    const repo = await GitTestRepo.create();
    await commitFile(repo, "a.txt", "base\n", "base");
    await commitFile(repo, "b.txt", "b\n", "add b");
    await repo.git("checkout", "-b", "other", "HEAD~1");
    await repo.git("checkout", "main");
    // An edit to an untouched file survives the switch.
    await repo.writeFile("a.txt", "work in progress\n");
    const service = serviceFor(repo);

    const result = await service.smartCheckout("other");

    assert.strictEqual(result.restored, true);
    assert.strictEqual(
      (await repo.git("rev-parse", "--abbrev-ref", "HEAD")).trim(),
      "other",
    );
    assert.strictEqual(
      await fs.readFile(path.join(repo.rootPath, "a.txt"), "utf8"),
      "work in progress\n",
    );
    assert.strictEqual((await repo.git("stash", "list")).trim(), "");
  });

  it("keeps the stash when restoring conflicts", async () => {
    const repo = await GitTestRepo.create();
    await commitFile(repo, "a.txt", "base\n", "base");
    await repo.git("checkout", "-b", "other");
    await commitFile(repo, "a.txt", "other version\n", "other edit");
    await repo.git("checkout", "main");
    await repo.writeFile("a.txt", "local version\n");
    const service = serviceFor(repo);

    const result = await service.smartCheckout("other");

    assert.strictEqual(result.restored, false);
    assert.ok(result.stashRef);
    // The user's work is still recoverable rather than silently dropped.
    assert.ok((await repo.git("stash", "list")).includes("smart checkout"));
  });
});

describe("gitService.getUnmergedCommits", () => {
  it("returns the commits the target does not contain", async () => {
    const repo = await GitTestRepo.create();
    await commitFile(repo, "a.txt", "a\n", "base");
    await repo.git("checkout", "-b", "feature");
    await commitFile(repo, "b.txt", "b\n", "feature one");
    await commitFile(repo, "c.txt", "c\n", "feature two");
    await repo.git("checkout", "main");
    const service = serviceFor(repo);

    const unmerged = await service.getUnmergedCommits("feature");

    assert.deepStrictEqual(
      unmerged.map((c) => c.subject),
      ["feature two", "feature one"],
    );

    await repo.git("merge", "feature");
    const afterMerge = await serviceFor(repo).getUnmergedCommits("feature");
    assert.deepStrictEqual(afterMerge, []);
  });
});

describe("gitService.resetToRemoteBranch", () => {
  it("drops local commits so the branch matches its upstream", async () => {
    const { repo, remotePath } = await createRepoWithRemote();
    const service = serviceFor(repo);
    await repo.git("push", "-u", "origin", "main");
    const upstreamHash = (await repo.git("rev-parse", "HEAD")).trim();
    await commitFile(repo, "local.txt", "local\n", "local only");

    await service.resetToRemoteBranch("main");

    assert.strictEqual(
      (await repo.git("rev-parse", "HEAD")).trim(),
      upstreamHash,
    );
    await fs.rm(remotePath, { recursive: true, force: true });
  });

  it("refuses a branch with no upstream", async () => {
    const repo = await GitTestRepo.create();
    await commitFile(repo, "a.txt", "a\n", "base");
    const service = serviceFor(repo);

    await assert.rejects(
      () => service.resetToRemoteBranch("main"),
      (error: { code?: string }) =>
        error.code === PorcelainErrorCode.BRANCH_NO_UPSTREAM,
    );
  });
});

describe("gitService.getMergedBranches", () => {
  it("marks merge status, excludes the checked-out branch, and filters by prefix", async () => {
    const repo = await GitTestRepo.create();
    await commitFile(repo, "a.txt", "a\n", "base");
    await repo.git("branch", "feature/done");
    await repo.git("checkout", "-b", "feature/open");
    await commitFile(repo, "b.txt", "b\n", "open work");
    await repo.git("checkout", "main");
    const service = serviceFor(repo);

    const rows = await service.getMergedBranches();
    const byName = new Map(rows.map((row) => [row.name, row]));

    assert.ok(!byName.has("main"), "the checked-out branch is not a candidate");
    assert.strictEqual(byName.get("feature/done")?.merged, true);
    assert.strictEqual(byName.get("feature/open")?.merged, false);
    // The ISO date survives parsing intact (it contains spaces).
    const date = byName.get("feature/done")?.lastCommitDate ?? "";
    assert.ok(
      !Number.isNaN(new Date(date).getTime()),
      `unparseable date: ${date}`,
    );

    const filtered = await service.getMergedBranches("HEAD", "feature/");
    assert.deepStrictEqual(filtered.map((row) => row.name).sort(), [
      "feature/done",
      "feature/open",
    ]);
  });
});

describe("gitService tag management", () => {
  it("creates annotated and lightweight tags, forces, and deletes", async () => {
    const repo = await GitTestRepo.create();
    await commitFile(repo, "a.txt", "a\n", "base");
    const first = (await repo.git("rev-parse", "HEAD")).trim();
    await commitFile(repo, "b.txt", "b\n", "second");
    const second = (await repo.git("rev-parse", "HEAD")).trim();
    const service = serviceFor(repo);

    await service.createTag("v1", first);
    await service.createTag("v2", first, "release two");
    assert.strictEqual(
      (await repo.git("cat-file", "-t", "v1")).trim(),
      "commit",
    );
    assert.strictEqual((await repo.git("cat-file", "-t", "v2")).trim(), "tag");

    // Without force, moving an existing tag fails.
    await assert.rejects(() => service.createTag("v1", second));
    await service.createTag("v1", second, undefined, true);
    assert.strictEqual(
      (await repo.git("rev-parse", "v1^{commit}")).trim(),
      second,
    );

    await service.deleteTag("v1");
    assert.ok(!(await repo.git("tag")).split("\n").includes("v1"));
  });

  it("pushes and deletes tags on a remote", async () => {
    const { repo, remotePath, remote } = await createRepoWithRemote();
    const service = serviceFor(repo);
    const head = (await repo.git("rev-parse", "HEAD")).trim();
    await service.createTag("v1", head);

    await service.pushTag("origin", "v1");
    assert.ok((await remote.git("tag")).split("\n").includes("v1"));

    const results = await service.deleteRemoteTag("v1", ["origin"]);
    assert.deepStrictEqual(results, [{ remote: "origin", deleted: true }]);
    assert.ok(!(await remote.git("tag")).split("\n").includes("v1"));
    // The local tag is untouched by a remote delete.
    assert.ok((await repo.git("tag")).split("\n").includes("v1"));

    await fs.rm(remotePath, { recursive: true, force: true });
  });
});

describe("gitService remote management", () => {
  it("adds, lists, renames, re-points, and removes remotes", async () => {
    const repo = await GitTestRepo.create();
    await commitFile(repo, "a.txt", "a\n", "base");
    const service = serviceFor(repo);

    await service.addRemote("origin", "https://example.com/one.git");
    assert.deepStrictEqual(await service.getRemotes(), [
      { name: "origin", url: "https://example.com/one.git" },
    ]);

    await assert.rejects(
      () => service.addRemote("origin", "https://example.com/two.git"),
      (error: { code?: string }) =>
        error.code === PorcelainErrorCode.REMOTE_ALREADY_EXISTS,
    );

    await service.renameRemote("origin", "upstream");
    await service.setRemoteUrl("upstream", "https://example.com/three.git");
    assert.deepStrictEqual(await service.getRemotes(), [
      { name: "upstream", url: "https://example.com/three.git" },
    ]);

    await service.removeRemote("upstream");
    assert.deepStrictEqual(await service.getRemotes(), []);
  });

  it("rejects option-shaped names and URLs before they reach git", async () => {
    const repo = await GitTestRepo.create();
    await commitFile(repo, "a.txt", "a\n", "base");
    const service = serviceFor(repo);

    await assert.rejects(() => service.addRemote("--upload-pack=evil", "u"));
    await assert.rejects(
      () => service.addRemote("ok", "--upload-pack=evil"),
      /Invalid remote URL/,
    );
    await assert.rejects(
      () => service.removeRemote("missing"),
      (error: { code?: string }) =>
        error.code === PorcelainErrorCode.REMOTE_NOT_FOUND,
    );
  });
});

/** A repo with a real bare remote wired up as `origin`. */
async function createRepoWithRemote(): Promise<{
  repo: GitTestRepo;
  remote: { git(...args: string[]): Promise<string> };
  remotePath: string;
}> {
  const repo = await GitTestRepo.create();
  await commitFile(repo, "a.txt", "a\n", "base");
  const remotePath = await fs.mkdtemp(path.join(os.tmpdir(), "porcelain-rem-"));
  await repo.git("init", "--bare", remotePath);
  await repo.git("remote", "add", "origin", remotePath);
  await repo.git("push", "origin", "main");
  return { repo, remote: { git: gitIn(remotePath) }, remotePath };
}

/** Run git in an arbitrary directory (the bare remote has no GitTestRepo). */
function gitIn(cwd: string) {
  return async (...args: string[]): Promise<string> => {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      env: {
        ...process.env,
        LC_ALL: "C",
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    });
    return stdout;
  };
}

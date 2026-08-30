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

/** A clone with an upstream, plus a second clone to push divergence from. */
async function createTrackedPair(): Promise<{
  local: GitTestRepo;
  other: GitTestRepo;
  remotePath: string;
}> {
  const local = await GitTestRepo.create();
  await commitFile(local, "a.txt", "base\n", "base");
  const remotePath = await fs.mkdtemp(
    path.join(os.tmpdir(), "porcelain-sync-"),
  );
  await local.git("init", "--bare", remotePath);
  await local.git("remote", "add", "origin", remotePath);
  await local.git("push", "-u", "origin", "main");

  const other = await GitTestRepo.create();
  await other.git("remote", "add", "origin", remotePath);
  await other.git("fetch", "origin");
  await other.git("checkout", "-B", "main", "origin/main");
  await other.git("branch", "--set-upstream-to=origin/main", "main");
  return { local, other, remotePath };
}

describe("gitService.isProtectedBranch", () => {
  it("matches whole names by regex and survives a bad pattern", () => {
    const repo = { rootPath: "/tmp" } as GitTestRepo;
    const service = new GitService({
      workTreeRoot: repo.rootPath,
      gitDir: "/tmp/.git",
      commonDir: "/tmp/.git",
    });

    assert.strictEqual(service.isProtectedBranch("main", ["main"]), true);
    // Anchored: a pattern must match the whole name, not a fragment.
    assert.strictEqual(service.isProtectedBranch("mainline", ["main"]), false);
    assert.strictEqual(
      service.isProtectedBranch("release/1.2", ["release/.*"]),
      true,
    );
    assert.strictEqual(service.isProtectedBranch("feature/x", ["main"]), false);
    // An unparseable pattern degrades to an exact match rather than throwing.
    assert.strictEqual(service.isProtectedBranch("weird[", ["weird["]), true);
    assert.strictEqual(service.isProtectedBranch("other", ["weird["]), false);
    // Blank entries never protect anything.
    assert.strictEqual(service.isProtectedBranch("main", ["", "  "]), false);
  });
});

describe("gitService.updateProject", () => {
  it("merges the tracked branch and reports what arrived", async () => {
    const { local, other, remotePath } = await createTrackedPair();
    await commitFile(other, "b.txt", "from elsewhere\n", "upstream work");
    await other.git("push", "origin", "main");
    const service = serviceFor(local);

    const result = await service.updateProject({ method: "merge" });

    assert.strictEqual(result.updated, true);
    assert.deepStrictEqual(
      result.commits.map((commit) => commit.subject),
      ["upstream work"],
    );
    assert.ok(
      (await local.git("ls-files")).includes("b.txt"),
      "the fetched file did not arrive",
    );
    await fs.rm(remotePath, { recursive: true, force: true });
  });

  it("rebases local commits on top when asked", async () => {
    const { local, other, remotePath } = await createTrackedPair();
    await commitFile(other, "b.txt", "from elsewhere\n", "upstream work");
    await other.git("push", "origin", "main");
    await commitFile(local, "c.txt", "mine\n", "my work");
    const service = serviceFor(local);

    await service.updateProject({ method: "rebase" });

    // Rebase replays the local commit on top, so it is newest and there is
    // no merge commit.
    const log = (await local.git("log", "--format=%s"))
      .split("\n")
      .filter(Boolean);
    assert.deepStrictEqual(log, ["my work", "upstream work", "base"]);
    assert.strictEqual(
      (await local.git("rev-list", "--count", "--merges", "HEAD")).trim(),
      "0",
    );
    await fs.rm(remotePath, { recursive: true, force: true });
  });

  it("carries uncommitted work across the update", async () => {
    const { local, other, remotePath } = await createTrackedPair();
    await commitFile(other, "b.txt", "from elsewhere\n", "upstream work");
    await other.git("push", "origin", "main");
    // An edit to a file the update does not touch must survive.
    await local.writeFile("a.txt", "work in progress\n");
    const service = serviceFor(local);

    await service.updateProject({ method: "merge" });

    assert.strictEqual(
      await fs.readFile(path.join(local.rootPath, "a.txt"), "utf8"),
      "work in progress\n",
    );
    await fs.rm(remotePath, { recursive: true, force: true });
  });

  it("reports when there was nothing to update", async () => {
    const { local, remotePath } = await createTrackedPair();
    const result = await serviceFor(local).updateProject({ method: "merge" });

    assert.strictEqual(result.updated, false);
    assert.deepStrictEqual(result.commits, []);
    await fs.rm(remotePath, { recursive: true, force: true });
  });

  it("refuses a branch with no tracked branch", async () => {
    const repo = await GitTestRepo.create();
    await commitFile(repo, "a.txt", "a\n", "base");

    await assert.rejects(
      () => serviceFor(repo).updateProject({ method: "merge" }),
      (error: { code?: string }) =>
        error.code === PorcelainErrorCode.BRANCH_NO_UPSTREAM,
    );
  });
});

describe("gitService.getIncomingOutgoing", () => {
  it("counts commits waiting in each direction", async () => {
    const { local, other, remotePath } = await createTrackedPair();
    await commitFile(other, "b.txt", "theirs\n", "upstream work");
    await other.git("push", "origin", "main");
    await commitFile(local, "c.txt", "mine\n", "my work");
    await local.git("fetch", "origin");
    const service = serviceFor(local);

    const counts = await service.getIncomingOutgoing();

    assert.deepStrictEqual(counts.main, { incoming: 1, outgoing: 1 });
    await fs.rm(remotePath, { recursive: true, force: true });
  });

  it("reports zeroes for a branch with no upstream", async () => {
    const repo = await GitTestRepo.create();
    await commitFile(repo, "a.txt", "a\n", "base");

    const counts = await serviceFor(repo).getIncomingOutgoing();

    assert.deepStrictEqual(counts.main, { incoming: 0, outgoing: 0 });
  });
});

describe("gitService.push options", () => {
  it("sets the upstream when asked", async () => {
    const { local, remotePath } = await createTrackedPair();
    await local.git("checkout", "-b", "feature");
    await commitFile(local, "f.txt", "feature\n", "feature work");
    const service = serviceFor(local);

    await service.push("feature", false, "origin", undefined, {
      setUpstream: true,
    });

    assert.strictEqual(
      (
        await local.git("rev-parse", "--abbrev-ref", "feature@{upstream}")
      ).trim(),
      "origin/feature",
    );
    await fs.rm(remotePath, { recursive: true, force: true });
  });

  it("pushes tags alongside the branch when asked", async () => {
    const { local, remotePath } = await createTrackedPair();
    await local.git("tag", "v1");
    const service = serviceFor(local);

    await service.push("main", false, "origin", undefined, {
      pushTags: "all",
    });

    assert.ok((await gitIn(remotePath)("tag")).includes("v1"));
    await fs.rm(remotePath, { recursive: true, force: true });
  });

  it("refuses a remote that is not configured", async () => {
    const { local, remotePath } = await createTrackedPair();

    await assert.rejects(
      () => serviceFor(local).push("main", false, "nowhere"),
      (error: { code?: string }) =>
        error.code === PorcelainErrorCode.REMOTE_NOT_FOUND,
    );
    await fs.rm(remotePath, { recursive: true, force: true });
  });
});

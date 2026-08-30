import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { GitService } from "../../git/gitService";
import { GitTestRepo } from "./gitTestRepo";

function serviceFor(repo: GitTestRepo): GitService {
  return new GitService({
    workTreeRoot: repo.rootPath,
    gitDir: path.join(repo.rootPath, ".git"),
    commonDir: path.join(repo.rootPath, ".git"),
  });
}

async function seed(repo: GitTestRepo): Promise<void> {
  await repo.writeFile("a.txt", "a\n");
  await repo.git("add", "a.txt");
  await repo.git("commit", "-m", "seed");
}

describe("gitService worktrees", () => {
  it("lists the main working tree before any are added", async () => {
    const repo = await GitTestRepo.create();
    await seed(repo);

    const worktrees = await serviceFor(repo).listWorktrees();

    assert.strictEqual(worktrees.length, 1);
    assert.strictEqual(worktrees[0].isMain, true);
    assert.strictEqual(worktrees[0].branch, "main");
    assert.strictEqual(worktrees[0].detached, false);
    assert.ok(worktrees[0].head.length > 0);
  });

  it("adds a worktree on a new branch and lists it", async () => {
    const repo = await GitTestRepo.create();
    await seed(repo);
    const service = serviceFor(repo);
    const target = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "porcelain-wt-")),
      "feature",
    );

    await service.addWorktree(target, { newBranch: "feature" });

    const worktrees = await service.listWorktrees();
    assert.strictEqual(worktrees.length, 2);
    const added = worktrees.find((tree) => tree.branch === "feature");
    assert.ok(added, "the new worktree was not listed");
    assert.strictEqual(added.isMain, false);
    // The branch really exists and is checked out there.
    assert.ok((await repo.git("branch")).includes("feature"));
    assert.ok(
      await fs
        .stat(path.join(target, "a.txt"))
        .then(() => true)
        .catch(() => false),
      "the worktree was not populated",
    );

    await service.removeWorktree(target);
    assert.strictEqual((await service.listWorktrees()).length, 1);
    await fs.rm(path.dirname(target), { recursive: true, force: true });
  });

  it("marks a worktree prunable once its directory is gone", async () => {
    const repo = await GitTestRepo.create();
    await seed(repo);
    const service = serviceFor(repo);
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "porcelain-wt-"));
    const target = path.join(base, "gone");
    await service.addWorktree(target, { newBranch: "gone" });

    await fs.rm(target, { recursive: true, force: true });

    // Matched by branch, not path: macOS resolves the temp directory's
    // symlink, so git reports a different (real) path than the one we passed.
    const worktrees = await service.listWorktrees();
    const stale = worktrees.find((tree) => tree.branch === "gone");
    assert.ok(stale, "the stale record disappeared before pruning");
    assert.strictEqual(stale.prunable, true);

    await service.pruneWorktrees();
    assert.ok(
      !(await service.listWorktrees()).some((tree) => tree.branch === "gone"),
      "prune left the stale record behind",
    );
    await fs.rm(base, { recursive: true, force: true });
  });

  it("rejects option-shaped paths before they reach git", async () => {
    const repo = await GitTestRepo.create();
    await seed(repo);
    const service = serviceFor(repo);

    await assert.rejects(
      () => service.addWorktree("--force"),
      /Invalid worktree path/,
    );
    await assert.rejects(
      () => service.removeWorktree("--force"),
      /Invalid worktree path/,
    );
  });
});

describe("gitService.searchCommits", () => {
  it("finds commits by message, most recent first", async () => {
    const repo = await GitTestRepo.create();
    await seed(repo);
    await repo.git("commit", "--allow-empty", "-m", "fix the parser");
    await repo.git("commit", "--allow-empty", "-m", "unrelated work");
    await repo.git("commit", "--allow-empty", "-m", "fix the printer");
    const service = serviceFor(repo);

    const results = await service.searchCommits("fix the");

    assert.deepStrictEqual(
      results.map((commit) => commit.subject),
      ["fix the printer", "fix the parser"],
    );
  });

  it("resolves a hash query to that single commit", async () => {
    const repo = await GitTestRepo.create();
    await seed(repo);
    const hash = (await repo.git("rev-parse", "HEAD")).trim();
    const service = serviceFor(repo);

    const results = await service.searchCommits(hash.slice(0, 8));

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].hash, hash);
  });

  it("returns nothing for an empty query", async () => {
    const repo = await GitTestRepo.create();
    await seed(repo);
    assert.deepStrictEqual(await serviceFor(repo).searchCommits("   "), []);
  });
});

describe("gitService.getSigningConfig", () => {
  it("reports signing off by default and on once configured", async () => {
    const repo = await GitTestRepo.create();
    await seed(repo);
    const service = serviceFor(repo);

    // The hermetic fixture explicitly disables signing.
    assert.deepStrictEqual(await service.getSigningConfig(), {
      signCommits: false,
      key: null,
    });

    await repo.git("config", "commit.gpgsign", "true");
    await repo.git("config", "user.signingkey", "ABC123");
    assert.deepStrictEqual(await service.getSigningConfig(), {
      signCommits: true,
      key: "ABC123",
    });
  });
});

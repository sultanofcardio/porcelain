import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CommitPathSelection } from "../../git/commit/types";
import { GitExecutor, type GitRunOptions } from "../../git/core/gitExecutor";
import { IdeaGitError } from "../../git/errors";
import { GitService } from "../../git/gitService";
import { PatchShelfService } from "../../git/shelf/patchShelfService";
import { WorkingTreeService } from "../../git/workingTree/workingTreeService";
import { GitTestRepo } from "./gitTestRepo";

describe("PatchShelfService", () => {
  const repositories: GitTestRepo[] = [];

  afterEach(async () => {
    await Promise.all(
      repositories
        .splice(0)
        .map((repo) => fs.rm(repo.rootPath, { recursive: true, force: true })),
    );
  });

  async function createRepo(): Promise<GitTestRepo> {
    const repo = await GitTestRepo.create();
    repositories.push(repo);
    return repo;
  }

  async function commitFiles(
    repo: GitTestRepo,
    files: Readonly<Record<string, Buffer | string>>,
  ): Promise<void> {
    for (const [filePath, content] of Object.entries(files)) {
      await repo.writeFile(filePath, content);
    }
    await repo.git("add", "-A");
    await repo.git("commit", "-m", "base");
  }

  function wholePath(
    filePath: string,
    options: Partial<CommitPathSelection> = {},
  ): CommitPathSelection {
    return {
      path: filePath,
      includeIndex: false,
      includeWorkingTree: true,
      ...options,
    };
  }

  function untracked(filePath: string): CommitPathSelection {
    return {
      path: filePath,
      includeIndex: false,
      includeWorkingTree: true,
    };
  }

  function service(
    repo: GitTestRepo,
    executor: GitExecutor = repo.executor,
  ): PatchShelfService {
    return new PatchShelfService(executor, new WorkingTreeService(executor));
  }

  async function rawIndex(repo: GitTestRepo): Promise<Buffer> {
    return repo.executor.buffer(["ls-files", "--stage", "-z"]);
  }

  async function assertRejectedWithoutMutation(
    repo: GitTestRepo,
    selections: readonly CommitPathSelection[],
  ): Promise<void> {
    const indexBefore = await rawIndex(repo);
    const statusBefore = await repo.executor.buffer([
      "status",
      "--porcelain=v1",
      "-z",
      "-uall",
    ]);

    const result = await service(repo).create({
      message: "rejected",
      selections,
    });

    assert.strictEqual(result.ok, false);
    if (result.ok) assert.fail("expected a typed failure");
    assert.strictEqual(result.code, "UNSUPPORTED_SHELF_CONTENT");
    assert.ok(result.recovery);
    assert.deepStrictEqual(await rawIndex(repo), indexBefore);
    assert.deepStrictEqual(
      await repo.executor.buffer(["status", "--porcelain=v1", "-z", "-uall"]),
      statusBefore,
    );
  }

  it("rejects unresolved conflicts before changing the index or working tree", async () => {
    const repo = await createRepo();
    await commitFiles(repo, { "conflict.txt": "base\n" });
    await repo.git("checkout", "-b", "other");
    await repo.writeFile("conflict.txt", "other\n");
    await repo.git("commit", "-am", "other");
    await repo.git("checkout", "-");
    await repo.writeFile("conflict.txt", "current\n");
    await repo.git("commit", "-am", "current");
    await repo.executor.buffer(["merge", "other"], {
      allowedExitCodes: [1],
    });

    await assertRejectedWithoutMutation(repo, [wholePath("conflict.txt")]);
  });

  it("rejects unreadable, binary untracked, and special-file content before mutation", async () => {
    const repo = await createRepo();
    await commitFiles(repo, { "tracked.txt": "base\n" });
    await repo.writeFile("unreadable.txt", "secret\n");
    await fs.chmod(path.join(repo.rootPath, "unreadable.txt"), 0o000);
    await assertRejectedWithoutMutation(repo, [untracked("unreadable.txt")]);
    await fs.chmod(path.join(repo.rootPath, "unreadable.txt"), 0o600);

    await repo.writeFile("binary.bin", Buffer.from([1, 0, 2, 3]));
    await assertRejectedWithoutMutation(repo, [untracked("binary.bin")]);

    await fs.symlink("tracked.txt", path.join(repo.rootPath, "special-link"));
    await assertRejectedWithoutMutation(repo, [untracked("special-link")]);
  });

  it("rejects malformed and incomplete selections before mutation", async () => {
    const repo = await createRepo();
    await commitFiles(repo, { "tracked.txt": "base\n" });
    await repo.writeFile("tracked.txt", "changed\n");

    await assertRejectedWithoutMutation(repo, [wholePath("../outside.txt")]);
    await assertRejectedWithoutMutation(repo, [wholePath("missing.txt")]);
  });

  it("returns a typed failure when repository inspection fails", async () => {
    const repo = await createRepo();
    await commitFiles(repo, { "tracked.txt": "base\n" });
    await repo.writeFile("tracked.txt", "changed\n");
    const indexBefore = await rawIndex(repo);

    class FailingInspectionExecutor extends GitExecutor {
      override buffer(
        args: readonly string[],
        options?: GitRunOptions,
      ): Promise<Buffer> {
        if (args.includes("--diff-filter=U")) {
          return Promise.reject(new Error("injected inspection failure"));
        }
        return super.buffer(args, options);
      }
    }
    const result = await service(
      repo,
      new FailingInspectionExecutor(repo.rootPath),
    ).create({
      message: "inspection",
      selections: [wholePath("tracked.txt")],
    });

    assert.strictEqual(result.ok, false);
    if (result.ok) assert.fail("expected a typed failure");
    assert.strictEqual(result.code, "UNSUPPORTED_SHELF_CONTENT");
    assert.deepStrictEqual(await rawIndex(repo), indexBefore);
    assert.strictEqual(
      await fs.readFile(path.join(repo.rootPath, "tracked.txt"), "utf8"),
      "changed\n",
    );
  });

  it("round-trips supported tracked binary content", async () => {
    const repo = await createRepo();
    const base = Buffer.from([0, 1, 2, 3, 4, 5]);
    const changed = Buffer.from([0, 9, 8, 7, 6, 5]);
    await commitFiles(repo, { "tracked.bin": base });
    await repo.writeFile("tracked.bin", changed);

    const result = await service(repo).create({
      message: "binary",
      selections: [wholePath("tracked.bin")],
    });

    assert.strictEqual(result.ok, true, result.ok ? undefined : result.message);
    if (!result.ok) assert.fail("expected a shelf artifact");
    assert.deepStrictEqual(
      await fs.readFile(path.join(repo.rootPath, "tracked.bin")),
      base,
    );
    await repo.git("apply", result.value.finalPath);
    assert.deepStrictEqual(
      await fs.readFile(path.join(repo.rootPath, "tracked.bin")),
      changed,
    );
  });

  it("materializes selected staged and workspace content before the first commit", async () => {
    const repo = await createRepo();
    await repo.writeFile("initial.txt", "staged\n");
    await repo.git("add", "--", "initial.txt");
    await repo.writeFile("initial.txt", "workspace\n");

    const result = await service(repo).create({
      message: "initial",
      selections: [
        wholePath("initial.txt", {
          includeIndex: true,
          includeWorkingTree: true,
        }),
      ],
    });

    assert.strictEqual(result.ok, true, result.ok ? undefined : result.message);
    if (!result.ok) assert.fail("expected a shelf artifact");
    await assert.rejects(fs.access(path.join(repo.rootPath, "initial.txt")));
    await repo.git("apply", result.value.finalPath);
    assert.strictEqual(
      await fs.readFile(path.join(repo.rootPath, "initial.txt"), "utf8"),
      "workspace\n",
    );
  });

  it("keeps the existing patch shelf method and maps unsupported content to its error shape", async () => {
    const repo = await createRepo();
    await commitFiles(repo, { "tracked.txt": "base\n" });
    const binary = Buffer.from([1, 0, 2, 3]);
    await repo.writeFile("binary.bin", binary);
    const gitDir = path.join(repo.rootPath, ".git");
    const gitService = new GitService({
      workTreeRoot: repo.rootPath,
      gitDir,
      commonDir: gitDir,
    });

    await assert.rejects(
      gitService.ideaShelveChanges("binary", ["binary.bin"]),
      (error: unknown) =>
        error instanceof IdeaGitError &&
        error.code === "UNSUPPORTED_SHELF_CONTENT",
    );

    assert.deepStrictEqual(
      await fs.readFile(path.join(repo.rootPath, "binary.bin")),
      binary,
    );
  });

  it("publishes a recoverable artifact and removes only requested changes", async () => {
    const repo = await createRepo();
    await commitFiles(repo, {
      "selected.txt": "selected base\n",
      "unrelated.txt": "unrelated base\n",
    });
    await repo.writeFile("selected.txt", "selected changed\n");
    await repo.writeFile("new.txt", "new content\n");
    await repo.writeFile("unrelated.txt", "unrelated changed\n");
    await repo.writeFile("unrelated-new.txt", "keep me\n");

    const result = await service(repo).create({
      message: "selected files",
      selections: [wholePath("selected.txt"), untracked("new.txt")],
    });

    assert.strictEqual(result.ok, true);
    if (!result.ok) assert.fail("expected a shelf artifact");
    assert.deepStrictEqual(result.value.paths, ["new.txt", "selected.txt"]);
    await fs.access(result.value.finalPath);
    await assert.rejects(fs.access(result.value.temporaryPath));
    assert.strictEqual(
      await fs.readFile(path.join(repo.rootPath, "selected.txt"), "utf8"),
      "selected base\n",
    );
    await assert.rejects(fs.access(path.join(repo.rootPath, "new.txt")));
    assert.strictEqual(
      await fs.readFile(path.join(repo.rootPath, "unrelated.txt"), "utf8"),
      "unrelated changed\n",
    );
    assert.strictEqual(
      await fs.readFile(path.join(repo.rootPath, "unrelated-new.txt"), "utf8"),
      "keep me\n",
    );

    await repo.git("apply", result.value.finalPath);
    assert.strictEqual(
      await fs.readFile(path.join(repo.rootPath, "selected.txt"), "utf8"),
      "selected changed\n",
    );
    assert.strictEqual(
      await fs.readFile(path.join(repo.rootPath, "new.txt"), "utf8"),
      "new content\n",
    );
  });

  it("removes an index-only selection without changing the working-tree bytes", async () => {
    const repo = await createRepo();
    await commitFiles(repo, { "staged.txt": "base\n" });
    await repo.writeFile("staged.txt", "staged\n");
    await repo.git("add", "--", "staged.txt");
    const workspaceBefore = await fs.readFile(
      path.join(repo.rootPath, "staged.txt"),
    );

    const result = await service(repo).create({
      message: "index only",
      selections: [
        wholePath("staged.txt", {
          includeIndex: true,
          includeWorkingTree: false,
        }),
      ],
    });

    assert.strictEqual(result.ok, true);
    if (!result.ok) assert.fail("expected a shelf artifact");
    assert.deepStrictEqual(
      await fs.readFile(path.join(repo.rootPath, "staged.txt")),
      workspaceBefore,
    );
    assert.strictEqual(await repo.git("diff", "--cached", "--name-only"), "");
    assert.strictEqual(
      await repo.git("diff", "--name-only", "--", "staged.txt"),
      "staged.txt\n",
    );
    await fs.access(result.value.finalPath);
  });

  it("fails closed when staged-only content differs from unselected working-tree content", async () => {
    const repo = await createRepo();
    await commitFiles(repo, { "partial.txt": "base\n" });
    await repo.writeFile("partial.txt", "staged\n");
    await repo.git("add", "--", "partial.txt");
    await repo.writeFile("partial.txt", "workspace\n");
    const indexBefore = await rawIndex(repo);
    const workspaceBefore = await fs.readFile(
      path.join(repo.rootPath, "partial.txt"),
    );

    const result = await service(repo).create({
      message: "different layers",
      selections: [
        wholePath("partial.txt", {
          includeIndex: true,
          includeWorkingTree: false,
        }),
      ],
    });

    assert.strictEqual(result.ok, false);
    if (result.ok) assert.fail("expected a typed failure");
    assert.strictEqual(result.code, "UNSUPPORTED_SHELF_CONTENT");
    assert.deepStrictEqual(await rawIndex(repo), indexBefore);
    assert.deepStrictEqual(
      await fs.readFile(path.join(repo.rootPath, "partial.txt")),
      workspaceBefore,
    );
  });

  it("preserves exact old and new identities for a special-path rename", async () => {
    const repo = await createRepo();
    const oldPath = 'old name\t"quoted".txt';
    const newPath = 'new name\t"quoted".txt';
    await commitFiles(repo, { [oldPath]: "rename content\n" });
    await fs.rename(
      path.join(repo.rootPath, oldPath),
      path.join(repo.rootPath, newPath),
    );
    await repo.git("add", "-A");

    const result = await service(repo).create({
      message: "special rename",
      selections: [
        wholePath(newPath, {
          oldPath,
          includeIndex: true,
          includeWorkingTree: false,
        }),
      ],
    });

    assert.strictEqual(result.ok, true, result.ok ? undefined : result.message);
    if (!result.ok) assert.fail("expected a shelf artifact");
    assert.deepStrictEqual(result.value.pathIdentities, [
      { oldPath, path: newPath },
    ]);
    assert.strictEqual(
      await fs.readFile(path.join(repo.rootPath, newPath), "utf8"),
      "rename content\n",
    );
  });

  it("rejects a rename artifact with the wrong old-path identity", async () => {
    const repo = await createRepo();
    const oldPath = "old-name.txt";
    const newPath = "new-name.txt";
    await commitFiles(repo, { [oldPath]: "rename content\n" });
    await fs.rename(
      path.join(repo.rootPath, oldPath),
      path.join(repo.rootPath, newPath),
    );
    await repo.git("add", "-A");
    const indexBefore = await rawIndex(repo);

    class WrongOldPathExecutor extends GitExecutor {
      override async buffer(
        args: readonly string[],
        options?: GitRunOptions,
      ): Promise<Buffer> {
        const output = await super.buffer(args, options);
        if (args[0] === "diff" && args.includes("-M")) {
          return Buffer.from(
            output
              .toString()
              .replace("rename from old-name.txt", "rename from wrong-old.txt"),
          );
        }
        return output;
      }
    }
    const result = await service(
      repo,
      new WrongOldPathExecutor(repo.rootPath),
    ).create({
      message: "wrong identity",
      selections: [
        wholePath(newPath, {
          oldPath,
          includeIndex: true,
          includeWorkingTree: false,
        }),
      ],
    });

    assert.strictEqual(result.ok, false);
    if (result.ok) assert.fail("expected a typed failure");
    assert.strictEqual(result.code, "UNSUPPORTED_SHELF_CONTENT");
    assert.deepStrictEqual(await rawIndex(repo), indexBefore);
    assert.strictEqual(
      await fs.readFile(path.join(repo.rootPath, newPath), "utf8"),
      "rename content\n",
    );
  });

  it("restores already reverted paths after mutation failure and retains recovery artifact", async () => {
    const repo = await createRepo();
    await commitFiles(repo, {
      "first.txt": "first base\n",
      "middle.txt": "middle base\n",
      "second.txt": "second base\n",
    });
    await repo.writeFile("first.txt", "first changed\n");
    await repo.writeFile("middle.txt", "middle changed\n");
    await repo.git("add", "--", "middle.txt");
    await repo.writeFile("second.txt", "second changed\n");
    const indexBefore = await rawIndex(repo);

    class SecondCheckoutFails extends GitExecutor {
      private checkoutCount = 0;

      override buffer(
        args: readonly string[],
        options?: GitRunOptions,
      ): Promise<Buffer> {
        if (args[0] === "checkout" && args[1] === "HEAD") {
          this.checkoutCount++;
          if (this.checkoutCount === 2) {
            return Promise.reject(new Error("injected mutation failure"));
          }
        }
        return super.buffer(args, options);
      }
    }

    const result = await service(
      repo,
      new SecondCheckoutFails(repo.rootPath),
    ).create({
      message: "mutation recovery",
      selections: [
        wholePath("first.txt"),
        wholePath("middle.txt", {
          includeIndex: true,
          includeWorkingTree: false,
        }),
        wholePath("second.txt"),
      ],
    });

    assert.strictEqual(result.ok, false);
    if (result.ok) assert.fail("expected a typed failure");
    assert.match(result.recovery ?? "", /shelved\.patch/);
    const artifactPath = result.recovery?.match(/\S+shelved\.patch/)?.[0];
    assert.ok(artifactPath);
    if (artifactPath) await fs.access(artifactPath);
    assert.strictEqual(
      await fs.readFile(path.join(repo.rootPath, "first.txt"), "utf8"),
      "first changed\n",
    );
    assert.strictEqual(
      await fs.readFile(path.join(repo.rootPath, "middle.txt"), "utf8"),
      "middle changed\n",
    );
    assert.strictEqual(
      await fs.readFile(path.join(repo.rootPath, "second.txt"), "utf8"),
      "second changed\n",
    );
    assert.deepStrictEqual(await rawIndex(repo), indexBefore);
  });

  it("cleans temporary artifacts when validation rejects malformed or incomplete materialization", async () => {
    const repo = await createRepo();
    await commitFiles(repo, {
      "first.txt": "first base\n",
      "second.txt": "second base\n",
    });
    await repo.writeFile("first.txt", "first changed\n");
    await repo.writeFile("second.txt", "second changed\n");

    class IncompletePatchExecutor extends GitExecutor {
      override buffer(
        args: readonly string[],
        options?: GitRunOptions,
      ): Promise<Buffer> {
        if (args[0] === "diff" && args.includes("second.txt")) {
          return Promise.resolve(Buffer.alloc(0));
        }
        return super.buffer(args, options);
      }
    }
    const result = await service(
      repo,
      new IncompletePatchExecutor(repo.rootPath),
    ).create({
      message: "incomplete",
      selections: [wholePath("first.txt"), wholePath("second.txt")],
    });

    assert.strictEqual(result.ok, false);
    if (result.ok) assert.fail("expected a typed failure");
    assert.strictEqual(result.code, "UNSUPPORTED_SHELF_CONTENT");
    const shelfRoot = path.join(repo.rootPath, ".idea", "shelf");
    assert.deepStrictEqual(await fs.readdir(shelfRoot), []);
    assert.strictEqual(
      await fs.readFile(path.join(repo.rootPath, "first.txt"), "utf8"),
      "first changed\n",
    );
    assert.strictEqual(
      await fs.readFile(path.join(repo.rootPath, "second.txt"), "utf8"),
      "second changed\n",
    );
  });
});

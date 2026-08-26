import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { IndexTransaction } from "../../git/commit/indexTransaction";
import type { CommitPathSelection } from "../../git/commit/types";
import { PorcelainError } from "../../git/errors";
import { GitTestRepo } from "./gitTestRepo";

describe("IndexTransaction", () => {
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
    files: Readonly<Record<string, string>>,
  ): Promise<void> {
    for (const [filePath, content] of Object.entries(files)) {
      await repo.writeFile(filePath, content);
    }
    await repo.git("add", "-A");
    await repo.git("commit", "-m", "base");
  }

  function selection(
    filePath: string,
    options: Partial<CommitPathSelection> = {},
  ): CommitPathSelection {
    return {
      path: filePath,
      includeIndex: false,
      includeWorkingTree: false,
      ...options,
    };
  }

  async function rawIndex(repo: GitTestRepo): Promise<Buffer> {
    return repo.executor.buffer(["ls-files", "--stage", "-z"]);
  }

  async function rawIndexFor(
    repo: GitTestRepo,
    ...paths: string[]
  ): Promise<Buffer> {
    return repo.executor.buffer(["ls-files", "--stage", "-z", "--", ...paths]);
  }

  async function indexPaths(repo: GitTestRepo): Promise<string[]> {
    const output = await repo.executor.buffer(["ls-files", "-z"]);
    return output
      .toString()
      .split("\0")
      .filter((value) => value.length > 0);
  }

  it("restores an unrelated staged blob byte-for-byte after success", async () => {
    const repo = await createRepo();
    await commitFiles(repo, {
      "selected.txt": "selected base\n",
      "unrelated.bin": "unrelated base\n",
    });
    await repo.writeFile("selected.txt", "selected commit\n");
    const stagedBlob = Buffer.from([0, 1, 2, 3, 255, 10]);
    const workspaceBlob = Buffer.from([9, 8, 7, 6, 0, 10]);
    await repo.writeFile("unrelated.bin", stagedBlob);
    await repo.git("add", "--", "unrelated.bin");
    const stagedEntryBefore = await rawIndexFor(repo, "unrelated.bin");
    await repo.writeFile("unrelated.bin", workspaceBlob);

    const result = await new IndexTransaction(repo.executor).withPreparedIndex(
      [
        selection("selected.txt", {
          includeWorkingTree: true,
        }),
      ],
      async () => {
        await repo.git("commit", "-m", "selected");
        return "committed";
      },
    );

    assert.strictEqual(result, "committed");
    assert.deepStrictEqual(
      await repo.executor.buffer(["show", ":unrelated.bin"]),
      stagedBlob,
    );
    assert.deepStrictEqual(
      await fs.readFile(path.join(repo.rootPath, "unrelated.bin")),
      workspaceBlob,
    );
    assert.deepStrictEqual(
      await rawIndexFor(repo, "unrelated.bin"),
      stagedEntryBefore,
    );
    assert.strictEqual(
      await repo.git("show", "HEAD:selected.txt"),
      "selected commit\n",
    );
    assert.strictEqual(
      await repo.git("show", "HEAD:unrelated.bin"),
      "unrelated base\n",
    );
  });

  it("commits selected index-only content while leaving its unstaged delta", async () => {
    const repo = await createRepo();
    await commitFiles(repo, { "partial.txt": "base\n" });
    await repo.writeFile("partial.txt", "staged\n");
    await repo.git("add", "--", "partial.txt");
    await repo.writeFile("partial.txt", "workspace\n");

    await new IndexTransaction(repo.executor).withPreparedIndex(
      [
        selection("partial.txt", {
          includeIndex: true,
        }),
      ],
      async () => {
        await repo.git("commit", "-m", "index only");
      },
    );

    assert.strictEqual(await repo.git("show", "HEAD:partial.txt"), "staged\n");
    assert.strictEqual(
      await fs.readFile(path.join(repo.rootPath, "partial.txt"), "utf8"),
      "workspace\n",
    );
    assert.strictEqual(await repo.git("show", ":partial.txt"), "staged\n");
    assert.strictEqual(
      await repo.git("diff", "--name-only", "--", "partial.txt"),
      "partial.txt\n",
    );
  });

  it("prepares selected working-tree additions, modifications, deletions, and renames", async () => {
    const repo = await createRepo();
    await commitFiles(repo, {
      "modified.txt": "modified base\n",
      "deleted.txt": "delete me\n",
      "old-name.txt": "rename me\n",
    });
    await repo.writeFile("modified.txt", "modified workspace\n");
    await fs.rm(path.join(repo.rootPath, "deleted.txt"));
    await fs.rename(
      path.join(repo.rootPath, "old-name.txt"),
      path.join(repo.rootPath, "new-name.txt"),
    );
    await repo.writeFile("added.txt", "new file\n");

    await new IndexTransaction(repo.executor).withPreparedIndex(
      [
        selection("added.txt", { includeWorkingTree: true }),
        selection("modified.txt", { includeWorkingTree: true }),
        selection("deleted.txt", { includeWorkingTree: true }),
        selection("new-name.txt", {
          oldPath: "old-name.txt",
          includeWorkingTree: true,
        }),
      ],
      async () => {
        assert.deepStrictEqual(await indexPaths(repo), [
          "added.txt",
          "modified.txt",
          "new-name.txt",
        ]);
        assert.strictEqual(await repo.git("show", ":added.txt"), "new file\n");
        assert.strictEqual(
          await repo.git("show", ":modified.txt"),
          "modified workspace\n",
        );
        assert.strictEqual(
          await repo.git("show", ":new-name.txt"),
          "rename me\n",
        );
      },
    );
  });

  it("restores excluded staged deletions and both rename endpoints after success", async () => {
    const repo = await createRepo();
    await commitFiles(repo, {
      "deleted.txt": "delete me\n",
      "old-name.txt": "rename me\n",
      "selected.txt": "selected base\n",
    });
    await fs.rm(path.join(repo.rootPath, "deleted.txt"));
    await fs.rename(
      path.join(repo.rootPath, "old-name.txt"),
      path.join(repo.rootPath, "new-name.txt"),
    );
    await repo.git("add", "-A");
    const stagedEntriesBefore = await rawIndexFor(
      repo,
      "deleted.txt",
      "old-name.txt",
      "new-name.txt",
    );
    await repo.writeFile("selected.txt", "selected commit\n");

    await new IndexTransaction(repo.executor).withPreparedIndex(
      [selection("selected.txt", { includeWorkingTree: true })],
      async () => {
        await repo.git("commit", "-m", "selected");
      },
    );

    assert.deepStrictEqual(
      await rawIndexFor(repo, "deleted.txt", "old-name.txt", "new-name.txt"),
      stagedEntriesBefore,
    );
    const staged = await repo.git("diff", "--cached", "--name-status", "-M");
    assert.match(staged, /^D\tdeleted\.txt$/m);
    assert.match(staged, /^R100\told-name\.txt\tnew-name\.txt$/m);
  });

  it("restores an excluded staged entry after the selected initial commit", async () => {
    const repo = await createRepo();
    await repo.writeFile("excluded.txt", "excluded staged\n");
    await repo.git("add", "--", "excluded.txt");
    const excludedEntryBefore = await rawIndexFor(repo, "excluded.txt");
    await repo.writeFile("selected.txt", "selected initial\n");

    await new IndexTransaction(repo.executor).withPreparedIndex(
      [selection("selected.txt", { includeWorkingTree: true })],
      async () => {
        assert.deepStrictEqual(await indexPaths(repo), ["selected.txt"]);
        await repo.git("commit", "-m", "initial");
      },
    );

    assert.strictEqual(
      await repo.git("show", "HEAD:selected.txt"),
      "selected initial\n",
    );
    assert.deepStrictEqual(
      await rawIndexFor(repo, "excluded.txt"),
      excludedEntryBefore,
    );
    assert.strictEqual(
      await repo.git("diff", "--cached", "--name-status"),
      "A\texcluded.txt\n",
    );
  });

  it("restores the complete pre-operation index when the operation fails", async () => {
    const repo = await createRepo();
    await commitFiles(repo, {
      "selected.txt": "selected base\n",
      "unrelated.txt": "unrelated base\n",
    });
    await repo.writeFile("unrelated.txt", "unrelated staged\n");
    await repo.git("add", "--", "unrelated.txt");
    await repo.writeFile("selected.txt", "selected workspace\n");
    await repo.writeFile("operation-added.txt", "operation workspace\n");
    const indexBefore = await rawIndex(repo);

    await assert.rejects(
      new IndexTransaction(repo.executor).withPreparedIndex(
        [selection("selected.txt", { includeWorkingTree: true })],
        async () => {
          await repo.git("add", "-A");
          throw new Error("operation failed");
        },
      ),
      /operation failed/,
    );

    assert.deepStrictEqual(await rawIndex(repo), indexBefore);
    assert.strictEqual(
      await fs.readFile(path.join(repo.rootPath, "selected.txt"), "utf8"),
      "selected workspace\n",
    );
    assert.strictEqual(
      await fs.readFile(
        path.join(repo.rootPath, "operation-added.txt"),
        "utf8",
      ),
      "operation workspace\n",
    );
  });

  it("rejects unmerged paths before changing the index", async () => {
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
    const indexBefore = await rawIndex(repo);

    await assert.rejects(
      new IndexTransaction(repo.executor).withPreparedIndex(
        [selection("conflict.txt", { includeWorkingTree: true })],
        async () => {
          assert.fail("operation must not run");
        },
      ),
      (error: unknown) =>
        error instanceof PorcelainError && error.code === "UNMERGED_PATHS",
    );

    assert.deepStrictEqual(await rawIndex(repo), indexBefore);
  });

  it("rejects an unstaged same-path selection that excludes its staged counterpart", async () => {
    const repo = await createRepo();
    await commitFiles(repo, { "partial.txt": "base\n" });
    await repo.writeFile("partial.txt", "staged\n");
    await repo.git("add", "--", "partial.txt");
    await repo.writeFile("partial.txt", "workspace\n");
    const indexBefore = await rawIndex(repo);

    await assert.rejects(
      new IndexTransaction(repo.executor).withPreparedIndex(
        [selection("partial.txt", { includeWorkingTree: true })],
        async () => {
          assert.fail("operation must not run");
        },
      ),
      (error: unknown) =>
        error instanceof PorcelainError &&
        error.code === "PARTIAL_FILE_SELECTION_UNSUPPORTED",
    );

    assert.deepStrictEqual(await rawIndex(repo), indexBefore);
  });
});

import * as assert from "node:assert";
import * as path from "node:path";
import {
  type FenceFileSystem,
  resolveRepoReadPath,
  resolveRepoWritePath,
} from "../../views/workingTreeDiffModel";

const ROOT = path.resolve("/repos/demo");
const GIT_DIR = path.join(ROOT, ".git");

const resolve = (filePath: string) =>
  resolveRepoWritePath(ROOT, GIT_DIR, filePath, path);

/** A filesystem where every parent exists and one directory is a symlink. */
const linkedFs = (from: string, to: string): FenceFileSystem => ({
  existsSync: () => true,
  realpathSync: (candidate) =>
    candidate === from || candidate.startsWith(from + path.sep)
      ? to + candidate.slice(from.length)
      : candidate,
});

describe("resolveRepoWritePath", () => {
  it("resolves an ordinary repo-relative path", () => {
    assert.strictEqual(resolve("src/app.ts"), path.join(ROOT, "src", "app.ts"));
  });

  it("refuses traversal out of the repository", () => {
    assert.throws(() => resolve("../outside.txt"), /outside the repository/);
    assert.throws(
      () => resolve("src/../../outside.txt"),
      /outside the repository/,
    );
  });

  it("refuses the repository root itself", () => {
    assert.throws(() => resolve("."), /outside the repository/);
  });

  it("refuses writes into the git directory, however addressed", () => {
    assert.throws(() => resolve(".git/hooks/post-commit"), /git directory/);
    assert.throws(() => resolve("src/../.git/config"), /git directory/);
    assert.throws(() => resolve("sub/.git/config"), /git directory/);
  });

  it("refuses the git directory in any letter case", () => {
    // macOS and Windows filesystems are case-insensitive by default, so
    // ".GIT/hooks" names the real hooks directory.
    assert.throws(() => resolve(".GIT/hooks/pre-commit"), /git directory/);
    assert.throws(() => resolve(".Git/config"), /git directory/);
    assert.throws(() => resolve("sub/.GiT/config"), /git directory/);
  });

  it("accepts an honest path when a real filesystem is supplied", () => {
    const fs: FenceFileSystem = {
      existsSync: () => true,
      realpathSync: (candidate) => candidate,
    };
    assert.strictEqual(
      resolveRepoWritePath(ROOT, GIT_DIR, "src/app.ts", path, fs),
      path.join(ROOT, "src", "app.ts"),
    );
  });

  it("refuses a symlinked parent that escapes the repository", () => {
    const fs = linkedFs(path.join(ROOT, "docs"), path.resolve("/elsewhere"));
    assert.throws(
      () => resolveRepoWritePath(ROOT, GIT_DIR, "docs/x.txt", path, fs),
      /outside the repository/,
    );
  });

  it("refuses a symlinked parent resolving into the git directory", () => {
    const fs = linkedFs(path.join(ROOT, "docs"), GIT_DIR);
    assert.throws(
      () => resolveRepoWritePath(ROOT, GIT_DIR, "docs/hook.txt", path, fs),
      /git directory/,
    );
  });
});

describe("resolveRepoReadPath", () => {
  it("shares the containment fence without the git-dir rule", () => {
    assert.strictEqual(
      resolveRepoReadPath(ROOT, "src/app.ts", path),
      path.join(ROOT, "src", "app.ts"),
    );
    assert.throws(
      () => resolveRepoReadPath(ROOT, "../../etc/passwd", path),
      /outside the repository/,
    );
  });

  it("refuses a symlinked parent that escapes the repository", () => {
    const fs = linkedFs(path.join(ROOT, "docs"), path.resolve("/elsewhere"));
    assert.throws(
      () => resolveRepoReadPath(ROOT, "docs/x.txt", path, fs),
      /outside the repository/,
    );
  });
});

import * as assert from "node:assert";
import * as path from "node:path";
import { resolveRepoWritePath } from "../../views/workingTreeDiffModel";

const ROOT = path.resolve("/repos/demo");
const GIT_DIR = path.join(ROOT, ".git");

const resolve = (filePath: string) =>
  resolveRepoWritePath(ROOT, GIT_DIR, filePath, path);

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
});

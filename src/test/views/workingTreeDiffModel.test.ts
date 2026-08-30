import * as assert from "node:assert";
import {
  buildGitContentQuery,
  DIFF_KIND_LABEL,
  getWorkingTreeDiffKind,
  getWorkingTreeDiffResources,
  readGitContent,
  WORKING_INDEX_REF,
} from "../../views/workingTreeDiffModel";

describe("working tree diff model", () => {
  it("maps staged changes from the current commit to the index", () => {
    assert.deepStrictEqual(getWorkingTreeDiffKind(true), {
      left: "head",
      right: "index",
    });
  });

  it("maps unstaged changes from the index to the working tree", () => {
    assert.deepStrictEqual(getWorkingTreeDiffKind(false), {
      left: "index",
      right: "workingTree",
    });
  });

  it("maps an unspecified side to the whole change against the last commit", () => {
    assert.deepStrictEqual(getWorkingTreeDiffKind(undefined), {
      left: "head",
      right: "workingTree",
    });
  });

  it("names each side of a diff after the kind it was built from", () => {
    // The editor title has to be read off the same kind the panes were, not
    // off the staged flag: an omitted side means HEAD against the working
    // tree, which a flag alone cannot tell from index-against-working-tree.
    const label = (staged: boolean | undefined) => {
      const kind = getWorkingTreeDiffKind(staged);
      return `${DIFF_KIND_LABEL[kind.left]} \u2194 ${DIFF_KIND_LABEL[kind.right]}`;
    };
    assert.strictEqual(label(true), "HEAD \u2194 Index");
    assert.strictEqual(label(false), "Index \u2194 Working Tree");
    assert.strictEqual(label(undefined), "HEAD \u2194 Working Tree");
  });

  it("diffs the file on disk against the commit, skipping the index", () => {
    // What the Commit panel shows. A file with both indexed and working-tree
    // changes must not be split across two partial diffs, because ticking its
    // row commits the whole thing.
    assert.deepStrictEqual(
      getWorkingTreeDiffResources(
        { path: "partial.txt", status: "modified", staged: true },
        { left: "head", right: "workingTree" },
      ),
      {
        left: { source: "git", ref: "HEAD", path: "partial.txt" },
        right: { source: "workingTree", path: "partial.txt" },
      },
    );
  });

  it("keeps the empty endpoints when diffing a whole add or delete", () => {
    assert.deepStrictEqual(
      getWorkingTreeDiffResources(
        { path: "added.txt", status: "added", staged: true },
        { left: "head", right: "workingTree" },
      ).left,
      { source: "empty", path: "added.txt" },
    );
    assert.deepStrictEqual(
      getWorkingTreeDiffResources(
        { path: "gone.txt", status: "deleted", staged: true },
        { left: "head", right: "workingTree" },
      ).right,
      { source: "empty", path: "gone.txt" },
    );
  });

  it("uses the old path on the commit side of a whole rename", () => {
    assert.deepStrictEqual(
      getWorkingTreeDiffResources(
        {
          path: "new.txt",
          oldPath: "old.txt",
          status: "renamed",
          staged: true,
        },
        { left: "head", right: "workingTree" },
      ),
      {
        left: { source: "git", ref: "HEAD", path: "old.txt" },
        right: { source: "workingTree", path: "new.txt" },
      },
    );
  });

  it("uses an empty left side for additions and an empty right side for deletions", () => {
    assert.deepStrictEqual(
      getWorkingTreeDiffResources({
        path: "added.txt",
        status: "added",
        staged: true,
      }),
      {
        left: { source: "empty", path: "added.txt" },
        right: { source: "git", ref: WORKING_INDEX_REF, path: "added.txt" },
      },
    );
    assert.deepStrictEqual(
      getWorkingTreeDiffResources({
        path: "deleted.txt",
        status: "deleted",
        staged: false,
      }),
      {
        left: {
          source: "git",
          ref: WORKING_INDEX_REF,
          path: "deleted.txt",
        },
        right: { source: "empty", path: "deleted.txt" },
      },
    );
  });

  it("uses the old path on the commit side of a staged rename", () => {
    assert.deepStrictEqual(
      getWorkingTreeDiffResources({
        path: "new-name.txt",
        oldPath: "old-name.txt",
        status: "renamed",
        staged: true,
      }),
      {
        left: { source: "git", ref: "HEAD", path: "old-name.txt" },
        right: {
          source: "git",
          ref: WORKING_INDEX_REF,
          path: "new-name.txt",
        },
      },
    );
  });
});

describe("working index content", () => {
  it("retains index identity and repository identity in the content URI", () => {
    const params = new URLSearchParams(
      buildGitContentQuery(WORKING_INDEX_REF, "repo-B"),
    );
    assert.strictEqual(params.get("ref"), WORKING_INDEX_REF);
    assert.strictEqual(params.get("repo"), "repo-B");
  });

  it("reads the sentinel through the selected repository index", async () => {
    let indexPath = "";
    const service = {
      getIndexFileContent: async (filePath: string) => {
        indexPath = filePath;
        return Buffer.from("index contents");
      },
      readFileContent: async () => {
        throw new Error("commit content should not be read");
      },
    };

    const content = await readGitContent(
      service,
      WORKING_INDEX_REF,
      "folder/file.txt",
    );

    assert.strictEqual(content.toString("utf8"), "index contents");
    assert.strictEqual(indexPath, "folder/file.txt");
  });

  it("does not convert an index read failure into empty content", async () => {
    const failure = new Error("index read failed");

    await assert.rejects(
      readGitContent(
        {
          getIndexFileContent: async () => {
            throw failure;
          },
        },
        WORKING_INDEX_REF,
        "file.txt",
      ),
      failure,
    );
  });
});

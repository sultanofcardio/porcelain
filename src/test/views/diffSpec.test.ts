import * as assert from "node:assert";
import * as vscode from "vscode";
import { refLabel, toDiffSpec } from "../../views/diffViewerManager";
import { buildGitContentUri } from "../../views/gitUri";
import {
  EMPTY_CONTENT_REF,
  WORKING_INDEX_REF,
  WORKING_TREE_REF,
} from "../../views/workingTreeDiffModel";

const REPO = "/repos/demo";
const PATH = "src/app.ts";

const revision = (ref: string) => buildGitContentUri(ref, PATH, REPO);
const onDisk = vscode.Uri.file(`${REPO}/${PATH}`);

describe("toDiffSpec", () => {
  it("accepts a diff between two revisions", () => {
    const spec = toDiffSpec(revision("aaaa111"), revision("bbbb222"), "t");
    assert.deepStrictEqual(spec, {
      repoId: REPO,
      path: PATH,
      leftRef: "aaaa111",
      rightRef: "bbbb222",
      title: "t",
    });
  });

  it("names the working tree with a sentinel when it is the modified side", () => {
    // The Commit panel's diffs put the real file on the right so the native
    // editor can edit it; the viewer has no URI to hand, so it asks the host
    // for that side by name instead.
    const spec = toDiffSpec(revision("HEAD"), onDisk, "t");
    assert.strictEqual(spec?.rightRef, WORKING_TREE_REF);
    assert.strictEqual(spec?.leftRef, "HEAD");
  });

  it("takes the path from the revision side, which is repo-relative", () => {
    // The file: URI carries an absolute path, and the host reads content by
    // repo-relative path.
    const spec = toDiffSpec(revision("HEAD"), onDisk, "t");
    assert.strictEqual(spec?.path, PATH);
  });

  it("handles the working tree on the left, as a swapped comparison would", () => {
    const spec = toDiffSpec(onDisk, revision("HEAD"), "t");
    assert.strictEqual(spec?.leftRef, WORKING_TREE_REF);
    assert.strictEqual(spec?.path, PATH);
  });

  it("carries the index sentinel through untouched", () => {
    const spec = toDiffSpec(revision(WORKING_INDEX_REF), onDisk, "t");
    assert.strictEqual(spec?.leftRef, WORKING_INDEX_REF);
    assert.strictEqual(spec?.rightRef, WORKING_TREE_REF);
  });

  it("keeps the empty sentinel, which is how an added file diffs", () => {
    const spec = toDiffSpec(revision(EMPTY_CONTENT_REF), onDisk, "t");
    assert.strictEqual(spec?.leftRef, EMPTY_CONTENT_REF);
  });

  it("declines a diff with no Porcelain side at all", () => {
    // Two ordinary files are somebody else's diff; routing it here would
    // hijack it.
    assert.strictEqual(toDiffSpec(onDisk, onDisk, "t"), null);
  });

  it("declines a scheme it cannot read", () => {
    const untitled = vscode.Uri.parse("untitled:Untitled-1");
    assert.strictEqual(toDiffSpec(revision("HEAD"), untitled, "t"), null);
  });

  it("declines a Porcelain URI with no repo, which would resolve anywhere", () => {
    const bare = vscode.Uri.parse(`porcelain:/${PATH}?ref=HEAD`);
    assert.strictEqual(toDiffSpec(bare, bare, "t"), null);
  });

  it("declines when a revision side carries no ref", () => {
    const noRef = vscode.Uri.parse(`porcelain:/${PATH}?repo=${REPO}`);
    assert.strictEqual(toDiffSpec(noRef, revision("HEAD"), "t"), null);
  });
});

describe("refLabel", () => {
  it("names the sentinels rather than leaking them to the header", () => {
    assert.strictEqual(refLabel(WORKING_TREE_REF), "Working tree");
    assert.strictEqual(refLabel(WORKING_INDEX_REF), "Index");
    assert.strictEqual(refLabel(EMPTY_CONTENT_REF), "None");
    assert.strictEqual(refLabel(""), "None");
  });

  it("abbreviates object names and leaves branch names whole", () => {
    assert.strictEqual(
      refLabel("af89dd2318a0c4f1b2e3d4c5a6b7c8d9e0f1a2b3"),
      "af89dd2",
    );
    assert.strictEqual(refLabel("feature/long-name"), "feature/long-name");
    assert.strictEqual(refLabel("HEAD"), "HEAD");
  });
});

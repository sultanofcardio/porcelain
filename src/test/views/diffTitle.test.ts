import * as assert from "node:assert";
import { buildDiffTitle, shortenRef } from "../../views/diffEditorManager";

describe("shortenRef", () => {
  it("abbreviates object names", () => {
    assert.strictEqual(
      shortenRef("af89dd2318a0c4f1b2e3d4c5a6b7c8d9e0f1a2b3"),
      "af89dd2",
    );
  });

  it("leaves branch and tag names whole", () => {
    // The previous blind substring(0, 7) turned this into "feature".
    assert.strictEqual(shortenRef("feature/long-name"), "feature/long-name");
    assert.strictEqual(shortenRef("main"), "main");
    assert.strictEqual(shortenRef("v1.2.0"), "v1.2.0");
  });

  it("leaves a short ref alone rather than padding or cutting it", () => {
    assert.strictEqual(shortenRef("HEAD"), "HEAD");
    assert.strictEqual(shortenRef(""), "");
  });
});

describe("buildDiffTitle", () => {
  const base = {
    filePath: "webview/src/shared/store/panel-store.ts",
    leftRef: "07748ba0111213141516171819202122232425",
    rightRef: "af89dd2318a0c4f1b2e3d4c5a6b7c8d9e0f1a2b3",
  };

  it("carries the file name, the position and both revisions", () => {
    assert.strictEqual(
      buildDiffTitle({ ...base, position: { current: 3, total: 7 } }),
      "panel-store.ts · 3 of 7 · 07748ba ↔ af89dd2",
    );
  });

  it("omits the position when there is no file list", () => {
    assert.strictEqual(
      buildDiffTitle({ ...base, position: null }),
      "panel-store.ts · 07748ba ↔ af89dd2",
    );
  });

  it("reports a cherry-pick range by commit count", () => {
    assert.strictEqual(
      buildDiffTitle({
        ...base,
        position: { current: 1, total: 2 },
        cherryPickCount: 4,
      }),
      "panel-store.ts · 1 of 2 · 4 commits",
    );
  });

  it("shows only the right revision for a root commit, which has no parent", () => {
    assert.strictEqual(
      buildDiffTitle({ ...base, leftRef: "" }),
      "panel-store.ts · af89dd2",
    );
  });

  it("falls back to the whole path when it has no separator", () => {
    assert.strictEqual(
      buildDiffTitle({ ...base, filePath: "README.md", leftRef: "main" }),
      "README.md · main ↔ af89dd2",
    );
  });
});

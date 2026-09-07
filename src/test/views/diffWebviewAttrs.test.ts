import * as assert from "node:assert";
import * as vscode from "vscode";
import {
  diffWebviewAttrs,
  resolvePresentation,
} from "../../views/diffViewerManager";
import { WORKING_TREE_REF } from "../../views/workingTreeDiffModel";

const SPEC = {
  repoId: "/repo",
  path: "src/app.ts",
  leftPath: "src/app.ts",
  rightPath: "src/app.ts",
  leftRef: "HEAD",
  rightRef: WORKING_TREE_REF,
  title: "app.ts (Working tree)",
};

/**
 * The webview payload is the diff surface's opening contract: everything the
 * webview knows before its first message arrives rides on these attributes.
 */
describe("diffWebviewAttrs", () => {
  afterEach(async () => {
    await vscode.workspace
      .getConfiguration("files")
      .update("autoSave", undefined, vscode.ConfigurationTarget.Global);
  });

  it("names the surface it is handed, not a setting of its own", () => {
    assert.strictEqual(
      diffWebviewAttrs(SPEC, "floatingWindow").presentation,
      "floatingWindow",
    );
    assert.strictEqual(
      diffWebviewAttrs(SPEC, "editorTab").presentation,
      "editorTab",
    );
  });

  it("carries the revisions and the editor settings alongside it", async () => {
    await vscode.workspace
      .getConfiguration("files")
      .update("autoSave", "onWindowChange", vscode.ConfigurationTarget.Global);
    const attrs = diffWebviewAttrs(SPEC, "editorTab");
    assert.strictEqual(attrs["left-ref"], "HEAD");
    assert.strictEqual(attrs["right-ref"], WORKING_TREE_REF);
    assert.strictEqual(attrs["diff-path"], "src/app.ts");
    assert.strictEqual(attrs["auto-save"], "onWindowChange");
  });
});

/**
 * The webview believes what this returns, and under files.autoSave
 * onWindowChange it writes the file when it thinks its window went away. A
 * preference for a floating window that the build could not honour must
 * therefore resolve to the tab the panel is actually sitting in.
 */
describe("resolvePresentation", () => {
  it("keeps a floating window when one was opened for the panel", () => {
    assert.strictEqual(
      resolvePresentation("floatingWindow", true, false),
      "floatingWindow",
    );
  });

  it("counts the detach fallback as reaching a floating window", () => {
    assert.strictEqual(
      resolvePresentation("floatingWindow", false, true),
      "floatingWindow",
    );
  });

  it("reports a tab when neither window command was available", () => {
    assert.strictEqual(
      resolvePresentation("floatingWindow", false, false),
      "editorTab",
    );
  });

  it("reports a tab whenever tabs were asked for", () => {
    assert.strictEqual(
      resolvePresentation("editorTab", false, false),
      "editorTab",
    );
    assert.strictEqual(
      resolvePresentation("editorTab", true, true),
      "editorTab",
    );
  });
});

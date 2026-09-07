import * as assert from "node:assert";
import * as vscode from "vscode";
import { diffWebviewAttrs } from "../../views/diffViewerManager";
import { CONFIG_SECTION, OPEN_IN_SETTING } from "../../views/floatingWindow";
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

async function setPresentation(value: string | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update(OPEN_IN_SETTING, value, vscode.ConfigurationTarget.Global);
}

/**
 * The webview payload is the diff surface's opening contract: everything the
 * webview knows before its first message arrives rides on these attributes.
 */
describe("diffWebviewAttrs", () => {
  afterEach(async () => {
    await setPresentation(undefined);
    await vscode.workspace
      .getConfiguration("files")
      .update("autoSave", undefined, vscode.ConfigurationTarget.Global);
  });

  it("names the surface the diff is rendered on", async () => {
    assert.strictEqual(diffWebviewAttrs(SPEC).presentation, "floatingWindow");

    await setPresentation("editorTab");
    assert.strictEqual(diffWebviewAttrs(SPEC).presentation, "editorTab");
  });

  it("carries the revisions and the editor settings alongside it", async () => {
    await vscode.workspace
      .getConfiguration("files")
      .update("autoSave", "onWindowChange", vscode.ConfigurationTarget.Global);
    const attrs = diffWebviewAttrs(SPEC);
    assert.strictEqual(attrs["left-ref"], "HEAD");
    assert.strictEqual(attrs["right-ref"], WORKING_TREE_REF);
    assert.strictEqual(attrs["diff-path"], "src/app.ts");
    assert.strictEqual(attrs["auto-save"], "onWindowChange");
  });
});

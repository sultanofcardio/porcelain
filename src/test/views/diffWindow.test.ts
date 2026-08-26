import * as assert from "node:assert";
import * as vscode from "vscode";
import { DiffWindow, supersededDiffTabs } from "../../views/diffWindow";
import {
  CONFIG_SECTION,
  getSurfacePresentation,
  OPEN_IN_SETTING,
} from "../../views/floatingWindow";
import { IDEA_GIT_SCHEME } from "../../views/gitContentProvider";
import { buildGitContentUri } from "../../views/gitUri";

const REPO = "repo-under-test";

function revision(ref: string, path: string): vscode.Uri {
  return buildGitContentUri(ref, path, REPO);
}

/** Every open tab across every window that IDEA Git owns as a diff. */
function ideaGitDiffTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.filter(
      (tab) =>
        tab.input instanceof vscode.TabInputTextDiff &&
        (tab.input.original.scheme === IDEA_GIT_SCHEME ||
          tab.input.modified.scheme === IDEA_GIT_SCHEME),
    ),
  );
}

async function closeEverything(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
}

async function setPresentation(value: string | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update(OPEN_IN_SETTING, value, vscode.ConfigurationTarget.Global);
}

/**
 * These run against real VS Code editor APIs, so they assert the invariant the
 * feature actually promises (one live diff at a time) rather than whether an
 * auxiliary window could be created, which depends on the host environment.
 */
describe("DiffWindow", () => {
  afterEach(async () => {
    await setPresentation(undefined);
    await closeEverything();
  });

  it("defaults to the floating presentation and honours an explicit override", async () => {
    assert.strictEqual(getSurfacePresentation(), "floatingWindow");

    await setPresentation("editorTab");
    assert.strictEqual(getSurfacePresentation(), "editorTab");

    await setPresentation("nonsense");
    assert.strictEqual(
      getSurfacePresentation(),
      "floatingWindow",
      "an unrecognized value must fall back to the default",
    );
  });

  it("opens the diff as an editor tab when configured to", async () => {
    await setPresentation("editorTab");
    const left = revision("aaaa111", "src/app.ts");
    const right = revision("bbbb222", "src/app.ts");

    await new DiffWindow().show(left, right, "app.ts (aaaa111..bbbb222)");

    const tabs = ideaGitDiffTabs();
    assert.strictEqual(tabs.length, 1, "expected exactly one diff tab");
    const input = tabs[0].input as vscode.TabInputTextDiff;
    assert.strictEqual(input.original.toString(), left.toString());
    assert.strictEqual(input.modified.toString(), right.toString());
  });

  it("replaces its contents instead of stacking up diffs", async () => {
    const diffWindow = new DiffWindow();

    await diffWindow.show(
      revision("aaaa111", "src/app.ts"),
      revision("bbbb222", "src/app.ts"),
      "app.ts",
    );
    const second = {
      left: revision("aaaa111", "src/other.ts"),
      right: revision("bbbb222", "src/other.ts"),
    };
    await diffWindow.show(second.left, second.right, "other.ts");

    const tabs = ideaGitDiffTabs();
    assert.strictEqual(
      tabs.length,
      1,
      `expected the second diff to replace the first, saw ${tabs.length} diffs`,
    );
    const input = tabs[0].input as vscode.TabInputTextDiff;
    assert.strictEqual(input.original.toString(), second.left.toString());
    assert.strictEqual(input.modified.toString(), second.right.toString());
  });

  it("creates the window before rendering into it", async () => {
    // The user-visible symptom of getting this backwards is a flash: the diff
    // renders in the main window, then jumps to its own.
    const calls: string[] = [];
    const original = vscode.commands.executeCommand;
    (vscode.commands as { executeCommand: unknown }).executeCommand = ((
      command: string,
      ...args: unknown[]
    ) => {
      calls.push(command);
      return (original as (...a: unknown[]) => Thenable<unknown>)(
        command,
        ...args,
      );
    }) as typeof vscode.commands.executeCommand;

    try {
      await new DiffWindow().show(
        revision("aaaa111", "src/first.ts"),
        revision("bbbb222", "src/first.ts"),
        "first.ts",
      );
    } finally {
      (vscode.commands as { executeCommand: unknown }).executeCommand =
        original;
    }

    const openedWindow = calls.indexOf("workbench.action.newEmptyEditorWindow");
    const rendered = calls.indexOf("vscode.diff");
    assert.ok(openedWindow >= 0, "expected an empty window to be created");
    assert.ok(
      openedWindow < rendered,
      "the window must exist before the diff renders into it",
    );
    assert.ok(
      !calls.includes("workbench.action.moveEditorToNewWindow"),
      "rendering then moving is the flashing path and must not be taken",
    );
  });

  it("supersedes this window's other diffs, but never a pinned one", () => {
    const incoming = {
      left: revision("aaaa111", "src/next.ts"),
      right: revision("bbbb222", "src/next.ts"),
    };
    const diffTab = (ref: string, path: string, isPinned = false): vscode.Tab =>
      ({
        input: new vscode.TabInputTextDiff(
          revision(ref, path),
          revision("bbbb222", path),
        ),
        isPinned,
      }) as unknown as vscode.Tab;
    const foreignTab = {
      input: new vscode.TabInputText(vscode.Uri.file("/tmp/scratch.ts")),
      isPinned: false,
    } as unknown as vscode.Tab;

    const stale = diffTab("aaaa111", "src/stale.ts");
    const superseded = supersededDiffTabs(
      [
        stale,
        diffTab("aaaa111", "src/keep.ts", true),
        diffTab("aaaa111", "src/next.ts"),
        foreignTab,
      ],
      incoming.left,
      incoming.right,
    );

    assert.deepStrictEqual(
      superseded,
      [stale],
      "only the unpinned IDEA Git diffs this one replaces may be closed",
    );
  });
});

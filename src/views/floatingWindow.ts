import * as vscode from "vscode";

/** Where Porcelain opens diff and changes surfaces. */
export type SurfacePresentation = "floatingWindow" | "editorTab";

export const CONFIG_SECTION = "porcelain";
export const OPEN_IN_SETTING = "diff.openIn";

/**
 * Read the user's preferred presentation for diff and changes surfaces.
 * Defaults to a floating window; any unrecognized value falls back to it too.
 */
export function getSurfacePresentation(): SurfacePresentation {
  const configured = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string>(OPEN_IN_SETTING);
  return configured === "editorTab" ? "editorTab" : "floatingWindow";
}

const NEW_EMPTY_EDITOR_WINDOW = "workbench.action.newEmptyEditorWindow";
const MOVE_EDITOR_TO_NEW_WINDOW = "workbench.action.moveEditorToNewWindow";

/** How long to wait for tab state to reach the extension host. */
const TAB_STATE_TIMEOUT_MS = 3000;

let availableCommands: Set<string> | undefined;
let unavailableNoticeShown = false;

/** Reset the cached capability probe. Test seam. */
export function resetFloatingWindowSupportCache(): void {
  availableCommands = undefined;
  unavailableNoticeShown = false;
}

async function hasCommand(id: string): Promise<boolean> {
  if (availableCommands === undefined) {
    try {
      availableCommands = new Set(await vscode.commands.getCommands(true));
    } catch {
      availableCommands = new Set();
    }
  }
  return availableCommands.has(id);
}

/**
 * Whether this VS Code build can put an editor in its own window at all.
 * Older builds and some forks ship neither command.
 */
export async function supportsFloatingWindows(): Promise<boolean> {
  return (
    (await hasCommand(NEW_EMPTY_EDITOR_WINDOW)) ||
    (await hasCommand(MOVE_EDITOR_TO_NEW_WINDOW))
  );
}

/**
 * Tell the user once per session that floating windows are unavailable and
 * that their diffs are opening as editor tabs instead. Staying quiet after the
 * first notice keeps a repeated action from turning into a stream of popups.
 */
function noticeFloatingUnavailable(): void {
  if (unavailableNoticeShown) return;
  unavailableNoticeShown = true;
  void vscode.window.showInformationMessage(
    "Porcelain: this editor build cannot open a separate window, so diffs will open as editor tabs.",
  );
}

/**
 * Open an empty detached window and leave its editor group focused, so the
 * next thing opened at `ViewColumn.Active` lands straight in it.
 *
 * This is what keeps a new surface from flashing: rendering it in the main
 * window and then moving it shows the content in the wrong place first.
 * Returns false when this build cannot make an empty window, leaving the
 * caller to fall back to `detachActiveEditor`.
 */
export async function openEmptyFloatingWindow(): Promise<boolean> {
  if (!(await hasCommand(NEW_EMPTY_EDITOR_WINDOW))) return false;
  try {
    await vscode.commands.executeCommand(NEW_EMPTY_EDITOR_WINDOW);
    return true;
  } catch (error) {
    console.error("[porcelain] opening an empty window failed:", error);
    return false;
  }
}

/**
 * Move the active editor into a new window and return the view column it
 * landed in, or undefined when the editor could not be detached (in which case
 * it stays where it is, as a normal tab).
 *
 * Only used on builds without `newEmptyEditorWindow`; it renders the editor in
 * the main window first, which the user sees as a flash.
 */
export async function detachActiveEditor(
  moved: (tab: vscode.Tab) => boolean,
): Promise<vscode.ViewColumn | undefined> {
  if (!(await hasCommand(MOVE_EDITOR_TO_NEW_WINDOW))) {
    noticeFloatingUnavailable();
    return undefined;
  }
  try {
    await vscode.commands.executeCommand(MOVE_EDITOR_TO_NEW_WINDOW);
  } catch (error) {
    console.error(
      "[porcelain] detaching editor into a new window failed:",
      error,
    );
    noticeFloatingUnavailable();
    return undefined;
  }
  return locateColumn(moved);
}

/**
 * The view column of the group holding the tab `owns` matches.
 *
 * Tab state reaches the extension host asynchronously, so a group opened in
 * this turn may not be visible yet; poll briefly rather than reading once.
 */
export async function locateColumn(
  owns: (tab: vscode.Tab) => boolean,
): Promise<vscode.ViewColumn | undefined> {
  const deadline = Date.now() + TAB_STATE_TIMEOUT_MS;
  for (;;) {
    const hosting = vscode.window.tabGroups.all.find((group) =>
      group.tabs.some(owns),
    );
    if (hosting) return hosting.viewColumn;
    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * True when `column` still hosts a tab group holding at least one tab matched
 * by `owns`. View columns are reused after a window closes, so identity alone
 * is not enough to decide a tracked window is still ours.
 */
export function isLiveGroup(
  column: vscode.ViewColumn | undefined,
  owns: (tab: vscode.Tab) => boolean,
): boolean {
  if (column === undefined) return false;
  const group = vscode.window.tabGroups.all.find(
    (candidate) => candidate.viewColumn === column,
  );
  return group?.tabs.some(owns) ?? false;
}

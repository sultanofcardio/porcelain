import * as vscode from "vscode";

/** Where IDEA Git opens diff and changes surfaces. */
export type SurfacePresentation = "floatingWindow" | "editorTab";

export const CONFIG_SECTION = "ideaGit";
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

const MOVE_EDITOR_TO_NEW_WINDOW = "workbench.action.moveEditorToNewWindow";

let floatingSupport: boolean | undefined;
let unavailableNoticeShown = false;

/** Reset the cached capability probe. Test seam. */
export function resetFloatingWindowSupportCache(): void {
  floatingSupport = undefined;
  unavailableNoticeShown = false;
}

/**
 * Whether this VS Code build can detach an editor group into its own window.
 * Probed once per session; older builds and some forks do not ship the command.
 */
export async function supportsFloatingWindows(): Promise<boolean> {
  if (floatingSupport === undefined) {
    try {
      const commands = await vscode.commands.getCommands(true);
      floatingSupport = commands.includes(MOVE_EDITOR_TO_NEW_WINDOW);
    } catch {
      floatingSupport = false;
    }
  }
  return floatingSupport;
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
    "IDEA Git: this editor build cannot open a separate window, so diffs will open as editor tabs.",
  );
}

/**
 * Move the active editor into a new window and return the view column it
 * landed in, or undefined when the editor could not be detached (in which case
 * it stays where it is, as a normal tab).
 */
export async function detachActiveEditor(): Promise<
  vscode.ViewColumn | undefined
> {
  if (!(await supportsFloatingWindows())) {
    noticeFloatingUnavailable();
    return undefined;
  }
  try {
    await vscode.commands.executeCommand(MOVE_EDITOR_TO_NEW_WINDOW);
  } catch (error) {
    console.error(
      "[idea-git] detaching editor into a new window failed:",
      error,
    );
    noticeFloatingUnavailable();
    return undefined;
  }
  return vscode.window.tabGroups.activeTabGroup?.viewColumn;
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

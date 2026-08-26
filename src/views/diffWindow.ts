import * as vscode from "vscode";
import {
  detachActiveEditor,
  getSurfacePresentation,
  isLiveGroup,
} from "./floatingWindow";
import { IDEA_GIT_SCHEME } from "./gitContentProvider";

/** Whether a tab is a diff of two IDEA Git content revisions. */
function isIdeaGitDiffTab(tab: vscode.Tab): boolean {
  const input = tab.input;
  if (!(input instanceof vscode.TabInputTextDiff)) return false;
  return (
    input.original.scheme === IDEA_GIT_SCHEME ||
    input.modified.scheme === IDEA_GIT_SCHEME
  );
}

/**
 * The single reusable diff surface.
 *
 * With the floating presentation there is exactly one diff window for the whole
 * session: the first diff creates it, every later diff replaces its contents.
 * Closing the window is not an error; the next diff simply creates a new one.
 */
export class DiffWindow {
  private column: vscode.ViewColumn | undefined;

  /** The view column currently hosting the diff window, if it is still open. */
  get activeColumn(): vscode.ViewColumn | undefined {
    return this.liveColumn();
  }

  async show(
    left: vscode.Uri,
    right: vscode.Uri,
    title: string,
  ): Promise<void> {
    if (getSurfacePresentation() === "editorTab") {
      await vscode.commands.executeCommand("vscode.diff", left, right, title);
      return;
    }

    const reuse = this.liveColumn();
    if (reuse !== undefined) {
      await vscode.commands.executeCommand("vscode.diff", left, right, title, {
        viewColumn: reuse,
        preview: true,
      });
      return;
    }

    await vscode.commands.executeCommand("vscode.diff", left, right, title, {
      viewColumn: vscode.ViewColumn.Active,
      preview: true,
    });
    this.column = await detachActiveEditor();
  }

  /**
   * The tracked column, or undefined once the window behind it is gone. The
   * tracked value is cleared on the way out so a later reuse check is cheap.
   */
  private liveColumn(): vscode.ViewColumn | undefined {
    if (!isLiveGroup(this.column, isIdeaGitDiffTab)) {
      this.column = undefined;
      return undefined;
    }
    return this.column;
  }
}

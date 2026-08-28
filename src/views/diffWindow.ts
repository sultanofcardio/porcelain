import * as vscode from "vscode";
import {
  type DiffViewerManager,
  getConfiguredViewer,
  toDiffSpec,
} from "./diffViewerManager";
import {
  detachActiveEditor,
  getSurfacePresentation,
  isLiveGroup,
  locateColumn,
  openEmptyFloatingWindow,
} from "./floatingWindow";
import { PORCELAIN_SCHEME } from "./gitContentProvider";

/** Whether a tab is a diff of two Porcelain content revisions. */
function isPorcelainDiffTab(tab: vscode.Tab): boolean {
  const input = tab.input;
  if (!(input instanceof vscode.TabInputTextDiff)) return false;
  return (
    input.original.scheme === PORCELAIN_SCHEME ||
    input.modified.scheme === PORCELAIN_SCHEME
  );
}

/** Whether a tab shows exactly this pair of revisions. */
function showsDiff(
  tab: vscode.Tab,
  left: vscode.Uri,
  right: vscode.Uri,
): boolean {
  const input = tab.input;
  return (
    input instanceof vscode.TabInputTextDiff &&
    input.original.toString() === left.toString() &&
    input.modified.toString() === right.toString()
  );
}

/**
 * The tabs a newly-opened diff replaces: this window's other Porcelain diffs,
 * minus anything pinned. Leaving pinned tabs alone makes pinning the way to
 * keep a diff around while the window keeps cycling.
 */
export function supersededDiffTabs(
  tabs: readonly vscode.Tab[],
  left: vscode.Uri,
  right: vscode.Uri,
): vscode.Tab[] {
  return tabs.filter(
    (tab) =>
      isPorcelainDiffTab(tab) && !tab.isPinned && !showsDiff(tab, left, right),
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

  /**
   * `viewer` is the Porcelain diff surface, when one is available. Routing
   * lives here because every diff in the extension funnels through `show()`,
   * so one decision covers commit diffs, comparisons, shelves and history
   * without touching any of their call sites.
   */
  constructor(private readonly viewer?: DiffViewerManager) {}

  /** The view column currently hosting the diff window, if it is still open. */
  get activeColumn(): vscode.ViewColumn | undefined {
    return this.liveColumn();
  }

  async show(
    left: vscode.Uri,
    right: vscode.Uri,
    title: string,
  ): Promise<void> {
    const spec =
      this.viewer && getConfiguredViewer() === "porcelain"
        ? toDiffSpec(left, right, title)
        : null;
    if (this.viewer && spec) {
      await this.viewer.show(spec);
      return;
    }

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
      await this.closeSupersededDiffs(reuse, left, right);
      return;
    }

    // Put an empty window up first so the diff renders where it belongs. The
    // new window's group is focused, so ViewColumn.Active is already it.
    const opened = await openEmptyFloatingWindow();
    await vscode.commands.executeCommand("vscode.diff", left, right, title, {
      viewColumn: vscode.ViewColumn.Active,
      preview: true,
    });
    const owns = (tab: vscode.Tab) => showsDiff(tab, left, right);
    this.column = opened
      ? await locateColumn(owns)
      : await detachActiveEditor(owns);
  }

  /**
   * Drop the diffs this one replaced. Preview reuse alone is not enough: it is
   * off entirely when the user disables preview editors, and a diff promoted to
   * a permanent tab stops being replaceable.
   */
  private async closeSupersededDiffs(
    column: vscode.ViewColumn,
    left: vscode.Uri,
    right: vscode.Uri,
  ): Promise<void> {
    const group = vscode.window.tabGroups.all.find(
      (candidate) => candidate.viewColumn === column,
    );
    if (!group) return;
    const superseded = supersededDiffTabs(group.tabs, left, right);
    if (superseded.length === 0) return;
    try {
      await vscode.window.tabGroups.close(superseded, true);
    } catch (error) {
      console.error("[porcelain] closing superseded diff tabs failed:", error);
    }
  }

  /**
   * The tracked column, or undefined once the window behind it is gone. The
   * tracked value is cleared on the way out so a later reuse check is cheap.
   */
  private liveColumn(): vscode.ViewColumn | undefined {
    if (!isLiveGroup(this.column, isPorcelainDiffTab)) {
      this.column = undefined;
      return undefined;
    }
    return this.column;
  }
}

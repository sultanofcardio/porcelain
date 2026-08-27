import * as vscode from "vscode";
import type { MessageRouter } from "../messages/messageRouter";
import {
  detachActiveEditor,
  getSurfacePresentation,
  openEmptyFloatingWindow,
} from "./floatingWindow";
import { getWebviewHtml } from "./html";

export class MergeEditorManager {
  private panels = new Map<string, vscode.WebviewPanel>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly messageRouter: MessageRouter,
  ) {}

  /**
   * Composite key so equal file paths in different repos cannot collide.
   * Uses a NUL separator (illegal in paths) to avoid ambiguity.
   */
  private panelKey(repoId: string, filePath: string): string {
    return `${repoId}\0${filePath}`;
  }

  async openMergeEditor(
    repoId: string,
    filePath: string,
    mergeMsg?: string,
  ): Promise<void> {
    const key = this.panelKey(repoId, filePath);
    const existing = this.panels.get(key);
    if (existing) {
      existing.reveal();
      return;
    }

    // Put an empty window up first so the editor renders where it belongs.
    const floating = getSurfacePresentation() === "floatingWindow";
    const detached = floating ? await openEmptyFloatingWindow() : false;

    const fileName = filePath.split("/").pop() ?? filePath;
    const panel = vscode.window.createWebviewPanel(
      "porcelain.mergeEditor",
      `Merge: ${fileName}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
      },
    );

    panel.webview.html = getWebviewHtml(
      panel.webview,
      this.extensionUri,
      "merge",
      {
        "repo-id": repoId,
        file: filePath,
        "merge-msg": mergeMsg ?? "",
      },
    );

    const routerDisposable = this.messageRouter.registerWebview(panel.webview);

    this.panels.set(key, panel);
    panel.onDidDispose(() => {
      this.panels.delete(key);
      routerDisposable.dispose();
    });

    if (floating && !detached) {
      await detachActiveEditor(
        (tab) =>
          tab.input instanceof vscode.TabInputWebview &&
          tab.label === panel.title,
      );
    } else if (!floating) {
      // Only worth maximizing when the editor shares the main window with
      // everything else; a window of its own is already all merge editor.
      void vscode.commands.executeCommand(
        "workbench.action.maximizeEditorHideSidebar",
      );
    }
  }

  closeMergeEditor(repoId: string, filePath: string): void {
    const key = this.panelKey(repoId, filePath);
    const panel = this.panels.get(key);
    if (panel) {
      panel.dispose();
    }
  }
}

import * as vscode from "vscode";
import type { MessageRouter } from "../messages/messageRouter";
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

  openMergeEditor(repoId: string, filePath: string, mergeMsg?: string): void {
    const key = this.panelKey(repoId, filePath);
    const existing = this.panels.get(key);
    if (existing) {
      existing.reveal();
      return;
    }

    const fileName = filePath.split("/").pop() ?? filePath;
    const panel = vscode.window.createWebviewPanel(
      "porcelain.mergeEditor",
      `Merge: ${fileName}`,
      vscode.ViewColumn.One,
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

    // Maximize editor area for full-screen merge experience
    void vscode.commands.executeCommand(
      "workbench.action.maximizeEditorHideSidebar",
    );
  }

  closeMergeEditor(repoId: string, filePath: string): void {
    const key = this.panelKey(repoId, filePath);
    const panel = this.panels.get(key);
    if (panel) {
      panel.dispose();
    }
  }
}

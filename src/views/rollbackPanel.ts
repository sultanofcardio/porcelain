import * as vscode from "vscode";
import type { RepoRegistry } from "../git/repoRegistry";
import { formatRepoLabel } from "../git/repoRegistry";
import type { MessageRouter } from "../messages/messageRouter";
import { getWebviewHtml } from "./html";

export interface RollbackFileInfo {
  path: string;
  status: string;
  staged: boolean;
}

/**
 * Opens a "Rollback Changes" webview panel in an editor tab,
 * similar to IntelliJ IDEA's rollback dialog.
 */
export class RollbackPanel {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly messageRouter: MessageRouter,
    private readonly repoRegistry: RepoRegistry,
  ) {}

  /**
   * Disambiguated repo label for the given repo, computed from the CURRENT
   * registry list. Empty string when the repo is no longer registered.
   */
  private repoLabelFor(repoId: string): string {
    const target = this.repoRegistry.get(repoId)?.descriptor;
    if (!target) return "";
    return formatRepoLabel(target, this.repoRegistry.list());
  }

  open(repoId: string, files: RollbackFileInfo[]): void {
    const filesJson = JSON.stringify(files);
    const repoName = this.repoLabelFor(repoId);

    if (this.panel) {
      this.panel.reveal();
      // Re-send init data with updated file list and repo binding. `repoName`
      // updates the header to the newly-targeted repo (Task 25).
      this.panel.webview.postMessage({
        type: "event",
        event: "rollbackPanelInit",
        data: { repoId, files, repoName },
      });
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "porcelain.rollbackPanel",
      "Rollback Changes",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
        retainContextWhenHidden: false,
      },
    );

    this.panel.webview.html = getWebviewHtml(
      this.panel.webview,
      this.extensionUri,
      "rollback",
      { "repo-id": repoId, files: filesJson, "repo-name": repoName },
    );

    const routerDisposable = this.messageRouter.registerWebview(
      this.panel.webview,
    );

    this.panel.onDidDispose(() => {
      routerDisposable.dispose();
      this.panel = undefined;
    });
  }

  close(): void {
    this.panel?.dispose();
  }
}

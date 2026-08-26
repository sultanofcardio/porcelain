import * as vscode from "vscode";
import type { RepoRegistry } from "../git/repoRegistry";
import { formatRepoLabel } from "../git/repoRegistry";
import type { MessageRouter } from "../messages/messageRouter";
import { getWebviewHtml } from "./html";

export class ConflictsManager {
  private panel: vscode.WebviewPanel | null = null;

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

  openConflictsPanel(repoId: string): void {
    const repoName = this.repoLabelFor(repoId);
    if (this.panel) {
      this.panel.reveal();
      // Re-send init data. The panel is reused (not recreated), so main.tsx
      // never re-runs; this re-init is what rebinds the bridge to the new repo
      // via bindRepo(payload.repoId). `repoName` updates the header to the
      // newly-targeted repo (Task 25). Mirrors pushPanel/rollbackPanel.
      this.panel.webview.postMessage({
        type: "event",
        event: "conflictsPanelInit",
        data: { repoId, repoName },
      });
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "porcelain.conflicts",
      "Conflicts",
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
      "conflicts",
      { "repo-id": repoId, "repo-name": repoName },
    );

    const routerDisposable = this.messageRouter.registerWebview(panel.webview);

    this.panel = panel;
    panel.onDidDispose(() => {
      this.panel = null;
      routerDisposable.dispose();
    });
  }
}

import * as vscode from "vscode";
import type { RepoRegistry } from "../git/repoRegistry";
import { formatRepoLabel } from "../git/repoRegistry";
import type { MessageRouter } from "../messages/messageRouter";
import { getWebviewHtml } from "./html";

/**
 * Opens a "Push Commits" webview panel in an editor tab,
 * similar to IntelliJ IDEA's push dialog.
 */
export class PushPanel {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly messageRouter: MessageRouter,
    private readonly repoRegistry: RepoRegistry,
  ) {}

  /**
   * Disambiguated repo label for the given repo, computed from the CURRENT
   * registry list so it stays correct as repos are added/removed. Empty string
   * when the repo is no longer registered (panel falls back to no suffix).
   */
  private repoLabelFor(repoId: string): string {
    const target = this.repoRegistry.get(repoId)?.descriptor;
    if (!target) return "";
    return formatRepoLabel(target, this.repoRegistry.list());
  }

  open(repoId: string, branchName: string, remoteName = "origin"): void {
    // Preparing the push data is asynchronous. The user can switch the global
    // active repo while getCurrentBranch/getDefaultRemote is in flight, so a
    // late continuation must not reveal or rebind this idle panel to the old
    // repo. Keep the request's Git reads bound to their captured repo, but only
    // expose the panel when that repo is still globally active.
    if (this.repoRegistry.getActiveId() !== repoId) return;

    const repoName = this.repoLabelFor(repoId);
    if (this.panel) {
      this.panel.reveal();
      // Re-send init data. The panel is reused (not recreated), so main.tsx
      // never re-runs; this re-init is what rebinds the bridge to the new repo
      // via bindRepo(payload.repoId). The remote key is `remote` to match the
      // create-time `data-remote` dataset (and the frontend's `payload.remote`
      // read) — previously this posted `remoteName`, which the frontend never
      // read, silently falling back to "origin". `repoName` updates the header
      // to the newly-targeted repo (Task 25).
      this.panel.webview.postMessage({
        type: "event",
        event: "pushPanelInit",
        data: { repoId, branchName, remote: remoteName, repoName },
      });
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "ideaGit.pushPanel",
      `Push Commits to ${branchName}`,
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
      "push",
      {
        "repo-id": repoId,
        branch: branchName,
        remote: remoteName,
        "repo-name": repoName,
      },
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

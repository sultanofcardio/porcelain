import * as vscode from "vscode";
import type { RepoRegistry } from "../git/repoRegistry";
import type { MessageRouter } from "../messages/messageRouter";
import { getWebviewHtml } from "./html";

export class CommitViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "porcelain.commitPanel";

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly messageRouter: MessageRouter,
    private readonly repoRegistry: RepoRegistry,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    const webview = webviewView.webview;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };

    webview.html = getWebviewHtml(webview, this.extensionUri, "commit");

    const routerDisposable = this.messageRouter.registerWebview(webview);
    webviewView.onDidDispose(() => routerDisposable.dispose());

    // First time opening: refresh the commit and log state after a delay
    setTimeout(() => {
      if (webviewView.visible) {
        const runtime = this.repoRegistry.getActive();
        runtime?.gitService.cache.invalidate();
        this.messageRouter.broadcastEvent("commitStateChanged", {
          repoId: runtime?.descriptor.id,
        });
        this.messageRouter.broadcastEvent("gitStateChanged", {
          scope: "all",
          repoId: runtime?.descriptor.id,
        });
      }
    }, 200);

    // Refresh both views when the Commit view becomes visible. The Commit view
    // and the bottom Git Log view own their visibility independently.
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        // Small delay to ensure the view is ready before refreshing its state
        setTimeout(() => {
          // Invalidate the active repo's git cache to ensure fresh data
          const runtime = this.repoRegistry.getActive();
          runtime?.gitService.cache.invalidate();
          this.messageRouter.broadcastEvent("commitStateChanged", {
            repoId: runtime?.descriptor.id,
          });
          this.messageRouter.broadcastEvent("gitStateChanged", {
            scope: "all",
            repoId: runtime?.descriptor.id,
          });
        }, 100);
      }
    });
  }
}

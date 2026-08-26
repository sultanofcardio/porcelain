import * as vscode from "vscode";
import type { GitRefIdentity } from "../git/branchDashboardState";
import { PorcelainError, PorcelainErrorCode } from "../git/errors";
import type { GitService } from "../git/gitService";
import type { MessageRouter } from "../messages/messageRouter";
import { getWebviewHtml } from "./html";

type CurrentRefGitService = Pick<
  GitService,
  "getCurrentBranch" | "resolveCommitRef"
>;

export async function resolveCurrentCompareRef(
  gitService: CurrentRefGitService,
): Promise<GitRefIdentity | null> {
  const branch = await gitService.getCurrentBranch();
  if (branch) {
    return {
      type: "local",
      name: branch,
      fullRef: `refs/heads/${branch}`,
    };
  }

  const headHash = await gitService.resolveCommitRef("HEAD");
  if (!headHash) return null;
  return {
    type: "detached",
    name: headHash.slice(0, 7),
    fullRef: headHash,
  };
}

export interface ComparePanelOpener {
  open(
    repoId: string,
    selectedRef: GitRefIdentity,
    currentRef: GitRefIdentity,
  ): void;
}

export function registerComparePanelHandlers(
  messageRouter: MessageRouter,
  comparePanelManager: ComparePanelOpener,
): void {
  messageRouter.handle("openCompareWithCurrent", async (params, ctx) => {
    if (!ctx) {
      throw new PorcelainError(
        PorcelainErrorCode.REPO_NOT_FOUND,
        "No repository context for comparison",
      );
    }
    const { repoId, gitService } = ctx;
    const selectedRef = params.ref as GitRefIdentity;
    const currentRef = await resolveCurrentCompareRef(gitService);
    if (!currentRef) {
      throw new PorcelainError(
        PorcelainErrorCode.INVALID_REF,
        "No current Git ref is available for comparison",
      );
    }
    comparePanelManager.open(repoId, selectedRef, currentRef);
    return { success: true };
  });
}

export class ComparePanelManager implements ComparePanelOpener {
  private panels = new Map<string, vscode.WebviewPanel>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly messageRouter: MessageRouter,
  ) {}

  private panelKey(
    repoId: string,
    selectedRef: GitRefIdentity,
    currentRef: GitRefIdentity,
  ): string {
    return `${repoId}\0${selectedRef.fullRef}\0${currentRef.fullRef}`;
  }

  open(
    repoId: string,
    selectedRef: GitRefIdentity,
    currentRef: GitRefIdentity,
  ): void {
    const key = this.panelKey(repoId, selectedRef, currentRef);
    const existing = this.panels.get(key);
    if (existing) {
      existing.reveal();
      void existing.webview.postMessage({
        type: "event",
        event: "comparePanelRefresh",
        data: {},
      });
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "porcelain.compare",
      `Compare: ${selectedRef.name} ↔ ${currentRef.name}`,
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
      "compare",
      {
        "repo-id": repoId,
        "selected-ref-type": selectedRef.type,
        "selected-ref-name": selectedRef.name,
        "selected-ref-full-ref": selectedRef.fullRef,
        "current-ref-type": currentRef.type,
        "current-ref-name": currentRef.name,
        "current-ref-full-ref": currentRef.fullRef,
      },
    );

    const routerDisposable = this.messageRouter.registerWebview(panel.webview);
    this.panels.set(key, panel);
    panel.onDidDispose(() => {
      this.panels.delete(key);
      routerDisposable.dispose();
    });
  }
}

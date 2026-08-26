import * as vscode from "vscode";
import type { MessageRouter } from "../messages/messageRouter";
import { detachActiveEditor, getSurfacePresentation } from "./floatingWindow";
import { getWebviewHtml } from "./html";

/** The two commits a Changes window compares, already ordered oldest-first. */
export interface ComparisonSpec {
  repoId: string;
  fromHash: string;
  toHash: string;
}

function shortHash(hash: string): string {
  return hash.slice(0, 8);
}

/**
 * Changes windows: one per comparison, each listing the files that differ
 * between two commits. Re-running the same comparison reveals the existing
 * window instead of opening a second copy of it.
 */
export class ChangesWindowManager {
  private panels = new Map<string, vscode.WebviewPanel>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly messageRouter: MessageRouter,
  ) {}

  private static key(spec: ComparisonSpec): string {
    return `${spec.repoId}\0${spec.fromHash}\0${spec.toHash}`;
  }

  async open(spec: ComparisonSpec): Promise<void> {
    const key = ChangesWindowManager.key(spec);
    const existing = this.panels.get(key);
    if (existing) {
      existing.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "ideaGit.changes",
      `Changes Between ${shortHash(spec.fromHash)} and ${shortHash(spec.toHash)}`,
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
      "changes",
      {
        "repo-id": spec.repoId,
        "from-hash": spec.fromHash,
        "to-hash": spec.toHash,
      },
    );

    const routerDisposable = this.messageRouter.registerWebview(panel.webview);
    this.panels.set(key, panel);
    panel.onDidDispose(() => {
      this.panels.delete(key);
      routerDisposable.dispose();
    });

    if (getSurfacePresentation() === "floatingWindow") {
      await detachActiveEditor();
    }
  }

  dispose(): void {
    for (const panel of this.panels.values()) panel.dispose();
    this.panels.clear();
  }
}

import * as vscode from "vscode";
import type { MessageRouter } from "../messages/messageRouter";
import {
  detachActiveEditor,
  getSurfacePresentation,
  openEmptyFloatingWindow,
} from "./floatingWindow";
import { PORCELAIN_SCHEME } from "./gitContentProvider";
import { getWebviewHtml } from "./html";

/** Where Porcelain renders a diff. */
export type DiffViewer = "native" | "porcelain";

export const VIEWER_SETTING = "diff.viewer";

/**
 * Read the configured diff viewer. Defaults to the native editor: the webview
 * surface has to earn the default by being at least as capable, and until it
 * has find, keyboard navigation and a screen-reader story it is not.
 */
export function getConfiguredViewer(): DiffViewer {
  const configured = vscode.workspace
    .getConfiguration("porcelain")
    .get<string>(VIEWER_SETTING);
  return configured === "porcelain" ? "porcelain" : "native";
}

/** The two revisions a diff webview shows. */
export interface DiffSpec {
  repoId: string;
  path: string;
  leftRef: string;
  rightRef: string;
  title: string;
}

/**
 * Whether the Porcelain surface can render this pair.
 *
 * Both sides must be Porcelain content revisions. A working-tree diff puts a
 * real `file:` URI on its modified side so the file stays editable in place —
 * a webview cannot offer that, so those diffs stay native by design rather
 * than by omission.
 */
export function toDiffSpec(
  left: vscode.Uri,
  right: vscode.Uri,
  title: string,
): DiffSpec | null {
  if (left.scheme !== PORCELAIN_SCHEME || right.scheme !== PORCELAIN_SCHEME) {
    return null;
  }
  const leftParams = new URLSearchParams(left.query);
  const rightParams = new URLSearchParams(right.query);
  const repoId = leftParams.get("repo") ?? rightParams.get("repo");
  const leftRef = leftParams.get("ref");
  const rightRef = rightParams.get("ref");
  if (!repoId || !leftRef || !rightRef) return null;

  const path = right.path.startsWith("/") ? right.path.slice(1) : right.path;
  if (!path) return null;

  return { repoId, path, leftRef, rightRef, title };
}

/**
 * The Porcelain diff surface: one reused webview panel, the same way the diff
 * window reuses one native editor.
 */
export class DiffViewerManager {
  private panel: vscode.WebviewPanel | undefined;
  private routerDisposable: vscode.Disposable | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly messageRouter: MessageRouter,
  ) {}

  async show(spec: DiffSpec): Promise<void> {
    const existing = this.panel;
    if (existing) {
      existing.title = spec.title;
      existing.webview.html = this.html(existing.webview, spec);
      existing.reveal(existing.viewColumn, true);
      return;
    }

    // Same ordering as every other surface: create the window first so the
    // content renders where it belongs instead of appearing here and jumping.
    const floating = getSurfacePresentation() === "floatingWindow";
    const detached = floating ? await openEmptyFloatingWindow() : false;

    const panel = vscode.window.createWebviewPanel(
      "porcelain.diff",
      spec.title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
      },
    );
    panel.webview.html = this.html(panel.webview, spec);

    this.routerDisposable = this.messageRouter.registerWebview(panel.webview);
    this.panel = panel;
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.routerDisposable?.dispose();
      this.routerDisposable = undefined;
    });

    if (floating && !detached) {
      await detachActiveEditor(
        (tab) =>
          tab.input instanceof vscode.TabInputWebview &&
          tab.label === panel.title,
      );
    }
  }

  private html(webview: vscode.Webview, spec: DiffSpec): string {
    return getWebviewHtml(webview, this.extensionUri, "diff", {
      "repo-id": spec.repoId,
      "diff-path": spec.path,
      "left-ref": spec.leftRef,
      "right-ref": spec.rightRef,
    });
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }
}

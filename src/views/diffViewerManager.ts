import * as vscode from "vscode";
import type { MessageRouter } from "../messages/messageRouter";
import { shortenRef } from "./diffEditorManager";
import {
  detachActiveEditor,
  getSurfacePresentation,
  openEmptyFloatingWindow,
} from "./floatingWindow";
import { PORCELAIN_SCHEME } from "./gitContentProvider";
import { getWebviewHtml } from "./html";
import {
  EMPTY_CONTENT_REF,
  WORKING_INDEX_REF,
  WORKING_TREE_REF,
} from "./workingTreeDiffModel";

/** Where Porcelain renders a diff. */
export type DiffViewer = "native" | "porcelain";

export const VIEWER_SETTING = "diff.viewer";

/**
 * Read the configured diff viewer. Still defaults to the native editor even
 * though the surface now handles working-tree diffs, shows in-viewer
 * placeholders for binary, image and oversized content, and has find,
 * keyboard navigation and a screen-reader story — flipping the default to
 * "porcelain" is a deliberate follow-up, not blocked on capability.
 */
export function getConfiguredViewer(): DiffViewer {
  const configured = vscode.workspace
    .getConfiguration("porcelain")
    .get<string>(VIEWER_SETTING);
  return configured === "porcelain" ? "porcelain" : "native";
}

/**
 * What a revision header should say for a ref.
 *
 * The sentinels are internal plumbing, so they are resolved here rather than
 * shipped to the webview for it to recognise — the viewer displays whatever
 * label it is handed and needs no knowledge of how content is addressed.
 */
export function refLabel(ref: string): string {
  if (ref === WORKING_TREE_REF) return "Working tree";
  if (ref === WORKING_INDEX_REF) return "Index";
  if (!ref || ref === EMPTY_CONTENT_REF) return "None";
  return shortenRef(ref);
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
 * Whether the Porcelain surface can render this pair, and with which revisions.
 *
 * A working-tree diff addresses the file on disk with a real `file:` URI, which
 * is what keeps that side editable in the native editor. The viewer cannot
 * offer editing, so it names that side with a sentinel ref and reads it from
 * disk instead; Edit Source is the way back to the real file.
 *
 * At least one side must still be a Porcelain revision, so an unrelated
 * `file:` ↔ `file:` diff that happens to pass through here is left alone.
 */
export function toDiffSpec(
  left: vscode.Uri,
  right: vscode.Uri,
  title: string,
): DiffSpec | null {
  const porcelainSides = [left, right].filter(
    (uri) => uri.scheme === PORCELAIN_SCHEME,
  );
  if (porcelainSides.length === 0) return null;
  if (
    (left.scheme !== PORCELAIN_SCHEME && left.scheme !== "file") ||
    (right.scheme !== PORCELAIN_SCHEME && right.scheme !== "file")
  ) {
    return null;
  }

  const repoId = porcelainSides
    .map((uri) => new URLSearchParams(uri.query).get("repo"))
    .find((id): id is string => Boolean(id));
  if (!repoId) return null;

  const refOf = (uri: vscode.Uri): string | null =>
    uri.scheme === PORCELAIN_SCHEME
      ? new URLSearchParams(uri.query).get("ref")
      : WORKING_TREE_REF;
  const leftRef = refOf(left);
  const rightRef = refOf(right);
  if (!leftRef || !rightRef) return null;

  // The path is repo-relative for a Porcelain revision but absolute for a file
  // on disk, and the host reads content by repo-relative path.
  const source = right.scheme === PORCELAIN_SCHEME ? right : left;
  const path = source.path.startsWith("/") ? source.path.slice(1) : source.path;
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

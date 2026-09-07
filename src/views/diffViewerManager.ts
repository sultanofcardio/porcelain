import * as vscode from "vscode";
import type { MessageRouter } from "../messages/messageRouter";
import { shortenRef } from "./diffEditorManager";
import {
  affectsEditorSettings,
  editorSettingsAttrs,
  readEditorSettings,
} from "./editorSettings";
import {
  detachActiveEditor,
  getSurfacePresentation,
  openEmptyFloatingWindow,
  type SurfacePresentation,
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
 * Read the configured diff viewer, which now defaults to the Porcelain
 * surface: it handles working-tree diffs, shows in-viewer placeholders for
 * binary, image and oversized content, and has find, keyboard navigation and
 * a screen-reader story. `native` remains available for anyone who prefers
 * VS Code's own diff editor.
 */
export function getConfiguredViewer(): DiffViewer {
  const configured = vscode.workspace
    .getConfiguration("porcelain")
    .get<string>(VIEWER_SETTING);
  return configured === "native" ? "native" : "porcelain";
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
  /** The file's display path — the right side's, matching the native title. */
  path: string;
  /**
   * Per-side read paths. A renamed or copied file diffs two different paths
   * (old on the left, new on the right); collapsing them to one made the
   * left read fail and the rename render as a whole-file addition.
   */
  leftPath: string;
  rightPath: string;
  leftRef: string;
  rightRef: string;
  title: string;
}

/**
 * The path of `uriPath` relative to `rootUriPath`, or null when it lies
 * outside the root. Both arguments are URI-form paths (forward slashes, a
 * leading slash before a Windows drive letter); `caseInsensitive` matches
 * Windows filesystem semantics, where `/c:/…` and `/C:/…` name one root.
 */
export function relativeToUriRoot(
  uriPath: string,
  rootUriPath: string,
  caseInsensitive: boolean,
): string | null {
  const root = rootUriPath.endsWith("/") ? rootUriPath : `${rootUriPath}/`;
  const matches = caseInsensitive
    ? uriPath.toLowerCase().startsWith(root.toLowerCase())
    : uriPath.startsWith(root);
  return matches ? uriPath.slice(root.length) : null;
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

  // Each Porcelain side carries its own repo-relative path — a rename
  // addresses the old path on the left and the new on the right. A `file:`
  // side's path is made relative against the repo root (the repoId): a
  // staged rename diffs the old path at HEAD against the *new* path on
  // disk, so borrowing the porcelain side's path would read — and save —
  // the wrong file. Only when the file sits outside the root does it fall
  // back to borrowing. The display path is the right side's, matching the
  // native title. The repoId is a native fsPath while uri.path is URI-form
  // (on Windows: `C:\repo` vs `/c:/repo` with a drive letter of either
  // case), so the root is normalized through vscode.Uri.file and matched
  // case-insensitively there.
  const relOf = (uri: vscode.Uri): string | null => {
    if (uri.scheme === PORCELAIN_SCHEME) {
      return uri.path.startsWith("/") ? uri.path.slice(1) : uri.path;
    }
    return relativeToUriRoot(
      uri.path,
      vscode.Uri.file(repoId).path,
      process.platform === "win32",
    );
  };
  const leftRel = relOf(left);
  const rightRel = relOf(right);
  const path = rightRel ?? leftRel;
  if (!path) return null;

  return {
    repoId,
    path,
    leftPath: leftRel ?? path,
    rightPath: rightRel ?? path,
    leftRef,
    rightRef,
    title,
  };
}

/**
 * The Porcelain diff surface: one reused webview panel, the same way the diff
 * window reuses one native editor.
 */
export class DiffViewerManager {
  private panel: vscode.WebviewPanel | undefined;
  /** Serialises show(): two quick opens racing openEmptyFloatingWindow would
   * each open a window, and the loser's stays empty forever. */
  private pendingShow: Promise<void> = Promise.resolve();
  /** The diff on screen: what a settings change is resolved against. */
  private current: DiffSpec | undefined;
  private readonly settingsListener: vscode.Disposable;
  private readonly windowStateListener: vscode.Disposable;
  /**
   * The surface the open panel actually landed on, resolved once when it was
   * created. A build without floating-window support keeps the panel as a
   * tab whatever the preference says, and re-showing or re-configuring must
   * not tell the webview otherwise: the panel stays in the window it was
   * born in.
   */
  private presentation: SurfacePresentation = "editorTab";

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly messageRouter: MessageRouter,
  ) {
    // The settings channel's live half. The initial values ride on the
    // webview's data-* payload; from then on every change to a forwarded key
    // is re-read for the open diff's file and broadcast, so flipping
    // files.autoSave takes effect in an open diff the way it does in an open
    // editor. Only the diff webview listens for the event.
    this.settingsListener = vscode.workspace.onDidChangeConfiguration(
      (event) => {
        const spec = this.current;
        if (!this.panel || !spec) return;
        const scope = settingsScope(spec);
        if (!affectsEditorSettings(event, scope)) return;
        this.messageRouter.broadcastEvent(
          "configChanged",
          readEditorSettings(scope),
        );
      },
    );
    // The docked half of onWindowChange autosave. A webview iframe's own
    // blur fires whenever focus leaves it, which is focus-change semantics,
    // so a diff on an editor tab learns about the window from the host
    // instead. A floating diff window is its own window and uses its blur.
    this.windowStateListener = vscode.window.onDidChangeWindowState((state) => {
      if (!this.panel) return;
      this.messageRouter.broadcastEvent("windowStateChanged", {
        focused: state.focused,
      });
    });
  }

  show(spec: DiffSpec): Promise<void> {
    const run = this.pendingShow.then(() => this.showNow(spec));
    this.pendingShow = run.catch(() => {});
    return run;
  }

  private async showNow(spec: DiffSpec): Promise<void> {
    this.current = spec;
    const existing = this.panel;
    if (existing) {
      existing.title = spec.title;
      existing.webview.html = this.html(existing.webview, spec);
      existing.reveal(existing.viewColumn, true);
      return;
    }

    // Same ordering as every other surface: create the window first so the
    // content renders where it belongs instead of appearing here and jumping.
    const configured = getSurfacePresentation();
    const floating = configured === "floatingWindow";
    const openedWindow = floating ? await openEmptyFloatingWindow() : false;
    this.presentation = resolvePresentation(configured, openedWindow, false);

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

    // Scoped to this panel rather than held on the class: a stale panel's
    // dispose must tear down its own registration and nothing else.
    const routerDisposable = this.messageRouter.registerWebview(panel.webview);
    this.panel = panel;
    panel.onDidDispose(() => {
      routerDisposable.dispose();
      if (this.panel === panel) {
        this.panel = undefined;
      }
    });

    if (floating && !openedWindow) {
      const detach = await detachActiveEditor(
        (tab) =>
          tab.input instanceof vscode.TabInputWebview &&
          tab.label === panel.title,
      );
      const landed = resolvePresentation(
        configured,
        openedWindow,
        detach.moved,
      );
      // Only the fallback path can reach here, and only a successful detach
      // changes the answer. The reassignment remounts the app once, in the
      // same turn the editor visibly moves to its own window.
      if (landed !== this.presentation) {
        this.presentation = landed;
        panel.webview.html = this.html(panel.webview, spec);
      }
    }
  }

  private html(webview: vscode.Webview, spec: DiffSpec): string {
    return getWebviewHtml(
      webview,
      this.extensionUri,
      "diff",
      diffWebviewAttrs(spec, this.presentation),
    );
  }

  dispose(): void {
    this.settingsListener.dispose();
    this.windowStateListener.dispose();
    this.panel?.dispose();
    this.panel = undefined;
    this.current = undefined;
    this.presentation = "editorTab";
  }
}

/**
 * The resource the settings are resolved for: the file on disk, so a
 * folder-level `files.autoSave` in a multi-root workspace applies to the
 * diffs of that folder. That is the working-tree side when there is one,
 * since it is the side autosave writes; otherwise the file the diff names.
 */
export function settingsScope(spec: DiffSpec): vscode.Uri {
  const path =
    spec.leftRef === WORKING_TREE_REF && spec.rightRef !== WORKING_TREE_REF
      ? spec.leftPath
      : spec.rightPath;
  return vscode.Uri.joinPath(vscode.Uri.file(spec.repoId), path);
}

/**
 * Where a diff panel ended up, as opposed to where it was asked to go.
 * Wanting a floating window is not having one: a build that ships neither
 * window command leaves the panel as a tab in the main window, and the
 * webview has to be told the truth, because onWindowChange autosave writes
 * to disk on what it believes is the window going away.
 */
export function resolvePresentation(
  configured: SurfacePresentation,
  openedWindow: boolean,
  detached: boolean,
): SurfacePresentation {
  if (configured !== "floatingWindow") return "editorTab";
  return openedWindow || detached ? "floatingWindow" : "editorTab";
}

/**
 * The data-* payload a diff webview opens with: which revisions it shows,
 * the editor settings it honours, and the surface it is rendered on. The
 * presentation is on the payload because the webview cannot tell a floating
 * window from an editor tab, and onWindowChange autosave has to.
 */
export function diffWebviewAttrs(
  spec: DiffSpec,
  presentation: SurfacePresentation,
): Record<string, string> {
  return {
    "repo-id": spec.repoId,
    "diff-path": spec.path,
    "left-path": spec.leftPath,
    "right-path": spec.rightPath,
    "left-ref": spec.leftRef,
    "right-ref": spec.rightRef,
    presentation,
    ...editorSettingsAttrs(readEditorSettings(settingsScope(spec))),
  };
}

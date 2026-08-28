import * as vscode from "vscode";
import { PorcelainError, PorcelainErrorCode } from "../git/errors";
import type { RepoRegistry } from "../git/repoRegistry";
import type { DiffFile } from "../git/types";
import type { DiffWindow } from "./diffWindow";
import { buildGitContentUri } from "./gitUri";

/**
 * Shorten a revision for display. Only abbreviates things that actually look
 * like object names — a branch or tag keeps its full name, which the previous
 * blind `substring(0, 7)` did not (it turned `feature/long-name` into
 * `feature`).
 */
export function shortenRef(ref: string): string {
  if (!ref) return "";
  return /^[0-9a-f]{8,40}$/i.test(ref) ? ref.slice(0, 7) : ref;
}

/**
 * The diff title, which is also where the file-stepper position is reported:
 * VS Code has no API for a toolbar item with a runtime label, and the compact
 * floating window shows no status bar, so the title is the only place a live
 * readout can go.
 *
 * `panel-store.ts · 3 of 7 · 07748ba ↔ af89dd2`
 */
export function buildDiffTitle(parts: {
  filePath: string;
  leftRef: string;
  rightRef: string;
  position?: { current: number; total: number } | null;
  cherryPickCount?: number;
}): string {
  const { filePath, leftRef, rightRef, position, cherryPickCount } = parts;
  const segments = [filePath.split("/").pop() || filePath];

  if (position) segments.push(`${position.current} of ${position.total}`);

  if (cherryPickCount && cherryPickCount > 1) {
    segments.push(`${cherryPickCount} commits`);
  } else {
    const left = shortenRef(leftRef);
    const right = shortenRef(rightRef);
    segments.push(left ? `${left} ↔ ${right}` : right);
  }

  return segments.join(" · ");
}

export class DiffEditorManager {
  /** Current diff navigation state */
  private diffFiles: DiffFile[] = [];
  private diffCommit = "";
  private diffRepoId = "";
  private diffIndex = -1;
  private diffBaseRef?: string;
  private diffCherryPickHashes?: string[];

  constructor(
    private readonly registry: RepoRegistry,
    private readonly diffWindow: DiffWindow,
  ) {}

  /** Set the file list for diff navigation */
  setDiffFileList(
    repoId: string,
    files: DiffFile[],
    commit: string,
    baseRef?: string,
    cherryPickHashes?: string[],
  ): void {
    this.diffRepoId = repoId;
    this.diffFiles = files;
    this.diffCommit = commit;
    this.diffBaseRef = baseRef;
    this.diffCherryPickHashes = cherryPickHashes;
    this.diffIndex = -1;
  }

  /** Set current index (when opening a specific file) */
  setCurrentIndex(index: number): void {
    this.diffIndex = index;
  }

  /**
   * Where the open diff sits in the file list, 1-based, or null when there is
   * no list or nothing has been opened from it yet.
   *
   * This is what the diff title reports. VS Code has no API for a toolbar item
   * with a runtime label, so the readout lives in the title rather than beside
   * the file-stepper buttons.
   */
  get position(): { current: number; total: number } | null {
    if (this.diffFiles.length === 0 || this.diffIndex < 0) return null;
    return { current: this.diffIndex + 1, total: this.diffFiles.length };
  }

  /** Navigate to next file diff */
  async nextDiff(): Promise<boolean> {
    if (this.diffFiles.length === 0) {
      void vscode.window.setStatusBarMessage(
        "$(info) No file list available. Open a diff from Changed Files first.",
        3000,
      );
      return false;
    }
    this.diffIndex = Math.min(this.diffIndex + 1, this.diffFiles.length - 1);
    await this.openCurrentDiff();
    return true;
  }

  /** Navigate to previous file diff */
  async prevDiff(): Promise<boolean> {
    if (this.diffFiles.length === 0) {
      void vscode.window.setStatusBarMessage(
        "$(info) No file list available. Open a diff from Changed Files first.",
        3000,
      );
      return false;
    }
    this.diffIndex = Math.max(this.diffIndex - 1, 0);
    await this.openCurrentDiff();
    return true;
  }

  private async openCurrentDiff(): Promise<void> {
    const file = this.diffFiles[this.diffIndex];
    if (!file) return;
    const filePath = file.newPath || file.oldPath;

    // No status-bar message: the position is in the diff title now, which is
    // visible from the floating window. The status bar is not.
    await this.openDiffEditor(
      this.diffRepoId,
      this.diffCommit,
      filePath,
      file,
      this.diffBaseRef,
      this.diffCherryPickHashes,
    );
  }

  async openDiffEditor(
    repoId: string,
    commit: string,
    filePath: string,
    fileMeta?: DiffFile,
    baseRef?: string,
    cherryPickHashes?: string[],
  ): Promise<void> {
    const runtime = this.registry.get(repoId);
    if (!runtime) {
      throw new PorcelainError(
        PorcelainErrorCode.REPO_NOT_FOUND,
        `Repository not available: ${repoId}`,
      );
    }
    const gitService = runtime.gitService;

    const status = fileMeta?.status ?? "modified";
    const oldPath = fileMeta?.oldPath ?? filePath;
    const newPath = fileMeta?.newPath ?? filePath;

    // Determine left (parent) and right (commit) refs
    let leftRef: string;
    let rightRef: string = commit;

    if (cherryPickHashes && cherryPickHashes.length > 1) {
      const range = await gitService.findFileRange(
        cherryPickHashes,
        newPath || oldPath,
      );
      if (range) {
        rightRef = range.newest;
        const parents = await gitService.getCommitParents(range.oldest);
        leftRef = parents[0] ?? "";
      } else {
        const parents = await gitService.getCommitParents(commit);
        leftRef = parents[0] ?? "";
      }
    } else if (baseRef) {
      leftRef = baseRef;
    } else {
      const parents = await gitService.getCommitParents(commit);
      leftRef = parents[0] ?? "";
    }

    // Build URIs based on file status
    let leftUri: vscode.Uri;
    let rightUri: vscode.Uri;

    switch (status) {
      case "added":
        leftUri = buildGitContentUri("empty", newPath, repoId);
        rightUri = buildGitContentUri(rightRef, newPath, repoId);
        break;
      case "deleted":
        leftUri = buildGitContentUri(leftRef, oldPath, repoId);
        rightUri = buildGitContentUri("empty", oldPath, repoId);
        break;
      case "renamed":
      case "copied":
        leftUri = buildGitContentUri(leftRef, oldPath, repoId);
        rightUri = buildGitContentUri(rightRef, newPath, repoId);
        break;
      default: // modified
        leftUri = buildGitContentUri(leftRef, newPath, repoId);
        rightUri = buildGitContentUri(rightRef, newPath, repoId);
        break;
    }

    const title = buildDiffTitle({
      filePath,
      leftRef,
      rightRef,
      position: this.position,
      cherryPickCount: cherryPickHashes?.length,
    });

    await this.diffWindow.show(leftUri, rightUri, title);
  }
}

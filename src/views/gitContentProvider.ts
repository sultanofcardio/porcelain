import * as vscode from "vscode";
import type { GitService } from "../git/gitService";
import type { RepoRegistry } from "../git/repoRegistry";
import { readGitContent } from "./workingTreeDiffModel";

export const IDEA_GIT_SCHEME = "idea-git";

/**
 * Provides virtual file content for git file revisions.
 * Uri format: idea-git:/<filePath>?ref=<commitHash>
 *
 * Implements both TextDocumentContentProvider (for text diff) and
 * FileSystemProvider (for binary files like images).
 */
export class GitContentProvider
  implements vscode.TextDocumentContentProvider, vscode.FileSystemProvider
{
  private externalContent: Map<string, string> | null = null;

  private _onDidChangeFile = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  constructor(private readonly registry: RepoRegistry) {}

  setExternalContentMap(map: Map<string, string>): void {
    this.externalContent = map;
  }

  /**
   * Resolve the GitService for a given URI. Reads the `?repo=` query param;
   * if present, looks up that repo explicitly. Otherwise (legacy URIs without
   * a repo param) falls back to the active repo.
   */
  private resolveGitService(uri: vscode.Uri): GitService | null {
    const repoId = new URLSearchParams(uri.query).get("repo");
    if (repoId) {
      return this.registry.get(repoId)?.gitService ?? null;
    }
    return this.registry.getActive()?.gitService ?? null; // legacy URI only
  }

  private async readContent(uri: vscode.Uri): Promise<Buffer> {
    const ref = new URLSearchParams(uri.query).get("ref") ?? "";
    const filePath = uri.path.startsWith("/") ? uri.path.slice(1) : uri.path;
    if (!ref || !filePath) return Buffer.alloc(0);
    const service = this.resolveGitService(uri);
    if (!service) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return readGitContent(service, ref, filePath);
  }

  // ─── TextDocumentContentProvider ──────────────────────────────────

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    // Check external content map first (used for shelf diffs)
    if (this.externalContent) {
      const external = this.externalContent.get(uri.toString());
      if (external !== undefined) {
        return external;
      }
    }

    return (await this.readContent(uri)).toString("utf8");
  }

  // ─── FileSystemProvider (for binary files) ────────────────────────

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  async stat(_uri: vscode.Uri): Promise<vscode.FileStat> {
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: 0,
    };
  }

  readDirectory(): Thenable<[string, vscode.FileType][]> {
    return Promise.resolve([]);
  }

  createDirectory(): void {}

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const buffer = await this.readContent(uri);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions("Read-only git content");
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions("Read-only git content");
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions("Read-only git content");
  }
}

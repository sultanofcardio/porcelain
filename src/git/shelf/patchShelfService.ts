import { constants, type Stats } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { IndexTransaction } from "../commit/indexTransaction";
import type { CommitPathSelection } from "../commit/types";
import type { GitExecutor } from "../core/gitExecutor";
import type { GitOperationResult } from "../core/operationResult";
import {
  type IdeaGitErrorCode as ErrorCode,
  IdeaGitErrorCode,
} from "../errors";
import type { WorkingTreeFile } from "../types";
import type { WorkingTreeService } from "../workingTree/workingTreeService";
import type { ShelfRequest } from "./nativeShelfService";
import { type ShelfArtifact, validateShelfArtifact } from "./shelfArtifact";

export type { ShelfRequest } from "./nativeShelfService";
export type { ShelfArtifact } from "./shelfArtifact";

interface PreparedPath {
  path: string;
  oldPath?: string;
  includeIndex: boolean;
  includeWorkingTree: boolean;
  untracked: boolean;
}

export class PatchShelfService {
  constructor(
    private readonly git: GitExecutor,
    private readonly workingTree: WorkingTreeService,
    private readonly indexTransaction = new IndexTransaction(git),
  ) {}

  async create(
    request: ShelfRequest,
  ): Promise<GitOperationResult<ShelfArtifact>> {
    let preflight: GitOperationResult<readonly PreparedPath[]>;
    try {
      preflight = await this.preflight(request);
    } catch (error) {
      return this.failure(
        IdeaGitErrorCode.UNSUPPORTED_SHELF_CONTENT,
        `The repository could not be inspected safely. ${this.errorMessage(error)}`,
        "The index and working tree were not changed. Refresh the repository status and retry.",
        error,
      );
    }
    if (!preflight.ok) return preflight;
    const selections = preflight.value;
    const shelfRoot = path.join(this.git.rootPath, ".idea", "shelf");

    let temporaryDirectory: string | undefined;
    let artifact: ShelfArtifact | undefined;
    try {
      const name = await this.uniqueName(
        shelfRoot,
        this.sanitizeName(request.message.trim() || "Changes"),
      );
      temporaryDirectory = await fs.mkdtemp(
        path.join(shelfRoot, ".shelf-tmp-"),
      );
      const temporaryPath = path.join(temporaryDirectory, "shelved.patch");
      const finalDirectory = path.join(shelfRoot, name);
      const finalPath = path.join(finalDirectory, "shelved.patch");
      artifact = {
        temporaryPath,
        finalPath,
        paths: selections.map((selection) => selection.path).sort(),
        pathIdentities: selections
          .map((selection) => ({
            path: selection.path,
            ...(selection.oldPath ? { oldPath: selection.oldPath } : {}),
          }))
          .sort((left, right) => left.path.localeCompare(right.path)),
      };

      const patch = await this.materialize(selections);
      await fs.writeFile(temporaryPath, patch);
      await validateShelfArtifact(this.git, artifact);

      await fs.rename(temporaryDirectory, finalDirectory);
      temporaryDirectory = undefined;
      await this.publishMetadata(shelfRoot, name, request.message);

      const mutation = await this.mutate(selections, artifact);
      if (!mutation.ok) return mutation;
      return { ok: true, value: artifact };
    } catch (error) {
      if (temporaryDirectory) {
        await fs.rm(temporaryDirectory, { recursive: true, force: true });
      }
      if (artifact && (await this.exists(artifact.finalPath))) {
        return this.failure(
          IdeaGitErrorCode.UNSUPPORTED_SHELF_CONTENT,
          `The shelf artifact was published, but shelving could not continue. ${this.errorMessage(error)}`,
          `The working tree was not changed. Keep the recovery artifact at ${artifact.finalPath}.`,
          error,
        );
      }
      return this.failure(
        IdeaGitErrorCode.UNSUPPORTED_SHELF_CONTENT,
        `The requested changes could not be materialized as a complete shelf. ${this.errorMessage(error)}`,
        "The index and working tree were not changed. Inspect the requested paths and retry.",
        error,
      );
    }
  }

  private async preflight(
    request: ShelfRequest,
  ): Promise<GitOperationResult<readonly PreparedPath[]>> {
    let changes: WorkingTreeFile[];
    try {
      changes = await this.workingTree.getWorkingTreeChanges();
    } catch (error) {
      return this.failure(
        IdeaGitErrorCode.UNSUPPORTED_SHELF_CONTENT,
        "The working tree could not be inspected safely.",
        "Refresh the repository status and retry.",
        error,
      );
    }
    const selections = this.resolveSelections(request.selections, changes);
    if (!selections.ok) return selections;

    const unmerged = new Set(
      (await this.git.buffer(["diff", "--name-only", "--diff-filter=U", "-z"]))
        .toString()
        .split("\0")
        .filter(Boolean),
    );

    for (const selection of selections.value) {
      if (
        !this.isRepositoryPath(selection.path) ||
        (selection.oldPath !== undefined &&
          !this.isRepositoryPath(selection.oldPath))
      ) {
        return this.unsupported(
          `The shelf selection for "${selection.path}" is malformed.`,
        );
      }
      const matching = this.matchingChanges(selection, changes);
      if (matching.length === 0) {
        return this.unsupported(
          `The requested path "${selection.path}" has no shelfable change.`,
        );
      }
      if (
        matching.some((change) => change.status === "conflicted") ||
        [selection.path, selection.oldPath].some(
          (value) => value !== undefined && unmerged.has(value),
        )
      ) {
        return this.unsupported(
          `The requested path "${selection.path}" has unresolved conflicts.`,
        );
      }
      if (selection.includeIndex && !matching.some((change) => change.staged)) {
        return this.unsupported(
          `The staged content for "${selection.path}" is no longer available.`,
        );
      }
      if (
        selection.includeWorkingTree &&
        !matching.some((change) => !change.staged)
      ) {
        return this.unsupported(
          `The working-tree content for "${selection.path}" is no longer available.`,
        );
      }
      if (
        selection.includeWorkingTree &&
        !selection.includeIndex &&
        matching.some((change) => change.staged)
      ) {
        return this.unsupported(
          `The working-tree-only change for "${selection.path}" cannot be represented independently of its staged content.`,
        );
      }

      const paths = [selection.oldPath, selection.path].filter(
        (value): value is string => value !== undefined,
      );
      for (const relativePath of paths) {
        const fullPath = path.join(this.git.rootPath, relativePath);
        let stats: Stats;
        try {
          stats = await fs.lstat(fullPath);
        } catch (error) {
          if (this.isMissing(error)) continue;
          return this.unsupported(
            `The requested path "${relativePath}" cannot be inspected.`,
            error,
          );
        }
        if (!stats.isFile()) {
          return this.unsupported(
            `The requested path "${relativePath}" is not a regular file.`,
          );
        }
        try {
          await fs.access(fullPath, constants.R_OK);
          const content = await fs.readFile(fullPath);
          if (selection.untracked && content.includes(0)) {
            return this.unsupported(
              `The untracked binary path "${relativePath}" cannot be represented safely.`,
            );
          }
        } catch (error) {
          return this.unsupported(
            `The requested path "${relativePath}" cannot be read.`,
            error,
          );
        }
      }
    }

    try {
      await this.verifyArtifactCapability(
        path.join(this.git.rootPath, ".idea", "shelf"),
      );
    } catch (error) {
      return this.unsupported(
        "The shelf artifact location is not writable.",
        error,
      );
    }
    return selections;
  }

  private resolveSelections(
    requested: readonly CommitPathSelection[] | undefined,
    changes: readonly WorkingTreeFile[],
  ): GitOperationResult<readonly PreparedPath[]> {
    if (requested && requested.length === 0) {
      return this.unsupported("At least one change must be selected.");
    }
    const source =
      requested ??
      changes.map((change) => ({
        path: change.path,
        ...(change.oldPath ? { oldPath: change.oldPath } : {}),
        includeIndex: change.staged,
        includeWorkingTree: !change.staged,
      }));
    const grouped = new Map<string, PreparedPath>();
    for (const selection of source) {
      const existing = grouped.get(selection.path);
      if (existing) {
        existing.includeIndex ||= selection.includeIndex;
        existing.includeWorkingTree ||= selection.includeWorkingTree;
        if (!existing.oldPath && selection.oldPath) {
          existing.oldPath = selection.oldPath;
        }
        continue;
      }
      const matching = this.matchingChanges(selection, changes);
      grouped.set(selection.path, {
        ...selection,
        untracked: matching.some((change) => change.status === "untracked"),
      });
    }
    if (grouped.size === 0) {
      return this.unsupported("There are no changes to shelve.");
    }
    return {
      ok: true,
      value: [...grouped.values()].sort((a, b) => a.path.localeCompare(b.path)),
    };
  }

  private matchingChanges(
    selection: Pick<CommitPathSelection, "path" | "oldPath">,
    changes: readonly WorkingTreeFile[],
  ): WorkingTreeFile[] {
    return changes.filter(
      (change) =>
        change.path === selection.path ||
        change.oldPath === selection.path ||
        (selection.oldPath !== undefined &&
          (change.path === selection.oldPath ||
            change.oldPath === selection.oldPath)),
    );
  }

  private async verifyArtifactCapability(shelfRoot: string): Promise<void> {
    await fs.mkdir(shelfRoot, { recursive: true });
    const source = await fs.mkdtemp(path.join(shelfRoot, ".capability-"));
    const destination = `${source}-published`;
    try {
      await fs.writeFile(path.join(source, "probe"), "probe");
      await fs.rename(source, destination);
    } finally {
      await fs.rm(source, { recursive: true, force: true });
      await fs.rm(destination, { recursive: true, force: true });
    }
  }

  private async materialize(
    selections: readonly PreparedPath[],
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const hasHead =
      (
        await this.git.buffer(["rev-parse", "--verify", "HEAD"], {
          allowedExitCodes: [0, 128],
        })
      ).length > 0;
    for (const selection of selections) {
      let patch: Buffer;
      const paths = [selection.oldPath, selection.path].filter(
        (value): value is string => value !== undefined,
      );
      if (selection.untracked) {
        patch = await this.git.buffer(
          ["diff", "--binary", "--no-index", "--", "/dev/null", selection.path],
          { allowedExitCodes: [0, 1] },
        );
      } else if (!hasHead && selection.includeWorkingTree) {
        patch = await this.git.buffer(
          ["diff", "--binary", "--no-index", "--", "/dev/null", selection.path],
          { allowedExitCodes: [0, 1] },
        );
      } else if (selection.includeIndex && !selection.includeWorkingTree) {
        patch = await this.git.buffer([
          "diff",
          "--binary",
          "--full-index",
          "-M",
          "--cached",
          "--",
          ...paths,
        ]);
      } else {
        patch = await this.git.buffer([
          "diff",
          "--binary",
          "--full-index",
          "-M",
          "HEAD",
          "--",
          ...paths,
        ]);
      }
      if (patch.length === 0) {
        throw new Error(`The materialized shelf omitted "${selection.path}".`);
      }
      chunks.push(patch, Buffer.from("\n"));
    }
    return Buffer.concat(chunks);
  }

  private async publishMetadata(
    shelfRoot: string,
    name: string,
    description: string,
  ): Promise<void> {
    const finalPath = path.join(shelfRoot, `${name}.xml`);
    const temporaryPath = `${finalPath}.tmp`;
    const xml = `<changelist name="${this.escapeXml(name)}" date="${Date.now()}" recycled="false">\n  <option name="PATH" value="$PROJECT_DIR$/.idea/shelf/${this.escapeXml(name)}/shelved.patch" />\n  <option name="DESCRIPTION" value="${this.escapeXml(description)}" />\n</changelist>\n`;
    try {
      await fs.writeFile(temporaryPath, xml, "utf8");
      await fs.rename(temporaryPath, finalPath);
    } finally {
      await fs.rm(temporaryPath, { force: true });
    }
  }

  private async mutate(
    selections: readonly PreparedPath[],
    artifact: ShelfArtifact,
  ): Promise<GitOperationResult<ShelfArtifact>> {
    const changed: string[] = [];
    try {
      await this.indexTransaction.withPreparedIndex(selections, async () => {
        for (const selection of selections) {
          const paths = [selection.oldPath, selection.path].filter(
            (value): value is string => value !== undefined,
          );
          if (selection.includeIndex && !selection.includeWorkingTree) {
            await this.revertIndexPaths(paths);
            continue;
          }
          for (const relativePath of paths) {
            if (changed.includes(relativePath)) continue;
            await this.revertPath(relativePath);
            changed.push(relativePath);
          }
        }
      });
      return { ok: true, value: artifact };
    } catch (error) {
      let restoreError: unknown;
      for (const relativePath of [...changed].reverse()) {
        try {
          await this.git.buffer([
            "apply",
            `--include=${relativePath}`,
            artifact.finalPath,
          ]);
        } catch (candidate) {
          restoreError = candidate;
          break;
        }
      }
      const detail = restoreError
        ? ` Automatic restoration also failed: ${this.errorMessage(restoreError)}`
        : " Already reverted paths were restored from the artifact.";
      return this.failure(
        IdeaGitErrorCode.UNSUPPORTED_SHELF_CONTENT,
        `The shelf was published, but the requested paths could not all be reverted.${detail}`,
        `Keep the recovery artifact at ${artifact.finalPath}. Inspect the working tree before retrying or applying it manually.`,
        error,
      );
    }
  }

  private async revertIndexPaths(paths: readonly string[]): Promise<void> {
    const head = await this.git.buffer(["rev-parse", "--verify", "HEAD"], {
      allowedExitCodes: [0, 128],
    });
    if (head.length > 0) {
      await this.git.buffer(["reset", "--quiet", "HEAD", "--", ...paths]);
      return;
    }
    await this.git.withInput(
      ["update-index", "--force-remove", "-z", "--stdin"],
      Buffer.from(`${paths.join("\0")}\0`),
    );
  }

  private async revertPath(relativePath: string): Promise<void> {
    const inHead = await this.git.buffer(
      ["ls-tree", "-z", "HEAD", "--", relativePath],
      { allowedExitCodes: [0, 128] },
    );
    if (inHead.length > 0) {
      await this.git.buffer(["checkout", "HEAD", "--", relativePath]);
      return;
    }
    const inIndex = await this.git.buffer([
      "ls-files",
      "-z",
      "--",
      relativePath,
    ]);
    if (inIndex.length > 0) {
      await this.git.buffer(["rm", "-f", "--", relativePath]);
      return;
    }
    await fs.unlink(path.join(this.git.rootPath, relativePath));
  }

  private async uniqueName(
    shelfRoot: string,
    baseName: string,
  ): Promise<string> {
    let suffix = 0;
    while (true) {
      const candidate = suffix === 0 ? baseName : `${baseName}${suffix}`;
      if (
        !(await this.exists(path.join(shelfRoot, candidate))) &&
        !(await this.exists(path.join(shelfRoot, `${candidate}.xml`)))
      ) {
        return candidate;
      }
      suffix++;
    }
  }

  private sanitizeName(value: string): string {
    return (
      value
        .replace(/[<>:"/\\|?*]/g, "_")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 100) || "Changes"
    );
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private isRepositoryPath(value: string): boolean {
    if (!value || value.includes("\0") || path.isAbsolute(value)) return false;
    return !value.replaceAll("\\", "/").split("/").includes("..");
  }

  private async exists(value: string): Promise<boolean> {
    try {
      await fs.access(value);
      return true;
    } catch {
      return false;
    }
  }

  private isMissing(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    );
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private unsupported(
    message: string,
    cause?: unknown,
  ): GitOperationResult<readonly PreparedPath[]> {
    return this.failure(
      IdeaGitErrorCode.UNSUPPORTED_SHELF_CONTENT,
      message,
      "The index and working tree were not changed. Refresh the working tree, fix the unsupported content, and retry.",
      cause,
    );
  }

  private failure<T>(
    code: ErrorCode,
    message: string,
    recovery?: string,
    cause?: unknown,
  ): GitOperationResult<T> {
    return {
      ok: false,
      code,
      message,
      ...(recovery !== undefined ? { recovery } : {}),
      ...(cause !== undefined ? { cause } : {}),
    };
  }
}

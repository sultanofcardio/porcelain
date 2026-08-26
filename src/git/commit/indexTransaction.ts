import type { GitExecutor } from "../core/gitExecutor";
import { PorcelainError, PorcelainErrorCode } from "../errors";
import type { CommitPathSelection, IndexEntry } from "./types";

interface IndexSnapshot {
  raw: Buffer;
  entries: readonly CapturedIndexEntry[];
  entriesByPath: ReadonlyMap<string, IndexEntry>;
}

interface CapturedIndexEntry {
  mode: string;
  objectId: string;
  stage: number;
  path: string;
}

export class IndexTransaction {
  constructor(private readonly git: GitExecutor) {}

  async withPreparedIndex<T>(
    selections: readonly CommitPathSelection[],
    operation: () => Promise<T>,
  ): Promise<T> {
    const snapshot = await this.captureIndex();
    this.rejectUnmerged(snapshot.entries);

    const stagedPaths = await this.getStagedPaths();
    this.rejectPartialSamePathSelection(selections, stagedPaths);

    const selectedIndexPaths = this.selectionPaths(
      selections.filter((item) => item.includeIndex),
    );
    const excludedStagedPaths = stagedPaths.filter(
      (path) => !selectedIndexPaths.has(path),
    );
    const workingTreePaths = this.selectionPaths(
      selections.filter((item) => item.includeWorkingTree),
    );

    try {
      await this.excludeStagedPaths(excludedStagedPaths);
      if (workingTreePaths.size > 0) {
        await this.git.buffer(["add", "-A", "--", ...workingTreePaths]);
      }
    } catch (error) {
      await this.restoreFullIndex(snapshot, error);
      throw new PorcelainError(
        PorcelainErrorCode.INDEX_PREPARE_FAILED,
        "Could not prepare the selected changes in the index.",
        "The original index was restored. Inspect the selected paths and retry.",
      );
    }

    let result: T;
    try {
      result = await operation();
    } catch (error) {
      await this.restoreFullIndex(snapshot, error);
      throw error;
    }

    await this.restorePaths(snapshot, excludedStagedPaths);
    return result;
  }

  private async captureIndex(): Promise<IndexSnapshot> {
    const raw = await this.git.buffer(["ls-files", "--stage", "-z"]);
    const entries = this.parseEntries(raw);
    return {
      raw,
      entries,
      entriesByPath: new Map(
        entries
          .filter((entry) => entry.stage === 0)
          .map((entry) => [entry.path, { ...entry, stage: 0 }]),
      ),
    };
  }

  private parseEntries(raw: Buffer): CapturedIndexEntry[] {
    const entries: CapturedIndexEntry[] = [];
    for (const record of raw.toString().split("\0")) {
      if (record.length === 0) continue;
      const match = /^(\S+) ([0-9a-f]+) ([0-3])\t([\s\S]*)$/.exec(record);
      if (!match) {
        throw new PorcelainError(
          PorcelainErrorCode.INDEX_PREPARE_FAILED,
          "Git returned an index entry that could not be read safely.",
          "Inspect the repository index before retrying.",
        );
      }
      const [, mode, objectId, stageText, path] = match;
      const stage = Number(stageText);
      entries.push({ mode, objectId, stage, path });
    }
    return entries;
  }

  private rejectUnmerged(entries: readonly CapturedIndexEntry[]): void {
    if (entries.some((entry) => entry.stage !== 0)) {
      throw new PorcelainError(
        PorcelainErrorCode.UNMERGED_PATHS,
        "The index contains unmerged paths.",
        "Resolve the conflicts before committing selected changes.",
      );
    }
  }

  private async getStagedPaths(): Promise<string[]> {
    const output = await this.git.buffer([
      "diff",
      "--cached",
      "--name-only",
      "--no-renames",
      "-z",
    ]);
    return output
      .toString()
      .split("\0")
      .filter((path) => path.length > 0);
  }

  private rejectPartialSamePathSelection(
    selections: readonly CommitPathSelection[],
    stagedPaths: readonly string[],
  ): void {
    const staged = new Set(stagedPaths);
    for (const selection of selections) {
      if (
        selection.includeWorkingTree &&
        !selection.includeIndex &&
        [...this.pathsFor(selection)].some((path) => staged.has(path))
      ) {
        throw new PorcelainError(
          PorcelainErrorCode.PARTIAL_FILE_SELECTION_UNSUPPORTED,
          `Cannot select only the working-tree change for "${selection.path}" while excluding its staged change.`,
          "Include both changes, commit the staged change first, or unstage it before retrying.",
        );
      }
    }
  }

  private selectionPaths(
    selections: readonly CommitPathSelection[],
  ): Set<string> {
    const paths = new Set<string>();
    for (const selection of selections) {
      for (const path of this.pathsFor(selection)) paths.add(path);
    }
    return paths;
  }

  private pathsFor(selection: CommitPathSelection): readonly string[] {
    return selection.oldPath
      ? [selection.oldPath, selection.path]
      : [selection.path];
  }

  private async excludeStagedPaths(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    const head = await this.git.buffer(["rev-parse", "--verify", "HEAD"], {
      allowedExitCodes: [0, 128],
    });
    if (head.length > 0) {
      await this.git.buffer(["reset", "--quiet", "HEAD", "--", ...paths]);
      return;
    }
    await this.removePaths(paths);
  }

  private async restoreFullIndex(
    snapshot: IndexSnapshot,
    cause: unknown,
  ): Promise<void> {
    try {
      const currentPaths = await this.currentIndexPaths();
      await this.removePaths(currentPaths);
      if (snapshot.raw.length > 0) {
        await this.git.withInput(
          ["update-index", "-z", "--index-info"],
          snapshot.raw,
        );
      }
    } catch {
      throw this.restoreError(cause);
    }
  }

  private async restorePaths(
    snapshot: IndexSnapshot,
    paths: readonly string[],
  ): Promise<void> {
    if (paths.length === 0) return;
    try {
      await this.removePaths(paths);
      const input = this.serializeEntries(
        paths.flatMap((path) => {
          const entry = snapshot.entriesByPath.get(path);
          return entry ? [entry] : [];
        }),
      );
      if (input.length > 0) {
        await this.git.withInput(["update-index", "-z", "--index-info"], input);
      }
    } catch (error) {
      throw this.restoreError(error);
    }
  }

  private async currentIndexPaths(): Promise<string[]> {
    const output = await this.git.buffer(["ls-files", "-z"]);
    return output
      .toString()
      .split("\0")
      .filter((path) => path.length > 0);
  }

  private async removePaths(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.git.withInput(
      ["update-index", "--force-remove", "-z", "--stdin"],
      Buffer.from(`${paths.join("\0")}\0`),
    );
  }

  private serializeEntries(entries: readonly IndexEntry[]): Buffer {
    return Buffer.from(
      entries
        .map(
          (entry) =>
            `${entry.mode} ${entry.objectId} ${entry.stage}\t${entry.path}\0`,
        )
        .join(""),
    );
  }

  private restoreError(cause: unknown): PorcelainError {
    const detail = cause instanceof Error ? ` ${cause.message}` : "";
    return new PorcelainError(
      PorcelainErrorCode.INDEX_RESTORE_FAILED,
      `The repository index could not be restored automatically.${detail}`,
      "Do not discard the working tree. Back up your files, inspect the index with Git, and restore or restage changes before retrying.",
    );
  }
}

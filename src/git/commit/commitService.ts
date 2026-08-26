import type { GitExecutor } from "../core/gitExecutor";
import type { GitOperationResult } from "../core/operationResult";
import { IdeaGitError, IdeaGitErrorCode } from "../errors";
import type { CommitRequest, WorkingTreeFile } from "../types";
import type { WorkingTreeService } from "../workingTree/workingTreeService";
import type { IndexTransaction } from "./indexTransaction";
import type { CommitPathSelection } from "./types";

export class CommitService {
  constructor(
    private readonly git: GitExecutor,
    private readonly workingTree: WorkingTreeService,
    private readonly indexTransaction: IndexTransaction,
  ) {}

  async commitSelected(
    request: CommitRequest,
  ): Promise<GitOperationResult<void>> {
    if (!request.message.trim()) {
      return this.failure(
        IdeaGitErrorCode.COMMIT_REJECTED,
        "A commit message is required.",
        "Enter a commit message and retry.",
      );
    }
    if (request.selections.length === 0) {
      return this.failure(
        IdeaGitErrorCode.COMMIT_REJECTED,
        "At least one change must be selected.",
        "Select one or more staged or unstaged changes and retry.",
      );
    }

    const selections = this.groupSelections(request);
    const partialFailure = await this.rejectPartialSelection(selections);
    if (partialFailure) return partialFailure;

    try {
      await this.indexTransaction.withPreparedIndex(selections, async () => {
        try {
          const args = ["commit", "-m", request.message];
          if (request.amend) args.push("--amend");
          await this.git.buffer(args);
        } catch (error) {
          if (this.isCancellation(error)) {
            throw new IdeaGitError(
              IdeaGitErrorCode.OPERATION_CANCELLED,
              "The commit was cancelled.",
              "No changes were committed. Retry when ready.",
            );
          }
          if (error instanceof IdeaGitError) throw error;
          throw new IdeaGitError(
            IdeaGitErrorCode.COMMIT_REJECTED,
            `Git rejected the commit. ${this.errorMessage(error)}`,
            "Review the commit output and repository hooks, then retry.",
          );
        }
      });
      return { ok: true, value: undefined };
    } catch (error) {
      if (error instanceof IdeaGitError) {
        return this.failure(error.code, error.message, error.recovery, error);
      }
      return this.failure(
        IdeaGitErrorCode.INDEX_PREPARE_FAILED,
        "Could not prepare the selected changes in the index.",
        "Inspect the repository index and retry.",
        error,
      );
    }
  }

  private groupSelections(request: CommitRequest): CommitPathSelection[] {
    const grouped = new Map<string, CommitPathSelection>();
    for (const item of request.selections) {
      const existing = grouped.get(item.path);
      if (existing) {
        existing.includeIndex ||= item.staged;
        existing.includeWorkingTree ||= !item.staged;
        if (!existing.oldPath && item.oldPath) existing.oldPath = item.oldPath;
        continue;
      }
      grouped.set(item.path, {
        path: item.path,
        ...(item.oldPath ? { oldPath: item.oldPath } : {}),
        includeIndex: item.staged,
        includeWorkingTree: !item.staged,
      });
    }
    return [...grouped.values()];
  }

  private async rejectPartialSelection(
    selections: readonly CommitPathSelection[],
  ): Promise<GitOperationResult<void> | undefined> {
    let current: WorkingTreeFile[];
    try {
      current = await this.workingTree.getWorkingTreeChanges();
    } catch (error) {
      return this.failure(
        IdeaGitErrorCode.INDEX_PREPARE_FAILED,
        "Could not inspect the current staged changes.",
        "Refresh the working tree and retry.",
        error,
      );
    }
    const stagedPaths = new Set(
      current.filter((item) => item.staged).map((item) => item.path),
    );
    const partial = selections.find(
      (item) =>
        item.includeWorkingTree &&
        !item.includeIndex &&
        stagedPaths.has(item.path),
    );
    if (!partial) return undefined;
    return this.failure(
      IdeaGitErrorCode.PARTIAL_FILE_SELECTION_UNSUPPORTED,
      `Cannot select only the working-tree change for "${partial.path}" while excluding its staged change.`,
      "Include both changes, commit the staged change first, or unstage it before retrying.",
    );
  }

  private isCancellation(error: unknown): boolean {
    return (
      (error instanceof IdeaGitError &&
        error.code === IdeaGitErrorCode.OPERATION_CANCELLED) ||
      (error instanceof Error &&
        (error.name === "AbortError" || error.name === "CancellationError"))
    );
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private failure(
    code: (typeof IdeaGitErrorCode)[keyof typeof IdeaGitErrorCode],
    message: string,
    recovery?: string,
    cause?: unknown,
  ): GitOperationResult<void> {
    return {
      ok: false,
      code,
      message,
      ...(recovery !== undefined ? { recovery } : {}),
      ...(cause !== undefined ? { cause } : {}),
    };
  }
}

import type { GitExecutor } from "../core/gitExecutor";
import type { GitOperationResult } from "../core/operationResult";
import { PorcelainError, PorcelainErrorCode } from "../errors";
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
        PorcelainErrorCode.COMMIT_REJECTED,
        "A commit message is required.",
        "Enter a commit message and retry.",
      );
    }
    if (request.selections.length === 0) {
      return this.failure(
        PorcelainErrorCode.COMMIT_REJECTED,
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
          const options = request.options ?? {};
          if (options.signOff) args.push("--signoff");
          if (options.noVerify) args.push("--no-verify");
          if (options.author) {
            const author = options.author.trim();
            // A leading "-" would be read as an option, not a value.
            if (!author || author.startsWith("-")) {
              throw new PorcelainError(
                PorcelainErrorCode.COMMIT_REJECTED,
                `Invalid commit author: ${options.author}`,
                'Use the form "Name <email>".',
              );
            }
            args.push(`--author=${author}`);
          }
          await this.git.buffer(args);
        } catch (error) {
          if (this.isCancellation(error)) {
            throw new PorcelainError(
              PorcelainErrorCode.OPERATION_CANCELLED,
              "The commit was cancelled.",
              "No changes were committed. Retry when ready.",
            );
          }
          if (error instanceof PorcelainError) throw error;
          throw new PorcelainError(
            PorcelainErrorCode.COMMIT_REJECTED,
            `Git rejected the commit. ${this.errorMessage(error)}`,
            "Review the commit output and repository hooks, then retry.",
          );
        }
      });
      return { ok: true, value: undefined };
    } catch (error) {
      if (error instanceof PorcelainError) {
        return this.failure(error.code, error.message, error.recovery, error);
      }
      return this.failure(
        PorcelainErrorCode.INDEX_PREPARE_FAILED,
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
        PorcelainErrorCode.INDEX_PREPARE_FAILED,
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
      PorcelainErrorCode.PARTIAL_FILE_SELECTION_UNSUPPORTED,
      `Cannot select only the working-tree change for "${partial.path}" while excluding its staged change.`,
      "Include both changes, commit the staged change first, or unstage it before retrying.",
    );
  }

  private isCancellation(error: unknown): boolean {
    return (
      (error instanceof PorcelainError &&
        error.code === PorcelainErrorCode.OPERATION_CANCELLED) ||
      (error instanceof Error &&
        (error.name === "AbortError" || error.name === "CancellationError"))
    );
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private failure(
    code: (typeof PorcelainErrorCode)[keyof typeof PorcelainErrorCode],
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

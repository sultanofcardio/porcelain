import type { IndexTransaction } from "../commit/indexTransaction";
import type { CommitPathSelection } from "../commit/types";
import type { GitExecutor } from "../core/gitExecutor";
import type { GitOperationResult } from "../core/operationResult";
import {
  type IdeaGitErrorCode as ErrorCode,
  IdeaGitError,
  IdeaGitErrorCode,
} from "../errors";
import type { WorkingTreeFile } from "../types";
import type { WorkingTreeService } from "../workingTree/workingTreeService";

export interface ShelfRequest {
  message: string;
  selections?: readonly CommitPathSelection[];
}

export class NativeShelfService {
  constructor(
    private readonly git: GitExecutor,
    private readonly workingTree: WorkingTreeService,
    private readonly indexTransaction: IndexTransaction,
  ) {}

  async create(request: ShelfRequest): Promise<GitOperationResult<void>> {
    const validation = await this.validateRequest(request);
    if (validation) return validation;

    let createdRef: string | undefined;
    let postCommandVerificationFailed = false;
    try {
      const before = await this.stashRef();
      const operation = async () => {
        await this.git.buffer([
          "stash",
          "push",
          ...(request.selections ? ["--staged"] : ["-u"]),
          "-m",
          request.message.trim() || "Shelved changes",
        ]);
        let after: string | undefined;
        try {
          after = await this.stashRef();
        } catch (error) {
          postCommandVerificationFailed = true;
          throw error;
        }
        if (!after || after === before) {
          throw new IdeaGitError(
            IdeaGitErrorCode.UNSUPPORTED_SHELF_CONTENT,
            "Git did not create the expected shelf reference.",
            "The original index was restored. Refresh the working tree and retry after confirming the selected changes are still present.",
          );
        }
        createdRef = after;
      };

      if (request.selections) {
        await this.indexTransaction.withPreparedIndex(
          request.selections,
          operation,
        );
      } else {
        await operation();
      }
      return { ok: true, value: undefined };
    } catch (error) {
      if (postCommandVerificationFailed) {
        return this.failure(
          IdeaGitErrorCode.UNSUPPORTED_SHELF_CONTENT,
          "The shelf command completed, but its reference could not be verified; repository state may have changed.",
          "Do not retry or discard files yet. Run git stash list, inspect the index and working tree, then apply or pop the matching stash if the selected changes are no longer present.",
          error,
        );
      }
      if (error instanceof IdeaGitError) {
        const recovery =
          error.code === IdeaGitErrorCode.INDEX_RESTORE_FAILED && createdRef
            ? `The changes were saved in refs/stash at ${createdRef}, but the original index could not be restored. Back up the working tree and inspect the index before continuing.`
            : error.recovery;
        return this.failure(error.code, error.message, recovery, error);
      }
      return this.failure(
        IdeaGitErrorCode.INDEX_PREPARE_FAILED,
        `Git could not create the shelf. ${this.errorMessage(error)}`,
        "The original index was restored. Inspect the repository status and retry.",
        error,
      );
    }
  }

  private async validateRequest(
    request: ShelfRequest,
  ): Promise<GitOperationResult<void> | undefined> {
    if (request.selections && request.selections.length === 0) {
      return this.failure(
        IdeaGitErrorCode.UNSUPPORTED_SHELF_CONTENT,
        "At least one change must be selected.",
        "Select one or more staged or unstaged changes and retry.",
      );
    }

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
    if (!request.selections) {
      if (changes.length > 0) return undefined;
      return this.failure(
        IdeaGitErrorCode.UNSUPPORTED_SHELF_CONTENT,
        "There are no changes to shelve.",
        "Modify or stage a file before creating a shelf.",
      );
    }

    for (const selection of request.selections) {
      if (
        !this.isRepositoryPath(selection.path) ||
        (selection.oldPath !== undefined &&
          !this.isRepositoryPath(selection.oldPath)) ||
        (!selection.includeIndex && !selection.includeWorkingTree)
      ) {
        return this.failure(
          IdeaGitErrorCode.UNSUPPORTED_SHELF_CONTENT,
          `The shelf selection for "${selection.path}" is not valid.`,
          "Refresh the working tree and select the change again.",
        );
      }
      const matching = changes.filter(
        (change) =>
          change.path === selection.path ||
          change.oldPath === selection.path ||
          (selection.oldPath !== undefined &&
            (change.path === selection.oldPath ||
              change.oldPath === selection.oldPath)),
      );
      const hasRequestedIndex =
        !selection.includeIndex || matching.some((change) => change.staged);
      const hasRequestedWorkspace =
        !selection.includeWorkingTree ||
        matching.some((change) => !change.staged);
      if (!hasRequestedIndex || !hasRequestedWorkspace) {
        return this.failure(
          IdeaGitErrorCode.UNSUPPORTED_SHELF_CONTENT,
          `The selected content for "${selection.path}" is no longer available.`,
          "Refresh the working tree and select the current change before retrying.",
        );
      }
      if (matching.some((change) => change.status === "conflicted")) {
        return this.failure(
          IdeaGitErrorCode.UNMERGED_PATHS,
          `The selected path "${selection.path}" has unresolved conflicts.`,
          "Resolve the conflicts before creating a shelf.",
        );
      }
    }
    return undefined;
  }

  private async stashRef(): Promise<string | undefined> {
    const output = await this.git.buffer(
      ["rev-parse", "--verify", "refs/stash"],
      { allowedExitCodes: [0, 128] },
    );
    const value = output.toString().trim();
    return value || undefined;
  }

  private isRepositoryPath(value: string): boolean {
    if (!value || value.includes("\0") || value.startsWith("/")) return false;
    const parts = value.replaceAll("\\", "/").split("/");
    return !parts.includes("..");
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private failure(
    code: ErrorCode,
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

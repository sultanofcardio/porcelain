import type { CommandType } from "../../bridge/types";
import { beginRepoOperation } from "../repo-store";
import type {
  CommitOperationError,
  CommitOperationSlice,
  CommitSliceContext,
  WorkingTreeFile,
} from "./types";
import { workingTreeKey } from "./types";

export function createOperationSlice({
  set,
  get,
  coordinator,
  request,
}: CommitSliceContext): CommitOperationSlice {
  let operationSequence = 0;

  const runOperation = async <T>(
    name: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    let result!: T;
    const status = await coordinator.runLatest(
      `commit.operation.${name}.${++operationSequence}`,
      operation,
      (value) => {
        result = value;
      },
    );
    if (status === "stale") {
      throw new Error("Repository changed before operation completed");
    }
    return result;
  };

  const runMutationOperation = async <T>(
    name: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const releaseRepoBinding = beginRepoOperation();
    try {
      return await runOperation(name, operation);
    } finally {
      releaseRepoBinding();
    }
  };

  const clearOperationError = () => set({ operationError: null });

  const reportOperationError = (label: string, error: unknown) => {
    const normalized = normalizeOperationError(error);
    if (!isStaleOperationError(error)) {
      set({ operationError: normalized });
    }
    console.error(`${label} failed:`, error);
  };

  const mutateAndRefresh = async (
    label: string,
    command: CommandType,
    params?: Record<string, unknown>,
  ) => {
    clearOperationError();
    try {
      await runMutationOperation(label, async () => {
        await request(command, params);
        await get().fetchChanges();
      });
    } catch (error) {
      reportOperationError(label, error);
    }
  };

  const selectedChanges = (): WorkingTreeFile[] => {
    const { changes, selectedFiles } = get();
    return changes.filter((file) => selectedFiles.has(workingTreeKey(file)));
  };

  const commitWith = async (command: "commitChanges" | "commitAndPush") => {
    const { commitMessage, amend, signOff, noVerify, author } = get();
    if (!commitMessage.trim()) return false;
    clearOperationError();
    const selections = selectedChanges().map((file) => ({
      path: file.path,
      ...(file.oldPath ? { oldPath: file.oldPath } : {}),
      status: file.status,
      staged: file.staged,
    }));

    try {
      await runMutationOperation(command, async () => {
        await request(command, {
          message: commitMessage,
          amend,
          selections,
          options: {
            signOff,
            noVerify,
            ...(author.trim() ? { author: author.trim() } : {}),
          },
        });
        await get().fetchChanges();
      });
      // Sign-off and hook preferences persist across commits; the author
      // override does not, since it is per-commit by nature.
      set({ commitMessage: "", amend: false, author: "" });
      return true;
    } catch (error) {
      reportOperationError(
        command === "commitChanges" ? "commit" : "commitAndPush",
        error,
      );
      return false;
    }
  };

  return {
    loading: false,
    pendingOperations: 0,
    operationError: null,

    async stageFile(filePath) {
      await mutateAndRefresh("stageFile", "stageFile", { filePath });
    },

    async unstageFile(filePath) {
      await mutateAndRefresh("unstageFile", "unstageFile", { filePath });
    },

    async stageAll() {
      await mutateAndRefresh("stageAll", "stageAll");
    },

    async unstageAll() {
      await mutateAndRefresh("unstageAll", "unstageAll");
    },

    async commit() {
      return commitWith("commitChanges");
    },

    async commitAndPush() {
      return commitWith("commitAndPush");
    },

    async rollbackFile(filePath) {
      await mutateAndRefresh("rollbackFile", "rollbackFile", { filePath });
    },

    async showDiff(filePath) {
      clearOperationError();
      try {
        await runOperation("showDiff", () =>
          request("showDiffForWorkingFile", { filePath }),
        );
      } catch (error) {
        reportOperationError("showDiff", error);
      }
    },
    async openMergeEditor(filePath) {
      try {
        await runOperation("openMergeEditor", () =>
          request("openMergeEditor", { file: filePath }),
        );
      } catch (error) {
        reportOperationError("openMergeEditor", error);
      }
    },

    async shelveChanges(message, filePaths) {
      clearOperationError();
      try {
        await runMutationOperation("shelveChanges", async () => {
          await request("shelveChanges", { message, filePaths });
          await Promise.all([get().fetchChanges(), get().fetchShelves()]);
        });
      } catch (error) {
        reportOperationError("shelveChanges", error);
      }
    },

    async unshelveChanges(stashId, drop = true) {
      clearOperationError();
      try {
        await runMutationOperation("unshelveChanges", async () => {
          await request("unshelveChanges", { stashId, drop });
          await Promise.all([get().fetchChanges(), get().fetchShelves()]);
        });
      } catch (error) {
        reportOperationError("unshelveChanges", error);
      }
    },

    async deleteShelve(stashId) {
      clearOperationError();
      try {
        await runMutationOperation("deleteShelve", async () => {
          await request("deleteShelve", { stashId });
          await get().fetchShelves();
        });
      } catch (error) {
        reportOperationError("deleteShelve", error);
      }
    },

    async ideaShelveChanges(message, filePaths) {
      clearOperationError();
      try {
        await runMutationOperation("ideaShelveChanges", async () => {
          await request("ideaShelveChanges", { message, filePaths });
          await Promise.all([get().fetchChanges(), get().fetchIdeaShelves()]);
        });
      } catch (error) {
        reportOperationError("ideaShelveChanges", error);
      }
    },

    async ideaUnshelveChanges(shelfName, drop = true) {
      clearOperationError();
      try {
        await runMutationOperation("ideaUnshelveChanges", async () => {
          await request("ideaUnshelveChanges", { shelfName, drop });
          await Promise.all([get().fetchChanges(), get().fetchIdeaShelves()]);
        });
      } catch (error) {
        reportOperationError("ideaUnshelveChanges", error);
      }
    },

    async deleteIdeaShelf(shelfName) {
      clearOperationError();
      try {
        await runMutationOperation("deleteIdeaShelf", async () => {
          await request("deleteIdeaShelf", { shelfName });
          await get().fetchIdeaShelves();
        });
      } catch (error) {
        reportOperationError("deleteIdeaShelf", error);
      }
    },

    async refresh() {
      await Promise.all([
        get().fetchChanges(),
        get().fetchShelves(),
        get().fetchIdeaShelves(),
        get()
          .refreshRefs()
          .catch((error) => console.error("refreshRefs failed:", error)),
      ]);
    },
  };
}

function normalizeOperationError(error: unknown): CommitOperationError {
  const value = error as {
    code?: unknown;
    message?: unknown;
    recovery?: unknown;
  };
  const message =
    typeof value?.message === "string"
      ? value.message
      : error instanceof Error
        ? error.message
        : String(error);
  return {
    ...(typeof value?.code === "string" ? { code: value.code } : {}),
    message,
    ...(typeof value?.recovery === "string"
      ? { recovery: value.recovery }
      : {}),
  };
}

function isStaleOperationError(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown };
  return (
    value?.code === "STALE_RESPONSE" ||
    value?.message === "Repository changed before operation completed"
  );
}

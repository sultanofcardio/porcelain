import { create } from "zustand";
import { bridge } from "../bridge";
import { RequestCoordinator } from "../requests/requestCoordinator";
import { createDataSlice } from "./commit/dataSlice";
import { createDraftSlice } from "./commit/draftSlice";
import { createOperationSlice } from "./commit/operationSlice";
import { createSelectionSlice } from "./commit/selectionSlice";
import type {
  CommitSliceContext,
  CommitStore,
  IdeaShelfEntry,
  ShelveEntry,
  WorkingTreeFile,
} from "./commit/types";
import { useRepoStore } from "./repo-store";

export type { IdeaShelfEntry, ShelveEntry, WorkingTreeFile };

const coordinator = new RequestCoordinator((error) => {
  console.error("Commit refresh failed:", error);
});

export const useCommitStore = create<CommitStore>((set, get) => {
  const context: CommitSliceContext = {
    set,
    get,
    coordinator,
    request: (command, params) => bridge.request(command, params),
  };

  return {
    ...createDraftSlice(context),
    ...createDataSlice(context),
    ...createSelectionSlice(context),
    ...createOperationSlice(context),
  };
});

coordinator.subscribePending((pending) => {
  useCommitStore.setState({
    pendingOperations: pending,
    loading: pending > 0,
  });
});

interface DraftSnapshot {
  commitMessage: string;
  amend: boolean;
  expandedGroups: Set<string>;
  collapsedDirs: Set<string>;
}

const drafts = new Map<string, DraftSnapshot>();

function snapshotCurrent(): DraftSnapshot {
  const state = useCommitStore.getState();
  return {
    commitMessage: state.commitMessage,
    amend: state.amend,
    expandedGroups: new Set(state.expandedGroups),
    collapsedDirs: new Set(state.collapsedDirs),
  };
}

export async function applyRepoSwitch(
  prevRepoId: string | null,
  nextRepoId: string | null,
  reload = true,
) {
  if (prevRepoId) drafts.set(prevRepoId, snapshotCurrent());
  coordinator.setRepository(nextRepoId);

  const snapshot = nextRepoId ? drafts.get(nextRepoId) : undefined;
  useCommitStore.setState({
    commitMessage: snapshot?.commitMessage ?? "",
    amend: snapshot?.amend ?? false,
    expandedGroups: new Set(
      snapshot?.expandedGroups ?? ["changes", "unversioned", "conflicts"],
    ),
    collapsedDirs: new Set(snapshot?.collapsedDirs ?? []),
    changes: [],
    shelves: [],
    ideaShelves: [],
    currentBranch: "",
    currentBranchHasUpstream: false,
    operationError: null,
    selectedFiles: new Set(),
    highlightedFiles: new Set(),
  });

  if (nextRepoId && reload) await useCommitStore.getState().refresh();
}

export function pruneRemovedDrafts(currentRepoIds: string[]) {
  const keep = new Set(currentRepoIds);
  for (const id of drafts.keys()) {
    if (!keep.has(id)) drafts.delete(id);
  }
}

function scheduleRepositoryRefresh() {
  coordinator.scheduleRefresh("workingTree", () =>
    useCommitStore.getState().refreshWorkingTree(),
  );
  coordinator.scheduleRefresh("refs", () =>
    useCommitStore.getState().refreshRefs(),
  );
  coordinator.scheduleRefresh("shelves", () =>
    useCommitStore.getState().refreshShelves(),
  );
}

bridge.onEvent((event, data) => {
  if (event !== "commitStateChanged" && event !== "gitStateChanged") return;
  const { repoId } = data as { repoId?: string };
  if (!repoId || repoId === useRepoStore.getState().activeRepoId) {
    scheduleRepositoryRefresh();
  }
});

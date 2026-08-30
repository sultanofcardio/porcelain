import type { CommandType } from "../../bridge/types";
import type { RequestCoordinator } from "../../requests/requestCoordinator";
import type { BranchInfo } from "../../types/git";

export interface WorkingTreeFile {
  path: string;
  oldPath?: string;
  status:
    | "added"
    | "modified"
    | "deleted"
    | "renamed"
    | "untracked"
    | "conflicted";
  staged: boolean;
}

export interface ShelveEntry {
  id: string;
  message: string;
  date: string;
  branch: string;
  files: string[];
}

export interface IdeaShelfEntry {
  name: string;
  description: string;
  date: string;
  patchPath: string;
  files: string[];
}

export type TabType = "commit" | "shelf" | "stash";

export interface CommitOperationError {
  code?: string;
  message: string;
  recovery?: string;
}

export interface CommitDraftSlice {
  commitMessage: string;
  amend: boolean;
  setCommitMessage: (message: string) => void;
  setAmend: (amend: boolean) => void;
  /** Append a `Signed-off-by:` trailer to the commit. */
  signOff: boolean;
  setSignOff: (signOff: boolean) => void;
  /** Skip commit hooks. */
  noVerify: boolean;
  setNoVerify: (noVerify: boolean) => void;
  /** Override the commit author, as "Name <email>"; empty means the default. */
  author: string;
  setAuthor: (author: string) => void;
  /** Seed an empty message from commit.template or MERGE_MSG. */
  loadMessageTemplate: () => Promise<void>;
}

export interface CommitDataSlice {
  changes: WorkingTreeFile[];
  shelves: ShelveEntry[];
  ideaShelves: IdeaShelfEntry[];
  currentBranch: string;
  currentBranchHasUpstream: boolean;
  fetchChanges: () => Promise<void>;
  fetchShelves: () => Promise<void>;
  fetchIdeaShelves: () => Promise<void>;
  refreshWorkingTree: () => Promise<void>;
  refreshRefs: () => Promise<void>;
  refreshShelves: () => Promise<void>;
}

export interface CommitSelectionSlice {
  selectedFiles: Set<string>;
  highlightedFiles: Set<string>;
  activeTab: TabType;
  expandedGroups: Set<string>;
  groupByDirectory: boolean;
  showUnversioned: boolean;
  collapsedDirs: Set<string>;
  toggleFileSelection: (filePath: string) => void;
  setFileKeys: (keys: string[], selected: boolean) => void;
  selectAllFiles: () => void;
  deselectAllFiles: () => void;
  highlightFile: (key: string, mode: "single" | "toggle") => void;
  reconcileSelection: (changes: readonly WorkingTreeFile[]) => void;
  setActiveTab: (tab: TabType) => void;
  toggleGroup: (group: string) => void;
  toggleDir: (dirPath: string) => void;
  expandAllDirs: () => void;
  collapseAllDirs: (allDirPaths: string[]) => void;
  toggleGroupByDirectory: () => void;
  toggleShowUnversioned: () => void;
}

export interface CommitOperationSlice {
  loading: boolean;
  pendingOperations: number;
  operationError: CommitOperationError | null;
  stageFile: (filePath: string) => Promise<void>;
  unstageFile: (filePath: string) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageAll: () => Promise<void>;
  commit: () => Promise<boolean>;
  commitAndPush: () => Promise<boolean>;
  rollbackFile: (filePath: string) => Promise<void>;
  showDiff: (filePath: string) => Promise<void>;
  /** Open a conflicted file in the three-way merge editor. */
  openMergeEditor: (filePath: string) => Promise<void>;
  shelveChanges: (message?: string, filePaths?: string[]) => Promise<void>;
  unshelveChanges: (stashId: string, drop?: boolean) => Promise<void>;
  deleteShelve: (stashId: string) => Promise<void>;
  ideaShelveChanges: (message?: string, filePaths?: string[]) => Promise<void>;
  ideaUnshelveChanges: (shelfName: string, drop?: boolean) => Promise<void>;
  deleteIdeaShelf: (shelfName: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export interface CommitStore
  extends CommitDraftSlice,
    CommitDataSlice,
    CommitSelectionSlice,
    CommitOperationSlice {}

export type CommitStoreSet = (
  partial:
    | CommitStore
    | Partial<CommitStore>
    | ((state: CommitStore) => CommitStore | Partial<CommitStore>),
  replace?: false,
) => void;

export interface CommitSliceContext {
  set: CommitStoreSet;
  get: () => CommitStore;
  coordinator: RequestCoordinator;
  request: (
    command: CommandType,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;
}

export type BranchList = BranchInfo[];

/**
 * Identity of a row in the Commit panel.
 *
 * A path, deliberately: staging is not part of this panel's model. Git reports
 * a file that has both indexed and working-tree changes as two records, and
 * both collapse onto the same row here, so ticking it selects the whole change
 * and the commit takes the file as it is on disk.
 */
export function workingTreeKey(file: WorkingTreeFile): string {
  return file.path;
}

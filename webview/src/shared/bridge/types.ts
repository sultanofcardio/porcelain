import type {
  GitRefIdentity,
  GraphLayoutResult,
  LaneSnapshot,
} from "../types/git";

export type LogQueryRevision =
  | { kind: "all" }
  | { kind: "ref"; ref: GitRefIdentity }
  | {
      kind: "range";
      excludeRef: GitRefIdentity;
      includeRef: GitRefIdentity;
    };

export interface LogQueryParams extends Record<string, unknown> {
  maxCount?: number;
  count?: number;
  skip?: number;
  snapshot?: LaneSnapshot;
  revision?: LogQueryRevision;
  currentRef?: GitRefIdentity;
  branch?: string;
  search?: string;
  author?: string;
  since?: string;
  until?: string;
  file?: string;
}

export type LogQueryResult =
  | ({ status: "ok"; hasMore: boolean } & GraphLayoutResult)
  | { status: "ref-unavailable"; ref: GitRefIdentity };

export interface CommitSelection {
  path: string;
  oldPath?: string;
  staged: boolean;
  status:
    | "added"
    | "modified"
    | "deleted"
    | "renamed"
    | "untracked"
    | "conflicted";
}

export interface CommitChangesParams extends Record<string, unknown> {
  message: string;
  amend?: boolean;
  selections?: readonly CommitSelection[];
  filePaths?: string[];
}

/**
 * Public repo identity as seen by the webview. The host-only `RepositoryPaths`
 * (workTreeRoot/gitDir/commonDir) is intentionally NOT mirrored here.
 */
export interface RepoDescriptor {
  id: string;
  name: string;
  rootPath: string;
}

export interface RequestMessage {
  type: "request";
  id: string;
  command: CommandType;
  params: Record<string, unknown>;
  repoId?: string;
}

export interface ResponseMessage {
  type: "response";
  id: string;
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string; recovery?: string };
}

export interface EventMessage {
  type: "event";
  event: EventType;
  data: unknown;
}

export type Message = RequestMessage | ResponseMessage | EventMessage;

export type CommandType =
  | "getLog"
  | "getGraphData"
  | "loadMoreLog"
  | "getBranches"
  | "getTags"
  | "getDiff"
  | "getFileContent"
  | "getCommitFiles"
  | "getStatus"
  | "openDiffEditor"
  | "openMergeEditor"
  | "getMergeState"
  | "getCherryPickState"
  | "getConflictFiles"
  | "getFileVersions"
  | "saveMergedContent"
  | "stageFile"
  | "unstageFile"
  | "stageAll"
  | "unstageAll"
  | "acceptOurs"
  | "acceptTheirs"
  | "confirmCancelMerge"
  | "closeMergeEditor"
  | "openFile"
  | "checkoutBranch"
  | "createBranch"
  | "createBranchFromCommit"
  | "deleteBranch"
  | "renameBranch"
  | "mergeBranch"
  | "rebaseBranch"
  | "checkoutAndRebase"
  | "pushBranch"
  | "updateBranch"
  | "pullBranch"
  | "pullRebase"
  | "pullMerge"
  | "fetchBranch"
  | "commitChanges"
  | "commitAndPush"
  | "amendCommit"
  | "rollbackFile"
  | "rollbackFiles"
  | "getWorkingTreeChanges"
  | "getShelves"
  | "shelveChanges"
  | "unshelveChanges"
  | "unshelveFile"
  | "deleteShelve"
  | "showShelfFileDiff"
  | "showDiffForWorkingFile"
  | "getAmendMessage"
  | "getIdeaShelves"
  | "ideaShelveChanges"
  | "ideaUnshelveChanges"
  | "deleteIdeaShelf"
  | "showIdeaShelfFileDiff"
  | "createPatchFromShelf"
  | "copyShelfPatchToClipboard"
  | "importPatches"
  | "deleteFiles"
  | "revealInSystemExplorer"
  | "getRecentCommitMessages"
  | "refreshGitState"
  | "getRebaseState"
  | "rebaseAction"
  | "mergeAction"
  | "cherryPickAction"
  | "checkoutCommit"
  | "cherryPick"
  | "cherryPickFileChanges"
  | "createTag"
  | "resetToCommit"
  | "revertCommit"
  | "revertFileChanges"
  | "openFileAtRevision"
  | "copyToClipboard"
  | "showConfirmMessage"
  | "showInputBox"
  | "showErrorNotification"
  | "showInfoNotification"
  | "openConflictsPanel"
  | "importPatchFromClipboard"
  | "createBranchPrompt"
  | "deleteBranchPrompt"
  | "fetchAll"
  | "setFavorite"
  | "getBranchDashboardPreferences"
  | "setBranchDashboardPreferences"
  | "getAheadCommits"
  | "getCommitRangeFiles"
  | "executePush"
  | "openPushPanel"
  | "getRemoteBranches"
  | "dropCommit"
  | "closePushPanel"
  | "openRollbackPanel"
  | "executeRollback"
  | "closeRollbackPanel"
  | "openCompareWithCurrent"
  | "openCompareVersions"
  | "getComparisonFiles"
  | "getRepos"
  | "selectRepo";

export type EventType =
  | "gitStateChanged"
  | "mergeStateChanged"
  | "themeChanged"
  | "showFileHistory"
  | "operationStart"
  | "operationEnd"
  | "commitStateChanged"
  | "pushPanelInit"
  | "conflictsPanelInit"
  | "rollbackPanelInit"
  | "comparePanelRefresh"
  | "activeRepoChanged"
  | "reposChanged";

/**
 * Request scope. "repo" (default) binds the call to the active repo context;
 * "global" opts out of repo-binding for control-plane calls (e.g. getRepos,
 * selectRepo) so they survive a repo switch without a hard-coded command list.
 *
 * `repoId` is an explicit per-request override: when set, the bridge stamps the
 * message with this repo instead of its ambient `currentRepoId`. This is the
 * correctness guarantee operation panels use so a request always targets the
 * repo the UI is showing, regardless of ambient context.
 */
export interface BridgeRequestOptions {
  scope?: "repo" | "global";
  repoId?: string;
}

/**
 * Alias for `BridgeRequestOptions`. Public hook signatures (e.g.
 * `useRepoBoundOperation`) reference `RequestOptions` so callers don't depend
 * on the implementation naming. The two types are structurally identical.
 */
export type RequestOptions = BridgeRequestOptions;

export interface Bridge {
  request(
    command: CommandType,
    params?: Record<string, unknown>,
    options?: BridgeRequestOptions,
  ): Promise<unknown>;
  onEvent(handler: (event: string, data: unknown) => void): () => void;
  setRepoContext(repoId: string | null): void;
}

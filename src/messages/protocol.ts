import type { GitRefIdentity } from "../git/branchDashboardState";
import type { GitService } from "../git/gitService";
import type { RepoDescriptor, RepositoryPaths } from "../git/repoRegistry";
import type {
  CommitSelection,
  GraphLayoutResult,
  LaneSnapshot,
} from "../git/types";

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

export interface CommitChangesParams extends Record<string, unknown> {
  message: string;
  amend?: boolean;
  selections?: readonly CommitSelection[];
  filePaths?: string[];
}

/** What both sides of a diff are, independent of what they contain. */
export interface DiffSidesMeta {
  filePath: string;
  leftRef: string;
  rightRef: string;
  leftLabel: string;
  rightLabel: string;
  language: string;
}

/**
 * The `getDiffSides` answer: a classification, not just two strings.
 *
 * The host holds the bytes, so it decides what they are; the webview only
 * branches on `kind`. Before this, a PNG was UTF-8-decoded into mojibake and
 * a failed read was indistinguishable from a deleted file — both arrived as
 * the empty string.
 */
export type DiffSidesResult =
  | ({ kind: "text"; left: string; right: string } & DiffSidesMeta)
  /** A NUL byte in the first 8000 bytes — git's own heuristic. */
  | ({
      kind: "binary";
      leftBytes: number;
      rightBytes: number;
      differs: boolean;
    } & DiffSidesMeta)
  /** Binary with a known image extension: `data:` URIs the CSP already allows. */
  | ({
      kind: "image";
      leftUri?: string;
      rightUri?: string;
      leftBytes: number;
      rightBytes: number;
    } & DiffSidesMeta)
  /** Soft limit with a "Show anyway" escape — re-request with `force`. */
  | ({ kind: "tooLarge"; lines: number; limit: number } & DiffSidesMeta)
  /** A read that failed for a reason other than the file being absent. */
  | ({ kind: "unreadable"; reason: string } & DiffSidesMeta);

/** What every `getFileVersions` answer carries, whatever the content is. */
export interface FileVersionsMeta {
  filePath: string;
  language: string;
  mergeMsg: string;
  /** Display labels: the current branch, and what is being merged in. */
  oursLabel: string;
  theirsLabel: string;
}

/**
 * The `getFileVersions` answer, typed at last — the webview used to re-declare
 * this shape locally and silently drop fields. Classified like `getDiffSides`:
 * the host holds the bytes of all three stages, so it says what they are, and
 * a binary or oversized conflict gets a placeholder with whole-file verbs
 * instead of feeding diff3 garbage.
 */
export type FileVersionsResult =
  | ({
      kind: "text";
      base: string;
      ours: string;
      theirs: string;
    } & FileVersionsMeta)
  | ({ kind: "binary"; bytes: number } & FileVersionsMeta)
  | ({ kind: "tooLarge"; lines: number; limit: number } & FileVersionsMeta)
  | ({ kind: "unreadable"; reason: string } & FileVersionsMeta);

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
  error?: {
    code: ErrorCode;
    message: string;
    recovery?: string;
  };
}

export interface EventMessage {
  type: "event";
  event: EventType;
  data: unknown;
}

export type Message = RequestMessage | ResponseMessage | EventMessage;

/**
 * Request-level context resolved by the router from `RequestMessage.repoId`.
 * Handlers that need repo binding consume this; control-plane commands
 * (scope "global") may be invoked without one.
 */
export interface RequestContext {
  repoId: string;
  repo: RepoDescriptor;
  paths: RepositoryPaths;
  gitService: GitService;
}

export type CommandType =
  | "getLog"
  | "getGraphData"
  | "loadMoreLog"
  | "getBranches"
  | "getTags"
  | "getDiff"
  | "getFileContent"
  | "getDiffSides"
  | "stepDiffFile"
  | "getCommitFiles"
  | "getStatus"
  | "openDiffEditor"
  | "openMergeEditor"
  | "getMergeState"
  | "getCherryPickState"
  | "getConflictFiles"
  | "getFileVersions"
  | "saveMergedContent"
  | "writeFileContent"
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

export interface RemoteBranchGroup {
  remote: string;
  branches: string[];
}

export enum ErrorCode {
  GIT_NOT_FOUND = "GIT_NOT_FOUND",
  GIT_COMMAND_FAILED = "GIT_COMMAND_FAILED",
  NOT_A_GIT_REPO = "NOT_A_GIT_REPO",
  INVALID_REF = "INVALID_REF",
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  MERGE_CONFLICT = "MERGE_CONFLICT",
  REPO_NOT_FOUND = "REPO_NOT_FOUND",
  BRANCH_NOT_FOUND = "BRANCH_NOT_FOUND",
  BRANCH_NO_UPSTREAM = "BRANCH_NO_UPSTREAM",
  BRANCH_CHECKED_OUT_IN_WORKTREE = "BRANCH_CHECKED_OUT_IN_WORKTREE",
  BRANCH_NON_FAST_FORWARD = "BRANCH_NON_FAST_FORWARD",
  BRANCH_NOT_FULLY_MERGED = "BRANCH_NOT_FULLY_MERGED",
  UNMERGED_PATHS = "UNMERGED_PATHS",
  INDEX_PREPARE_FAILED = "INDEX_PREPARE_FAILED",
  INDEX_RESTORE_FAILED = "INDEX_RESTORE_FAILED",
  PARTIAL_FILE_SELECTION_UNSUPPORTED = "PARTIAL_FILE_SELECTION_UNSUPPORTED",
  UNSUPPORTED_SHELF_CONTENT = "UNSUPPORTED_SHELF_CONTENT",
  COMMIT_REJECTED = "COMMIT_REJECTED",
  OPERATION_CANCELLED = "OPERATION_CANCELLED",
  UNKNOWN = "UNKNOWN",
}

/** Emitted when the active repository changes (incl. to null). */
export interface ActiveRepoChangedEvent {
  repo: RepoDescriptor | null;
}

/** Emitted when the set of known repositories changes. */
export interface ReposChangedEvent {
  repos: RepoDescriptor[];
  activeId: string | null;
}

/** Payload for `gitStateChanged`; `repoId` identifies which repo changed. */
export interface GitStateChangedEvent {
  scope: "all" | "branches" | "status" | "mergeState" | "log";
  repoId: string;
}

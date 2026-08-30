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
  branches?: string[];
  search?: string;
  searchRegex?: boolean;
  searchCaseSensitive?: boolean;
  author?: string;
  since?: string;
  until?: string;
  file?: string;
  paths?: string[];
  sortTopo?: boolean;
  firstParent?: boolean;
  noMerges?: boolean;
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
 * The one ref sentinel the webview must recognise: a side addressed as the
 * file on disk is the only side that can own an editable buffer. Mirrors the
 * host's `workingTreeDiffModel.ts`.
 */
export const WORKING_TREE_REF = "__porcelain_worktree__";

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
  | "getLogAuthors"
  | "getContainingBranches"
  | "getUserIdentity"
  | "resolveLogRef"
  | "getRecentBranches"
  | "smartCheckout"
  | "getUnmergedCommits"
  | "resetToRemoteBranch"
  | "getMergedBranches"
  | "deleteTag"
  | "deleteRemoteTag"
  | "pushTag"
  | "getRemotes"
  | "addRemote"
  | "renameRemote"
  | "setRemoteUrl"
  | "removeRemote"
  | "getRebaseTodoCommits"
  | "runInteractiveRebase"
  | "rewordCommit"
  | "squashCommits"
  | "commitFixup"
  | "undoLastCommit"
  | "rebaseWithOptions"
  | "mergeWithOptions"
  | "pullWithOptions"
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
  | "showQuickPick"
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

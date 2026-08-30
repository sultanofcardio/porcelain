export interface CommitNode {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: string; // ISO 8601
  committerDate: string; // ISO 8601
  subject: string;
  body: string;
  refs: RefInfo[];
  reachableFromCurrent?: boolean;
}

export interface RefInfo {
  type: "branch" | "remote-branch" | "tag" | "HEAD";
  name: string;
}

/** postMessage 传输用 Record（Map 不可 JSON 序列化） */
export interface GraphData {
  commits: CommitNode[];
  lanes: Record<string, LaneInfo>;
}

export interface LaneInfo {
  column: number;
  color: number;
  lines: LaneLine[];
}

export interface LaneLine {
  fromColumn: number;
  toColumn: number;
  toCommit: string;
  type: "straight" | "merge-left" | "merge-right" | "fork-left" | "fork-right";
  /** Parent is hidden by current filter window; keep relation for later pages. */
  hiddenParent?: boolean;
}

export interface LaneSnapshot {
  activeLanes: (string | null)[];
  laneColors: (number | null)[];
  nextColorIndex: number;
  /** legacy field for backward compatibility when reading old snapshots */
  colorIndex?: number;
}

export interface GraphLayoutResult {
  graphData: GraphData;
  snapshot: LaneSnapshot;
}

export interface BranchInfo {
  name: string;
  fullRef: string;
  isRemote: boolean;
  isCurrent: boolean;
  upstream?: string;
  checkedOutWorktreePath?: string;
  ahead: number;
  behind: number;
  lastCommitHash: string;
}

export interface TagInfo {
  name: string;
  fullRef: string;
  hash: string;
  targetCommitHash: string;
  isAnnotated: boolean;
  message?: string;
}

export interface FileStatus {
  path: string;
  oldPath?: string;
  indexStatus: string;
  workTreeStatus: string;
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  status: "added" | "deleted" | "modified" | "renamed" | "copied";
  isBinary: boolean;
}

export type LogRevision =
  | { kind: "all" }
  | { kind: "ref"; ref: string }
  | { kind: "range"; excludeRef: string; includeRef: string };

export interface LogOptions {
  maxCount?: number; // default 200
  skip?: number;
  revision?: LogRevision;
  branch?: string; // specific branch, default --all
  /** Multiple branches/refs; the log shows their union (like IntelliJ's branch filter). */
  branches?: string[];
  author?: string;
  search?: string; // --grep
  /** Treat `search` as an extended regex instead of a literal string. */
  searchRegex?: boolean;
  /** Match `search`/`author` case-sensitively (git's raw default). */
  searchCaseSensitive?: boolean;
  file?: string;
  /** Additional pathspecs (files or folders) narrowing the log. */
  paths?: string[];
  since?: string;
  until?: string;
  /** Order commits topologically instead of by commit date. */
  sortTopo?: boolean;
  /** Follow only the first parent at merge commits. */
  firstParent?: boolean;
  /** Exclude merge commits entirely. */
  noMerges?: boolean;
}

export interface MergeState {
  isMerging: boolean;
  mergeHead?: string;
  mergeMsg?: string;
}

export interface CherryPickState {
  isCherryPicking: boolean;
  cherryPickHead?: string;
}

export interface FileVersions {
  base: string;
  ours: string;
  theirs: string;
  language: string;
}

export interface MergeResult {
  merged: string;
  conflicts: ConflictRegion[];
  hasConflict: boolean;
}

export interface ConflictRegion {
  index: number;
  oursStart: number;
  oursEnd: number;
  theirsStart: number;
  theirsEnd: number;
  baseStart: number;
  baseEnd: number;
  oursContent: string;
  theirsContent: string;
  baseContent: string;
  mergedStart: number;
  mergedEnd: number;
}

/** Working tree file change for the commit panel */
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

export interface CommitSelection {
  path: string;
  oldPath?: string;
  staged: boolean;
  status: WorkingTreeFile["status"];
}

export interface CommitRequest {
  message: string;
  amend: boolean;
  selections: readonly CommitSelection[];
  options?: CommitOptions;
}

/** Shelf entry (git stash based) */
export interface ShelveEntry {
  id: string; // stash@{n}
  message: string;
  date: string;
  branch: string;
  files: string[];
}

/** IDEA-compatible shelf entry (patch-file based in .idea/shelf/) */
export interface IdeaShelfEntry {
  name: string;
  description: string;
  date: string; // ISO date
  patchPath: string;
  files: string[];
}

/** Options the Rebase dialog exposes, mirroring IntelliJ's option popup. */
export interface RebaseOptions {
  interactive?: boolean;
  autosquash?: boolean;
  updateRefs?: boolean;
  rebaseMerges?: boolean;
  keepEmpty?: boolean;
  autostash?: boolean;
  /** `--onto <new base>`. */
  onto?: string;
  /** Rebase from the root commit instead of an upstream. */
  root?: boolean;
  /** Check out this branch before rebasing it. */
  branch?: string;
}

/** Options the Merge dialog exposes. */
export interface MergeOptions {
  noFf?: boolean;
  ffOnly?: boolean;
  squash?: boolean;
  noCommit?: boolean;
  noVerify?: boolean;
  allowUnrelatedHistories?: boolean;
  message?: string;
}

/** Options the Pull dialog exposes. */
export interface PullOptions {
  remote?: string;
  branch?: string;
  rebase?: boolean;
  ffOnly?: boolean;
  noFf?: boolean;
  squash?: boolean;
  noCommit?: boolean;
}

/** Options the commit panel exposes alongside the message. */
export interface CommitOptions {
  /** Append a `Signed-off-by:` trailer. */
  signOff?: boolean;
  /** Skip commit hooks (`--no-verify`). */
  noVerify?: boolean;
  /** Override the author, as "Name <email>". */
  author?: string;
}

/** Options the Push dialog exposes. */
export interface PushOptions {
  /** Set the upstream while pushing (`-u`), for a branch without one. */
  setUpstream?: boolean;
  /** Skip pre-push hooks. */
  noVerify?: boolean;
  /** Push tags along with the branch. */
  pushTags?: "none" | "all";
}

/** One blamed line: the commit that last touched it, and the text. */
export interface BlameLine {
  hash: string;
  /** 1-based line number in the blamed revision. */
  line: number;
  content: string;
  author: string;
  authorEmail: string;
  /** Unix seconds. */
  authorTime: number;
  summary: string;
  /** True for a line not yet committed (git's all-zero hash). */
  uncommitted: boolean;
}

/** Options IntelliJ exposes in the annotation gutter's menu. */
export interface BlameOptions {
  ignoreWhitespace?: boolean;
  detectMovesWithinFile?: boolean;
  detectMovesAcrossFiles?: boolean;
  /** Blame the file as of this revision instead of the working tree. */
  revision?: string;
}

/** A linked worktree as the manager lists it. */
export interface WorktreeInfo {
  path: string;
  /** Checked-out branch, absent when detached. */
  branch?: string;
  head: string;
  /** The repository's own working tree, which cannot be removed. */
  isMain: boolean;
  locked: boolean;
  /** Git considers the record removable: its directory is gone. */
  prunable: boolean;
  detached: boolean;
}

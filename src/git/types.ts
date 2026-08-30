export interface CommitNode {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: string; // ISO 8601
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
  author?: string;
  search?: string; // --grep
  /** Treat `search` as an extended regex instead of a literal string. */
  searchRegex?: boolean;
  /** Match `search`/`author` case-sensitively (git's raw default). */
  searchCaseSensitive?: boolean;
  file?: string;
  since?: string;
  until?: string;
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

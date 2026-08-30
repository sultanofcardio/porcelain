import { Tooltip } from "../../shared/components/Tooltip";
import { usePreventSelect } from "../../shared/hooks/usePreventSelect";
import { useGitLogStore } from "../../shared/store/git-log-store-context";
import type { Commit, LaneInfo, RefInfo } from "../../shared/types/git";

export const ROW_HEIGHT = 28;
export const COMMIT_COLUMN_GUTTER_WIDTH = 9;
const COLUMN_WIDTH = 10;
const GRAPH_PADDING = 6;
const NODE_TEXT_GAP = 14;

export function getCommitMessageOffset(maxColumn: number): number {
  return GRAPH_PADDING + (maxColumn + 1) * COLUMN_WIDTH + NODE_TEXT_GAP;
}

/** Tag icon colors matching IDEA */
const REF_ICON_COLORS: Record<string, string> = {
  branch: "#59a869",
  "remote-branch": "#b07cd8",
  tag: "#e5c07b",
  HEAD: "#c75450",
};

export function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

/**
 * Commit age the way IntelliJ's log reads it. Anything past a month falls back
 * to the absolute date, where "5 weeks ago" stops being easier than the date.
 */
export function formatRelativeTime(dateStr: string, now = Date.now()): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  const elapsed = now - date.getTime();
  if (elapsed < 0) return formatDateTime(dateStr);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return plural(Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return plural(Math.floor(elapsed / HOUR), "hour");
  if (elapsed < 30 * DAY) return plural(Math.floor(elapsed / DAY), "day");
  return formatDateTime(dateStr);
}

function buildRefDisplayItems(refs: RefInfo[]): Array<{
  key: string;
  type: RefInfo["type"];
  label: string;
}> {
  const branchRef = refs.find((ref) => ref.type === "branch");
  const hasHead = refs.some((ref) => ref.type === "HEAD");
  const result: Array<{ key: string; type: RefInfo["type"]; label: string }> =
    [];

  // Collect all branch names (local and remote)
  const localBranches: string[] = [];
  const remoteBranches: string[] = [];
  const tags: string[] = [];

  for (const ref of refs) {
    if (ref.type === "HEAD") continue;
    if (ref.type === "branch") {
      // Always collect local branches for merge logic
      localBranches.push(ref.name);
      continue;
    }
    if (ref.type === "remote-branch") {
      // Skip remote HEAD pointers (e.g. origin/HEAD)
      if (ref.name.endsWith("/HEAD")) continue;
      remoteBranches.push(ref.name);
      continue;
    }
    if (ref.type === "tag") {
      tags.push(ref.name);
    }
  }

  // Build merged branch display
  const displayNames: string[] = [];
  const usedRemotes = new Set<string>();
  const usedLocals = new Set<string>();

  for (const local of localBranches) {
    // Find matching remote (e.g. "origin/prod" matches local "prod")
    const matchingRemote = remoteBranches.find((rb) => {
      const baseName = rb.includes("/")
        ? rb.substring(rb.indexOf("/") + 1)
        : rb;
      return baseName === local;
    });
    if (matchingRemote) {
      // Merge: show "origin & branchName" style
      const remote = matchingRemote.substring(0, matchingRemote.indexOf("/"));
      displayNames.push(`${remote} & ${local}`);
      usedRemotes.add(matchingRemote);
      usedLocals.add(local);
    }
  }

  // Add local branches that weren't merged (skip if HEAD covers it)
  for (const local of localBranches) {
    if (usedLocals.has(local)) continue;
    if (hasHead && branchRef?.name === local) continue; // HEAD already represents this
    displayNames.push(local);
  }

  // Add remaining remote branches not merged with local
  for (const rb of remoteBranches) {
    if (!usedRemotes.has(rb)) {
      displayNames.push(rb);
    }
  }

  // HEAD: show icon only (no text label) in row display
  if (hasHead) {
    // HEAD adds one extra icon but no text
    result.push({ key: "HEAD", type: "HEAD", label: "" });
    // Ensure the branch name is shown if not already merged with remote
    if (branchRef && !usedLocals.has(branchRef.name)) {
      displayNames.unshift(branchRef.name);
    }
  }

  // Render branch/remote tags
  for (const name of displayNames) {
    const isMerged = name.includes(" & ");
    const isRemote = name.includes("/");
    if (isMerged) {
      // Merged label like "origin & main" needs both remote + local icons
      result.push({
        key: `remote:${name}`,
        type: "remote-branch",
        label: "",
      });
      result.push({
        key: `branch:${name}`,
        type: "branch",
        label: name,
      });
    } else if (isRemote) {
      result.push({
        key: `branch:${name}`,
        type: "remote-branch",
        label: name,
      });
    } else {
      result.push({
        key: `branch:${name}`,
        type: "branch",
        label: name,
      });
    }
  }

  // Tags
  for (const tag of tags) {
    result.push({ key: `tag:${tag}`, type: "tag", label: tag });
  }

  return result;
}

export interface ColumnWidths {
  author: number;
  date: number;
  hash: number;
}

export interface VisibleColumns {
  author: boolean;
  date: boolean;
  hash: boolean;
}

function ColumnGutter() {
  return (
    <span
      aria-hidden="true"
      data-commit-column-gutter
      style={{ width: COMMIT_COLUMN_GUTTER_WIDTH, flexShrink: 0 }}
    />
  );
}

export function CommitRow({
  commit,
  lane,
  rowMaxColumn,
  columnWidths,
  visibleColumns,
  onCommitClick,
  onContextMenu,
}: {
  commit: Commit;
  lane: LaneInfo | undefined;
  rowMaxColumn: number;
  columnWidths: ColumnWidths;
  visibleColumns?: VisibleColumns;
  onCommitClick: (event: React.MouseEvent, hash: string) => void;
  onContextMenu?: (event: React.MouseEvent, commit: Commit) => void;
}) {
  const selectedCommitHashes = useGitLogStore((s) => s.selectedCommitHashes);
  const setHoveredColumn = useGitLogStore((s) => s.setHoveredColumn);
  const presentation = useGitLogStore((s) => s.presentation);
  const myIdentity = useGitLogStore((s) => s.myIdentity);
  const rowRef = usePreventSelect<HTMLDivElement>();

  const isSelected = selectedCommitHashes.includes(commit.hash);
  const col = lane?.column ?? 0;
  let refItems = buildRefDisplayItems(commit.refs);
  if (!presentation.showTagNames) {
    refItems = refItems.filter((item) => item.type !== "tag");
  }
  const isMine =
    presentation.highlightMyCommits &&
    myIdentity !== null &&
    commit.authorName === myIdentity;
  const isDimmedMerge =
    presentation.dimMergeCommits && commit.parents.length > 1;
  const faded =
    presentation.fadeOtherBranches && commit.reachableFromCurrent === false;
  const rowDate = presentation.preferCommitDate
    ? (commit.committerDate ?? commit.authorDate)
    : commit.authorDate;

  return (
    <div
      ref={rowRef}
      className={`commit-row selectable-row${faded ? " not-reachable" : ""}${isSelected ? " selected" : ""}`}
      onClick={(event) => onCommitClick(event, commit.hash)}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e, commit);
        }
      }}
      onMouseEnter={() => setHoveredColumn(col)}
      onMouseLeave={() => setHoveredColumn(null)}
      style={{
        display: "flex",
        alignItems: "center",
        height: ROW_HEIGHT,
        paddingRight: 8,
        color: isSelected ? "var(--selected-fg)" : "inherit",
      }}
    >
      {/* Author column: leads the row, matching IntelliJ's log */}
      {visibleColumns?.author !== false && (
        <>
          <span
            style={{
              flexShrink: 0,
              width: columnWidths.author,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              opacity: 0.7,
              paddingLeft: 8,
              fontWeight: isMine ? 600 : undefined,
            }}
          >
            {commit.authorName}
          </span>
          <ColumnGutter />
        </>
      )}

      {/* Reserves the strip the graph overlay draws into. */}
      <span
        aria-hidden="true"
        style={{ flexShrink: 0, width: getCommitMessageOffset(rowMaxColumn) }}
      />

      {/* Subject + refs column (flex) */}
      <span
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          overflow: "hidden",
          paddingRight: 8,
          gap: 6,
        }}
      >
        <span
          style={{
            flexShrink: 1,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <Tooltip text={commit.subject} onlyWhenTruncated>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                display: "block",
                fontWeight: isMine ? 600 : undefined,
                opacity: isDimmedMerge ? 0.45 : undefined,
              }}
            >
              {commit.subject}
            </span>
          </Tooltip>
        </span>
        {refItems.length > 0 && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
              marginLeft: "auto",
              paddingLeft: 8,
            }}
          >
            {/* Overlapping outline tag icons */}
            <span
              style={{
                display: "inline-flex",
                position: "relative",
                width: 16 + Math.max(0, (refItems.length - 1) * 5),
                height: 16,
              }}
            >
              {refItems.map((item, idx) => {
                const color =
                  REF_ICON_COLORS[item.type] ?? REF_ICON_COLORS.branch;
                return (
                  <svg
                    key={item.key}
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    style={{ position: "absolute", left: idx * 5, top: 0 }}
                  >
                    <path
                      d="M2.5 3.5C2.5 2.95 2.95 2.5 3.5 2.5H7.09c.27 0 .52.1.71.3l5.41 5.41c.39.39.39 1.02 0 1.41l-3.59 3.59c-.39.39-1.02.39-1.41 0L2.79 7.8a1 1 0 01-.29-.71V3.5z"
                      fill="var(--app-bg, #fff)"
                      stroke={color}
                      strokeWidth="1.2"
                    />
                    <circle cx="5" cy="5" r="0.9" fill={color} />
                  </svg>
                );
              })}
            </span>
            {/* Text labels (skip HEAD text); compact mode keeps the first. */}
            {(() => {
              const labels = refItems
                .filter((item) => item.type !== "HEAD")
                .map((item) => item.label)
                .filter(Boolean);
              const compact = presentation.compactRefs && labels.length > 1;
              return (
                <Tooltip text={labels.join("  ")}>
                  <span
                    style={{
                      fontSize: "0.8em",
                      whiteSpace: "nowrap",
                      opacity: 0.85,
                    }}
                  >
                    {compact
                      ? `${labels[0]} +${labels.length - 1}`
                      : labels.join("  ")}
                  </span>
                </Tooltip>
              );
            })()}
          </span>
        )}
      </span>

      {/* Date column */}
      {visibleColumns?.date !== false && (
        <>
          <ColumnGutter />
          <Tooltip text={formatDateTime(rowDate)}>
            <span
              style={{
                flexShrink: 0,
                width: columnWidths.date,
                textAlign: "left",
                opacity: 0.5,
                paddingLeft: 8,
              }}
            >
              {formatRelativeTime(rowDate)}
            </span>
          </Tooltip>
        </>
      )}

      {/* Hash column */}
      {visibleColumns?.hash !== false && (
        <>
          <ColumnGutter />
          <span
            style={{
              flexShrink: 0,
              width: columnWidths.hash,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              opacity: 0.5,
              paddingLeft: 8,
              fontFamily: "monospace",
              fontSize: "0.9em",
            }}
          >
            {commit.shortHash}
          </span>
        </>
      )}
    </div>
  );
}

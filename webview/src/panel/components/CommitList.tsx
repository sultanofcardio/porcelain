import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModifierClickSelection } from "../../shared/hooks/useModifierClickSelection";
import { useGitLogStore } from "../../shared/store/git-log-store-context";
import type { Commit } from "../../shared/types/git";
import { CommitContextMenu } from "./CommitContextMenu";
import {
  COMMIT_COLUMN_GUTTER_WIDTH,
  type ColumnWidths,
  CommitRow,
  getCommitMessageOffset,
  ROW_HEIGHT,
  type VisibleColumns,
} from "./CommitRow";
import { CreateBranchDialog } from "./CreateBranchDialog";

const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  author: 100,
  date: 130,
  hash: 70,
};

export function CommitList({
  onScroll,
  onHeaderHeight,
  onGraphOffset,
  onRefreshComparison,
}: {
  onScroll?: (scrollTop: number) => void;
  onHeaderHeight?: (height: number) => void;
  /** Where the graph strip starts, so the overlay can line up with the rows. */
  onGraphOffset?: (x: number) => void;
  onRefreshComparison?: () => void | Promise<void>;
}) {
  const visibleCommits = useGitLogStore((s) => s.visibleCommits);
  const graphLayout = useGitLogStore((s) => s.graphLayout);
  const hasMore = useGitLogStore((s) => s.hasMore);
  const loadMore = useGitLogStore((s) => s.loadMore);
  const loading = useGitLogStore((s) => s.loading);
  const selectCommit = useGitLogStore((s) => s.selectCommit);
  const scrollTargetHash = useGitLogStore((s) => s.scrollTargetHash);
  const clearScrollTarget = useGitLogStore((s) => s.clearScrollTarget);
  const request = useGitLogStore((s) => s.requestFromSurface);

  const parentRef = useRef<HTMLDivElement>(null);
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(
    DEFAULT_COLUMN_WIDTHS,
  );
  const visibleColumns = useGitLogStore((s) => s.visibleColumns);
  const toggleColumnVisibility = useGitLogStore(
    (s) => s.toggleColumnVisibility,
  );
  const [headerMenu, setHeaderMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const columnWidthsRef = useRef(columnWidths);
  columnWidthsRef.current = columnWidths;

  // The author column leads the row, so the graph starts after it. Reported up
  // because the overlay is a sibling of this list, not a child of the rows.
  const graphOffset = visibleColumns.author
    ? columnWidths.author + COMMIT_COLUMN_GUTTER_WIDTH
    : 0;
  useEffect(() => {
    onGraphOffset?.(graphOffset);
  }, [graphOffset, onGraphOffset]);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    commit: Commit;
  } | null>(null);

  // Create branch dialog state (triggered from commit context menu)
  const [createBranchDialog, setCreateBranchDialog] = useState<{
    hash: string;
    shortHash: string;
  } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, commit: Commit) => {
      setContextMenu({ x: e.clientX, y: e.clientY, commit });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const maxColumn = Math.max(
    0,
    ...Object.values(graphLayout).map((l) => l.column),
  );
  const messageColumnOffset = getCommitMessageOffset(maxColumn);

  const virtualizer = useVirtualizer({
    count: visibleCommits.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });
  const allVisibleCommitHashes = visibleCommits.map((commit) => commit.hash);

  useEffect(() => {
    if (!scrollTargetHash) return;
    const index = visibleCommits.findIndex(
      (commit) => commit.hash === scrollTargetHash,
    );
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: "center" });
    clearScrollTarget();
  }, [clearScrollTarget, scrollTargetHash, virtualizer, visibleCommits]);

  const handleCommitClick = useModifierClickSelection<string>((hash, mode) => {
    void selectCommit(hash, mode, allVisibleCommitHashes);
  });

  // Keyboard navigation (Arrow Up/Down)
  const selectedCommitHashes = useGitLogStore((s) => s.selectedCommitHashes);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (!visibleCommits.length) return;

      // Only handle when no input is focused
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement
      )
        return;

      e.preventDefault();

      const currentHash =
        selectedCommitHashes.length > 0
          ? selectedCommitHashes[selectedCommitHashes.length - 1]
          : null;
      const currentIdx = currentHash
        ? visibleCommits.findIndex((c) => c.hash === currentHash)
        : -1;

      let nextIdx: number;
      if (e.key === "ArrowUp") {
        nextIdx = currentIdx <= 0 ? 0 : currentIdx - 1;
      } else {
        nextIdx =
          currentIdx >= visibleCommits.length - 1
            ? visibleCommits.length - 1
            : currentIdx + 1;
      }

      const nextHash = visibleCommits[nextIdx].hash;
      void selectCommit(nextHash, "single", allVisibleCommitHashes);

      // Scroll the selected row into view with some padding
      // Show 3 rows ahead so user can see upcoming items
      const scrollIdx =
        e.key === "ArrowDown"
          ? Math.min(nextIdx + 3, visibleCommits.length - 1)
          : Math.max(nextIdx - 3, 0);
      virtualizer.scrollToIndex(scrollIdx, { align: "auto" });
    },
    [
      visibleCommits,
      selectedCommitHashes,
      selectCommit,
      allVisibleCommitHashes,
      virtualizer,
    ],
  );

  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    onScroll?.(el.scrollTop);
    if (
      !loading &&
      hasMore &&
      el.scrollTop + el.clientHeight >= el.scrollHeight - ROW_HEIGHT * 5
    ) {
      loadMore();
    }
  }, [onScroll, loading, hasMore, loadMore]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    // Report header height = offset of scroll area from container top
    if (onHeaderHeight && el.parentElement) {
      onHeaderHeight(el.offsetTop);
    }
  }, [onHeaderHeight]);

  // Resize handlers using startX approach for stable dragging
  const [resizing, setResizing] = useState<string | null>(null);

  const startResize = useCallback(
    (
      column: "author" | "date" | "hash",
      e: React.MouseEvent,
      // Which edge the handle sits on. The author column leads the row, so its
      // handle is on the right and dragging right widens it; the trailing
      // columns keep their handle on the left, where dragging left widens.
      edge: "leading" | "trailing" = "leading",
    ) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = columnWidthsRef.current[column];
      setResizing(column);

      // Prevent text selection during drag
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMouseMove = (ev: MouseEvent) => {
        const diff =
          edge === "trailing" ? ev.clientX - startX : startX - ev.clientX;
        const newWidth = Math.max(
          column === "author" ? 40 : column === "date" ? 60 : 50,
          startWidth + diff,
        );
        setColumnWidths((prev) => ({ ...prev, [column]: newWidth }));
      };

      const onMouseUp = () => {
        setResizing(null);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Column header with resize handles */}
      <div
        onContextMenu={(e) => {
          e.preventDefault();
          setHeaderMenu({ x: e.clientX, y: e.clientY });
        }}
        style={{
          display: "flex",
          alignItems: "center",
          height: 24,
          paddingRight: 8,
          borderBottom: "1px solid var(--border, #333)",
          fontSize: "11px",
          opacity: 0.6,
          flexShrink: 0,
          userSelect: "none",
          position: "relative",
          zIndex: 3,
          background: "var(--app-bg, #1e1e1e)",
        }}
      >
        {visibleColumns.author && (
          <>
            <span
              style={{
                flexShrink: 0,
                width: columnWidths.author,
                paddingLeft: 8,
              }}
            >
              Author
            </span>
            <ColumnResizeHandle
              active={resizing === "author"}
              onMouseDown={(e) => startResize("author", e, "trailing")}
            />
          </>
        )}
        {/* Reserves the strip the graph overlay draws into. */}
        <span
          aria-hidden="true"
          style={{ flexShrink: 0, width: messageColumnOffset }}
        />
        <span style={{ flex: 1, paddingRight: 4 }}>Message</span>
        {visibleColumns.date && (
          <>
            <ColumnResizeHandle
              active={resizing === "date"}
              onMouseDown={(e) => startResize("date", e)}
            />
            <span
              style={{
                flexShrink: 0,
                width: columnWidths.date,
                textAlign: "left",
                paddingLeft: 8,
              }}
            >
              Date
            </span>
          </>
        )}
        {visibleColumns.hash && (
          <>
            <ColumnResizeHandle
              active={resizing === "hash"}
              onMouseDown={(e) => startResize("hash", e)}
            />
            <span
              style={{
                flexShrink: 0,
                width: columnWidths.hash,
                paddingLeft: 8,
              }}
            >
              Hash
            </span>
          </>
        )}
      </div>

      {/* Column header context menu */}
      {headerMenu && (
        <HeaderColumnMenu
          x={headerMenu.x}
          y={headerMenu.y}
          visibleColumns={visibleColumns}
          onToggle={toggleColumnVisibility}
          onClose={() => setHeaderMenu(null)}
        />
      )}

      {/* Scrollable commit list */}
      <div
        ref={parentRef}
        tabIndex={0}
        aria-label="Commit list"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => {
          if (event.button === 0)
            event.currentTarget.focus({ preventScroll: true });
        }}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          position: "relative",
          outline: "none",
        }}
      >
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const commit = visibleCommits[item.index];
            const lane = graphLayout[commit.hash];
            return (
              <div
                key={commit.hash}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: ROW_HEIGHT,
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <CommitRow
                  commit={commit}
                  lane={lane}
                  rowMaxColumn={maxColumn}
                  columnWidths={columnWidths}
                  visibleColumns={visibleColumns}
                  onCommitClick={handleCommitClick}
                  onContextMenu={handleContextMenu}
                />
              </div>
            );
          })}
        </div>
        {contextMenu && (
          <CommitContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            commit={contextMenu.commit}
            onClose={closeContextMenu}
            onRefreshComparison={onRefreshComparison}
            onCreateBranch={(hash, _defaultName) => {
              closeContextMenu();
              const shortHash = hash.slice(0, 8);
              setCreateBranchDialog({ hash, shortHash });
            }}
          />
        )}
        {createBranchDialog &&
          createPortal(
            <CreateBranchDialog
              title={`Create Branch from ${createBranchDialog.shortHash}`}
              defaultName=""
              placeholder="branch-name"
              onClose={() => setCreateBranchDialog(null)}
              onConfirm={async ({ branchName, checkout, force }) => {
                const hash = createBranchDialog.hash;
                try {
                  await request("createBranchFromCommit", {
                    branchName,
                    hash,
                    checkout,
                    force,
                  });
                  setCreateBranchDialog(null);
                  return undefined;
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  const match = msg.match(/fatal:\s*(.+)/);
                  return match
                    ? match[1]
                    : `Branch '${branchName}' already exists.\nChange the name or overwrite existing branch.`;
                }
              }}
            />,
            document.body,
          )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ColumnResizeHandle
// ---------------------------------------------------------------------------

function ColumnResizeHandle({
  active,
  onMouseDown,
}: {
  active: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const highlight = active || hovered;

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: COMMIT_COLUMN_GUTTER_WIDTH,
        cursor: "col-resize",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        padding: "0 3px",
      }}
    >
      <div
        style={{
          width: highlight ? 2 : 1,
          height: "70%",
          background: highlight
            ? "var(--vscode-focusBorder, #007fd4)"
            : "var(--border, #444)",
          borderRadius: 1,
          transition: "width 0.1s, background 0.1s",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// HeaderColumnMenu – right-click context menu for toggling column visibility
// ---------------------------------------------------------------------------

function HeaderColumnMenu({
  x,
  y,
  visibleColumns,
  onToggle,
  onClose,
}: {
  x: number;
  y: number;
  visibleColumns: VisibleColumns;
  onToggle: (col: keyof VisibleColumns) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const columns: { key: keyof VisibleColumns; label: string }[] = [
    { key: "author", label: "Author" },
    { key: "date", label: "Date" },
    { key: "hash", label: "Hash" },
  ];

  return (
    <div
      ref={menuRef}
      className="commit-context-menu"
      style={{
        position: "fixed",
        left: x,
        top: y,
        zIndex: 10000,
      }}
    >
      <div className="commit-context-menu-header">Columns</div>
      {columns.map((col) => (
        <button
          key={col.key}
          type="button"
          className="commit-context-menu-item"
          onClick={() => onToggle(col.key)}
        >
          <span style={{ width: 16, display: "inline-block" }}>
            {visibleColumns[col.key] ? "✓" : ""}
          </span>
          <span>{col.label}</span>
        </button>
      ))}
    </div>
  );
}

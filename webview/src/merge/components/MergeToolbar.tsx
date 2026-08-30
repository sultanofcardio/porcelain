import { Tooltip } from "../../shared/components/Tooltip";
import { useMergeStore } from "../../shared/store/merge-store";

interface MergeToolbarProps {
  onStep: (delta: number) => void;
  onApply: () => void;
  onCancel: () => void;
  /** Apply in flight: the button reads "Applying…" and goes quiet. */
  applying: boolean;
}

/**
 * The merge editor's toolbar — the diff toolbar's shape with merge verbs.
 * Everything is glyph-only except Apply and Cancel, which are the two
 * decisions worth words.
 */
export function MergeToolbar({
  onStep,
  onApply,
  onCancel,
  applying,
}: MergeToolbarProps) {
  const conflictTotal = useMergeStore((s) => s.conflictTotal);
  const conflictResolved = useMergeStore((s) => s.conflictResolved);
  const allResolved = useMergeStore((s) => s.allResolved);
  const activeRegion = useMergeStore((s) => s.activeRegion);
  const loading = useMergeStore((s) => s.loading);
  const fallback = useMergeStore((s) => s.fallback);
  const findOpen = useMergeStore((s) => s.findOpen);
  const openFind = useMergeStore((s) => s.openFind);
  const collapse = useMergeStore((s) => s.collapseUnchanged);
  const expandedFolds = useMergeStore((s) => s.expandedFolds);
  const setCollapsed = useMergeStore((s) => s.setCollapsed);
  const undo = useMergeStore((s) => s.undo);
  const redo = useMergeStore((s) => s.redo);
  const canUndo = useMergeStore((s) => s.canUndo);
  const canRedo = useMergeStore((s) => s.canRedo);
  const composing = useMergeStore((s) => s.composition !== null);
  const applyNonConflicting = useMergeStore((s) => s.applyNonConflicting);
  const resolveAutomatically = useMergeStore((s) => s.resolveAutomatically);
  const nonConflictingCount = useMergeStore((s) => s.nonConflictingCount);
  const autoResolvableCount = useMergeStore((s) => s.autoResolvableCount);
  // Recomputed per render off the region list, which every decision replaces.
  const regions = useMergeStore((s) => s.regions);
  void regions;
  const nonConflicting = nonConflictingCount();
  const autoResolvable = autoResolvableCount();

  const fullyCollapsed = collapse && expandedFolds.size === 0;
  const pending = conflictTotal - conflictResolved;

  return (
    <div className="diff-toolbar">
      <Tooltip text="Previous conflict">
        <button
          type="button"
          className="diff-btn"
          aria-label="Previous conflict"
          onClick={() => onStep(-1)}
        >
          ↑
        </button>
      </Tooltip>
      <Tooltip text="Next conflict">
        <button
          type="button"
          className="diff-btn"
          aria-label="Next conflict"
          onClick={() => onStep(1)}
        >
          ↓
        </button>
      </Tooltip>
      <span className="diff-sep" />
      <Tooltip text="Apply all non-conflicting changes">
        <button
          type="button"
          className="diff-btn"
          aria-label="Apply non-conflicting changes"
          disabled={nonConflicting === 0 || composing}
          onClick={() => applyNonConflicting()}
        >
          ⇉
        </button>
      </Tooltip>
      <Tooltip text="Resolve conflicts whose changes do not overlap">
        <button
          type="button"
          className="diff-btn"
          aria-label="Resolve automatically"
          disabled={autoResolvable === 0 || composing}
          onClick={resolveAutomatically}
        >
          ✨
        </button>
      </Tooltip>
      <span className="diff-sep" />
      <Tooltip text="Undo (Cmd+Z)">
        <button
          type="button"
          className="diff-btn"
          aria-label="Undo"
          disabled={!canUndo || composing}
          onClick={undo}
        >
          ↶
        </button>
      </Tooltip>
      <Tooltip text="Redo (Cmd+Shift+Z)">
        <button
          type="button"
          className="diff-btn"
          aria-label="Redo"
          disabled={!canRedo || composing}
          onClick={redo}
        >
          ↷
        </button>
      </Tooltip>
      <span className="diff-sep" />
      <Tooltip
        text={
          fullyCollapsed
            ? "Expand unchanged regions"
            : "Collapse unchanged regions"
        }
      >
        <button
          type="button"
          className={`diff-btn ${fullyCollapsed ? "diff-btn-on" : ""}`}
          aria-label="Collapse unchanged regions"
          aria-pressed={fullyCollapsed}
          onClick={() => setCollapsed(!fullyCollapsed)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M4 3l4 3.5L12 3M4 13l4-3.5 4 3.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </Tooltip>
      <Tooltip text="Find (Ctrl+F / Cmd+F)">
        <button
          type="button"
          className={`diff-btn ${findOpen ? "diff-btn-on" : ""}`}
          aria-label="Find in merge"
          aria-pressed={findOpen}
          onClick={openFind}
        >
          🔍
        </button>
      </Tooltip>

      <span className="diff-spring" />
      {/* Polite, so each F7 step is announced without interrupting. */}
      <span className="diff-sr-only" aria-live="polite">
        {activeRegion >= 0
          ? `Conflict ${activeRegion + 1} of ${conflictTotal}`
          : ""}
      </span>
      <span className="diff-count">
        {loading
          ? ""
          : fallback
            ? "Cannot merge inline"
            : conflictTotal === 0
              ? "No conflicts"
              : pending === 0
                ? `All ${conflictTotal} conflicts resolved`
                : `${conflictTotal} conflict${conflictTotal === 1 ? "" : "s"} · ${conflictResolved} resolved`}
      </span>
      <span className="diff-sep" />
      <button
        type="button"
        className="diff-btn"
        onClick={onCancel}
        disabled={applying}
      >
        Cancel
      </button>
      <Tooltip
        text={
          allResolved
            ? "Save the merged result and stage the file"
            : "Enabled once every conflict is resolved"
        }
      >
        <button
          type="button"
          className="diff-btn diff-btn-primary"
          disabled={!allResolved || loading || fallback !== null || applying}
          onClick={onApply}
        >
          {applying ? "Applying…" : "Apply"}
        </button>
      </Tooltip>
    </div>
  );
}

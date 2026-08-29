import { useRef, useState } from "react";
import { Tooltip } from "../../shared/components/Tooltip";
import { useDiffStore } from "../../shared/store/diff-store";
import { DiffSettingsMenu } from "./DiffSettingsMenu";

interface DiffToolbarProps {
  onStep: (delta: number) => void;
  onEditSource: () => void;
  onFile: (delta: number) => void;
}

/** What the count slot says when there is nothing to count. */
const FALLBACK_LABEL: Record<string, string> = {
  binary: "Binary file",
  image: "Image",
  tooLarge: "Large file",
  unreadable: "Unreadable",
};

export function DiffToolbar({
  onStep,
  onEditSource,
  onFile,
}: DiffToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const differences = useDiffStore((s) => s.differences);
  const fallback = useDiffStore((s) => s.fallback);
  const findOpen = useDiffStore((s) => s.findOpen);
  const openFind = useDiffStore((s) => s.openFind);
  const chunks = useDiffStore((s) => s.chunks);
  const activeChunk = useDiffStore((s) => s.activeChunk);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // "difference 3 of 7" for the live region: which non-equal chunk the
  // stepper is on. Without this, stepping announces nothing at all.
  const changed = chunks
    .map((chunk, index) => ({ chunk, index }))
    .filter(({ chunk }) => chunk.kind !== "equal")
    .map(({ index }) => index);
  const position = changed.indexOf(activeChunk);
  const collapse = useDiffStore((s) => s.collapseUnchanged);
  const expandedFolds = useDiffStore((s) => s.expandedFolds);
  const setCollapsed = useDiffStore((s) => s.setCollapsed);
  // Pressed means "everything foldable is folded": hand-expanding a fold
  // unpresses it, and clicking then re-collapses the lot — which is the whole
  // reason this is a toggle rather than the bare feature switch the settings
  // menu already offers.
  const fullyCollapsed = collapse && expandedFolds.size === 0;
  const sync = useDiffStore((s) => s.syncScroll);
  const toggleSync = useDiffStore((s) => s.toggleSyncScroll);
  const viewMode = useDiffStore((s) => s.viewMode);

  return (
    <div className="diff-toolbar">
      {/* Every button is glyph-only, so the aria-label carries the whole
          accessible name — the Tooltip is a visual popup with no ARIA. */}
      <Tooltip text="Previous difference">
        <button
          type="button"
          className="diff-btn"
          aria-label="Previous difference"
          onClick={() => onStep(-1)}
        >
          ↑
        </button>
      </Tooltip>
      <Tooltip text="Next difference">
        <button
          type="button"
          className="diff-btn"
          aria-label="Next difference"
          onClick={() => onStep(1)}
        >
          ↓
        </button>
      </Tooltip>
      <span className="diff-sep" />
      <Tooltip text="Edit source">
        <button
          type="button"
          className="diff-btn"
          aria-label="Edit source"
          onClick={onEditSource}
        >
          ✎
        </button>
      </Tooltip>
      <span className="diff-sep" />
      <Tooltip text="Previous file">
        <button
          type="button"
          className="diff-btn"
          aria-label="Previous file"
          onClick={() => onFile(-1)}
        >
          ‹
        </button>
      </Tooltip>
      <Tooltip text="Next file">
        <button
          type="button"
          className="diff-btn"
          aria-label="Next file"
          onClick={() => onFile(1)}
        >
          ›
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
          {/* Chevrons folding toward each other, after VS Code's fold icon. */}
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
      {viewMode === "split" && (
        <Tooltip text="Synchronise scrolling">
          <button
            type="button"
            className={`diff-btn ${sync ? "diff-btn-on" : ""}`}
            aria-label="Synchronise scrolling"
            aria-pressed={sync}
            onClick={toggleSync}
          >
            ⇅
          </button>
        </Tooltip>
      )}
      <span className="diff-sep" />
      <Tooltip text="Find in diff (Ctrl+F / Cmd+F)">
        <button
          type="button"
          className={`diff-btn ${findOpen ? "diff-btn-on" : ""}`}
          aria-label="Find in diff"
          aria-pressed={findOpen}
          onClick={openFind}
        >
          🔍
        </button>
      </Tooltip>

      <span className="diff-spring" />
      {/* Polite, so each F7 step is announced without interrupting. */}
      <span className="diff-sr-only" aria-live="polite">
        {position >= 0 ? `Difference ${position + 1} of ${changed.length}` : ""}
      </span>
      <span className="diff-count">
        {fallback
          ? FALLBACK_LABEL[fallback.kind]
          : differences === 0
            ? "No differences"
            : `${differences} difference${differences === 1 ? "" : "s"}`}
      </span>
      <span className="diff-sep" />
      <div className="diff-menu-anchor">
        <Tooltip text="Diff settings">
          <button
            ref={menuButtonRef}
            type="button"
            className={`diff-btn ${menuOpen ? "diff-btn-on" : ""}`}
            aria-label="Diff settings"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            ⚙
          </button>
        </Tooltip>
        {menuOpen && (
          <DiffSettingsMenu
            onClose={() => {
              setMenuOpen(false);
              // Focus goes back where it came from, or closing the menu
              // strands the keyboard at the top of the document.
              menuButtonRef.current?.focus();
            }}
          />
        )}
      </div>
    </div>
  );
}

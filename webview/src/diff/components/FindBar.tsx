import { useEffect, useRef } from "react";
import { Tooltip } from "../../shared/components/Tooltip";
import { useDiffStore } from "../../shared/store/diff-store";
import type { Side } from "../utils/diff-model";

interface FindBarProps {
  /** Which pane this bar searches. Each side carries its own bar. */
  side: Side;
  /** Scroll the shared axis so a position sits near the top of the viewport. */
  onJump: (axisPosition: number) => void;
  /** The bar Cmd+F lands in — one per row, conventionally the right. */
  autoFocus?: boolean;
}

/**
 * One side's find bar — searched against that side's full text.
 *
 * Two bars, one per pane, is the IntelliJ shape: each editor of a diff
 * searches independently, with its own query, options and count. The
 * webview's native find widget (`enableFindWidget`) is deliberately not
 * used: it searches the DOM, and the panes virtualise to roughly a viewport
 * of rows, so it would confidently report "1 of 2" in a file with two
 * hundred hits.
 */
export function FindBar({ side, onJump, autoFocus = false }: FindBarProps) {
  const state = useDiffStore((s) =>
    side === "left" ? s.findLeft : s.findRight,
  );
  const setFindQuery = useDiffStore((s) => s.setFindQuery);
  const toggleFindCase = useDiffStore((s) => s.toggleFindCase);
  const toggleFindWord = useDiffStore((s) => s.toggleFindWord);
  const toggleFindRegex = useDiffStore((s) => s.toggleFindRegex);
  const stepMatch = useDiffStore((s) => s.stepMatch);
  const closeFind = useDiffStore((s) => s.closeFind);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [autoFocus]);

  // Every path that changes this bar's active match funnels through here, so
  // typing, stepping and option toggles all reveal their result the same
  // way. Keyed on the match itself, not its index: a query change recomputes
  // the list and resets the index to 0, so a new first match at an unchanged
  // index must still re-fire the reveal.
  const currentMatch = state.matches[state.activeMatch];
  useEffect(() => {
    if (!currentMatch) return;
    // A hit inside a collapsed run expands its fold first — jumping to a
    // match the viewer then cannot show would make the count read as a lie.
    useDiffStore.getState().revealActiveMatch(side);
    const axis = useDiffStore.getState().activeMatchAxis(side);
    if (axis !== null) onJump(Math.max(0, axis - 2));
  }, [currentMatch, side, onJump]);

  const count = state.matches.length;
  const label = side === "left" ? "Find in left side" : "Find in right side";

  return (
    <div className="diff-find" role="search">
      <input
        ref={inputRef}
        className="diff-find-input"
        type="text"
        placeholder={label}
        aria-label={label}
        value={state.query}
        onChange={(event) => setFindQuery(side, event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            stepMatch(side, event.shiftKey ? -1 : 1);
            event.preventDefault();
          }
          if (event.key === "Escape") {
            closeFind();
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      />
      <Tooltip text="Match case">
        <button
          type="button"
          className={`diff-find-chip ${state.caseSensitive ? "diff-find-chip-on" : ""}`}
          aria-label="Match case"
          aria-pressed={state.caseSensitive}
          onClick={() => toggleFindCase(side)}
        >
          Aa
        </button>
      </Tooltip>
      <Tooltip text="Whole word">
        <button
          type="button"
          className={`diff-find-chip ${state.wholeWord ? "diff-find-chip-on" : ""}`}
          aria-label="Whole word"
          aria-pressed={state.wholeWord}
          onClick={() => toggleFindWord(side)}
        >
          ab|
        </button>
      </Tooltip>
      <Tooltip text="Regular expression">
        <button
          type="button"
          className={`diff-find-chip ${state.regex ? "diff-find-chip-on" : ""}`}
          aria-label="Regular expression"
          aria-pressed={state.regex}
          onClick={() => toggleFindRegex(side)}
        >
          .*
        </button>
      </Tooltip>
      {/* Polite, so it reads "3/12" after each step without interrupting. */}
      <span className="diff-find-count" aria-live="polite">
        {state.query === ""
          ? ""
          : count === 0
            ? "0 results"
            : `${state.activeMatch + 1}/${count}`}
      </span>
      <Tooltip text="Previous match (Shift+Enter)">
        <button
          type="button"
          className="diff-btn"
          aria-label="Previous match"
          disabled={count === 0}
          onClick={() => stepMatch(side, -1)}
        >
          ↑
        </button>
      </Tooltip>
      <Tooltip text="Next match (Enter)">
        <button
          type="button"
          className="diff-btn"
          aria-label="Next match"
          disabled={count === 0}
          onClick={() => stepMatch(side, 1)}
        >
          ↓
        </button>
      </Tooltip>
      <Tooltip text="Close find (Escape)">
        <button
          type="button"
          className="diff-btn"
          aria-label="Close find"
          onClick={closeFind}
        >
          ✕
        </button>
      </Tooltip>
    </div>
  );
}

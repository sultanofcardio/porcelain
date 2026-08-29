import { useEffect, useRef } from "react";
import { Tooltip } from "../../shared/components/Tooltip";
import { useDiffStore } from "../../shared/store/diff-store";

interface FindBarProps {
  /** Scroll the shared axis so a position sits near the top of the viewport. */
  onJump: (axisPosition: number) => void;
}

const SCOPE_LABEL = {
  both: "Both sides",
  left: "Left only",
  right: "Right only",
} as const;

/**
 * Find within the diff — searched against the store's full texts.
 *
 * The webview's native find widget (`enableFindWidget`) is deliberately not
 * used: it searches the DOM, and the panes virtualise to roughly a viewport
 * of rows, so it would confidently report "1 of 2" in a file with two hundred
 * hits. This bar owns Cmd/Ctrl+F instead.
 */
export function FindBar({ onJump }: FindBarProps) {
  const store = useDiffStore();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Every path that changes the active match funnels through here, so typing,
  // stepping and option toggles all reveal their result the same way.
  const { activeMatch } = store;
  useEffect(() => {
    if (activeMatch < 0) return;
    const axis = useDiffStore.getState().activeMatchAxis();
    if (axis !== null) onJump(Math.max(0, axis - 2));
  }, [activeMatch, onJump]);

  const count = store.matches.length;

  return (
    <div className="diff-find" role="search">
      <input
        ref={inputRef}
        className="diff-find-input"
        type="text"
        placeholder="Find in diff"
        aria-label="Find in diff"
        value={store.findQuery}
        onChange={(event) => store.setFindQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            store.stepMatch(event.shiftKey ? -1 : 1);
            event.preventDefault();
          }
          if (event.key === "Escape") {
            store.closeFind();
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      />
      <Tooltip text="Match case">
        <button
          type="button"
          className={`diff-find-chip ${store.findCase ? "diff-find-chip-on" : ""}`}
          aria-label="Match case"
          aria-pressed={store.findCase}
          onClick={store.toggleFindCase}
        >
          Aa
        </button>
      </Tooltip>
      <Tooltip text="Whole word">
        <button
          type="button"
          className={`diff-find-chip ${store.findWord ? "diff-find-chip-on" : ""}`}
          aria-label="Whole word"
          aria-pressed={store.findWord}
          onClick={store.toggleFindWord}
        >
          ab|
        </button>
      </Tooltip>
      <Tooltip text="Regular expression">
        <button
          type="button"
          className={`diff-find-chip ${store.findRegex ? "diff-find-chip-on" : ""}`}
          aria-label="Regular expression"
          aria-pressed={store.findRegex}
          onClick={store.toggleFindRegex}
        >
          .*
        </button>
      </Tooltip>
      {/* Polite, so it reads "3 of 12" after each step without interrupting. */}
      <span className="diff-find-count" aria-live="polite">
        {store.findQuery === ""
          ? ""
          : count === 0
            ? "No matches"
            : `${store.activeMatch + 1} of ${count}`}
      </span>
      <Tooltip text="Previous match (Shift+Enter)">
        <button
          type="button"
          className="diff-btn"
          aria-label="Previous match"
          disabled={count === 0}
          onClick={() => store.stepMatch(-1)}
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
          onClick={() => store.stepMatch(1)}
        >
          ↓
        </button>
      </Tooltip>
      <Tooltip text="Which side to search">
        <button
          type="button"
          className={`diff-find-chip ${store.findScope !== "both" ? "diff-find-chip-on" : ""}`}
          aria-label={`Searching ${SCOPE_LABEL[store.findScope].toLowerCase()} — click to change`}
          onClick={store.cycleFindScope}
        >
          {SCOPE_LABEL[store.findScope]}
        </button>
      </Tooltip>
      <Tooltip text="Close (Escape)">
        <button
          type="button"
          className="diff-btn"
          aria-label="Close find"
          onClick={store.closeFind}
        >
          ✕
        </button>
      </Tooltip>
    </div>
  );
}

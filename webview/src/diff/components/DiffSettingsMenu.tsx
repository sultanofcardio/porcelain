import { useEffect, useRef } from "react";
import {
  type Granularity,
  useDiffStore,
  type Whitespace,
} from "../../shared/store/diff-store";

const WHITESPACE: Array<{ value: Whitespace; label: string }> = [
  { value: "none", label: "Do not ignore" },
  { value: "trim", label: "Ignore leading and trailing" },
];

const GRANULARITY: Array<{ value: Granularity; label: string }> = [
  { value: "line", label: "By line" },
  { value: "word", label: "By word" },
  { value: "character", label: "By character" },
  { value: "none", label: "Off" },
];

/**
 * The per-window settings menu.
 *
 * Nothing here is persisted: these options apply to this diff only and are
 * forgotten when it closes. That is the whole reason the surface exists —
 * VS Code's `diffEditor.*` equivalents are global settings, so changing one
 * from a diff changes every diff the user ever opens.
 */
export function DiffSettingsMenu({ onClose }: { onClose: () => void }) {
  const store = useDiffStore();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // Deferred so the click that opened the menu does not immediately close it.
    const id = window.setTimeout(() => {
      window.addEventListener("mousedown", dismiss);
      window.addEventListener("keydown", onEscape);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onEscape);
    };
  }, [onClose]);

  return (
    <div className="diff-menu" ref={ref}>
      <div className="diff-menu-head">Whitespace</div>
      {WHITESPACE.map((option) => (
        <button
          type="button"
          key={option.value}
          className="diff-menu-row"
          onClick={() => store.setWhitespace(option.value)}
        >
          <span className="diff-menu-mark">
            {store.whitespace === option.value ? "●" : ""}
          </span>
          {option.label}
        </button>
      ))}

      <div className="diff-menu-sep" />
      <div className="diff-menu-head">Highlight granularity</div>
      {GRANULARITY.map((option) => (
        <button
          type="button"
          key={option.value}
          className="diff-menu-row"
          onClick={() => store.setGranularity(option.value)}
        >
          <span className="diff-menu-mark">
            {store.granularity === option.value ? "●" : ""}
          </span>
          {option.label}
        </button>
      ))}

      <div className="diff-menu-sep" />
      <button
        type="button"
        className="diff-menu-row"
        onClick={store.toggleCollapseUnchanged}
      >
        <span className="diff-menu-mark">
          {store.collapseUnchanged ? "✓" : ""}
        </span>
        Collapse unchanged
        <span className="diff-menu-value">{store.contextLines} lines</span>
      </button>
      <button
        type="button"
        className="diff-menu-row"
        onClick={store.toggleSyncScroll}
      >
        <span className="diff-menu-mark">{store.syncScroll ? "✓" : ""}</span>
        Synchronise scrolling
      </button>

      <div className="diff-menu-sep" />
      <button type="button" className="diff-menu-row" onClick={store.swapSides}>
        <span className="diff-menu-mark" />
        Swap sides
      </button>
      <div className="diff-menu-note">Applies to this window only</div>
    </div>
  );
}

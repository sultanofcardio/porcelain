import { useEffect, useRef } from "react";
import {
  type Granularity,
  useDiffStore,
  type ViewMode,
  type Whitespace,
} from "../../shared/store/diff-store";

const VIEW: Array<{ value: ViewMode; label: string }> = [
  { value: "split", label: "Side by side" },
  { value: "unified", label: "Unified" },
];

const WHITESPACE: Array<{ value: Whitespace; label: string }> = [
  { value: "none", label: "Do not ignore" },
  { value: "trim", label: "Ignore leading and trailing" },
  { value: "ignore", label: "Ignore whitespaces" },
  { value: "ignore-empty", label: "Ignore whitespaces and empty lines" },
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
export function DiffSettingsMenu({
  onClose,
  anchorRef,
}: {
  onClose: () => void;
  /** The button that opened the menu — its own toggle handles closing. */
  anchorRef?: React.RefObject<HTMLElement | null>;
}) {
  const store = useDiffStore();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      // A mousedown on the anchor is not "outside": dismissing here would
      // race the anchor's click toggle, which then reopens the menu and
      // makes the gear unable to ever close it.
      if (anchorRef?.current?.contains(target)) return;
      onClose();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Capture phase plus stopPropagation, so the one press dismisses the
      // menu alone — the app's own Escape handler (close find) must not run
      // on the same keystroke.
      event.stopPropagation();
      onClose();
    };
    // Deferred so the click that opened the menu does not immediately close it.
    const id = window.setTimeout(() => {
      window.addEventListener("mousedown", dismiss);
      window.addEventListener("keydown", onEscape, true);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onEscape, true);
    };
  }, [onClose, anchorRef]);

  // Menu semantics: focus lands on the first row when the menu opens, and
  // the arrow keys walk the rows. Without this the menu is mouse-only —
  // Escape worked, but nothing inside was reachable.
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? []),
    ];
    if (buttons.length === 0) return;
    const current = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[next]?.focus();
    event.preventDefault();
  };

  return (
    <div className="diff-menu" ref={ref} role="menu" onKeyDown={onMenuKeyDown}>
      <div className="diff-menu-head">View</div>
      {VIEW.map((option) => (
        <button
          type="button"
          key={option.value}
          className="diff-menu-row"
          role="menuitemradio"
          aria-checked={store.viewMode === option.value}
          onClick={() => store.setViewMode(option.value)}
        >
          <span className="diff-menu-mark">
            {store.viewMode === option.value ? "●" : ""}
          </span>
          {option.label}
        </button>
      ))}

      <div className="diff-menu-sep" />
      <div className="diff-menu-head">Whitespace</div>
      {WHITESPACE.map((option) => (
        <button
          type="button"
          key={option.value}
          className="diff-menu-row"
          role="menuitemradio"
          aria-checked={store.whitespace === option.value}
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
          role="menuitemradio"
          aria-checked={store.granularity === option.value}
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
        role="menuitemcheckbox"
        aria-checked={store.collapseUnchanged}
        onClick={store.toggleCollapseUnchanged}
      >
        <span className="diff-menu-mark">
          {store.collapseUnchanged ? "✓" : ""}
        </span>
        Collapse unchanged
      </button>
      {store.collapseUnchanged && (
        <div className="diff-menu-row diff-menu-stepper">
          <span className="diff-menu-mark" />
          Context lines
          <span className="diff-menu-value">
            <button
              type="button"
              className="diff-menu-step"
              aria-label="Fewer context lines"
              disabled={store.contextLines <= 0}
              onClick={() => store.setContextLines(store.contextLines - 1)}
            >
              −
            </button>
            <span className="diff-menu-step-count">{store.contextLines}</span>
            <button
              type="button"
              className="diff-menu-step"
              aria-label="More context lines"
              onClick={() => store.setContextLines(store.contextLines + 1)}
            >
              +
            </button>
          </span>
        </div>
      )}
      {/* One column has nothing to synchronise; a toggle that does nothing
          is a bug report waiting to be filed. */}
      {store.viewMode === "split" && (
        <button
          type="button"
          className="diff-menu-row"
          role="menuitemcheckbox"
          aria-checked={store.syncScroll}
          onClick={store.toggleSyncScroll}
        >
          <span className="diff-menu-mark">{store.syncScroll ? "✓" : ""}</span>
          Synchronise scrolling
        </button>
      )}

      <div className="diff-menu-sep" />
      <button
        type="button"
        className="diff-menu-row"
        role="menuitem"
        onClick={store.swapSides}
      >
        <span className="diff-menu-mark" />
        Swap sides
      </button>
      <div className="diff-menu-note">Applies to this window only</div>
    </div>
  );
}

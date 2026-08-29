import { useEffect, useRef, useState } from "react";
import { LINE_HEIGHT } from "./metrics";

interface EditIslandProps {
  /** Pixel offset of the island's first row within the pane. */
  top: number;
  /** The lines the island took over when it opened. */
  lines: string[];
  /** Accessible name: what is being edited and how to leave. */
  label: string;
  /** Fired when the typed line count changes, so the axis can grow live. */
  onLinesChange: (lines: string[]) => void;
  onCommit: (lines: string[]) => void;
}

/**
 * The edit island: a native textarea swapped in over the rows of the block
 * being edited, so caret, selection, IME composition and in-island undo are
 * the platform's problem rather than ours. The pane around it stays
 * porcelain-rendered; committing splices the text back into the buffer and
 * re-derives everything.
 *
 * Esc and blur commit — the island is not a modal, and the nearest thing to
 * its mental model is a cell editor. Committing unchanged text is a no-op at
 * the buffer level. Escape is consumed here so the diff shell's own Escape
 * (close find) does not fire on the same press.
 */
export function EditIsland({
  top,
  lines,
  label,
  onLinesChange,
  onCommit,
}: EditIslandProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [rowCount, setRowCount] = useState(Math.max(1, lines.length));
  const lastCount = useRef(lines.length);
  // Guards the commit against double-firing: Escape commits and then blurs.
  const committed = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(0, 0);
  }, []);

  const currentLines = () => (ref.current?.value ?? "").split("\n");

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    onCommit(currentLines());
  };

  return (
    <textarea
      ref={ref}
      className="diff-island"
      style={{ top, height: rowCount * LINE_HEIGHT }}
      defaultValue={lines.join("\n")}
      wrap="off"
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      aria-label={label}
      onInput={() => {
        const typed = currentLines();
        setRowCount(Math.max(1, typed.length));
        if (typed.length !== lastCount.current) {
          lastCount.current = typed.length;
          onLinesChange(typed);
        }
      }}
      onKeyDown={(event) => {
        // A keystroke resolving an IME composition belongs to the
        // composition: Escape cancelling it must not commit the island, and
        // shortcuts must not fire on half-composed text.
        if (event.nativeEvent.isComposing) {
          event.stopPropagation();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          commit();
          return;
        }
        // Cmd/Ctrl+S commits and then deliberately bubbles on to the app's
        // save handler, so save-while-typing writes what was just typed
        // instead of silently doing nothing.
        if ((event.metaKey || event.ctrlKey) && event.key === "s") {
          commit();
          return;
        }
        // Cmd/Ctrl+Z stays native inside the island; the structural stack
        // takes over once the island has committed.
        event.stopPropagation();
      }}
      onBlur={() => commit()}
    />
  );
}

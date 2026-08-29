import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LINE_HEIGHT } from "../components/metrics";
import {
  caretAt,
  colAtVisual,
  comparePositions,
  deletionRange,
  documentEnd,
  documentStart,
  type EditorSelection,
  isCaret,
  lineEnd,
  lineStart,
  moveHorizontal,
  moveVertical,
  moveWord,
  ordered,
  type Position,
  visualCol,
} from "./editor-model";

/** The row a source line renders at, and back — the pane's fold coordinate. */
export interface DisplayMapping {
  toDisplayRow: (line: number) => number;
  toSourceLine: (row: number) => number | null;
}

interface EditablePaneProps {
  lines: string[];
  cursor: EditorSelection | null;
  composition: { start: Position; endLine: number } | null;
  /** Fractional display-row offset of the viewport top on this pane. */
  offset: number;
  visibleLines: number;
  mapping: DisplayMapping;
  label: string;
  onSetCursor: (selection: EditorSelection, goalVisual?: number | null) => void;
  onEdit: (
    selection: EditorSelection,
    text: string,
    coalesceKey: string | null,
  ) => void;
  onCompositionBegin: () => void;
  onCompositionUpdate: (text: string) => void;
  onCompositionEnd: (text: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  /** Scroll the surface so a display row sits inside the viewport. */
  onRevealRow: (displayRow: number) => void;
  /** The porcelain-rendered pane this editor sits over. */
  children: ReactNode;
}

const PANE_TEXT_PADDING = 10;

/** Width of one monospace cell in the editor font, in px. */
function useCharWidth(host: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(7.2);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const style = window.getComputedStyle(element);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    context.font = `${style.fontSize || "12px"} ${style.fontFamily || "monospace"}`;
    const measured = context.measureText("0").width;
    if (measured > 0) setWidth(measured);
  }, [host]);
  return width;
}

/**
 * The hand-built editor core's surface half: a hidden input receiver, a drawn
 * caret and selection, and mouse handling — layered over the porcelain rows,
 * which keep doing all of the rendering. Chosen at the hand-test review over
 * CodeMirror and a ghost textarea; the model half lives in editor-model.ts.
 *
 * Text enters through the textarea's input events (so dead keys and IME
 * composition follow the platform's own protocol); navigation and deletion
 * are keydown commands over the model. During composition the textarea's
 * value is the composition buffer and every update live-replaces the
 * composition range in the store, so the pane renders composition text
 * exactly like committed text.
 */
export function EditablePane({
  lines,
  cursor,
  composition,
  offset,
  visibleLines,
  mapping,
  label,
  onSetCursor,
  onEdit,
  onCompositionBegin,
  onCompositionUpdate,
  onCompositionEnd,
  onUndo,
  onRedo,
  onRevealRow,
  children,
}: EditablePaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const charWidth = useCharWidth(hostRef);
  const composingRef = useRef(false);
  const draggingRef = useRef(false);
  const goalRef = useRef<number | null>(null);

  const selectionText = useMemo(() => {
    if (!cursor || isCaret(cursor)) return "";
    const { start, end } = ordered(cursor);
    if (start.line === end.line) {
      return (lines[start.line] ?? "").slice(start.col, end.col);
    }
    const parts = [(lines[start.line] ?? "").slice(start.col)];
    for (let line = start.line + 1; line < end.line; line++) {
      parts.push(lines[line] ?? "");
    }
    parts.push((lines[end.line] ?? "").slice(0, end.col));
    return parts.join("\n");
  }, [cursor, lines]);

  const positionFromEvent = useCallback(
    (event: { clientX: number; clientY: number }): Position | null => {
      const host = hostRef.current;
      if (!host) return null;
      const rect = host.getBoundingClientRect();
      const row = Math.floor(offset + (event.clientY - rect.top) / LINE_HEIGHT);
      const line = mapping.toSourceLine(Math.max(0, row));
      if (line === null) return null;
      const x = event.clientX - rect.left - PANE_TEXT_PADDING;
      const col = colAtVisual(lines[line] ?? "", Math.max(0, x / charWidth));
      return { line: Math.min(line, Math.max(0, lines.length - 1)), col };
    },
    [offset, mapping, lines, charWidth],
  );

  const focusInput = useCallback(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const onMouseDown = useCallback(
    (event: React.MouseEvent) => {
      // Fold rows are buttons with their own behaviour; buttons stay buttons.
      if ((event.target as HTMLElement).closest("button")) return;
      const position = positionFromEvent(event);
      if (!position) return;
      event.preventDefault();
      focusInput();
      goalRef.current = null;
      if (event.detail >= 3) {
        onSetCursor({
          anchor: lineStart(position),
          head:
            position.line + 1 < lines.length
              ? { line: position.line + 1, col: 0 }
              : lineEnd(lines, position),
        });
        return;
      }
      if (event.detail === 2) {
        // The word under the click: step out to both boundaries.
        const after = moveWord(lines, lineStart(position), 1);
        const from =
          comparePositions(after, position) > 0
            ? moveWord(lines, after, -1)
            : moveWord(lines, position, -1);
        onSetCursor({ anchor: from, head: moveWord(lines, from, 1) });
        return;
      }
      if (event.shiftKey && cursor) {
        onSetCursor({ anchor: cursor.anchor, head: position });
      } else {
        onSetCursor(caretAt(position.line, position.col));
      }
      draggingRef.current = true;
    },
    [positionFromEvent, focusInput, onSetCursor, cursor, lines],
  );

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!draggingRef.current) return;
      const position = positionFromEvent(event);
      const current = cursor;
      if (position && current) {
        onSetCursor({ anchor: current.anchor, head: position });
      }
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [positionFromEvent, onSetCursor, cursor]);

  /** Move the caret (or extend with shift), collapsing selections sensibly. */
  const moveTo = useCallback(
    (target: Position, extend: boolean, goal: number | null = null) => {
      goalRef.current = goal;
      if (extend && cursor) {
        onSetCursor({ anchor: cursor.anchor, head: target }, goal);
      } else {
        onSetCursor(caretAt(target.line, target.col), goal);
      }
    },
    [cursor, onSetCursor],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Mid-composition keys belong to the IME — Enter confirms a candidate,
      // Escape cancels one; interfering commits half-composed text.
      if (event.nativeEvent.isComposing || composingRef.current) return;
      if (!cursor) return;
      const head = cursor.head;
      const extend = event.shiftKey;
      const primary = event.metaKey || event.ctrlKey;

      const handled = () => event.preventDefault();

      if (primary && (event.key === "a" || event.key === "A")) {
        onSetCursor({ anchor: documentStart(), head: documentEnd(lines) });
        return handled();
      }
      if (primary && (event.key === "z" || event.key === "Z")) {
        if (event.shiftKey) onRedo();
        else onUndo();
        return handled();
      }
      switch (event.key) {
        case "ArrowLeft":
        case "ArrowRight": {
          const delta = event.key === "ArrowLeft" ? -1 : 1;
          if (primary) {
            moveTo(delta < 0 ? lineStart(head) : lineEnd(lines, head), extend);
            return handled();
          }
          if (event.altKey) {
            moveTo(moveWord(lines, head, delta), extend);
            return handled();
          }
          if (!extend && !isCaret(cursor)) {
            // Plain arrows collapse a selection to its edge, going nowhere.
            const span = ordered(cursor);
            moveTo(delta < 0 ? span.start : span.end, false);
            return handled();
          }
          moveTo(moveHorizontal(lines, head, delta), extend);
          return handled();
        }
        case "ArrowUp":
        case "ArrowDown": {
          const delta = event.key === "ArrowUp" ? -1 : 1;
          if (primary) {
            moveTo(delta < 0 ? documentStart() : documentEnd(lines), extend);
            return handled();
          }
          const moved = moveVertical(lines, head, delta, goalRef.current);
          moveTo(moved.position, extend, moved.goalVisual);
          return handled();
        }
        case "Home":
          moveTo(lineStart(head), extend);
          return handled();
        case "End":
          moveTo(lineEnd(lines, head), extend);
          return handled();
        case "PageUp":
        case "PageDown": {
          const delta =
            (event.key === "PageUp" ? -1 : 1) * Math.max(1, visibleLines - 2);
          const moved = moveVertical(lines, head, delta, goalRef.current);
          moveTo(moved.position, extend, moved.goalVisual);
          return handled();
        }
        case "Backspace":
        case "Delete": {
          const direction = event.key === "Backspace" ? -1 : 1;
          const range = deletionRange(lines, cursor, direction, event.altKey);
          if (isCaret(range)) return handled();
          onEdit(range, "", "delete");
          return handled();
        }
        case "Tab":
          onEdit(cursor, "\t", "type");
          return handled();
        default:
          return;
      }
    },
    [cursor, lines, visibleLines, moveTo, onSetCursor, onEdit, onUndo, onRedo],
  );

  const onInput = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    if (composingRef.current) {
      onCompositionUpdate(input.value);
      return;
    }
    if (input.value && cursor) {
      onEdit(cursor, input.value, "type");
      input.value = "";
    }
  }, [cursor, onEdit, onCompositionUpdate]);

  /* ── overlay geometry ─────────────────────────────────────────────────── */

  const xOf = useCallback(
    (position: Position) =>
      PANE_TEXT_PADDING +
      visualCol(lines[position.line] ?? "", position.col) * charWidth,
    [lines, charWidth],
  );
  const yOf = useCallback(
    (line: number) => (mapping.toDisplayRow(line) - offset) * LINE_HEIGHT,
    [mapping, offset],
  );

  const overlayRects = useMemo(() => {
    const rects: Array<{
      key: string;
      top: number;
      left: number;
      width: number | "flex";
      kind: "selection" | "composition";
    }> = [];
    const push = (
      span: { start: Position; end: Position },
      kind: "selection" | "composition",
    ) => {
      const firstVisible = Math.floor(offset) - 1;
      const lastVisible = Math.ceil(offset + visibleLines) + 1;
      for (let line = span.start.line; line <= span.end.line; line++) {
        const row = mapping.toDisplayRow(line);
        if (row < firstVisible || row > lastVisible) continue;
        const fromCol = line === span.start.line ? span.start.col : 0;
        const from =
          PANE_TEXT_PADDING + visualCol(lines[line] ?? "", fromCol) * charWidth;
        const to =
          line === span.end.line
            ? PANE_TEXT_PADDING +
              visualCol(lines[line] ?? "", span.end.col) * charWidth
            : ("flex" as const);
        rects.push({
          key: `${kind}-${line}`,
          top: (row - offset) * LINE_HEIGHT,
          left: from,
          width: to === "flex" ? "flex" : Math.max(0, to - from),
          kind,
        });
      }
    };
    if (cursor && !isCaret(cursor)) push(ordered(cursor), "selection");
    if (composition && cursor) {
      push(
        ordered({ anchor: composition.start, head: cursor.head }),
        "composition",
      );
    }
    return rects;
  }, [cursor, composition, lines, mapping, offset, visibleLines, charWidth]);

  // Follow the caret: a move or edit that leaves the viewport scrolls to it.
  // Keyed on the caret's identity alone — everything else is read through a
  // ref, because scrolling (which changes `offset`) must not re-trigger it.
  const headKey = cursor ? `${cursor.head.line}:${cursor.head.col}` : null;
  const revealRef = useRef({ mapping, offset, visibleLines, onRevealRow });
  revealRef.current = { mapping, offset, visibleLines, onRevealRow };
  useEffect(() => {
    if (headKey === null) return;
    const {
      mapping: map,
      offset: at,
      visibleLines: rows,
      onRevealRow: go,
    } = revealRef.current;
    const headLine = Number(headKey.split(":")[0]);
    const row = map.toDisplayRow(headLine);
    if (row < at + 0.5 || row > at + rows - 1.5) {
      go(Math.max(0, row - Math.floor(rows / 2)));
    }
  }, [headKey]);

  const caretVisible = cursor !== null;
  const caretTop = cursor ? yOf(cursor.head.line) : 0;
  const caretLeft = cursor ? xOf(cursor.head) : 0;

  return (
    // The host div only translates pointer geometry; the textarea below is
    // the accessible control that owns focus and input.
    <div className="diff-editor-host" ref={hostRef} onMouseDown={onMouseDown}>
      {children}
      <div className="diff-editor-overlay" aria-hidden="true">
        {overlayRects.map((rect) => (
          <div
            key={rect.key}
            className={
              rect.kind === "selection"
                ? "diff-editor-selection"
                : "diff-editor-composition"
            }
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width === "flex" ? undefined : rect.width,
              right: rect.width === "flex" ? 0 : undefined,
            }}
          />
        ))}
        {caretVisible && (
          <div
            className="diff-editor-caret"
            style={{ top: caretTop, left: caretLeft }}
          />
        )}
      </div>
      <textarea
        ref={inputRef}
        className="diff-editor-input"
        style={{ top: caretTop, left: caretLeft }}
        aria-label={label}
        wrap="off"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        onKeyDown={onKeyDown}
        onInput={onInput}
        onCompositionStart={() => {
          composingRef.current = true;
          onCompositionBegin();
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          onCompositionEnd(event.data ?? "");
          if (inputRef.current) inputRef.current.value = "";
        }}
        onCopy={(event) => {
          event.clipboardData.setData("text/plain", selectionText);
          event.preventDefault();
        }}
        onCut={(event) => {
          event.clipboardData.setData("text/plain", selectionText);
          event.preventDefault();
          if (cursor && !isCaret(cursor)) onEdit(cursor, "", null);
        }}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text/plain");
          event.preventDefault();
          if (text && cursor) onEdit(cursor, text, null);
        }}
        onBlur={() => {
          // Blur mid-composition commits what the IME had — never lose text.
          if (composingRef.current) {
            composingRef.current = false;
            onCompositionEnd(inputRef.current?.value ?? "");
            if (inputRef.current) inputRef.current.value = "";
          }
        }}
      />
    </div>
  );
}

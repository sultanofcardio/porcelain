import { useEffect, useRef } from "react";
import type { LineMeasurer } from "../components/metrics";
import { visualCol } from "../editor/editor-model";

/** A find match to bring into view sideways, in the pane that shows it. */
export interface MatchTarget<K extends string> {
  /** The pane the match is revealed in. */
  pane: K;
  /** The text of the line the match sits on, and its position on it. */
  text: string;
  line: number;
  start: number;
  end: number;
  /** Where the line's text starts inside the pane's content, in px. */
  inset: number;
  /** Width of the pane's left edge that content scrolls under (sticky columns). */
  obscuredLeft?: number;
}

export interface RevealGeometry<K extends string> {
  charWidth: number;
  measure: LineMeasurer | null;
  reveal: (pane: K, from: number, to: number, obscuredLeft?: number) => void;
}

/**
 * Stepping to a match brings it into view sideways as well as down: the find
 * bar's jump moves the axis, and this moves the pane, since a hit at column
 * 150 of a wide line is otherwise highlighted off-screen.
 *
 * Positions are rendered pixels, like the pane's width: a match past a run of
 * full-width glyphs paints twice as far along as its cells suggest. The
 * editor's own caret, selection and click mapping stay in cells on purpose,
 * that coordinate being the editor's model, so only find reads through the
 * measurer; without one (jsdom) cells are all there is.
 *
 * Keyed on the match itself, with everything else read through a ref, so a
 * scroll, which re-renders, cannot re-run it and fight the user's own
 * scrolling.
 */
export function useRevealMatch<K extends string>(
  target: MatchTarget<K> | null,
  geometry: RevealGeometry<K>,
): void {
  const key = target
    ? `${target.pane}:${target.line}:${target.start}:${target.end}`
    : null;
  const latest = useRef({ target, geometry });
  latest.current = { target, geometry };
  useEffect(() => {
    if (key === null) return;
    const { target: match, geometry: at } = latest.current;
    if (!match) return;
    const xAt = (col: number) =>
      match.inset +
      (at.measure
        ? at.measure.prefix(match.text, col)
        : visualCol(match.text, col) * at.charWidth);
    at.reveal(
      match.pane,
      xAt(match.start),
      xAt(match.end),
      match.obscuredLeft ?? 0,
    );
  }, [key]);
}

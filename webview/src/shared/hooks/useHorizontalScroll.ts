import type { KeyboardEvent } from "react";
import { useCallback, useMemo, useRef, useState } from "react";

/** One arrow key's worth of sideways travel, in px: the browser's own step. */
const ARROW_STEP = 40;
/** Room kept between a revealed span and the pane edge, in px. */
const REVEAL_MARGIN = 24;

/**
 * The horizontal axis of a set of panes, each a native horizontal scroll
 * container of its own.
 *
 * The DOM owns the positions. Panes scroll natively and report through
 * `onScrollX`; every programmatic move writes `scrollLeft` directly. No
 * effect ever pushes a React value back into a pane, so a stale render can
 * never yank a pane mid-gesture — the failure mode of a controlled scroller.
 * React keeps a read model of the positions for whatever draws in pane
 * coordinates (the editor's caret), one scroll event behind the DOM, the same
 * relationship the vertical axis has with `offset`.
 *
 * With `synced` on, one pane's scroll is written straight to the others. The
 * caller gives synchronised panes one shared content width, so their ranges
 * match and no pane is left behind at a shorter maximum.
 *
 * `keys` must be a stable array (a module constant): the ref callbacks are
 * derived from it once.
 */
export function useHorizontalScroll<K extends string>(
  keys: readonly K[],
  synced: boolean,
) {
  const nodes = useRef(new Map<K, HTMLDivElement>());
  const [positions, setPositions] = useState<Partial<Record<K, number>>>({});
  // Panes whose next scroll event is the echo of a write made here. A pane
  // written to fires its own scroll event a frame later, carrying a value
  // the source pane has already moved past when a wheel is animating it;
  // broadcast back, that stale value would yank the source pane and kill
  // its gesture. The echo is recorded in `positions` and goes no further.
  const echoes = useRef(new Set<K>());

  const refs = useMemo(() => {
    const callbacks = new Map<K, (node: HTMLDivElement | null) => void>();
    for (const key of keys) {
      callbacks.set(key, (node) => {
        // The read model never outlives the node it describes: a fresh pane
        // reports where it actually is (a remount starts at 0 and fires no
        // scroll event), and a gone pane leaves no position behind.
        if (node) {
          nodes.current.set(key, node);
          const x = node.scrollLeft;
          setPositions((current) =>
            current[key] === x ? current : { ...current, [key]: x },
          );
        } else {
          nodes.current.delete(key);
          setPositions((current) => {
            if (!(key in current)) return current;
            const next = { ...current };
            delete next[key];
            return next;
          });
        }
      });
    }
    return callbacks;
  }, [keys]);

  /** The ref for a pane's scroll container. */
  const refFor = useCallback((key: K) => refs.get(key), [refs]);

  /** A pane scrolled to `x`: record it, and carry the others along if synced. */
  const onScrollX = useCallback(
    (key: K, x: number) => {
      setPositions((current) =>
        current[key] === x ? current : { ...current, [key]: x },
      );
      if (echoes.current.delete(key) || !synced) return;
      for (const [other, node] of nodes.current) {
        if (other === key) continue;
        // A pane already there is left alone: writing an equal value is a
        // no-op, and a sub-pixel disagreement is not worth an event.
        if (Math.abs(node.scrollLeft - x) < 1) continue;
        node.scrollLeft = x;
        // Only a write that took marks an echo — a clamped no-op fires none,
        // and a stale mark would swallow that pane's next real scroll.
        if (node.scrollLeft !== x) continue;
        echoes.current.add(other);
      }
    },
    [synced],
  );

  /** Move a pane by `delta` px; synced panes follow through its scroll event. */
  const scrollBy = useCallback((key: K, delta: number) => {
    const node = nodes.current.get(key);
    if (node) node.scrollLeft = Math.max(0, node.scrollLeft + delta);
  }, []);

  /**
   * Scroll a pane the least distance that brings the content span
   * `[from, to]` (px, pane coordinates) into view, with a margin. A span
   * already in view leaves the pane where the user put it; one wider than
   * the pane shows its start. `obscuredLeft` is the width of the pane's left
   * edge that content scrolls under — sticky line numbers — and so does not
   * count as in view.
   */
  const reveal = useCallback(
    (key: K, from: number, to: number, obscuredLeft = 0) => {
      const node = nodes.current.get(key);
      if (!node) return;
      const width = node.clientWidth - obscuredLeft;
      if (width <= 0) return;
      const left = node.scrollLeft + obscuredLeft;
      if (from >= left && to <= left + width) return;
      const target =
        from < left || to - from >= width
          ? from - REVEAL_MARGIN
          : to - width + REVEAL_MARGIN;
      node.scrollLeft = Math.max(0, target - obscuredLeft);
    },
    [],
  );

  /**
   * Arrow keys on a focused viewport. Up and down scroll the viewport
   * natively; left and right have nothing to move there, since the sideways
   * axis belongs to the panes — so they drive the pane that owns the axis.
   * Only the viewport's own keys: an element focused inside it (a fold
   * button, the editor's input) keeps its arrows.
   */
  const arrowScroll = useCallback(
    (key: K, event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (event.target !== event.currentTarget) return;
      scrollBy(key, event.key === "ArrowRight" ? ARROW_STEP : -ARROW_STEP);
      event.preventDefault();
    },
    [scrollBy],
  );

  return { positions, refFor, onScrollX, scrollBy, reveal, arrowScroll };
}

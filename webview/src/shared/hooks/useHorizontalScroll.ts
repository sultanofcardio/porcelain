import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** One arrow key's worth of sideways travel, in px: the browser's own step. */
const ARROW_STEP = 40;
/** Room kept between a revealed span and the pane edge, in px. */
const REVEAL_MARGIN = 24;

/** The same record without `key`, or the record itself when it has no `key`. */
function without<K extends string>(
  current: Partial<Record<K, number>>,
  key: K,
): Partial<Record<K, number>> {
  if (!(key in current)) return current;
  const next = { ...current };
  delete next[key];
  return next;
}

/**
 * The horizontal axis of a set of panes, each a native horizontal scroll
 * container of its own.
 *
 * The DOM owns the positions. Panes scroll natively and report through
 * `onScrollX`; every programmatic move writes `scrollLeft` directly. No
 * effect ever pushes a React value back into a pane, so a stale render can
 * never yank a pane mid-gesture - the failure mode of a controlled scroller.
 * React keeps a read model of the positions for whatever draws in pane
 * coordinates (the editor's caret), one scroll event behind the DOM, the same
 * relationship the vertical axis has with `offset`.
 *
 * With `synced` on, one pane's scroll is written straight to the others. The
 * caller gives synchronised panes one shared content width, but equal content
 * over unequal panes still ends at unequal maxima - a pane 26px wider stops
 * 26px earlier - so the hook measures each pane and offers `padding`, the px
 * every pane must add to that shared width for all of their ranges to end
 * together. The widest pane gets a little blank space past the text; nothing
 * is left unreachable in the narrower ones. `realign` brings the panes back
 * together when the caller re-couples them.
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
  const [widths, setWidths] = useState<Partial<Record<K, number>>>({});
  // Panes whose next scroll event is the echo of a write made here. A pane
  // written to fires its own scroll event a frame later, carrying a value
  // the source pane has already moved past when a wheel is animating it;
  // broadcast back, that stale value would yank the source pane and kill
  // its gesture. The echo is recorded in `positions` and goes no further.
  const echoes = useRef(new Set<K>());
  const observed = useRef(new Map<Element, K>());
  const observer = useRef<ResizeObserver | null>(null);

  const measure = useCallback((key: K, width: number) => {
    setWidths((current) =>
      current[key] === width ? current : { ...current, [key]: width },
    );
  }, []);

  // One observer for every pane. Environments without ResizeObserver (jsdom)
  // fall back to a single read at attach time.
  const watcher = useCallback(() => {
    if (typeof ResizeObserver === "undefined") return null;
    observer.current ??= new ResizeObserver((entries) => {
      for (const entry of entries) {
        const key = observed.current.get(entry.target);
        if (key === undefined) continue;
        measure(key, (entry.target as HTMLElement).clientWidth);
      }
    });
    return observer.current;
  }, [measure]);

  useEffect(() => () => observer.current?.disconnect(), []);

  const refs = useMemo(() => {
    const callbacks = new Map<K, (node: HTMLDivElement | null) => void>();
    for (const key of keys) {
      callbacks.set(key, (node) => {
        // No per-key state outlives the node it describes: a fresh pane
        // reports where it actually is (a remount starts at 0 and fires no
        // scroll event), and a gone pane leaves behind no position, no
        // width and no pending echo.
        const previous = nodes.current.get(key);
        if (previous) {
          observer.current?.unobserve(previous);
          observed.current.delete(previous);
        }
        if (!node) {
          nodes.current.delete(key);
          echoes.current.delete(key);
          setPositions((current) => without(current, key));
          setWidths((current) => without(current, key));
          return;
        }
        nodes.current.set(key, node);
        const x = node.scrollLeft;
        setPositions((current) =>
          current[key] === x ? current : { ...current, [key]: x },
        );
        const resize = watcher();
        if (!resize) {
          measure(key, node.clientWidth);
          return;
        }
        observed.current.set(node, key);
        resize.observe(node);
      });
    }
    return callbacks;
  }, [keys, watcher, measure]);

  /** The ref for a pane's scroll container. */
  const refFor = useCallback((key: K) => refs.get(key), [refs]);

  /**
   * How much extra content width each pane needs for every synchronised
   * pane's scroll range to end at the same maximum: its own width less the
   * narrowest pane's. Zero everywhere while decoupled, where each pane keeps
   * its own range.
   */
  const padding = useMemo(() => {
    const result: Partial<Record<K, number>> = {};
    if (!synced) return result;
    const measured = keys.filter((key) => widths[key] !== undefined);
    if (measured.length < 2) return result;
    const narrowest = Math.min(...measured.map((key) => widths[key] as number));
    for (const key of measured) {
      result[key] = (widths[key] as number) - narrowest;
    }
    return result;
  }, [keys, synced, widths]);

  /** Carry every pane but `from` to `x`, marking the echoes that will come. */
  const broadcast = useCallback((from: K, x: number) => {
    for (const [other, node] of nodes.current) {
      if (other === from) continue;
      // A pane already there is left alone: writing an equal value is a
      // no-op, and a sub-pixel disagreement is not worth an event.
      if (Math.abs(node.scrollLeft - x) < 1) continue;
      const before = node.scrollLeft;
      node.scrollLeft = x;
      // Any write that moved the pane marks an echo, even one the pane
      // clamped short of `x` - that scroll event is still this write coming
      // back, and broadcasting it would drag the source pane down to the
      // clamped value. A write that did nothing fires no event, and a stale
      // mark would swallow the pane's next real scroll.
      if (node.scrollLeft !== before) echoes.current.add(other);
    }
  }, []);

  /** A pane scrolled to `x`: record it, and carry the others along if synced. */
  const onScrollX = useCallback(
    (key: K, x: number) => {
      setPositions((current) =>
        current[key] === x ? current : { ...current, [key]: x },
      );
      if (echoes.current.delete(key) || !synced) return;
      broadcast(key, x);
    },
    [synced, broadcast],
  );

  /**
   * Bring the panes back together at `leader`'s position. Panes drift apart
   * while decoupled, and re-coupling them has to mean the same thing on this
   * axis as it does on the vertical one.
   */
  const realign = useCallback(
    (leader: K) => {
      const node = nodes.current.get(leader);
      if (node) broadcast(leader, node.scrollLeft);
    },
    [broadcast],
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
   * edge that content scrolls under - sticky line numbers - and so does not
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
   * axis belongs to the panes - so they drive the pane that owns the axis.
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

  return {
    positions,
    padding,
    refFor,
    onScrollX,
    scrollBy,
    reveal,
    realign,
    arrowScroll,
  };
}

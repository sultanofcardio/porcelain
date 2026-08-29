import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { bridge } from "../shared/bridge";
import type { DiffSidesResult } from "../shared/bridge/types";
import { useDiffStore } from "../shared/store/diff-store";
import { ChangeStripe, splitStripeMarks } from "./components/ChangeStripe";
import { DiffFallback } from "./components/DiffFallback";
import { DiffGutter } from "./components/DiffGutter";
import { DiffPane } from "./components/DiffPane";
import { DiffToolbar } from "./components/DiffToolbar";
import { FindBar } from "./components/FindBar";
import { LINE_HEIGHT } from "./components/metrics";
import { RevisionHeader } from "./components/RevisionHeader";
import { UnifiedPane } from "./components/UnifiedPane";
import {
  axisToSide,
  chooseLayout,
  sideToAxis,
  splitLines,
} from "./utils/diff-model";
import { unifiedRows, unifiedStripeMarks } from "./utils/unified";
import "./diff.css";

export function DiffApp() {
  const store = useDiffStore();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [axisPosition, setAxisPosition] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  // "Show anyway" on an oversized diff. Per-diff by construction: opening
  // another diff replaces the webview's html, which remounts the app.
  const [force, setForce] = useState(false);

  const root = document.getElementById("root");
  const filePath = root?.dataset.diffPath ?? "";
  const leftRef = root?.dataset.leftRef ?? "";
  const rightRef = root?.dataset.rightRef ?? "";

  useEffect(() => {
    let cancelled = false;
    bridge
      .request("getDiffSides", { filePath, leftRef, rightRef, force })
      .then((data) => {
        // Reached through getState() rather than the hook: the store is a
        // singleton whose actions never change identity, and depending on the
        // hook's object would re-run this fetch on every render.
        if (!cancelled)
          useDiffStore.getState().setSides(data as DiffSidesResult);
      })
      .catch((error: Error) => {
        if (!cancelled) useDiffStore.getState().setError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, leftRef, rightRef, force]);

  // Measured rather than derived, because the number of rows to render depends
  // on it.
  const measure = useCallback(() => {
    const element = viewportRef.current;
    if (element) setViewportHeight(element.clientHeight);
  }, []);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  useLayoutEffect(() => {
    // The first measurement happens while the placeholder is up, before the
    // toolbar and headers have laid out, so on its own it under-reports and the
    // panes stop short of the bottom of the window. Re-measure once real
    // content has replaced it.
    if (store.loading) return;
    measure();
  }, [measure, store.loading]);

  // The scroll container's own scrollTop *is* the shared axis: one scrollbar
  // drives both panes, and each derives its own offset from it. That is what
  // lets the right pane move through an insertion while the left stands still.
  const onScroll = useCallback(() => {
    const element = viewportRef.current;
    if (element) setAxisPosition(element.scrollTop / LINE_HEIGHT);
  }, []);

  const scrollToAxis = useCallback((position: number) => {
    const element = viewportRef.current;
    if (element) element.scrollTop = Math.max(0, position) * LINE_HEIGHT;
  }, []);

  const step = useCallback(
    (delta: number) => {
      useDiffStore.getState().stepDifference(delta);
      const target = useDiffStore.getState().activeChunkAxis();
      if (target !== null) scrollToAxis(Math.max(0, target - 2));
    },
    [scrollToAxis],
  );
  // Read by the window key handler, which binds once.
  const stepRef = useRef(step);
  stepRef.current = step;

  // Remounting the bar is how a second Cmd+F refocuses the input while the
  // bar is already up; its state all lives in the store, so nothing is lost.
  const [findNonce, setFindNonce] = useState(0);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "f") {
        useDiffStore.getState().openFind();
        setFindNonce((nonce) => nonce + 1);
        event.preventDefault();
        return;
      }
      if (event.key === "Escape" && useDiffStore.getState().findOpen) {
        useDiffStore.getState().closeFind();
        return;
      }
      // IntelliJ's diff bindings. Not while typing: the find input owns its
      // own keys, and stealing arrows from it would break editing. Only
      // editable elements qualify — buttons also carry a `value` property,
      // and a focused toolbar button must not swallow F7.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        target &&
        (tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable)
      )
        return;
      if (event.key === "F7") {
        stepRef.current(event.shiftKey ? -1 : 1);
        event.preventDefault();
      }
      if (
        event.altKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        void bridge.request("stepDiffFile", {
          delta: event.key === "ArrowDown" ? 1 : -1,
        });
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const leftLines = splitLines(store.left);
  const rightLines = splitLines(store.right);
  const visibleLines = Math.ceil(viewportHeight / LINE_HEIGHT);

  const activeMatch = store.matches[store.activeMatch] ?? null;

  // An added or deleted file collapses to one pane — see `chooseLayout` —
  // and the unified toggle has nothing to unify there.
  const layout = chooseLayout(store.left, store.right);
  const unified = store.viewMode === "unified" && layout.mode === "split";

  // The unified row list: the same chunks and folds, rendered one column.
  const rows = useMemo(
    () => (unified ? unifiedRows(store.chunks, store.folds) : []),
    [unified, store.chunks, store.folds],
  );

  // What one unit of scrollTop means: a shared-axis line in split view, a
  // display row in unified. Everything below — the spacer, the stripe, the
  // jump targets — speaks in these units.
  const axisUnits = unified ? rows.length : store.axis;

  // Every (side, line) resolved to its row — both sides of an equal row,
  // folded lines to their fold row — in one pass, so the stripe below looks
  // rows up in constant time instead of scanning the list per match.
  const unifiedRowIndex = useMemo(() => {
    const index = new Map<string, number>();
    for (const [position, row] of rows.entries()) {
      if (row.kind === "fold") {
        for (let i = 0; i < row.fold.left.count; i++) {
          index.set(`left:${row.fold.left.start + i}`, position);
        }
        for (let i = 0; i < row.fold.right.count; i++) {
          index.set(`right:${row.fold.right.start + i}`, position);
        }
        continue;
      }
      if (row.leftNumber !== null) {
        index.set(`left:${row.leftNumber - 1}`, position);
      }
      if (row.rightNumber !== null) {
        index.set(`right:${row.rightNumber - 1}`, position);
      }
    }
    return index;
  }, [rows]);

  // Where the hits sit on the stripe. Deduplicated onto a coarse grid: the
  // stripe is a few hundred pixels tall, and a common query in a big file can
  // hit thousands of lines — distinct marks past one per half-percent are
  // just DOM.
  const { matches, chunks, folds } = store;
  const matchPositions = useMemo(() => {
    if (matches.length === 0) return [];
    // Positions memoised per (side, line), the same way computeMatches does:
    // sideToAxis walks the chunk list, and a busy query can hit thousands of
    // matches on far fewer distinct lines.
    const positionOf = new Map<string, number>();
    const seen = new Set<number>();
    const positions: number[] = [];
    for (const match of matches) {
      const key = `${match.side}:${match.line}`;
      let position = positionOf.get(key);
      if (position === undefined) {
        position = unified
          ? (unifiedRowIndex.get(key) ?? -1)
          : sideToAxis(chunks, match.line, match.side, folds);
        positionOf.set(key, position);
      }
      if (position < 0) continue;
      const cell = Math.round((position / Math.max(1, axisUnits)) * 400);
      if (seen.has(cell)) continue;
      seen.add(cell);
      positions.push(position);
    }
    return positions;
  }, [matches, chunks, folds, axisUnits, unified, unifiedRowIndex]);

  const stripeMarks = useMemo(
    () =>
      unified
        ? unifiedStripeMarks(rows)
        : splitStripeMarks(store.chunks, store.folds),
    [unified, rows, store.chunks, store.folds],
  );

  // With synchronised scrolling off the panes decouple: the left holds still
  // and only the right follows the axis, which is the state the connectors
  // have to survive with a chunk visible on one side and not the other.
  const leftOffset = store.syncScroll
    ? axisToSide(store.chunks, axisPosition, "left", store.folds)
    : axisToSide(store.chunks, 0, "left", store.folds);
  const rightOffset = axisToSide(
    store.chunks,
    axisPosition,
    "right",
    store.folds,
  );

  // The shell stays mounted through loading and failure. Returning early left
  // the viewport unmounted, so the ResizeObserver had nothing to observe and
  // `viewportHeight` stayed 0 — which silently clipped both panes to nothing
  // once the content finally arrived.
  const status = store.error
    ? `Could not load this diff: ${store.error}`
    : store.loading
      ? "Loading…"
      : null;

  return (
    <div className="diff-root">
      <DiffToolbar
        onStep={step}
        onEditSource={() => void bridge.request("openFile", { filePath })}
        onFile={(delta) => void bridge.request("stepDiffFile", { delta })}
      />
      {store.findOpen && <FindBar key={findNonce} onJump={scrollToAxis} />}
      <RevisionHeader />
      <div className="diff-body">
        {/* Focusable so the keyboard can drive it: a focused scroll
            container gets arrow, page and Home/End scrolling natively, which
            is the whole pane-navigation story the audit found missing. */}
        <div
          className="diff-viewport"
          ref={viewportRef}
          onScroll={onScroll}
          tabIndex={0}
          role="region"
          aria-label={`Diff of ${filePath}`}
        >
          <div className="diff-layers">
            <div
              className={`diff-columns diff-columns-${unified ? "unified" : layout.mode}`}
              style={{ height: viewportHeight }}
            >
              {unified ? (
                <UnifiedPane
                  rows={rows}
                  leftLines={leftLines}
                  rightLines={rightLines}
                  chunks={store.chunks}
                  language={store.language}
                  granularity={store.granularity}
                  offset={axisPosition}
                  visibleLines={visibleLines}
                  onToggleFold={(fold) =>
                    useDiffStore.getState().toggleFold(fold.left.start)
                  }
                  matches={store.matches}
                  activeMatch={activeMatch}
                />
              ) : layout.mode === "single" ? (
                <>
                  <DiffGutter
                    chunks={store.chunks}
                    axisPosition={axisPosition}
                    visibleLines={visibleLines}
                    leftOffset={leftOffset}
                    rightOffset={rightOffset}
                    leftLineCount={leftLines.length}
                    rightLineCount={rightLines.length}
                    folds={store.folds}
                    only={layout.side}
                  />
                  <DiffPane
                    side={layout.side}
                    lines={layout.side === "left" ? leftLines : rightLines}
                    counterpart={[]}
                    chunks={store.chunks}
                    language={store.language}
                    granularity={store.granularity}
                    offset={layout.side === "left" ? leftOffset : rightOffset}
                    visibleLines={visibleLines}
                    folds={store.folds}
                    onToggleFold={(fold) =>
                      useDiffStore.getState().toggleFold(fold.left.start)
                    }
                    matches={store.matches}
                    activeMatch={activeMatch}
                  />
                </>
              ) : (
                <>
                  <DiffPane
                    side="left"
                    lines={leftLines}
                    counterpart={rightLines}
                    chunks={store.chunks}
                    language={store.language}
                    granularity={store.granularity}
                    offset={leftOffset}
                    visibleLines={visibleLines}
                    folds={store.folds}
                    onToggleFold={(fold) =>
                      useDiffStore.getState().toggleFold(fold.left.start)
                    }
                    matches={store.matches}
                    activeMatch={activeMatch}
                  />
                  <DiffGutter
                    chunks={store.chunks}
                    axisPosition={axisPosition}
                    visibleLines={visibleLines}
                    leftOffset={leftOffset}
                    rightOffset={rightOffset}
                    leftLineCount={leftLines.length}
                    rightLineCount={rightLines.length}
                    folds={store.folds}
                  />
                  <DiffPane
                    side="right"
                    lines={rightLines}
                    counterpart={leftLines}
                    chunks={store.chunks}
                    language={store.language}
                    granularity={store.granularity}
                    offset={rightOffset}
                    visibleLines={visibleLines}
                    folds={store.folds}
                    onToggleFold={(fold) =>
                      useDiffStore.getState().toggleFold(fold.left.start)
                    }
                    matches={store.matches}
                    activeMatch={activeMatch}
                  />
                </>
              )}
            </div>
          </div>
          <div
            className="diff-axis"
            style={{ height: (axisUnits + visibleLines) * LINE_HEIGHT }}
          />
        </div>
        {status && <div className="diff-message">{status}</div>}
        {/* An overlay rather than a replacement, for the same reason as the
            message above: unmounting the viewport would detach its
            ResizeObserver, and "Show anyway" would swap the panes back in
            clipped to a height measured as zero. */}
        {store.fallback && !store.loading && (
          <DiffFallback
            fallback={store.fallback}
            onOpenInEditor={() => void bridge.request("openFile", { filePath })}
            onShowAnyway={() => setForce(true)}
          />
        )}
        <ChangeStripe
          total={axisUnits || 1}
          marks={stripeMarks}
          axisPosition={axisPosition}
          visibleLines={visibleLines}
          matchPositions={matchPositions}
          onJump={scrollToAxis}
        />
      </div>
    </div>
  );
}

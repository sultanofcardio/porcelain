import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { bridge } from "../shared/bridge";
import { useDiffStore } from "../shared/store/diff-store";
import { ChangeStripe } from "./components/ChangeStripe";
import { DiffGutter } from "./components/DiffGutter";
import { DiffPane } from "./components/DiffPane";
import { DiffToolbar } from "./components/DiffToolbar";
import { LINE_HEIGHT } from "./components/metrics";
import { RevisionHeader } from "./components/RevisionHeader";
import { axisToSide, chooseLayout } from "./utils/diff-model";
import "./diff.css";

interface DiffSides {
  left: string;
  right: string;
  filePath: string;
  leftRef: string;
  rightRef: string;
  language: string;
}

/** Split keeping no trailing empty line, so line counts match the model's. */
function toLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function DiffApp() {
  const store = useDiffStore();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [axisPosition, setAxisPosition] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const root = document.getElementById("root");
  const filePath = root?.dataset.diffPath ?? "";
  const leftRef = root?.dataset.leftRef ?? "";
  const rightRef = root?.dataset.rightRef ?? "";

  useEffect(() => {
    let cancelled = false;
    bridge
      .request("getDiffSides", { filePath, leftRef, rightRef })
      .then((data) => {
        // Reached through getState() rather than the hook: the store is a
        // singleton whose actions never change identity, and depending on the
        // hook's object would re-run this fetch on every render.
        if (!cancelled) useDiffStore.getState().setSides(data as DiffSides);
      })
      .catch((error: Error) => {
        if (!cancelled) useDiffStore.getState().setError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, leftRef, rightRef]);

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

  const leftLines = toLines(store.left);
  const rightLines = toLines(store.right);
  const visibleLines = Math.ceil(viewportHeight / LINE_HEIGHT);

  // With synchronised scrolling off the panes decouple: the left holds still
  // and only the right follows the axis, which is the state the connectors
  // have to survive with a chunk visible on one side and not the other.
  const leftOffset = store.syncScroll
    ? axisToSide(store.chunks, axisPosition, "left")
    : axisToSide(store.chunks, 0, "left");
  const rightOffset = axisToSide(store.chunks, axisPosition, "right");

  // An added or deleted file collapses to one pane — see `chooseLayout`.
  const layout = chooseLayout(store.left, store.right);

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
      <RevisionHeader />
      <div className="diff-body">
        <div className="diff-viewport" ref={viewportRef} onScroll={onScroll}>
          <div className="diff-layers">
            <div
              className={`diff-columns diff-columns-${layout.mode}`}
              style={{ height: viewportHeight }}
            >
              {layout.mode === "single" ? (
                <>
                  <DiffGutter
                    chunks={store.chunks}
                    axisPosition={axisPosition}
                    visibleLines={visibleLines}
                    leftOffset={leftOffset}
                    rightOffset={rightOffset}
                    leftLineCount={leftLines.length}
                    rightLineCount={rightLines.length}
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
                  />
                  <DiffGutter
                    chunks={store.chunks}
                    axisPosition={axisPosition}
                    visibleLines={visibleLines}
                    leftOffset={leftOffset}
                    rightOffset={rightOffset}
                    leftLineCount={leftLines.length}
                    rightLineCount={rightLines.length}
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
                  />
                </>
              )}
            </div>
          </div>
          <div
            className="diff-axis"
            style={{ height: (store.axis + visibleLines) * LINE_HEIGHT }}
          />
        </div>
        {status && <div className="diff-message">{status}</div>}
        <ChangeStripe
          chunks={store.chunks}
          axisPosition={axisPosition}
          visibleLines={visibleLines}
          onJump={scrollToAxis}
        />
      </div>
    </div>
  );
}

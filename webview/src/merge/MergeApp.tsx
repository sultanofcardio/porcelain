import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ChangeStripe } from "../diff/components/ChangeStripe";
import { DiffGutter } from "../diff/components/DiffGutter";
import { DiffPane } from "../diff/components/DiffPane";
import { FindBarView } from "../diff/components/FindBar";
import { gutterMetrics, LINE_HEIGHT } from "../diff/components/metrics";
import { type DisplayMapping, EditablePane } from "../diff/editor/EditablePane";
import { displayLine, displayToSource } from "../diff/utils/diff-model";
import { bridge } from "../shared/bridge";
import type { FileVersionsResult } from "../shared/bridge/types";
import {
  PANE_SIDE,
  paneFolds,
  useMergeStore,
} from "../shared/store/merge-store";
import { MergeGutterVerbs } from "./components/MergeGutterVerbs";
import { MergeToolbar } from "./components/MergeToolbar";
import {
  axisToOffsets,
  type MergePane,
  mergeStripeMarks,
  paneToAxis,
  regionChunkIndices,
} from "./utils/merge-model";
import "../diff/diff.css";

/**
 * The rebuilt 3-way merge editor: three diff panes on one shared axis.
 * Ours | result | theirs — the IDEA convention — with the two live pair
 * diffs drawn as connector polygons through the gutters, and the merge verbs
 * riding them. The centre pane owns the only editable buffer.
 */
export function MergeApp() {
  const store = useMergeStore();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [axisPosition, setAxisPosition] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [applying, setApplying] = useState(false);

  const root = document.getElementById("root");
  const filePath = root?.dataset.file ?? "";

  useEffect(() => {
    let cancelled = false;
    if (!filePath) {
      useMergeStore.getState().setError("Missing merge file path.");
      return;
    }
    bridge
      .request("getFileVersions", { filePath })
      .then((data) => {
        if (!cancelled)
          useMergeStore.getState().load(data as FileVersionsResult);
      })
      .catch((error: Error) => {
        if (!cancelled) useMergeStore.getState().setError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

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
    if (store.loading) return;
    measure();
  }, [measure, store.loading]);

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
      useMergeStore.getState().stepConflict(delta);
      const target = useMergeStore.getState().activeRegionAxis();
      if (target !== null) scrollToAxis(Math.max(0, target - 2));
    },
    [scrollToAxis],
  );
  const stepRef = useRef(step);
  stepRef.current = step;

  const [findNonce, setFindNonce] = useState(0);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "f") {
        useMergeStore.getState().openFind();
        setFindNonce((nonce) => nonce + 1);
        event.preventDefault();
        return;
      }
      if (event.key === "Escape" && useMergeStore.getState().findOpen) {
        useMergeStore.getState().closeFind();
        return;
      }
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
        (event.metaKey || event.ctrlKey) &&
        (event.key === "z" || event.key === "Z")
      ) {
        if (event.shiftKey) useMergeStore.getState().redo();
        else useMergeStore.getState().undo();
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleApply = useCallback(async () => {
    const state = useMergeStore.getState();
    if (!state.allResolved || applying) return;
    setApplying(true);
    try {
      await bridge.request("saveMergedContent", {
        filePath,
        content: state.mergedText(),
      });
      await bridge.request("stageFile", { filePath });
      await bridge.request("openFile", { filePath });
      await bridge.request("closeMergeEditor", { filePath });
    } catch (error) {
      setApplying(false);
      useMergeStore
        .getState()
        .setError(
          `Apply failed: ${error instanceof Error ? error.message : error}`,
        );
    }
  }, [filePath, applying]);

  const handleCancel = useCallback(async () => {
    const { dirty } = useMergeStore.getState();
    if (dirty) {
      const res = (await bridge.request("confirmCancelMerge", {
        filePath,
        hasChanges: true,
      })) as { confirmed: boolean };
      if (!res.confirmed) return;
    }
    await bridge.request("closeMergeEditor", { filePath });
  }, [filePath]);

  /** Whole-file resolution for content the editor cannot merge inline. */
  const acceptWholeFile = useCallback(
    async (side: "ours" | "theirs") => {
      try {
        await bridge.request(side === "ours" ? "acceptOurs" : "acceptTheirs", {
          filePath,
        });
        await bridge.request("closeMergeEditor", { filePath });
      } catch (error) {
        useMergeStore
          .getState()
          .setError(
            `Accept ${side} failed: ${error instanceof Error ? error.message : error}`,
          );
      }
    },
    [filePath],
  );

  const offsets = axisToOffsets(store.axis, axisPosition);
  const visibleLines = Math.ceil(viewportHeight / LINE_HEIGHT);

  const oursLines = store.ours.lines;
  const resultLines = store.result.lines;
  const theirsLines = store.theirs.lines;

  const leftMetrics = gutterMetrics(
    Math.max(oursLines.length, resultLines.length),
  );
  const rightMetrics = gutterMetrics(
    Math.max(resultLines.length, theirsLines.length),
  );

  const conflictChunksO = regionChunkIndices(
    store.chunksOurs,
    store.regions,
    "left",
    "ours",
  );
  const conflictChunksT = regionChunkIndices(
    store.chunksTheirs,
    store.regions,
    "right",
    "theirs",
  );
  const conflictFill = "var(--diff-conflict-connector)";

  const stripeMarks = mergeStripeMarks(store.axis, store.regions, store.folds);

  // Find hits on the stripe, all three panes, deduplicated onto the same
  // coarse grid the diff viewer uses.
  const matchPositions = (() => {
    const seen = new Set<number>();
    const positions: number[] = [];
    const total = Math.max(1, store.axis.length);
    for (const pane of ["ours", "result", "theirs"] as const) {
      for (const match of store.findPanes[pane].matches) {
        const row = displayLine(
          paneFolds(store.folds, pane),
          match.line,
          PANE_SIDE[pane],
        );
        const position = paneToAxis(store.axis, pane, row);
        const cell = Math.round((position / total) * 400);
        if (seen.has(cell)) continue;
        seen.add(cell);
        positions.push(position);
      }
    }
    return positions;
  })();

  const activePane = store.activeFindPane;
  const activeFind = activePane ? store.findPanes[activePane] : null;
  const activeMatch = activeFind?.matches[activeFind.activeMatch] ?? null;

  // The result pane's editor mapping: source result lines ↔ display rows
  // under pair O's folds (the coordinate the result pane renders in).
  const resultMapping: DisplayMapping = {
    toDisplayRow: (line) => displayLine(store.folds.pairO, line, "right"),
    toSourceLine: (row) => {
      const source = displayToSource(store.folds.pairO, row, "right");
      return source.kind === "line"
        ? Math.min(source.line, Math.max(0, resultLines.length - 1))
        : null;
    },
  };

  const findBar = (pane: MergePane, autoFocus = false) => (
    <FindBarView
      key={`${pane}${findNonce}`}
      label={`Find in ${pane}`}
      state={store.findPanes[pane]}
      autoFocus={autoFocus}
      onQuery={(query) => useMergeStore.getState().setFindQuery(pane, query)}
      onToggleCase={() => useMergeStore.getState().toggleFindCase(pane)}
      onToggleWord={() => useMergeStore.getState().toggleFindWord(pane)}
      onToggleRegex={() => useMergeStore.getState().toggleFindRegex(pane)}
      onStep={(delta) => useMergeStore.getState().stepMatch(pane, delta)}
      onClose={() => useMergeStore.getState().closeFind()}
      onActiveMatch={() => {
        useMergeStore.getState().revealActiveMatch(pane);
        const axis = useMergeStore.getState().activeMatchAxis(pane);
        if (axis !== null) scrollToAxis(Math.max(0, axis - 2));
      }}
    />
  );

  const status = store.error
    ? `Could not load this merge: ${store.error}`
    : store.loading
      ? "Loading…"
      : null;

  const gridColumns = `1fr ${leftMetrics.width}px 1.08fr ${rightMetrics.width}px 1fr`;

  return (
    <div className="diff-root">
      <MergeToolbar
        onStep={step}
        onApply={() => void handleApply()}
        onCancel={() => void handleCancel()}
        applying={applying}
      />
      {store.findOpen && (
        <div
          className="diff-find-row"
          style={{ gridTemplateColumns: gridColumns }}
        >
          {findBar("ours")}
          <div className="diff-find-gap" />
          {findBar("result", true)}
          <div className="diff-find-gap" />
          {findBar("theirs")}
        </div>
      )}
      <div
        className="diff-revisions"
        style={{ gridTemplateColumns: gridColumns }}
      >
        <div>
          <span className="diff-lock" title="Read-only">
            🔒
          </span>
          <span className="diff-hash">{store.oursLabel}</span>
          <span className="diff-path">{filePath}</span>
          <span className="diff-tag">Yours</span>
        </div>
        <div />
        <div>
          <span className="diff-editable" title="Editable" aria-hidden="true">
            ✎
          </span>
          <span className="diff-hash">Result</span>
          <span className="diff-path">{filePath}</span>
          {store.dirty && <span className="diff-tag">Edited</span>}
        </div>
        <div />
        <div>
          <span className="diff-lock" title="Read-only">
            🔒
          </span>
          <span className="diff-hash">{store.theirsLabel}</span>
          <span className="diff-path">{filePath}</span>
          <span className="diff-tag">Theirs</span>
        </div>
      </div>
      <div className="diff-body">
        <div
          className="diff-viewport"
          ref={viewportRef}
          onScroll={onScroll}
          tabIndex={0}
          role="region"
          aria-label={`Merge of ${filePath}`}
        >
          <div className="diff-layers">
            <div
              className="diff-columns diff-columns-merge"
              style={{ height: viewportHeight }}
            >
              <DiffPane
                side="left"
                lines={oursLines}
                counterpart={resultLines}
                chunks={store.chunksOurs}
                language={store.language}
                granularity="word"
                offset={offsets.ours}
                visibleLines={visibleLines}
                folds={store.folds.pairO}
                onToggleFold={(fold) =>
                  useMergeStore.getState().toggleFold(fold.right.start)
                }
                matches={store.findPanes.ours.matches}
                activeMatch={activePane === "ours" ? activeMatch : null}
                overrideKinds={store.oursKinds}
              />
              <div className="merge-gutter">
                <DiffGutter
                  chunks={store.chunksOurs}
                  axisPosition={axisPosition}
                  visibleLines={visibleLines}
                  leftOffset={offsets.ours}
                  rightOffset={offsets.result}
                  leftLineCount={oursLines.length}
                  rightLineCount={resultLines.length}
                  folds={store.folds.pairO}
                  connectorFill={(index) =>
                    conflictChunksO.has(index) ? conflictFill : undefined
                  }
                />
                <MergeGutterVerbs
                  flank="ours"
                  folds={store.folds}
                  flankOffset={offsets.ours}
                  resultOffset={offsets.result}
                  visibleLines={visibleLines}
                />
              </div>
              <EditablePane
                lines={resultLines}
                cursor={store.cursor}
                composition={store.composition}
                offset={offsets.result}
                visibleLines={visibleLines}
                mapping={resultMapping}
                label={`Merge result editor for ${filePath}. A full text editor: type anywhere; edits inside a conflict resolve it.`}
                onSetCursor={(selection, goal) =>
                  useMergeStore.getState().setCursor(selection, goal)
                }
                onEdit={(selection, text, key) =>
                  useMergeStore.getState().editAt(selection, text, key)
                }
                onCompositionBegin={() =>
                  useMergeStore.getState().beginComposition()
                }
                onCompositionUpdate={(text) =>
                  useMergeStore.getState().updateComposition(text)
                }
                onCompositionEnd={(text) =>
                  useMergeStore.getState().endComposition(text)
                }
                onUndo={() => useMergeStore.getState().undo()}
                onRedo={() => useMergeStore.getState().redo()}
                onRevealRow={(row) =>
                  scrollToAxis(paneToAxis(store.axis, "result", row))
                }
              >
                <DiffPane
                  side="right"
                  lines={resultLines}
                  counterpart={oursLines}
                  chunks={store.chunksOurs}
                  language={store.language}
                  granularity="word"
                  offset={offsets.result}
                  visibleLines={visibleLines}
                  folds={store.folds.pairO}
                  onToggleFold={(fold) =>
                    useMergeStore.getState().toggleFold(fold.right.start)
                  }
                  matches={store.findPanes.result.matches}
                  activeMatch={activePane === "result" ? activeMatch : null}
                  overrideKinds={store.resultKinds}
                />
              </EditablePane>
              <div className="merge-gutter">
                <DiffGutter
                  chunks={store.chunksTheirs}
                  axisPosition={axisPosition}
                  visibleLines={visibleLines}
                  leftOffset={offsets.result}
                  rightOffset={offsets.theirs}
                  leftLineCount={resultLines.length}
                  rightLineCount={theirsLines.length}
                  folds={store.folds.pairT}
                  connectorFill={(index) =>
                    conflictChunksT.has(index) ? conflictFill : undefined
                  }
                />
                <MergeGutterVerbs
                  flank="theirs"
                  folds={store.folds}
                  flankOffset={offsets.theirs}
                  resultOffset={offsets.result}
                  visibleLines={visibleLines}
                />
              </div>
              <DiffPane
                side="right"
                lines={theirsLines}
                counterpart={resultLines}
                chunks={store.chunksTheirs}
                language={store.language}
                granularity="word"
                offset={offsets.theirs}
                visibleLines={visibleLines}
                folds={store.folds.pairT}
                onToggleFold={(fold) =>
                  useMergeStore.getState().toggleFold(fold.left.start)
                }
                matches={store.findPanes.theirs.matches}
                activeMatch={activePane === "theirs" ? activeMatch : null}
                overrideKinds={store.theirsKinds}
              />
            </div>
          </div>
          <div
            className="diff-axis"
            style={{
              height: (store.axis.length + visibleLines) * LINE_HEIGHT,
            }}
          />
        </div>
        {status && <div className="diff-message">{status}</div>}
        {store.fallback && !store.loading && (
          <div className="diff-fallback">
            <div className="diff-fallback-title">
              {store.fallback.kind === "binary"
                ? "Binary conflict — no inline merge to show"
                : store.fallback.kind === "tooLarge"
                  ? `Large conflict — ${store.fallback.lines.toLocaleString()} lines`
                  : "Could not read this conflict"}
            </div>
            <div className="diff-fallback-detail">
              {store.fallback.kind === "unreadable"
                ? store.fallback.reason
                : "Resolve it whole-file: keep your version, or take theirs."}
            </div>
            <div className="diff-fallback-actions">
              <button
                type="button"
                className="diff-fallback-btn diff-fallback-btn-primary"
                onClick={() => void acceptWholeFile("ours")}
              >
                Accept yours
              </button>
              <button
                type="button"
                className="diff-fallback-btn diff-fallback-btn-primary"
                onClick={() => void acceptWholeFile("theirs")}
              >
                Accept theirs
              </button>
              <button
                type="button"
                className="diff-fallback-btn"
                onClick={() => void bridge.request("openFile", { filePath })}
              >
                Open in editor
              </button>
            </div>
          </div>
        )}
        <ChangeStripe
          total={store.axis.length || 1}
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

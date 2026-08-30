import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { bridge } from "../shared/bridge";
import {
  type CommandType,
  type DiffSidesResult,
  WORKING_TREE_REF,
} from "../shared/bridge/types";
import { editableSide, useDiffStore } from "../shared/store/diff-store";
import { ChangeStripe, splitStripeMarks } from "./components/ChangeStripe";
import { DiffFallback } from "./components/DiffFallback";
import { DiffGutter } from "./components/DiffGutter";
import { DiffPane } from "./components/DiffPane";
import { DiffToolbar } from "./components/DiffToolbar";
import { FindBar } from "./components/FindBar";
import { gutterMetrics, LINE_HEIGHT } from "./components/metrics";
import { RevisionHeader } from "./components/RevisionHeader";
import { UnifiedPane } from "./components/UnifiedPane";
import { type DisplayMapping, EditablePane } from "./editor/EditablePane";
import {
  axisToSide,
  chooseLayout,
  type DiffChunk,
  displayLine,
  displayToSource,
  type Side,
  sideToAxis,
  splitLines,
  stallLift,
} from "./utils/diff-model";
import { unifiedRows, unifiedStripeMarks } from "./utils/unified";
import "./diff.css";

export function DiffApp() {
  const store = useDiffStore();
  const viewportRef = useRef<HTMLDivElement>(null);
  const leftScrollerRef = useRef<HTMLDivElement>(null);
  const [axisPosition, setAxisPosition] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  // "Show anyway" on an oversized diff. Per-diff by construction: opening
  // another diff replaces the webview's html, which remounts the app.
  const [force, setForce] = useState(false);
  // Bumped to re-request the sides: the disk-banner's Reload, and quiet
  // refreshes when the file changes under a clean editable diff.
  const [reloadNonce, setReloadNonce] = useState(0);

  const root = document.getElementById("root");
  const filePath = root?.dataset.diffPath ?? "";
  // A rename diffs two different paths; each side reads its own. Sides
  // without an explicit path (every non-rename) fall back to the file's.
  const leftPath = root?.dataset.leftPath ?? filePath;
  const rightPath = root?.dataset.rightPath ?? filePath;
  const leftRef = root?.dataset.leftRef ?? "";
  const rightRef = root?.dataset.rightRef ?? "";
  const repoId = root?.dataset.repoId ?? "";

  useEffect(() => {
    // Not an input to the request — a re-fetch trigger (disk reloads).
    void reloadNonce;
    let cancelled = false;
    bridge
      .request("getDiffSides", {
        filePath,
        leftPath,
        rightPath,
        leftRef,
        rightRef,
        force,
      })
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
  }, [filePath, leftPath, rightPath, leftRef, rightRef, force, reloadNonce]);

  // The working tree can change under an open diff — a formatter, a checkout,
  // the native editor. gitStateChanged is a firehose, though, so nothing acts
  // on the event alone: re-read quietly and compare against the saved
  // baseline first. Untouched disk → nothing happens, view state intact.
  // Actually changed: a clean view refreshes; unsaved edits (or a live
  // composition) get the banner and the user's choice — never a silent merge.
  useEffect(() => {
    return bridge.onEvent((event, data) => {
      if (event !== "gitStateChanged") return;
      const payload = data as { repoId?: string } | null;
      if (repoId && payload?.repoId && payload.repoId !== repoId) return;
      // The probe speaks in the request's orientation, which never swaps:
      // the working-tree side comes from the dataset refs, not from the
      // store, whose left/right flip under Swap Sides. And it reuses the
      // force flag the view was loaded with, so a "Show anyway" diff is not
      // reverted to the placeholder by an unrelated git event.
      const diskSide =
        rightRef === WORKING_TREE_REF
          ? "right"
          : leftRef === WORKING_TREE_REF
            ? "left"
            : null;
      if (!diskSide) return;
      const state = useDiffStore.getState();
      if (state.loading) return;
      void bridge
        .request("getDiffSides", {
          filePath,
          leftPath,
          rightPath,
          leftRef,
          rightRef,
          force,
        })
        .then((raw) => {
          const sides = raw as DiffSidesResult;
          const current = useDiffStore.getState();
          if (current.filePath !== filePath) return;
          const diskText =
            sides.kind === "text"
              ? diskSide === "left"
                ? sides.left
                : sides.right
              : null;
          if (diskText !== null && diskText === current.savedText) return;
          if (current.dirty || current.composition)
            current.setDiskChanged(true);
          else current.setSides(sides);
        })
        .catch(() => {
          // A failed probe is not evidence of a change; stay quiet.
        });
    });
  }, [filePath, leftPath, rightPath, leftRef, rightRef, repoId, force]);

  const save = useCallback(async () => {
    const state = useDiffStore.getState();
    const side = editableSide(state);
    if (!side || !state.dirty) return;
    const content = side === "left" ? state.left : state.right;
    try {
      await bridge.request("writeFileContent", { filePath, content });
      useDiffStore.getState().markSaved(content);
    } catch (error) {
      useDiffStore
        .getState()
        .setError(
          `Save failed: ${error instanceof Error ? error.message : error}`,
        );
    }
  }, [filePath]);
  const saveRef = useRef(save);
  saveRef.current = save;

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

  // The left pane's own position while synchronised scrolling is off. Seeded
  // from wherever the pane already was when sync was switched off, so
  // decoupling never makes the view jump.
  const [independentLeft, setIndependentLeft] = useState(0);
  const leftAtDecouple = useRef(0);
  useEffect(() => {
    if (store.syncScroll) return;
    setIndependentLeft(leftAtDecouple.current);
  }, [store.syncScroll]);

  // A working-tree diff can stage, unstage and revert individual changes. The
  // checkbox reflects what git has staged rather than a separate notion of
  // inclusion, so it never drifts from the index it claims to describe.
  const workingTree = store.rightRef === WORKING_TREE_REF;
  /**
   * What is *not* in the index yet, addressed by right-pane row.
   *
   * Read from the working-tree-vs-index diff rather than the staged one: its
   * new side is the working tree, so its line numbers are the right pane's
   * line numbers, and they stay that way as parts of the file are staged. The
   * staged diff's new side is the index, which drifts away from the pane the
   * moment a change is only half taken.
   */
  const [pending, setPending] = useState<{
    lines: Set<number>;
    deletions: Set<number>;
  }>({ lines: new Set(), deletions: new Set() });
  const refreshStaged = useCallback(async () => {
    if (!workingTree || !filePath) return;
    try {
      const hunks = (await bridge.request("getFileHunks", {
        filePath,
        staged: false,
      })) as Array<{ newStart: number; lines: string[] }> | null;
      const lines = new Set<number>();
      const deletions = new Set<number>();
      for (const hunk of hunks ?? []) {
        // Hunk line numbers are 1-based; the panes address rows from 0.
        let row = hunk.newStart - 1;
        for (const line of hunk.lines) {
          if (line.startsWith("\\")) continue;
          if (line.startsWith("-")) {
            // A removal occupies no row on the new side, so it is recorded at
            // the row it sits in front of.
            deletions.add(row);
            continue;
          }
          if (line.startsWith("+")) lines.add(row);
          row++;
        }
      }
      setPending({ lines, deletions });
    } catch {
      setPending({ lines: new Set(), deletions: new Set() });
    }
  }, [filePath, workingTree]);

  useEffect(() => {
    void refreshStaged();
  }, [refreshStaged]);

  const changeControls = useMemo(() => {
    if (!workingTree || !filePath) return undefined;
    const call = async (
      command: CommandType,
      params: Record<string, unknown>,
    ) => {
      try {
        await bridge.request(command, params);
      } catch (error) {
        useDiffStore
          .getState()
          .setError(
            `${command} failed: ${error instanceof Error ? error.message : error}`,
          );
      }
      await refreshStaged();
    };
    const lineIncluded = (rightLine: number) => !pending.lines.has(rightLine);
    return {
      isLineIncluded: lineIncluded,
      // A change counts as included only once none of it is still pending —
      // half of a block taken leaves its box clear, matching what a commit
      // would actually carry.
      isChunkIncluded: (chunk: DiffChunk) => {
        if (pending.deletions.has(chunk.right.start)) return false;
        for (let i = 0; i < chunk.right.count; i++) {
          if (!lineIncluded(chunk.right.start + i)) return false;
        }
        return true;
      },
      // The change's own checkbox takes or returns the whole hunk…
      onToggleChunk: (rightLine: number, included: boolean) => {
        void call("stageHunkAtLine", {
          filePath,
          newLine: rightLine + 1,
          unstage: included,
        });
      },
      // …while the hovered line's checkbox takes just that line, so part of
      // a block can be left behind.
      onToggleLine: (rightLine: number) => {
        void call("setLineStaged", {
          filePath,
          newLine: rightLine + 1,
          staged: !lineIncluded(rightLine),
        });
      },
      onRevert: (rightLine: number) => {
        void call("revertHunkAtLine", { filePath, newLine: rightLine + 1 });
      },
    };
  }, [filePath, refreshStaged, pending, workingTree]);

  const scrollLeftPane = useCallback((deltaLines: number, maxLine: number) => {
    setIndependentLeft((current) =>
      // Stops one line short of the end, the same limit the shared scroller
      // reaches, so decoupled panes do not scroll past their content.
      Math.max(0, Math.min(current + deltaLines, Math.max(0, maxLine))),
    );
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
      // Save works from anywhere — muscle memory does not check focus. This
      // runs before the editable-target guard below so it fires while typing
      // in the EditablePane textarea, which does not claim Cmd+S; composition
      // text is live-applied to the store, so the save sees what's on screen.
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        void saveRef.current();
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
        (event.metaKey || event.ctrlKey) &&
        (event.key === "z" || event.key === "Z")
      ) {
        if (event.shiftKey) useDiffStore.getState().redo();
        else useDiffStore.getState().undo();
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

  // Both bars' hits highlight; the box goes to the current match of the bar
  // that last acted.
  const { findLeft, findRight, activeFindSide } = store;
  const matches = useMemo(
    () => [...findLeft.matches, ...findRight.matches],
    [findLeft.matches, findRight.matches],
  );
  const activeFind =
    activeFindSide === null
      ? null
      : activeFindSide === "left"
        ? findLeft
        : findRight;
  const activeMatch = activeFind?.matches[activeFind.activeMatch] ?? null;

  // An added or deleted file collapses to one pane — see `chooseLayout` —
  // and the unified toggle has nothing to unify there.
  const layout = chooseLayout(store.left, store.right);
  const unified = store.viewMode === "unified" && layout.mode === "split";

  // With sync off the left pane scrolls on its own. React registers `wheel`
  // as a passive root listener, so a synthetic onWheel's preventDefault is a
  // no-op and the wheel would still scroll `.diff-viewport` (moving the right
  // pane too). A native non-passive listener is the only way preventDefault
  // holds the axis still.
  useEffect(() => {
    const node = leftScrollerRef.current;
    if (!node || store.syncScroll || unified || layout.mode === "single") {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      scrollLeftPane(event.deltaY / LINE_HEIGHT, leftLines.length - 1);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [store.syncScroll, unified, layout.mode, scrollLeftPane, leftLines.length]);

  // Editing, where a side owns a buffer (the working tree, per the merge
  // scope review's decision 2) — through the same editor core the merge
  // result pane uses: click anywhere, type anywhere. Unified view stays
  // read-only: the editor lives in a pane's own coordinate space, which
  // unified rows do not have.
  const editable = editableSide(store);
  const editorMapping = (side: Side): DisplayMapping => ({
    toDisplayRow: (line) => displayLine(store.folds, line, side),
    toSourceLine: (row) => {
      const source = displayToSource(store.folds, row, side);
      return source.kind === "line" ? source.line : null;
    },
  });
  const wrapEditable = (side: Side, pane: React.ReactNode) => {
    if (editable !== side || unified || store.fallback) return pane;
    const offset = side === "left" ? leftOffset : rightOffset;
    return (
      <EditablePane
        lines={side === "left" ? leftLines : rightLines}
        cursor={store.cursor}
        composition={store.composition}
        offset={offset}
        visibleLines={visibleLines}
        mapping={editorMapping(side)}
        label={`Working-tree editor for ${filePath}. A full text editor: type anywhere; Cmd+S saves.`}
        onSetCursor={(selection, goal) =>
          useDiffStore.getState().setCursor(selection, goal)
        }
        onEdit={(selection, text, key) =>
          useDiffStore.getState().editAt(selection, text, key)
        }
        onCompositionBegin={() => useDiffStore.getState().beginComposition()}
        onCompositionUpdate={(text) =>
          useDiffStore.getState().updateComposition(text)
        }
        onCompositionEnd={(text) =>
          useDiffStore.getState().endComposition(text)
        }
        onUndo={() => useDiffStore.getState().undo()}
        onRedo={() => useDiffStore.getState().redo()}
        onRevealRow={(row) => {
          const source = displayToSource(store.folds, Math.floor(row), side);
          if (source.kind !== "line") return;
          scrollToAxis(
            sideToAxis(store.chunks, source.line, side, store.folds),
          );
        }}
      >
        {pane}
      </EditablePane>
    );
  };

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
  const { chunks, folds } = store;
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

  // With synchronised scrolling on, both panes are positioned from the shared
  // axis, and a side standing still through an insertion is lifted so its
  // anchor sits mid-pane rather than at the very top. With it off the panes
  // decouple: the right keeps following the axis (it owns the scrollbar) and
  // the left scrolls on its own, which is the state the connectors have to
  // survive with a chunk visible on one side and not the other.
  const syncedLeft =
    axisToSide(store.chunks, axisPosition, "left", store.folds) -
    stallLift(store.chunks, axisPosition, "left", visibleLines, store.folds);
  // Remember where the synced left pane sits, so switching sync off hands the
  // independent scroller the position already on screen.
  if (store.syncScroll) leftAtDecouple.current = Math.max(0, syncedLeft);
  const leftOffset = store.syncScroll
    ? Math.max(0, syncedLeft)
    : independentLeft;
  const rightOffset =
    axisToSide(store.chunks, axisPosition, "right", store.folds) -
    stallLift(store.chunks, axisPosition, "right", visibleLines, store.folds);

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
      {store.findOpen &&
        (layout.mode === "single" ? (
          // One pane, one bar — the absent side has nothing to search.
          <div className="diff-find-row diff-find-row-single">
            <FindBar
              key={findNonce}
              side={layout.side}
              onJump={scrollToAxis}
              autoFocus
            />
          </div>
        ) : (
          // One bar per pane, the IntelliJ shape. In split view the row's
          // middle column mirrors the gutter, so each bar sits exactly over
          // the pane it searches; unified has no gutter to mirror.
          <div
            className="diff-find-row"
            style={
              unified
                ? { gridTemplateColumns: "1fr 1fr" }
                : {
                    gridTemplateColumns: `1fr ${gutterMetrics(Math.max(leftLines.length, rightLines.length)).width}px 1fr`,
                  }
            }
          >
            <FindBar key={`l${findNonce}`} side="left" onJump={scrollToAxis} />
            {!unified && <div className="diff-find-gap" />}
            <FindBar
              key={`r${findNonce}`}
              side="right"
              onJump={scrollToAxis}
              autoFocus
            />
          </div>
        ))}
      {store.diskChanged && (
        <div className="diff-disk-banner" role="alert">
          <span>
            This file changed on disk while you were editing. Reload discards
            your unsaved edits; keep leaves the view as it is.
          </span>
          <button
            type="button"
            onClick={() => setReloadNonce((nonce) => nonce + 1)}
          >
            Reload from disk
          </button>
          <button
            type="button"
            onClick={() => useDiffStore.getState().setDiskChanged(false)}
          >
            Keep my edits
          </button>
        </div>
      )}
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
                  matches={matches}
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
                  {wrapEditable(
                    layout.side,
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
                      matches={matches}
                      activeMatch={activeMatch}
                    />,
                  )}
                </>
              ) : (
                <>
                  {/* Decoupled, the left pane owns its own wheel: the shared
                      scrollbar drives the axis, which the right follows. The
                      wheel handler is attached natively (see the effect above)
                      because React's synthetic wheel listener is passive, so
                      preventDefault there is a no-op and the axis would move
                      too. */}
                  <div
                    ref={leftScrollerRef}
                    className="diff-left-scroller"
                    style={{ display: "contents" }}
                  >
                    {wrapEditable(
                      "left",
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
                        matches={matches}
                        activeMatch={activeMatch}
                      />,
                    )}
                  </div>
                  <DiffGutter
                    chunks={store.chunks}
                    axisPosition={axisPosition}
                    visibleLines={visibleLines}
                    leftOffset={leftOffset}
                    rightOffset={rightOffset}
                    leftLineCount={leftLines.length}
                    rightLineCount={rightLines.length}
                    folds={store.folds}
                    changeControls={changeControls}
                  />
                  {wrapEditable(
                    "right",
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
                      matches={matches}
                      activeMatch={activeMatch}
                    />,
                  )}
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

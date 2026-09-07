import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeChunks, computeFolds } from "../utils/diff-model";
import { DiffPane } from "./DiffPane";
import { LINE_HEIGHT, PANE_TEXT_PADDING } from "./metrics";

const left = ["alpha", "beta", "gamma", "delta", "epsilon"];
const right = ["alpha", "BETA", "gamma", "delta", "epsilon"];
const chunks = computeChunks(`${left.join("\n")}\n`, `${right.join("\n")}\n`);

// jsdom cannot measure the editor font, so the pane keeps its default cell.
const CELL = 7.2;

function renderPane(overrides: Partial<Parameters<typeof DiffPane>[0]> = {}) {
  return render(
    <DiffPane
      side="left"
      lines={left}
      counterpart={right}
      chunks={chunks}
      language="typescript"
      granularity="word"
      offset={0}
      visibleLines={10}
      label="HEAD side, read-only"
      {...overrides}
    />,
  );
}

describe("DiffPane read-only caret", () => {
  afterEach(cleanup);

  it("draws nothing and takes no focus without a caret to place", () => {
    const { container } = renderPane();
    expect(container.querySelector(".diff-readonly-caret")).toBeNull();
    expect(
      container.querySelector(".diff-pane")?.getAttribute("tabindex"),
    ).toBeNull();
  });

  it("draws the caret at its line and column, and names the pane", () => {
    const { container } = renderPane({
      caret: { line: 2, col: 3 },
      onPlaceCaret: () => {},
    });
    const caret = container.querySelector<HTMLElement>(".diff-readonly-caret");
    expect(caret?.style.top).toBe(`${2 * LINE_HEIGHT}px`);
    expect(caret?.style.left).toBe(`${PANE_TEXT_PADDING + 3 * CELL}px`);
    const pane = container.querySelector(".diff-pane");
    expect(pane?.getAttribute("tabindex")).toBe("0");
    // A bare div takes no accessible name, so the label needs the role.
    expect(screen.getByRole("region", { name: "HEAD side, read-only" })).toBe(
      pane,
    );
  });

  it("sits on the fold row when its line is hidden, shifted by the folds above", () => {
    const many = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    const changed = many.map((l, i) => (i === 30 ? "changed" : l));
    const wide = computeChunks(
      `${many.join("\n")}\n`,
      `${changed.join("\n")}\n`,
    );
    const folds = computeFolds(wide);
    const { container } = renderPane({
      lines: many,
      counterpart: changed,
      chunks: wide,
      folds,
      caret: { line: 28, col: 0 },
      onPlaceCaret: () => {},
    });
    // Lines 0..26 collapse to one row; line 28 renders at row 2.
    const caret = container.querySelector<HTMLElement>(".diff-readonly-caret");
    expect(caret?.style.top).toBe(`${2 * LINE_HEIGHT}px`);
  });

  it("places the caret where the pane was clicked", () => {
    const onPlaceCaret = vi.fn();
    const { container } = renderPane({
      caret: { line: 0, col: 0 },
      onPlaceCaret,
    });
    const pane = container.querySelector(".diff-pane") as HTMLElement;
    // jsdom lays nothing out; give the pane a height so a press inside it
    // is not taken for one in the scrollbar band along its bottom edge.
    Object.defineProperty(pane, "clientHeight", { value: 200 });
    fireEvent.mouseDown(pane, {
      clientX: PANE_TEXT_PADDING + 2 * CELL + 1,
      clientY: 2 * LINE_HEIGHT + 4,
    });
    expect(onPlaceCaret).toHaveBeenCalledWith({ line: 2, col: 2 });
  });

  it("leaves a click on a fold row to the fold", () => {
    const onPlaceCaret = vi.fn();
    const many = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    const changed = many.map((l, i) => (i === 30 ? "changed" : l));
    const wide = computeChunks(
      `${many.join("\n")}\n`,
      `${changed.join("\n")}\n`,
    );
    const { container } = renderPane({
      lines: many,
      counterpart: changed,
      chunks: wide,
      folds: computeFolds(wide),
      caret: { line: 28, col: 0 },
      onPlaceCaret,
    });
    const fold = container.querySelector(".diff-fold-row") as HTMLElement;
    fireEvent.mouseDown(fold, { clientX: 20, clientY: 4 });
    expect(onPlaceCaret).not.toHaveBeenCalled();
  });

  it("walks the caret with the arrow keys and keeps them from the viewport", () => {
    const onPlaceCaret = vi.fn();
    const outer = vi.fn();
    const { container } = render(
      <div onKeyDown={outer}>
        <DiffPane
          side="left"
          lines={left}
          counterpart={right}
          chunks={chunks}
          language="typescript"
          granularity="word"
          offset={0}
          visibleLines={10}
          caret={{ line: 2, col: 2 }}
          onPlaceCaret={onPlaceCaret}
        />
      </div>,
    );
    const pane = container.querySelector(".diff-pane") as HTMLElement;
    fireEvent.keyDown(pane, { key: "ArrowDown" });
    expect(onPlaceCaret).toHaveBeenLastCalledWith({ line: 3, col: 2 });
    fireEvent.keyDown(pane, { key: "ArrowRight" });
    expect(onPlaceCaret).toHaveBeenLastCalledWith({ line: 2, col: 3 });
    fireEvent.keyDown(pane, { key: "End" });
    expect(onPlaceCaret).toHaveBeenLastCalledWith({ line: 2, col: 5 });
    fireEvent.keyDown(pane, { key: "ArrowUp", metaKey: true });
    expect(onPlaceCaret).toHaveBeenLastCalledWith({ line: 0, col: 0 });
    expect(outer).not.toHaveBeenCalled();
  });

  it("steps the caret over a collapsed run in both directions", () => {
    // Two changes with a long equal run between them: the middle fold hides
    // lines 14 to 46, with visible lines on both sides of it.
    const many = Array.from({ length: 60 }, (_, i) => `line ${i}`);
    const changed = many.map((l, i) => (i === 10 || i === 50 ? "changed" : l));
    const wide = computeChunks(
      `${many.join("\n")}\n`,
      `${changed.join("\n")}\n`,
    );
    const folds = computeFolds(wide);
    const onPlaceCaret = vi.fn();
    const { container, rerender } = render(
      <DiffPane
        side="left"
        lines={many}
        counterpart={changed}
        chunks={wide}
        language="typescript"
        granularity="word"
        offset={0}
        visibleLines={10}
        folds={folds}
        caret={{ line: 13, col: 2 }}
        onPlaceCaret={onPlaceCaret}
      />,
    );
    const pane = container.querySelector(".diff-pane") as HTMLElement;
    // Down off the last line before the run: the first line past it, rather
    // than the hidden line 14, which the store would open the run for.
    fireEvent.keyDown(pane, { key: "ArrowDown" });
    expect(onPlaceCaret).toHaveBeenLastCalledWith({ line: 47, col: 2 });

    rerender(
      <DiffPane
        side="left"
        lines={many}
        counterpart={changed}
        chunks={wide}
        language="typescript"
        granularity="word"
        offset={0}
        visibleLines={10}
        folds={folds}
        caret={{ line: 47, col: 2 }}
        onPlaceCaret={onPlaceCaret}
      />,
    );
    fireEvent.keyDown(pane, { key: "ArrowUp" });
    expect(onPlaceCaret).toHaveBeenLastCalledWith({ line: 13, col: 2 });
  });

  it("lets Alt+ArrowUp/Down through to the file-stepping binding above", () => {
    const onPlaceCaret = vi.fn();
    const outer = vi.fn();
    const { container } = render(
      <div onKeyDown={outer}>
        <DiffPane
          side="left"
          lines={left}
          counterpart={right}
          chunks={chunks}
          language="typescript"
          granularity="word"
          offset={0}
          visibleLines={10}
          caret={{ line: 2, col: 2 }}
          onPlaceCaret={onPlaceCaret}
        />
      </div>,
    );
    const pane = container.querySelector(".diff-pane") as HTMLElement;
    fireEvent.keyDown(pane, { key: "ArrowDown", altKey: true });
    fireEvent.keyDown(pane, { key: "ArrowUp", altKey: true });
    expect(onPlaceCaret).not.toHaveBeenCalled();
    expect(outer).toHaveBeenCalledTimes(2);
    expect(outer.mock.calls.every(([event]) => !event.defaultPrevented)).toBe(
      true,
    );
  });

  it("scrolls sideways to a caret past the right edge of the pane", () => {
    const onRevealX = vi.fn();
    const wide = ["short", "x".repeat(400)];
    const same = computeChunks(`${wide.join("\n")}\n`, `${wide.join("\n")}\n`);
    const pane = (caret: { line: number; col: number }) => (
      <DiffPane
        side="left"
        lines={wide}
        counterpart={wide}
        chunks={same}
        language="typescript"
        granularity="word"
        offset={0}
        visibleLines={10}
        caret={caret}
        onPlaceCaret={() => {}}
        onRevealX={onRevealX}
      />
    );
    const { rerender } = render(pane({ line: 1, col: 0 }));
    // The caret it opened with is where the surface put it; nothing to chase.
    expect(onRevealX).not.toHaveBeenCalled();
    // End on a line wider than the pane, as the store reports it back.
    rerender(pane({ line: 1, col: 400 }));
    const x = PANE_TEXT_PADDING + 400 * CELL;
    expect(onRevealX).toHaveBeenLastCalledWith(x, x + 2);
  });

  it("leaves the view alone when it remounts around a caret already there", () => {
    // The split and unified views are alternatives of one ternary, so
    // switching between them unmounts and remounts the panes; the reader's
    // scroll position has to survive that.
    const onRevealRow = vi.fn();
    const many = Array.from({ length: 60 }, (_, i) => `line ${i}`);
    const same = computeChunks(`${many.join("\n")}\n`, `${many.join("\n")}\n`);
    const pane = (caret: { line: number; col: number }) => (
      <DiffPane
        side="left"
        lines={many}
        counterpart={many}
        chunks={same}
        language="typescript"
        granularity="word"
        offset={40}
        visibleLines={10}
        caret={caret}
        onPlaceCaret={() => {}}
        onRevealRow={onRevealRow}
      />
    );
    // Mounted with the caret far above the scrolled viewport.
    const { unmount } = render(pane({ line: 2, col: 0 }));
    expect(onRevealRow).not.toHaveBeenCalled();
    unmount();
    const { rerender } = render(pane({ line: 2, col: 0 }));
    expect(onRevealRow).not.toHaveBeenCalled();

    // A caret that actually moves is still followed.
    rerender(pane({ line: 3, col: 0 }));
    expect(onRevealRow).toHaveBeenCalledWith(0);
  });

  it("leaves the view alone for a caret on the row drawn at the top", () => {
    const onRevealRow = vi.fn();
    const many = Array.from({ length: 60 }, (_, i) => `line ${i}`);
    const same = computeChunks(`${many.join("\n")}\n`, `${many.join("\n")}\n`);
    const pane = (line: number) => (
      <DiffPane
        side="left"
        lines={many}
        counterpart={many}
        chunks={same}
        language="typescript"
        granularity="word"
        offset={40}
        visibleLines={10}
        caret={{ line, col: 0 }}
        onPlaceCaret={() => {}}
        onRevealRow={onRevealRow}
      />
    );
    const { rerender } = render(pane(41));
    // Clicking the topmost row on screen is not a reason to scroll.
    rerender(pane(40));
    expect(onRevealRow).not.toHaveBeenCalled();
    // One row above it is off screen, and is followed.
    rerender(pane(39));
    expect(onRevealRow).toHaveBeenCalledWith(34);
  });

  it("scrolls to a caret that moved out of view, once the viewport has a height", () => {
    const onRevealRow = vi.fn();
    const many = Array.from({ length: 60 }, (_, i) => `line ${i}`);
    const same = computeChunks(`${many.join("\n")}\n`, `${many.join("\n")}\n`);
    const { rerender } = render(
      <DiffPane
        side="left"
        lines={many}
        counterpart={many}
        chunks={same}
        language="typescript"
        granularity="word"
        offset={0}
        visibleLines={0}
        caret={{ line: 50, col: 0 }}
        onPlaceCaret={() => {}}
        onRevealRow={onRevealRow}
      />,
    );
    // Unmeasured: nothing to reveal against.
    expect(onRevealRow).not.toHaveBeenCalled();
    rerender(
      <DiffPane
        side="left"
        lines={many}
        counterpart={many}
        chunks={same}
        language="typescript"
        granularity="word"
        offset={0}
        visibleLines={10}
        caret={{ line: 51, col: 0 }}
        onPlaceCaret={() => {}}
        onRevealRow={onRevealRow}
      />,
    );
    expect(onRevealRow).toHaveBeenCalledWith(46);
  });
});

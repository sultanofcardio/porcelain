import { cleanup, fireEvent, render } from "@testing-library/react";
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
    expect(pane?.getAttribute("aria-label")).toBe("HEAD side, read-only");
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

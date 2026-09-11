import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeChunks, computeFolds } from "../utils/diff-model";
import { DiffPane } from "./DiffPane";
import { LINE_HEIGHT, PANE_TEXT_PADDING } from "./metrics";

const left = ["alpha", "beta", "gamma delta", "epsilon", "zeta"];
const right = ["alpha", "BETA", "gamma delta", "epsilon", "zeta"];
const chunks = computeChunks(`${left.join("\n")}\n`, `${right.join("\n")}\n`);

// jsdom cannot measure the editor font, so the pane keeps its default cell.
const CELL = 7.2;

function renderPane(overrides: Partial<Parameters<typeof DiffPane>[0]> = {}) {
  const rendered = render(
    <DiffPane
      side="left"
      lines={left}
      counterpart={right}
      chunks={chunks}
      language="typescript"
      granularity="word"
      offset={0}
      visibleLines={10}
      {...overrides}
    />,
  );
  const pane = rendered.container.querySelector(".diff-pane") as HTMLElement;
  // jsdom lays nothing out; give the pane a height so a pointer inside it
  // is not taken for one in the scrollbar band along its bottom edge.
  Object.defineProperty(pane, "clientHeight", { value: 200 });
  return { ...rendered, pane };
}

/** A pointer over column `col` of line `line`, in the pane's own frame. */
const over = (line: number, col: number) => ({
  clientX: PANE_TEXT_PADDING + (col + 0.5) * CELL,
  clientY: line * LINE_HEIGHT + 4,
});

describe("DiffPane pointer text", () => {
  afterEach(cleanup);

  it("reports the word under the pointer with its box, and null on leaving", () => {
    const onPointerText = vi.fn();
    const { pane } = renderPane({ onPointerText });
    fireEvent.mouseMove(pane, over(2, 7));
    expect(onPointerText).toHaveBeenLastCalledWith({
      side: "left",
      line: 2,
      col: 7,
      word: { start: 6, end: 11 },
      anchor: {
        left: PANE_TEXT_PADDING + 6 * CELL,
        right: PANE_TEXT_PADDING + 11 * CELL,
        top: 2 * LINE_HEIGHT,
        bottom: 3 * LINE_HEIGHT,
      },
      modifier: false,
    });
    fireEvent.mouseLeave(pane);
    expect(onPointerText).toHaveBeenLastCalledWith(null);
  });

  it("reports null past the end of a line and over a fold row", () => {
    const onPointerText = vi.fn();
    const many = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    const changed = many.map((l, i) => (i === 30 ? "changed" : l));
    const wide = computeChunks(
      `${many.join("\n")}\n`,
      `${changed.join("\n")}\n`,
    );
    const { pane, container } = renderPane({
      lines: many,
      counterpart: changed,
      chunks: wide,
      folds: computeFolds(wide),
      onPointerText,
    });
    fireEvent.mouseMove(pane, over(1, 40));
    expect(onPointerText).toHaveBeenLastCalledWith(null);
    const fold = container.querySelector(".diff-fold-row") as HTMLElement;
    fireEvent.mouseMove(fold, { clientX: 30, clientY: 4 });
    expect(onPointerText).toHaveBeenLastCalledWith(null);
  });

  it("does not listen without a hover to drive", () => {
    const { pane } = renderPane();
    // No handler, no throw: the pane is inert to pointer motion.
    fireEvent.mouseMove(pane, over(0, 1));
    expect(pane.getAttribute("data-side")).toBe("left");
  });
});

describe("DiffPane definition link", () => {
  afterEach(cleanup);

  it("underlines the link's span on its line, on its side only", () => {
    const { container, rerender } = renderPane({
      linkRange: { side: "left", line: 2, start: 6, end: 11 },
    });
    const link = container.querySelector(".diff-link");
    expect(link?.textContent).toBe("delta");
    expect(container.querySelector(".diff-pane-linking")).not.toBeNull();
    rerender(
      <DiffPane
        side="left"
        lines={left}
        counterpart={right}
        chunks={chunks}
        language="typescript"
        granularity="word"
        offset={0}
        visibleLines={10}
        linkRange={{ side: "right", line: 2, start: 6, end: 11 }}
      />,
    );
    expect(container.querySelector(".diff-link")).toBeNull();
    expect(container.querySelector(".diff-pane-linking")).toBeNull();
  });

  it("follows a modifier-click to the word, and still places the caret", () => {
    const onActivateLink = vi.fn();
    const onPlaceCaret = vi.fn();
    const { pane } = renderPane({
      onActivateLink,
      onPlaceCaret,
      caret: { line: 0, col: 0 },
    });
    fireEvent.mouseDown(pane, { ...over(2, 1), metaKey: true, ctrlKey: true });
    expect(onActivateLink).toHaveBeenCalledTimes(1);
    expect(onActivateLink.mock.calls[0][0]).toMatchObject({
      side: "left",
      line: 2,
      word: { start: 0, end: 5 },
      modifier: true,
    });
    // The pointer sat mid-cell, which the caret rounds up from.
    expect(onPlaceCaret).toHaveBeenCalledWith({ line: 2, col: 2 });
    // A plain click follows nothing.
    fireEvent.mouseDown(pane, over(2, 1));
    expect(onActivateLink).toHaveBeenCalledTimes(1);
  });

  it("takes modifier-clicks on a pane with no caret of its own", () => {
    const onActivateLink = vi.fn();
    const { pane } = renderPane({ onActivateLink });
    fireEvent.mouseDown(pane, { ...over(2, 8), metaKey: true, ctrlKey: true });
    expect(onActivateLink.mock.calls[0][0]).toMatchObject({
      word: { start: 6, end: 11 },
    });
  });
});

describe("DiffPane fold scope", () => {
  afterEach(cleanup);

  it("badges each fold row with the scope its hidden run starts in", () => {
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
      foldScope: (fold) => (fold.left.start === 0 ? "handle()" : null),
    });
    expect(container.querySelector(".diff-fold-scope")?.textContent).toBe(
      "handle()",
    );
    expect(
      screen.getByRole("button", {
        name: "Show 4 of 27 unchanged lines above in handle()",
      }),
    ).toBeTruthy();
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeChunks, computeFolds, splitLines } from "../utils/diff-model";
import { unifiedRows } from "../utils/unified";
import { gutterMetrics, PANE_TEXT_PADDING } from "./metrics";
import { UnifiedPane } from "./UnifiedPane";

const lines = (...values: string[]) => `${values.join("\n")}\n`;

function renderUnified(
  left: string,
  right: string,
  overrides: Partial<Parameters<typeof UnifiedPane>[0]> = {},
) {
  const chunks = computeChunks(left, right);
  return render(
    <UnifiedPane
      rows={unifiedRows(chunks)}
      leftLines={splitLines(left)}
      rightLines={splitLines(right)}
      chunks={chunks}
      language="plaintext"
      granularity="word"
      offset={0}
      visibleLines={20}
      {...overrides}
    />,
  );
}

describe("UnifiedPane", () => {
  afterEach(cleanup);

  it("renders old-then-new with each side's own number column", () => {
    const { container } = renderUnified(
      lines("a", "old", "c"),
      lines("a", "new", "c"),
    );
    const rows = [...container.querySelectorAll(".diff-unified-line")];
    expect(rows).toHaveLength(4);
    const numbers = rows.map((row) =>
      [...row.querySelectorAll(".diff-unified-number")].map(
        (cell) => cell.textContent,
      ),
    );
    // Equal rows carry both numbers; each modified half carries only its own.
    expect(numbers).toEqual([
      ["1", "1"],
      ["2", ""],
      ["", "2"],
      ["3", "3"],
    ]);
  });

  it("keeps the modified background on both halves of an edit", () => {
    const { container } = renderUnified(lines("old"), lines("new"));
    const rows = [...container.querySelectorAll(".diff-unified-line")];
    expect(
      rows.every((row) => row.classList.contains("diff-line-modified")),
    ).toBe(true);
  });

  it("renders a fold row that expands on click", () => {
    const body = Array.from({ length: 40 }, (_, i) => `line${i}`);
    const left = lines("old", ...body);
    const right = lines("new", ...body);
    const chunks = computeChunks(left, right);
    const folds = computeFolds(chunks);
    const onToggleFold = vi.fn();
    render(
      <UnifiedPane
        rows={unifiedRows(chunks, folds)}
        leftLines={splitLines(left)}
        rightLines={splitLines(right)}
        chunks={chunks}
        language="plaintext"
        granularity="word"
        offset={0}
        visibleLines={20}
        onToggleFold={onToggleFold}
      />,
    );
    screen.getByRole("button", { name: /Expand 37 unchanged lines/ }).click();
    expect(onToggleFold).toHaveBeenCalledWith(folds[0]);
  });

  it("shows a left-side match on an equal row, which renders the right text", () => {
    const { container } = renderUnified(
      lines("foo", "old"),
      lines("foo", "new"),
      { matches: [{ side: "left", line: 0, start: 0, end: 3 }] },
    );
    const equalRow = container.querySelector(".diff-unified-line");
    expect(equalRow?.querySelector(".diff-found")?.textContent).toBe("foo");
  });

  it("paints the active highlight when stepping lands on an equal row's left twin", () => {
    const twins = [
      { side: "left" as const, line: 0, start: 0, end: 3 },
      { side: "right" as const, line: 0, start: 0, end: 3 },
    ];
    const { container } = renderUnified(
      lines("foo", "old"),
      lines("foo", "new"),
      { matches: twins, activeMatch: twins[0] },
    );
    const equalRow = container.querySelector(".diff-unified-line");
    expect(equalRow?.querySelector(".diff-found-active")?.textContent).toBe(
      "foo",
    );
    // The identical twin ranges dedupe to one highlight, not two.
    expect(equalRow?.querySelectorAll(".diff-found").length).toBe(0);
  });

  it("announces the row's number and state invisibly, like the split panes", () => {
    const { container } = renderUnified(lines("a", "old"), lines("a", "new"));
    const prefixes = [...container.querySelectorAll(".diff-sr-only")].map(
      (el) => el.textContent,
    );
    expect(prefixes).toEqual([
      "Line 1: ",
      "Line 2, modified, old: ",
      "Line 2, modified, new: ",
    ]);
  });
});

describe("UnifiedPane horizontal scrolling", () => {
  afterEach(cleanup);

  it("offers the text width plus both number columns as its scrollable width", () => {
    const { container } = renderUnified(lines("a"), lines("b"), {
      contentWidth: 500,
    });
    const content = container.querySelector(
      ".diff-pane-content",
    ) as HTMLElement;
    const { numberWidth } = gutterMetrics(1);
    expect(content.style.minWidth).toBe(
      `max(100%, ${numberWidth * 2 + 500}px)`,
    );
  });

  it("parks the second number column after the first so both stay put", () => {
    const { container } = renderUnified(lines("a"), lines("a"));
    const [first, second] = [
      ...container.querySelectorAll<HTMLElement>(".diff-unified-number"),
    ];
    expect(first.style.left).toBe("0px");
    expect(second.style.left).toBe(`${gutterMetrics(1).numberWidth}px`);
  });

  it("reports sideways scrolling through the scroller it exposes", () => {
    const seen: number[] = [];
    const ref = { current: null as HTMLDivElement | null };
    renderUnified(lines("a"), lines("b"), {
      ref,
      onScrollX: (x) => seen.push(x),
    });
    const scroller = ref.current as HTMLDivElement;
    expect(scroller.classList.contains("diff-unified")).toBe(true);
    scroller.scrollLeft = 48;
    fireEvent.scroll(scroller);
    expect(seen).toEqual([48]);
  });
});

describe("UnifiedPane caret", () => {
  afterEach(cleanup);

  // Two long unchanged runs around one edit, so the middle folds by default.
  const many = Array.from({ length: 40 }, (_, i) => `line ${i}`);
  const changed = many.map((value, i) => (i === 30 ? "changed" : value));
  const leftText = lines(...many);
  const rightText = lines(...changed);

  function renderFolded(
    overrides: Partial<Parameters<typeof UnifiedPane>[0]> = {},
  ) {
    const chunks = computeChunks(leftText, rightText);
    const folds = computeFolds(chunks);
    expect(folds.length).toBeGreaterThan(0);
    return render(
      <UnifiedPane
        rows={unifiedRows(chunks, folds)}
        leftLines={splitLines(leftText)}
        rightLines={splitLines(rightText)}
        chunks={chunks}
        language="plaintext"
        granularity="word"
        offset={0}
        visibleLines={40}
        {...overrides}
      />,
    );
  }

  it("draws a caret hidden inside a fold on the fold's own row, and still walks", () => {
    const onPlaceCaret = vi.fn();
    const { container } = renderFolded({
      caret: { side: "right", line: 10, col: 0 },
      onPlaceCaret,
    });
    expect(container.querySelector(".diff-readonly-caret")).not.toBeNull();

    const pane = container.querySelector(".diff-unified") as HTMLElement;
    fireEvent.keyDown(pane, { key: "ArrowDown" });
    expect(onPlaceCaret).toHaveBeenCalledTimes(1);
  });

  it("keeps the goal column across vertical moves over a short line", () => {
    const onPlaceCaret = vi.fn();
    const text = lines("a longer line here", "short", "another long line");
    const chunks = computeChunks(text, text);
    const view = (line: number, col: number) => (
      <UnifiedPane
        rows={unifiedRows(chunks)}
        leftLines={splitLines(text)}
        rightLines={splitLines(text)}
        chunks={chunks}
        language="plaintext"
        granularity="word"
        offset={0}
        visibleLines={20}
        caret={{ side: "right", line, col }}
        onPlaceCaret={onPlaceCaret}
      />
    );
    const { container, rerender } = render(view(0, 14));
    const pane = container.querySelector(".diff-unified") as HTMLElement;
    // Down onto "short" clamps to its end; down again restores the goal.
    fireEvent.keyDown(pane, { key: "ArrowDown" });
    expect(onPlaceCaret).toHaveBeenLastCalledWith("right", {
      line: 1,
      col: 5,
    });
    rerender(view(1, 5));
    fireEvent.keyDown(pane, { key: "ArrowDown" });
    expect(onPlaceCaret).toHaveBeenLastCalledWith("right", {
      line: 2,
      col: 14,
    });
  });

  it("scrolls sideways to a caret past the right edge of the pane", () => {
    const onRevealX = vi.fn();
    const wide = lines("short", "x".repeat(400));
    const chunks = computeChunks(wide, wide);
    const inset = gutterMetrics(2).numberWidth * 2 + PANE_TEXT_PADDING;
    const view = (col: number) => (
      <UnifiedPane
        rows={unifiedRows(chunks)}
        leftLines={splitLines(wide)}
        rightLines={splitLines(wide)}
        chunks={chunks}
        language="plaintext"
        granularity="word"
        offset={0}
        visibleLines={20}
        caret={{ side: "right", line: 1, col }}
        onPlaceCaret={() => {}}
        onRevealX={onRevealX}
      />
    );
    const { rerender } = render(view(0));
    expect(onRevealX).toHaveBeenLastCalledWith(inset, inset + 2);
    // End on a line wider than the pane, as the store reports it back.
    rerender(view(400));
    expect(onRevealX).toHaveBeenLastCalledWith(
      inset + 400 * 7.2,
      inset + 400 * 7.2 + 2,
    );
  });

  it("stops drawing the caret where it slides under the parked numbers", () => {
    const text = lines("alpha", "beta");
    const chunks = computeChunks(text, text);
    const inset = gutterMetrics(2).numberWidth * 2 + PANE_TEXT_PADDING;
    const view = (scrollX: number) => (
      <UnifiedPane
        rows={unifiedRows(chunks)}
        leftLines={splitLines(text)}
        rightLines={splitLines(text)}
        chunks={chunks}
        language="plaintext"
        granularity="word"
        offset={0}
        visibleLines={20}
        scrollX={scrollX}
        caret={{ side: "right", line: 0, col: 0 }}
        onPlaceCaret={() => {}}
      />
    );
    const { container, rerender } = render(view(0));
    expect(container.querySelector(".diff-readonly-caret")).not.toBeNull();
    // Scrolled far enough that the caret's x is behind both number columns.
    rerender(view(inset));
    expect(container.querySelector(".diff-readonly-caret")).toBeNull();
  });

  it("names the pane it puts a caret in, as a region", () => {
    const text = lines("a", "b");
    const chunks = computeChunks(text, text);
    render(
      <UnifiedPane
        rows={unifiedRows(chunks)}
        leftLines={splitLines(text)}
        rightLines={splitLines(text)}
        chunks={chunks}
        language="plaintext"
        granularity="word"
        offset={0}
        visibleLines={20}
        caret={{ side: "right", line: 0, col: 0 }}
        onPlaceCaret={() => {}}
        label="Unified diff of a.ts, read-only."
      />,
    );
    expect(
      screen.getByRole("region", { name: "Unified diff of a.ts, read-only." }),
    ).toBeTruthy();
  });

  it("lets Alt+ArrowUp/Down through to the file-stepping binding above", () => {
    const onPlaceCaret = vi.fn();
    const outer = vi.fn();
    const text = lines("a", "b", "c");
    const chunks = computeChunks(text, text);
    const { container } = render(
      <div onKeyDown={outer}>
        <UnifiedPane
          rows={unifiedRows(chunks)}
          leftLines={splitLines(text)}
          rightLines={splitLines(text)}
          chunks={chunks}
          language="plaintext"
          granularity="word"
          offset={0}
          visibleLines={20}
          caret={{ side: "right", line: 1, col: 0 }}
          onPlaceCaret={onPlaceCaret}
        />
      </div>,
    );
    const pane = container.querySelector(".diff-unified") as HTMLElement;
    fireEvent.keyDown(pane, { key: "ArrowDown", altKey: true });
    fireEvent.keyDown(pane, { key: "ArrowUp", altKey: true });
    expect(onPlaceCaret).not.toHaveBeenCalled();
    expect(outer).toHaveBeenCalledTimes(2);
    expect(outer.mock.calls.every(([event]) => !event.defaultPrevented)).toBe(
      true,
    );
  });
});

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { computeChunks, computeFolds } from "../utils/diff-model";
import { DiffGutter } from "./DiffGutter";

const lines = (...values: string[]) => `${values.join("\n")}\n`;

function renderGutter(
  left: string,
  right: string,
  overrides: Partial<Parameters<typeof DiffGutter>[0]> = {},
) {
  const chunks = computeChunks(left, right);
  return render(
    <DiffGutter
      chunks={chunks}
      axisPosition={0}
      visibleLines={20}
      leftOffset={0}
      rightOffset={0}
      leftLineCount={left.split("\n").length}
      rightLineCount={right.split("\n").length}
      {...overrides}
    />,
  );
}

describe("DiffGutter", () => {
  afterEach(cleanup);

  /** Every y in a path, so a band's thickness can be measured from it. */
  const ysOf = (path: string) =>
    [...path.matchAll(/[ML]\s*[\d.-]+\s+([\d.-]+)/g)].map((m) => Number(m[1]));

  it("never lets the band pinch to nothing where a side has no lines", () => {
    // The regression this pins: an insertion's left edge is degenerate, so the
    // band tapered to zero height exactly where it met the pane's insertion
    // marker — which read as a gap in an otherwise continuous line.
    const { container } = renderGutter(
      lines("a", "b"),
      lines("a", "x", "y", "b"),
    );
    const path = container.querySelector("path")?.getAttribute("d") ?? "";
    expect(path).toBeTruthy();

    const ys = ysOf(path);
    // First and last y are the band's two edges at x=0, where it leaves the
    // gutter and the pane's marker takes over.
    expect(Math.abs(ys[ys.length - 1] - ys[0])).toBeGreaterThanOrEqual(2);
  });

  it("keeps the same floor when the deletion is the empty side", () => {
    const { container } = renderGutter(
      lines("a", "x", "y", "b"),
      lines("a", "b"),
    );
    const ys = ysOf(container.querySelector("path")?.getAttribute("d") ?? "");
    // The pair spanning the far edge, where the right side collapses.
    expect(Math.abs(ys[3] - ys[2])).toBeGreaterThanOrEqual(2);
  });

  it("leaves a chunk with lines on both sides at its natural height", () => {
    // A one-line modification is already a full row tall, so the floor must not
    // inflate it.
    const { container } = renderGutter(lines("a", "old"), lines("a", "new"));
    const ys = ysOf(container.querySelector("path")?.getAttribute("d") ?? "");
    expect(Math.abs(ys[ys.length - 1] - ys[0])).toBe(20);
  });

  it("renders one connector per change and none for unchanged runs", () => {
    const { container } = renderGutter(
      lines("a", "b", "c"),
      lines("a", "B", "c"),
    );
    expect(container.querySelectorAll("path").length).toBe(1);
  });

  describe("working-tree change controls", () => {
    /** A stub standing in for the staged/unstaged state the host reports. */
    const controlsFor = (
      overrides: Partial<Parameters<typeof DiffGutter>[0]> = {},
      included: (line: number) => boolean = () => true,
    ) => {
      const toggledChunks: Array<[DiffChunk, boolean]> = [];
      const toggledLines: number[] = [];
      const reverted: DiffChunk[] = [];
      const view = renderGutter(lines("a", "b"), lines("a", "x", "y", "b"), {
        changeControls: {
          isLineIncluded: included,
          isChunkIncluded: (chunk) => {
            for (let i = 0; i < chunk.right.count; i++) {
              if (!included(chunk.right.start + i)) return false;
            }
            return true;
          },
          onToggleChunk: (chunk, wasIncluded) =>
            toggledChunks.push([chunk, wasIncluded]),
          onToggleLine: (line) => toggledLines.push(line),
          onRevert: (chunk) => reverted.push(chunk),
        },
        ...overrides,
      });
      return { view, toggledChunks, toggledLines, reverted };
    };

    /** Move the pointer to the row the given right-side line occupies. */
    const hover = (container: HTMLElement, row: number) => {
      const gutter = container.querySelector(".diff-gutter") as HTMLElement;
      fireEvent.mouseMove(gutter, { clientY: row * 20 + 1 });
    };

    it("puts one revert arrow and one checkbox on each change", () => {
      const { view, reverted, toggledChunks } = controlsFor();
      const revert = view.getByLabelText("Revert change at line 2");
      const include = view.getByLabelText(
        "Include change at line 2 in the commit",
      ) as HTMLInputElement;
      // The insertion starts at right line 2 (1-based) and there is only one
      // change, so only one cluster.
      expect(
        view.container.querySelectorAll(".diff-change-revert").length,
      ).toBe(1);
      expect(include.checked).toBe(true);

      fireEvent.click(revert);
      fireEvent.click(include);
      // The whole block is handed over, not a line inside it: git merges
      // changes closer than its context width into one hunk, so a line alone
      // would let the host act on a neighbouring block too.
      expect(reverted).toEqual([
        {
          kind: "added",
          left: { start: 1, count: 0 },
          right: { start: 1, count: 2 },
        },
      ]);
      // The callback carries the state it is leaving, so the host is told to
      // unstage rather than stage again.
      expect(toggledChunks).toEqual([[reverted[0], true]]);
    });

    it("clears the change's box while any of it is still left out", () => {
      const { view } = controlsFor({}, (line) => line !== 2);
      const include = view.getByLabelText(
        "Include change at line 2 in the commit",
      ) as HTMLInputElement;
      expect(include.checked).toBe(false);
    });

    it("offers a checkbox on a line inside the block once hovered", () => {
      const { view, toggledLines } = controlsFor();
      // Nothing until the pointer is over the block.
      expect(view.queryByLabelText("Include line 3 in the commit")).toBeNull();

      hover(view.container, 2);
      const line = view.getByLabelText("Include line 3 in the commit");
      fireEvent.click(line);
      expect(toggledLines).toEqual([2]);
    });

    it("does not stack a second checkbox on the change's own first line", () => {
      // Line 2 already carries the block's checkbox; a per-line one on top of
      // it would be two controls for one row saying different things.
      const { view } = controlsFor();
      hover(view.container, 1);
      expect(view.container.querySelector(".diff-line-control")).toBeNull();
      // The block's own checkbox is still the one on that row.
      expect(
        view.getByLabelText("Include change at line 2 in the commit"),
      ).toBeTruthy();
    });

    it("ignores rows outside any change", () => {
      const { view } = controlsFor();
      hover(view.container, 0);
      expect(view.container.querySelector(".diff-line-control")).toBeNull();
    });

    it("still offers the hover checkbox on a change below a collapsed fold", () => {
      // A fold above the change makes its display row lower than its source
      // line. The pointer offset is a display row, so it must be mapped back
      // to the source line before it is tested against the changed lines and
      // before it is stored — otherwise the checkbox silently never appears
      // (or lands on an unrelated line).
      const unchanged = Array.from({ length: 12 }, (_, i) => `u${i + 1}`);
      const left = lines(...unchanged, "old1", "old2");
      const right = lines(...unchanged, "new1", "new2");
      const chunks = computeChunks(left, right);
      const folds = computeFolds(chunks);
      // The long unchanged run really does collapse, shifting the change up.
      expect(folds.length).toBe(1);

      const toggledLines: number[] = [];
      const view = render(
        <DiffGutter
          chunks={chunks}
          axisPosition={0}
          visibleLines={20}
          leftOffset={0}
          rightOffset={0}
          leftLineCount={left.split("\n").length}
          rightLineCount={right.split("\n").length}
          folds={folds}
          changeControls={{
            isLineIncluded: () => true,
            isChunkIncluded: () => true,
            onToggleChunk: () => {},
            onToggleLine: (line) => toggledLines.push(line),
            onRevert: () => {},
          }}
        />,
      );

      // Source line 14 (0-based row 13, the change's second line) renders at
      // display row 5 because the fold hides eight rows above it.
      const gutter = view.container.querySelector(
        ".diff-gutter",
      ) as HTMLElement;
      fireEvent.mouseMove(gutter, { clientY: 5 * 20 + 1 });
      fireEvent.click(view.getByLabelText("Include line 14 in the commit"));
      expect(toggledLines).toEqual([13]);
    });

    it("hands over a deletion's extent on both sides", () => {
      // A deletion has no rows of its own on the right, so its right count is
      // zero and its right start is the row it sits in front of. Both sides
      // travel, because the host needs whichever one the diff it builds the
      // patch from actually has.
      const reverted: DiffChunk[] = [];
      const view = renderGutter(lines("a", "x", "b"), lines("a", "b"), {
        changeControls: {
          isLineIncluded: () => true,
          isChunkIncluded: () => true,
          onToggleChunk: () => {},
          onToggleLine: () => {},
          onRevert: (chunk) => reverted.push(chunk),
        },
      });
      fireEvent.click(view.getByLabelText("Revert change at line 2"));
      expect(reverted).toEqual([
        {
          kind: "removed",
          left: { start: 1, count: 1 },
          right: { start: 1, count: 0 },
        },
      ]);
    });

    it("stays read-only when no controls are supplied", () => {
      const { container } = renderGutter(lines("a", "b"), lines("a", "x", "b"));
      expect(container.querySelector("input")).toBeNull();
      expect(container.querySelector(".diff-change-revert")).toBeNull();
    });
  });

  it("drops connectors entirely when collapsed to a single pane", () => {
    const { container } = renderGutter(lines("a", "b"), lines("a", "x", "b"), {
      only: "right",
    });
    expect(container.querySelectorAll("path").length).toBe(0);
    expect(container.querySelectorAll("svg").length).toBe(0);
  });
});

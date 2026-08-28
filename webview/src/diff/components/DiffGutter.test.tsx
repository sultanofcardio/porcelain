import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { computeChunks } from "../utils/diff-model";
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

  it("drops connectors entirely when collapsed to a single pane", () => {
    const { container } = renderGutter(lines("a", "b"), lines("a", "x", "b"), {
      only: "right",
    });
    expect(container.querySelectorAll("path").length).toBe(0);
    expect(container.querySelectorAll("svg").length).toBe(0);
  });
});

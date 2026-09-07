import { describe, expect, it } from "vitest";
import { LINE_HEIGHT, PANE_TEXT_PADDING } from "../components/metrics";
import { positionAt } from "./positionAt";

const lines = ["alpha", "\tbeta", "gamma"];
const geometry = {
  rect: { top: 100, left: 50 },
  offset: 0,
  scrollX: 0,
  charWidth: 8,
  toSourceLine: (row: number) => (row === 1 ? null : row),
  lines,
};
const at = (row: number, cell: number) => ({
  clientX: 50 + PANE_TEXT_PADDING + cell * 8,
  clientY: 100 + row * LINE_HEIGHT + 3,
});

describe("positionAt", () => {
  it("resolves a pointer to the row under it and the cell within it", () => {
    expect(positionAt(at(0, 2), geometry)).toEqual({ line: 0, col: 2 });
  });

  it("answers null over a fold row", () => {
    expect(positionAt(at(1, 0), geometry)).toBeNull();
  });

  it("scrolls the row window with the offset and the columns with scrollX", () => {
    expect(
      positionAt(at(0, 2), { ...geometry, offset: 2, toSourceLine: (r) => r }),
    ).toEqual({ line: 2, col: 2 });
    expect(positionAt(at(0, 0), { ...geometry, scrollX: 16 })).toEqual({
      line: 0,
      col: 2,
    });
  });

  it("clamps past the last line and before the first cell", () => {
    expect(
      positionAt(at(9, 0), { ...geometry, toSourceLine: (r) => r }),
    ).toEqual({ line: 2, col: 0 });
    expect(positionAt({ clientX: 0, clientY: 100 }, geometry)).toEqual({
      line: 0,
      col: 0,
    });
  });

  it("steps by visual cell, so a tab counts for its whole stop", () => {
    // Cell 3 of "\tbeta" is inside the tab's eight-cell stop.
    expect(
      positionAt(at(2, 3), { ...geometry, toSourceLine: () => 1 }),
    ).toEqual({ line: 1, col: 0 });
    expect(
      positionAt(at(2, 9), { ...geometry, toSourceLine: () => 1 }),
    ).toEqual({ line: 1, col: 2 });
  });

  it("has nowhere to go in an empty document", () => {
    expect(positionAt(at(0, 4), { ...geometry, lines: [] })).toEqual({
      line: 0,
      col: 0,
    });
  });
});

import { describe, expect, it } from "vitest";
import { LINE_HEIGHT, PANE_TEXT_PADDING } from "../components/metrics";
import { needsReveal, positionAt } from "./positionAt";

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

  it("lands a click below the content on the last visible line, not a hidden one", () => {
    // A fold hides the file's tail: rows 0 and 1 show lines 0 and 1, row 2
    // is the fold row standing in for lines 2..9, and nothing follows it.
    // A click in the empty space below must not resolve to line 9 (which
    // would open the whole run) but to the end of the last line on show.
    const tail = Array.from({ length: 10 }, (_, i) => `line${i}`);
    const folded = {
      ...geometry,
      lines: tail,
      toSourceLine: (row: number) =>
        row < 2 ? row : row === 2 ? null : row + 7,
    };
    expect(positionAt(at(5, 3), folded)).toEqual({ line: 1, col: 3 });
    expect(positionAt(at(3, 0), folded)).toEqual({ line: 1, col: 0 });
    // The fold row itself still belongs to its button.
    expect(positionAt(at(2, 0), folded)).toBeNull();
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

  it("counts the columns a row carries in front of its text", () => {
    // A unified row parks two number columns before its text; a click lands
    // in the same cell it would in a split pane, measured from the text.
    const inset = PANE_TEXT_PADDING + 80;
    expect(
      positionAt(
        { clientX: 50 + inset + 3 * 8, clientY: 100 + 3 },
        { ...geometry, textInset: inset },
      ),
    ).toEqual({ line: 0, col: 3 });
    // Anything left of the text is before its first cell.
    expect(
      positionAt(
        { clientX: 50 + 4, clientY: 100 + 3 },
        { ...geometry, textInset: inset },
      ),
    ).toEqual({ line: 0, col: 0 });
  });

  it("has nowhere to go in an empty document", () => {
    expect(positionAt(at(0, 4), { ...geometry, lines: [] })).toEqual({
      line: 0,
      col: 0,
    });
  });
});

describe("needsReveal", () => {
  // Ten rows drawn from row 40, the state scrollToAxis leaves behind.
  it("leaves the rows already drawn alone, top row included", () => {
    expect(needsReveal(40, 40, 10)).toBe(false);
    expect(needsReveal(48, 40, 10)).toBe(false);
  });

  it("asks for a row above the first drawn or past the last full one", () => {
    expect(needsReveal(39, 40, 10)).toBe(true);
    expect(needsReveal(49, 40, 10)).toBe(true);
  });

  it("counts a row the viewport has stopped part way through as drawn", () => {
    // Stopped between rows 40 and 41: row 40 is clipped at the top but the
    // reader can still see it, and scrolling to it would be a jolt.
    expect(needsReveal(40, 40.4, 10)).toBe(false);
    expect(needsReveal(39, 40.4, 10)).toBe(true);
  });
});

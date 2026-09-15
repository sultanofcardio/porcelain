import { describe, expect, it } from "vitest";
import { LINE_HEIGHT, PANE_TEXT_PADDING } from "../components/metrics";
import type { PointerGeometry } from "./positionAt";
import { characterAt, pointerTarget, wordAt, wordAtCaret } from "./text-target";

describe("wordAt", () => {
  const text = "const route_2 = $item.héllo(x);";

  it("finds the identifier holding a column, digits and underscores included", () => {
    expect(wordAt(text, 7)).toEqual({ start: 6, end: 13 });
    expect(wordAt(text, 6)).toEqual({ start: 6, end: 13 });
    expect(wordAt(text, 12)).toEqual({ start: 6, end: 13 });
  });

  it("takes `$` and non-ASCII letters as word characters", () => {
    expect(wordAt(text, 16)).toEqual({ start: 16, end: 21 });
    expect(wordAt(text, 23)).toEqual({ start: 22, end: 27 });
  });

  it("is null on whitespace and punctuation, the dot after a name included", () => {
    expect(wordAt(text, 13)).toBeNull();
    expect(wordAt(text, 14)).toBeNull();
    expect(wordAt(text, 21)).toBeNull();
    expect(wordAt(text, 30)).toBeNull();
    expect(wordAt("", 0)).toBeNull();
    expect(wordAt(text, 31)).toBeNull();
  });
});

describe("wordAtCaret", () => {
  const text = "const route_2 = $item.héllo(x);";

  it("names the word a caret sits in or right after", () => {
    expect(wordAtCaret(text, 8)).toEqual({ start: 6, end: 13 });
    expect(wordAtCaret(text, 13)).toEqual({ start: 6, end: 13 });
    expect(wordAtCaret(text, 5)).toEqual({ start: 0, end: 5 });
    expect(wordAtCaret(text, 31)).toBeNull();
  });

  it("is null between two non-word characters", () => {
    expect(wordAtCaret(text, 15)).toBeNull();
    expect(wordAtCaret("  ", 1)).toBeNull();
    expect(wordAtCaret("", 0)).toBeNull();
  });
});

const CELL = 10;
const lines = ["alpha beta", "\tgamma", "delta x"];
const geometry: PointerGeometry = {
  rect: { top: 100, left: 50 },
  offset: 0,
  scrollX: 0,
  charWidth: CELL,
  toSourceLine: (row) => (row === 1 ? null : row),
  lines,
};
const at = (x: number, y: number) => ({
  clientX: 50 + PANE_TEXT_PADDING + x,
  clientY: 100 + y,
  metaKey: false,
  ctrlKey: false,
});

describe("characterAt", () => {
  it("names the character whose cell is under the pointer, never the nearer edge", () => {
    expect(characterAt(at(0.5 * CELL, 5), geometry)).toEqual({
      line: 0,
      col: 0,
    });
    expect(characterAt(at(0.9 * CELL, 5), geometry)).toEqual({
      line: 0,
      col: 0,
    });
    expect(characterAt(at(6.2 * CELL, 5), geometry)).toEqual({
      line: 0,
      col: 6,
    });
  });

  it("is null past the end of the line, left of the text, and on a fold row", () => {
    expect(characterAt(at(10.5 * CELL, 5), geometry)).toBeNull();
    expect(characterAt(at(-PANE_TEXT_PADDING - 1, 5), geometry)).toBeNull();
    expect(characterAt(at(2 * CELL, LINE_HEIGHT + 5), geometry)).toBeNull();
  });

  it("puts every cell of a tab on the tab, and reads scrolled text through scrollX", () => {
    const rows: PointerGeometry = { ...geometry, toSourceLine: (row) => row };
    expect(characterAt(at(3 * CELL, LINE_HEIGHT + 5), rows)).toEqual({
      line: 1,
      col: 0,
    });
    expect(characterAt(at(8.5 * CELL, LINE_HEIGHT + 5), rows)).toEqual({
      line: 1,
      col: 1,
    });
    const scrolled = { ...rows, scrollX: 4 * CELL };
    expect(characterAt(at(1.5 * CELL, 5), scrolled)).toEqual({
      line: 0,
      col: 5,
    });
  });

  it("is null below the last line", () => {
    const rows: PointerGeometry = { ...geometry, toSourceLine: (row) => row };
    expect(characterAt(at(0, 3 * LINE_HEIGHT + 5), rows)).toBeNull();
  });
});

describe("pointerTarget", () => {
  it("carries the word and the box it is drawn in", () => {
    expect(pointerTarget(at(7.5 * CELL, 5), geometry, "left")).toEqual({
      side: "left",
      line: 0,
      word: { start: 6, end: 10 },
      anchor: {
        left: 50 + PANE_TEXT_PADDING + 6 * CELL,
        right: 50 + PANE_TEXT_PADDING + 10 * CELL,
        top: 100,
        bottom: 100 + LINE_HEIGHT,
      },
      modifier: false,
    });
  });

  it("boxes the character alone outside a word, and follows a scrolled pane", () => {
    const rows: PointerGeometry = {
      ...geometry,
      toSourceLine: (row) => row,
      offset: 2,
      scrollX: 3 * CELL,
    };
    // Row 0 of the viewport shows line 2 ("delta x"); x resolves through the
    // scroll to the space, which is no word, and the box is the space's own.
    const target = pointerTarget(at(2 * CELL, 5), rows, "right");
    expect(target).toMatchObject({ side: "right", line: 2 });
    expect(target?.word).toBeNull();
    expect(target?.anchor).toEqual({
      left: 50 + PANE_TEXT_PADDING + 2 * CELL,
      right: 50 + PANE_TEXT_PADDING + 3 * CELL,
      top: 100,
      bottom: 100 + LINE_HEIGHT,
    });
    expect(pointerTarget(at(0, 5), rows, "right")).toMatchObject({
      line: 2,
      word: { start: 0, end: 5 },
      anchor: { left: 50 + PANE_TEXT_PADDING - 3 * CELL, top: 100 },
    });
  });

  it("is null wherever there is no character", () => {
    expect(
      pointerTarget(at(2 * CELL, LINE_HEIGHT + 5), geometry, "left"),
    ).toBeNull();
    expect(pointerTarget(at(20 * CELL, 5), geometry, "left")).toBeNull();
  });
});

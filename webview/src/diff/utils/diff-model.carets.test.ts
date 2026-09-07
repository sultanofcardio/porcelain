import { describe, expect, it } from "vitest";
import { computeChunks, counterpartLine, firstChangeLine } from "./diff-model";

const text = (...lines: string[]) => `${lines.join("\n")}\n`;

describe("firstChangeLine", () => {
  it("is the first changed chunk's first line on each side", () => {
    const chunks = computeChunks(
      text("a", "b", "c", "d"),
      text("a", "B", "c", "d"),
    );
    expect(firstChangeLine(chunks, "left", 4)).toBe(1);
    expect(firstChangeLine(chunks, "right", 4)).toBe(1);
  });

  it("puts the caret where an insertion lands on the side that lacks it", () => {
    const chunks = computeChunks(text("a", "b"), text("a", "new", "new", "b"));
    expect(firstChangeLine(chunks, "left", 2)).toBe(1);
    expect(firstChangeLine(chunks, "right", 4)).toBe(1);
  });

  it("clamps an insertion at the end of the file into the document", () => {
    const chunks = computeChunks(text("a", "b"), text("a", "b", "tail"));
    expect(firstChangeLine(chunks, "left", 2)).toBe(1);
    expect(firstChangeLine(chunks, "right", 3)).toBe(2);
  });

  it("starts at the top of an unchanged file, and of an empty one", () => {
    expect(
      firstChangeLine(computeChunks(text("a"), text("a")), "left", 1),
    ).toBe(0);
    expect(firstChangeLine([], "right", 0)).toBe(0);
  });
});

describe("counterpartLine", () => {
  const chunks = computeChunks(
    text("a", "b", "c", "old", "e", "f"),
    text("a", "b", "c", "new1", "new2", "e", "f"),
  );

  it("pairs equal lines exactly, above and below a change", () => {
    expect(counterpartLine(chunks, "left", 1)).toEqual({
      line: 1,
      exact: true,
    });
    expect(counterpartLine(chunks, "left", 4)).toEqual({
      line: 5,
      exact: true,
    });
    expect(counterpartLine(chunks, "right", 6)).toEqual({
      line: 5,
      exact: true,
    });
  });

  it("lands a changed line on the twin chunk's first line, inexactly", () => {
    expect(counterpartLine(chunks, "left", 3)).toEqual({
      line: 3,
      exact: false,
    });
    expect(counterpartLine(chunks, "right", 4)).toEqual({
      line: 3,
      exact: false,
    });
  });

  it("maps a line beside a pure insertion to the insertion point", () => {
    const inserted = computeChunks(text("a", "b"), text("a", "x", "b"));
    expect(counterpartLine(inserted, "right", 1)).toEqual({
      line: 1,
      exact: false,
    });
    expect(counterpartLine(inserted, "left", 1)).toEqual({
      line: 2,
      exact: true,
    });
  });

  it("assumes the sides run in step past the last chunk", () => {
    expect(counterpartLine([], "left", 7)).toEqual({ line: 7, exact: true });
  });
});

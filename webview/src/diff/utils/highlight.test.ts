import { describe, expect, it } from "vitest";
import { buildPieces, changedRanges, normalizeLanguage } from "./highlight";

describe("normalizeLanguage", () => {
  it("keeps the grammars Shiki actually loads", () => {
    expect(normalizeLanguage("typescript")).toBe("typescript");
    expect(normalizeLanguage("JSON")).toBe("json");
  });

  it("maps the react dialects onto their base grammar", () => {
    expect(normalizeLanguage("typescriptreact")).toBe("typescript");
    expect(normalizeLanguage("javascriptreact")).toBe("javascript");
  });

  it("falls back to plain text rather than colouring Go as TypeScript", () => {
    // The merge editor's fallback was `typescript`, which renders a Go or
    // Python diff with confidently wrong colours.
    expect(normalizeLanguage("go")).toBe("text");
    expect(normalizeLanguage("python")).toBe("text");
    expect(normalizeLanguage("")).toBe("text");
  });
});

describe("changedRanges", () => {
  it("marks the whole line at line granularity", () => {
    expect(changedRanges("abc", "abd", "line")).toBeNull();
  });

  it("marks nothing when highlighting is off", () => {
    expect(changedRanges("abc", "abd", "none")).toEqual([]);
  });

  it("marks only the differing words", () => {
    const ranges = changedRanges("return true;", "return false;", "word");
    expect(ranges).not.toBeNull();
    const covered = (ranges ?? []).map((r) =>
      "return true;".slice(r.start, r.end),
    );
    expect(covered.join("")).toContain("true");
    expect(covered.join("")).not.toContain("return");
  });

  it("marks the whole line when there is no counterpart to compare against", () => {
    expect(changedRanges("added line", undefined, "word")).toBeNull();
  });
});

describe("buildPieces", () => {
  it("splits at both syntax and change boundaries so each span carries both", () => {
    const pieces = buildPieces(
      "abcd",
      [
        { start: 0, end: 2, color: "#f00" },
        { start: 2, end: 4, color: "#0f0" },
      ],
      [{ start: 1, end: 3 }],
    );
    expect(pieces.map((p) => p.text)).toEqual(["a", "b", "c", "d"]);
    expect(pieces.map((p) => p.color)).toEqual([
      "#f00",
      "#f00",
      "#0f0",
      "#0f0",
    ]);
    expect(pieces.map((p) => p.changed)).toEqual([false, true, true, false]);
  });

  it("treats a null change set as the whole line being changed", () => {
    const pieces = buildPieces("ab", [], null);
    expect(pieces.every((p) => p.changed)).toBe(true);
  });

  it("returns nothing for an empty line", () => {
    expect(buildPieces("", [], null)).toEqual([]);
  });

  it("reassembles the original line exactly", () => {
    const line = "  const x = fn(1, 2);";
    const pieces = buildPieces(
      line,
      [{ start: 0, end: 8 }],
      [{ start: 5, end: 12 }],
    );
    expect(pieces.map((p) => p.text).join("")).toBe(line);
  });
});

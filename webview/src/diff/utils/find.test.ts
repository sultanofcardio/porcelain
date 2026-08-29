import { describe, expect, it } from "vitest";
import { computeChunks } from "./diff-model";
import {
  compileQuery,
  computeMatches,
  type FindOptions,
  matchesOnLine,
} from "./find";

const options = (overrides: Partial<FindOptions> = {}): FindOptions => ({
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  scope: "both",
  ...overrides,
});

const chunksFor = (left: string[], right: string[]) =>
  computeChunks(
    left.length ? `${left.join("\n")}\n` : "",
    right.length ? `${right.join("\n")}\n` : "",
  );

describe("compileQuery", () => {
  it("escapes a literal query so regex metacharacters match themselves", () => {
    const pattern = compileQuery("a.b(", options());
    expect(pattern?.test("a.b(")).toBe(true);
    expect(pattern?.test("axb(")).toBe(false);
  });

  it("treats an invalid regex as no matches rather than an error", () => {
    // The user is mid-typing; "(" is a moment, not a mistake.
    expect(compileQuery("(", options({ regex: true }))).toBeNull();
  });

  it("rejects a pattern that matches the empty string", () => {
    expect(compileQuery("a*", options({ regex: true }))).toBeNull();
  });

  it("applies whole-word to regex queries too", () => {
    const pattern = compileQuery(
      "cat|dog",
      options({ regex: true, wholeWord: true }),
    );
    expect(pattern?.test("a dog here")).toBe(true);
    expect(pattern?.test("category")).toBe(false);
  });
});

describe("computeMatches", () => {
  it("finds every occurrence on a line, not just the first", () => {
    const left = ["user, user"];
    const matches = computeMatches(
      left,
      [],
      chunksFor(left, []),
      "user",
      options(),
    );
    expect(matches).toHaveLength(2);
    expect(matches[1].start).toBe(6);
  });

  it("is case-insensitive by default and sensitive on request", () => {
    const left = ["User"];
    const chunks = chunksFor(left, []);
    expect(computeMatches(left, [], chunks, "user", options())).toHaveLength(1);
    expect(
      computeMatches(
        left,
        [],
        chunks,
        "user",
        options({ caseSensitive: true }),
      ),
    ).toHaveLength(0);
  });

  it("restricts to one side when scoped", () => {
    const left = ["needle"];
    const right = ["needle"];
    const chunks = chunksFor(left, right);
    const matches = computeMatches(
      left,
      right,
      chunks,
      "needle",
      options({ scope: "left" }),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].side).toBe("left");
  });

  it("orders matches by axis position, not by line number", () => {
    // A five-line insertion after the first line pushes the right side down:
    // right line 6 and left line 1 are the same text at the same height, and
    // the hit inside the insertion must land between the two equal lines —
    // which line-number order would not give.
    const left = ["top needle", "needle old"];
    const right = [
      "top needle",
      "ins1 needle",
      "ins2",
      "ins3",
      "ins4",
      "ins5",
      "needle old",
    ];
    const chunks = chunksFor(left, right);
    const matches = computeMatches(left, right, chunks, "needle", options());
    expect(matches.map((m) => [m.side, m.line])).toEqual([
      ["left", 0],
      ["right", 0],
      ["right", 1],
      ["left", 1],
      ["right", 6],
    ]);
  });
});

describe("matchesOnLine", () => {
  it("returns only the ranges for one line of one side", () => {
    const left = ["needle", "no", "needle needle"];
    const matches = computeMatches(
      left,
      [],
      chunksFor(left, []),
      "needle",
      options(),
    );
    expect(matchesOnLine(matches, "left", 2)).toHaveLength(2);
    expect(matchesOnLine(matches, "left", 1)).toHaveLength(0);
    expect(matchesOnLine(matches, "right", 0)).toHaveLength(0);
  });
});

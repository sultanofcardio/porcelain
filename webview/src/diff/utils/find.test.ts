import { describe, expect, it } from "vitest";
import { compileQuery, type FindOptions, sideMatches } from "./find";

const options = (overrides: Partial<FindOptions> = {}): FindOptions => ({
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  ...overrides,
});

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

describe("sideMatches", () => {
  it("finds every occurrence on a line, not just the first", () => {
    const matches = sideMatches(["user, user"], "left", "user", options());
    expect(matches).toHaveLength(2);
    expect(matches[1].start).toBe(6);
  });

  it("is case-insensitive by default and sensitive on request", () => {
    expect(sideMatches(["User"], "left", "user", options())).toHaveLength(1);
    expect(
      sideMatches(["User"], "left", "user", options({ caseSensitive: true })),
    ).toHaveLength(0);
  });

  it("tags every hit with the side it was asked to search", () => {
    const matches = sideMatches(["needle"], "right", "needle", options());
    expect(matches[0].side).toBe("right");
  });

  it("returns hits in document order", () => {
    const matches = sideMatches(
      ["b needle", "needle a needle"],
      "left",
      "needle",
      options(),
    );
    expect(matches.map((m) => [m.line, m.start])).toEqual([
      [0, 2],
      [1, 0],
      [1, 9],
    ]);
  });
});

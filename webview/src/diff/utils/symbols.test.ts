import { describe, expect, it } from "vitest";
import type { DocumentSymbolNode } from "../../shared/bridge/types";
import { enclosingSymbol, scopeLabel } from "./symbols";

const node = (
  name: string,
  kind: number,
  start: number,
  end: number,
  children: DocumentSymbolNode[] = [],
): DocumentSymbolNode => ({
  name,
  kind,
  range: {
    start: { line: start, character: 0 },
    end: { line: end, character: 1 },
  },
  children,
});

describe("enclosingSymbol", () => {
  const outline = [
    node("Router", 4, 0, 40, [
      node("constructor", 8, 2, 5),
      node("handle", 5, 10, 30, [node("inner", 11, 15, 18)]),
    ]),
    node("helper", 11, 45, 50),
  ];

  it("answers with the innermost symbol covering the line", () => {
    expect(enclosingSymbol(outline, 16)?.name).toBe("inner");
    expect(enclosingSymbol(outline, 20)?.name).toBe("handle");
    expect(enclosingSymbol(outline, 7)?.name).toBe("Router");
    expect(enclosingSymbol(outline, 47)?.name).toBe("helper");
  });

  it("takes range edges as inside, and is null between symbols", () => {
    expect(enclosingSymbol(outline, 10)?.name).toBe("handle");
    expect(enclosingSymbol(outline, 30)?.name).toBe("handle");
    expect(enclosingSymbol(outline, 42)).toBeNull();
    expect(enclosingSymbol([], 3)).toBeNull();
  });

  it("finds the smallest of a flat list, the way a SymbolInformation outline arrives", () => {
    const flat = [
      node("file", 1, 0, 100),
      node("fn", 11, 10, 20),
      node("cls", 4, 5, 60),
    ];
    expect(enclosingSymbol(flat, 12)?.name).toBe("fn");
    expect(enclosingSymbol(flat, 40)?.name).toBe("cls");
    expect(enclosingSymbol(flat, 80)?.name).toBe("file");
  });
});

describe("scopeLabel", () => {
  it("writes callable symbols with parentheses and the rest bare", () => {
    expect(scopeLabel(node("handle", 5, 0, 1))).toBe("handle()");
    expect(scopeLabel(node("constructor", 8, 0, 1))).toBe("constructor()");
    expect(scopeLabel(node("createRouter", 11, 0, 1))).toBe("createRouter()");
    expect(scopeLabel(node("Router", 4, 0, 1))).toBe("Router");
    expect(scopeLabel(node("dependencies", 6, 0, 1))).toBe("dependencies");
  });
});

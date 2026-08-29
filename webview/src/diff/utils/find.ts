import { type DiffChunk, type Side, sideToAxis } from "./diff-model";

/** One find hit: a character range on one line of one side. */
export interface FindMatch {
  side: Side;
  line: number;
  start: number;
  end: number;
}

export type FindScope = "both" | "left" | "right";

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  scope: FindScope;
}

/**
 * The query as a RegExp, or null when it matches nothing yet.
 *
 * Everything funnels through one regex — a literal query is escaped rather
 * than special-cased — so whole-word and case rules apply identically to both
 * modes. An invalid regex is "no matches", not an error: the user is mid-typing.
 */
export function compileQuery(
  query: string,
  options: FindOptions,
): RegExp | null {
  if (query === "") return null;
  const source = options.regex
    ? query
    : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wrapped = options.wholeWord ? `\\b(?:${source})\\b` : source;
  try {
    const compiled = new RegExp(wrapped, options.caseSensitive ? "g" : "gi");
    // A regex that matches the empty string would loop forever one character
    // at a time and highlight nothing visible.
    if (compiled.test("")) return null;
    return compiled;
  } catch {
    return null;
  }
}

function matchLine(
  pattern: RegExp,
  text: string,
  side: Side,
  line: number,
  out: FindMatch[],
): void {
  pattern.lastIndex = 0;
  for (const hit of text.matchAll(pattern)) {
    if (hit[0].length === 0) continue;
    out.push({
      side,
      line,
      start: hit.index,
      end: hit.index + hit[0].length,
    });
  }
}

/**
 * Every hit across both documents, in reading order.
 *
 * Reading order means axis order, not line order: past an unequal chunk the
 * same line number sits at different heights on each side, and stepping
 * through matches has to move down the screen, not jump by line arithmetic.
 * Within one axis position, left before right, then left-to-right.
 */
export function computeMatches(
  leftLines: readonly string[],
  rightLines: readonly string[],
  chunks: readonly DiffChunk[],
  query: string,
  options: FindOptions,
): FindMatch[] {
  const pattern = compileQuery(query, options);
  if (!pattern) return [];

  const matches: FindMatch[] = [];
  if (options.scope !== "right") {
    for (let line = 0; line < leftLines.length; line++) {
      matchLine(pattern, leftLines[line], "left", line, matches);
    }
  }
  if (options.scope !== "left") {
    for (let line = 0; line < rightLines.length; line++) {
      matchLine(pattern, rightLines[line], "right", line, matches);
    }
  }

  // Axis positions are memoised per (side, line): sideToAxis walks the chunk
  // list, and a busy query can hit thousands of lines.
  const axisOf = new Map<string, number>();
  const axis = (match: FindMatch) => {
    const key = `${match.side}:${match.line}`;
    let value = axisOf.get(key);
    if (value === undefined) {
      value = sideToAxis(chunks, match.line, match.side);
      axisOf.set(key, value);
    }
    return value;
  };

  matches.sort(
    (a, b) =>
      axis(a) - axis(b) ||
      (a.side === b.side ? 0 : a.side === "left" ? -1 : 1) ||
      a.start - b.start,
  );
  return matches;
}

/** The ranges of `matches` that sit on one line of one side. */
export function matchesOnLine(
  matches: readonly FindMatch[],
  side: Side,
  line: number,
): Array<{ start: number; end: number }> {
  return matches
    .filter((match) => match.side === side && match.line === line)
    .map((match) => ({ start: match.start, end: match.end }));
}

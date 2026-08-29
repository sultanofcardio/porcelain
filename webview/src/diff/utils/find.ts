import type { Side } from "./diff-model";

/** One find hit: a character range on one line of one side. */
export interface FindMatch {
  side: Side;
  line: number;
  start: number;
  end: number;
}

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
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

/**
 * Every hit in one side's document, in document order.
 *
 * Each side has its own find bar and therefore its own match list — the
 * IntelliJ shape, where a diff's two editors search independently. Within a
 * single side, document order and screen order agree, so no axis arithmetic
 * is needed here.
 */
export function sideMatches(
  lines: readonly string[],
  side: Side,
  query: string,
  options: FindOptions,
): FindMatch[] {
  const pattern = compileQuery(query, options);
  if (!pattern) return [];

  const matches: FindMatch[] = [];
  for (let line = 0; line < lines.length; line++) {
    pattern.lastIndex = 0;
    for (const hit of lines[line].matchAll(pattern)) {
      if (hit[0].length === 0) continue;
      matches.push({
        side,
        line,
        start: hit.index,
        end: hit.index + hit[0].length,
      });
    }
  }
  return matches;
}

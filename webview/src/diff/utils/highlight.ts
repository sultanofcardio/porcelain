import type { BundledLanguage, Highlighter, SpecialLanguage } from "shiki";
import { calculateInlineDiffs } from "../../conflicts/utils/inline-diff";

export interface Piece {
  text: string;
  color?: string;
  /** Set on the sub-range that actually differs, for word/character granularity. */
  changed?: boolean;
  /** Set on a find match. */
  found?: boolean;
  /** Set on the find match the stepper is on; implies `found`. */
  activeFound?: boolean;
}

export interface Range {
  start: number;
  end: number;
}

/**
 * Shiki ships a fixed set of grammars, and anything outside it would otherwise
 * be coloured with TypeScript's rules — which looks authoritative and is wrong.
 * Falling back to plain text is the honest option: no colour beats false colour.
 */
const SUPPORTED = new Set([
  "javascript",
  "typescript",
  "json",
  "css",
  "html",
  "markdown",
]);

export function normalizeLanguage(
  language: string,
): BundledLanguage | SpecialLanguage {
  const lang = language.toLowerCase();
  if (lang === "typescriptreact") return "typescript";
  if (lang === "javascriptreact") return "javascript";
  if (SUPPORTED.has(lang)) return lang as BundledLanguage;
  return "text";
}

export function shikiTheme(): "github-light" | "github-dark" {
  if (typeof document === "undefined") return "github-dark";
  const cls = document.body.classList;
  return cls.contains("vscode-dark") || cls.contains("vscode-high-contrast")
    ? "github-dark"
    : "github-light";
}

/** Syntax spans for one line, as character ranges. */
export function syntaxSpans(
  highlighter: Highlighter | null,
  line: string,
  language: string,
): Array<{ start: number; end: number; color?: string }> {
  if (!highlighter || line.length === 0) return [];
  try {
    const result = highlighter.codeToTokens(line, {
      lang: normalizeLanguage(language),
      theme: shikiTheme(),
    });
    const tokens = result.tokens?.[0] ?? [];
    const spans: Array<{ start: number; end: number; color?: string }> = [];
    let offset = 0;
    for (const token of tokens) {
      spans.push({
        start: offset,
        end: offset + token.content.length,
        color: token.color,
      });
      offset += token.content.length;
    }
    return spans;
  } catch {
    return [];
  }
}

/**
 * Character ranges of `line` that differ from `against`.
 *
 * Returns null when the whole line should read as changed, which is what
 * line-granularity means and also what happens when there is no counterpart
 * line to compare against.
 */
export function changedRanges(
  line: string,
  against: string | undefined,
  granularity: "line" | "word" | "character" | "none",
): Array<{ start: number; end: number }> | null {
  if (granularity === "none") return [];
  if (granularity === "line" || against === undefined) return null;

  const rows = calculateInlineDiffs(against, line);
  const tokens = rows[0] ?? [];
  const ranges: Array<{ start: number; end: number }> = [];
  let offset = 0;
  for (const token of tokens) {
    if (token.removed) continue;
    const end = offset + token.value.length;
    if (token.added) ranges.push({ start: offset, end });
    offset = end;
  }
  return ranges;
}

/**
 * Merge syntax colour with change ranges — and find matches, when there are
 * any — by splitting at every boundary, so a single span carries all of them
 * and none has to win.
 */
export function buildPieces(
  line: string,
  syntax: Array<{ start: number; end: number; color?: string }>,
  changed: Range[] | null,
  found: Range[] = [],
  /** The one match the find stepper is on, when it is on this line. */
  active: Range | null = null,
): Piece[] {
  if (line.length === 0) return [];

  const boundaries = new Set<number>([0, line.length]);
  for (const span of syntax) {
    boundaries.add(span.start);
    boundaries.add(span.end);
  }
  for (const span of changed ?? []) {
    boundaries.add(span.start);
    boundaries.add(span.end);
  }
  for (const span of found) {
    boundaries.add(span.start);
    boundaries.add(span.end);
  }
  if (active) {
    boundaries.add(active.start);
    boundaries.add(active.end);
  }

  const points = [...boundaries]
    .filter((point) => point >= 0 && point <= line.length)
    .sort((a, b) => a - b);

  const pieces: Piece[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (start >= end) continue;
    const isFound = found.some((s) => s.start <= start && s.end >= end);
    pieces.push({
      text: line.slice(start, end),
      color: syntax.find((s) => s.start <= start && s.end >= end)?.color,
      changed:
        changed === null ||
        changed.some((s) => s.start <= start && s.end >= end),
      found: isFound || undefined,
      activeFound:
        (isFound && active && active.start <= start && active.end >= end) ||
        undefined,
    });
  }
  return pieces;
}

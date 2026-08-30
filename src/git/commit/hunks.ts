/**
 * Unified-diff hunk parsing and patch reassembly.
 *
 * Staging part of a file means handing git a patch containing only the chosen
 * hunks. Git recomputes the applied result itself, so the only thing that has
 * to be exact is the patch: correct headers, correct counts, and the context
 * lines each hunk carries.
 */

export interface DiffHunk {
  /** Position in the file's diff, 0-based — how the UI addresses a hunk. */
  index: number;
  /** The `@@ -a,b +c,d @@` line, verbatim. */
  header: string;
  /** Body lines including their leading ' ', '+', '-' or '\' marker. */
  lines: string[];
  /** First line of the hunk on the old side. */
  oldStart: number;
  oldCount: number;
  /** First line of the hunk on the new side. */
  newStart: number;
  newCount: number;
}

export interface ParsedDiff {
  /** Everything before the first hunk: `diff --git`, index, ---/+++ lines. */
  fileHeader: string[];
  hunks: DiffHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Split one file's unified diff into its header and hunks. Input is the
 * output of `git diff` for a single path.
 */
export function parseUnifiedDiff(diff: string): ParsedDiff {
  const lines = diff.split("\n");
  const fileHeader: string[] = [];
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;

  for (const line of lines) {
    const match = HUNK_HEADER.exec(line);
    if (match) {
      if (current) hunks.push(current);
      current = {
        index: hunks.length,
        header: line,
        lines: [],
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
      };
      continue;
    }
    if (current) {
      // A trailing empty string from the final newline is not a diff line.
      if (line === "" && lines[lines.length - 1] === line) continue;
      current.lines.push(line);
      continue;
    }
    if (line !== "") fileHeader.push(line);
  }
  if (current) hunks.push(current);
  return { fileHeader, hunks };
}

/**
 * Rebuild a patch containing only the selected hunks.
 *
 * Later hunks must be renumbered on the new side: skipping an earlier hunk
 * means the lines it would have added or removed are not there, so every
 * following hunk starts somewhere else than it did in the full diff. The old
 * side is untouched — it still describes the file as the index has it.
 */
export function buildPartialPatch(
  parsed: ParsedDiff,
  selectedIndices: readonly number[],
): string | null {
  const selected = new Set(selectedIndices);
  const chosen = parsed.hunks.filter((hunk) => selected.has(hunk.index));
  if (chosen.length === 0) return null;

  const out: string[] = [...parsed.fileHeader];
  let drift = 0;
  for (const hunk of parsed.hunks) {
    if (!selected.has(hunk.index)) {
      // A skipped hunk shifts everything after it by the lines it would have
      // contributed.
      drift += hunk.oldCount - hunk.newCount;
      continue;
    }
    const newStart = hunk.newStart + drift;
    out.push(
      `@@ -${hunk.oldStart},${hunk.oldCount} +${newStart},${hunk.newCount} @@`,
    );
    out.push(...hunk.lines);
  }
  return `${out.join("\n")}\n`;
}

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
  options: { direction?: "forward" | "reverse" } = {},
): string | null {
  const direction = options.direction ?? "forward";
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
    // Drift belongs to whichever side the patch writes: forward it reads the
    // old side and writes the new one, reversed the roles swap.
    const oldStart =
      direction === "reverse" ? hunk.oldStart - drift : hunk.oldStart;
    const newStart =
      direction === "reverse" ? hunk.newStart : hunk.newStart + drift;
    out.push(
      `@@ -${oldStart},${hunk.oldCount} +${newStart},${hunk.newCount} @@`,
    );
    out.push(...hunk.lines);
  }
  return `${out.join("\n")}\n`;
}

/**
 * Which lines of which hunks are included, keyed by hunk index. A hunk absent
 * from the map contributes nothing; a hunk present with every line selected is
 * the same as taking the whole hunk.
 */
export type LineSelection = ReadonlyMap<number, ReadonlySet<number>>;

/**
 * Build a patch from a selection of individual lines.
 *
 * Excluding a changed line is not the same as deleting it from the patch:
 * an excluded addition simply does not appear, but an excluded *removal* has
 * to become a context line, because the line is still there in the result.
 * Getting that backwards silently drops the line from the file, so the two
 * cases are handled separately rather than filtered together.
 */
export function buildLinePatch(
  parsed: ParsedDiff,
  selection: LineSelection,
  options: { direction?: "forward" | "reverse" } = {},
): string | null {
  const direction = options.direction ?? "forward";
  const out: string[] = [...parsed.fileHeader];
  let drift = 0;
  let wroteAnything = false;

  for (const hunk of parsed.hunks) {
    const selected = selection.get(hunk.index);
    if (!selected || selected.size === 0) {
      // Nothing taken here: the hunk's net effect still shifts what follows.
      drift += hunk.oldCount - hunk.newCount;
      continue;
    }

    const body = emitSelectedHunk(hunk, selected, direction);
    const oldCount = body.filter(
      (line) => line.startsWith(" ") || line.startsWith("-"),
    ).length;
    const newCount = body.filter(
      (line) => line.startsWith(" ") || line.startsWith("+"),
    ).length;
    const changes = body.some(
      (line) => line.startsWith("+") || line.startsWith("-"),
    );
    if (!changes) {
      // Everything selected turned into context: this hunk applies nothing.
      drift += hunk.oldCount - hunk.newCount;
      continue;
    }

    // Drift belongs to whichever side the patch *writes*. Applied forward it
    // reads the old side and writes the new one; reversed it reads the new
    // side — which still describes the index verbatim — and writes the old.
    const oldNum =
      direction === "reverse" ? hunk.oldStart - drift : hunk.oldStart;
    const newNum =
      direction === "reverse" ? hunk.newStart : hunk.newStart + drift;
    out.push(`@@ -${oldNum},${oldCount} +${newNum},${newCount} @@`);
    out.push(...body);
    wroteAnything = true;
    // What this hunk actually applies shifts the ones after it.
    drift += oldCount - newCount - (hunk.oldCount - hunk.newCount);
  }

  return wroteAnything ? `${out.join("\n")}\n` : null;
}

/**
 * One hunk's body, keeping only the selected changes.
 *
 * An excluded addition simply does not appear. An excluded *removal* has to
 * become a context line, because the line is still in the file — dropping it
 * would silently delete it. Where that context line goes matters: a run of
 * removals followed by additions describes a replacement, and leaving the
 * kept-back line sitting among the removals would reorder the file. So each
 * run is rebuilt with the surviving old lines in their own order and the
 * selected additions placed just after the last removal actually taken.
 */
function emitSelectedHunk(
  hunk: DiffHunk,
  selected: ReadonlySet<number>,
  direction: "forward" | "reverse",
): string[] {
  // Which side already exists in the target the patch will be applied to,
  // and so has to survive as context rather than disappear.
  //
  // Staging reads the working-tree diff and writes the index: the index does
  // not have the unselected additions yet, so they are simply omitted, while
  // an unselected removal is still present and must stay as context.
  //
  // Unstaging reverses a patch against the index, which *does* hold the other
  // staged additions. Dropping them would describe an index that never
  // existed and the patch would not apply — so there the roles swap.
  const keepAsContext = direction === "reverse" ? "+" : "-";
  const dropUnselected = direction === "reverse" ? "-" : "+";
  const body: string[] = [];
  let index = 0;

  while (index < hunk.lines.length) {
    const line = hunk.lines[index];
    const marker = line[0];
    if (marker !== "+" && marker !== "-") {
      body.push(line);
      index++;
      continue;
    }

    // Gather the whole run of changed lines: that is the replacement unit.
    const runStart = index;
    while (index < hunk.lines.length) {
      const next = hunk.lines[index][0];
      if (next !== "+" && next !== "-") break;
      index++;
    }

    const oldSide: string[] = [];
    const additions: string[] = [];
    let lastKeptRemoval = -1;
    for (let position = runStart; position < index; position++) {
      const current = hunk.lines[position];
      if (current.startsWith(keepAsContext)) {
        if (selected.has(position)) {
          oldSide.push(current);
          lastKeptRemoval = oldSide.length;
        } else {
          // Present in the target already, so it is context on both sides.
          oldSide.push(` ${current.slice(1)}`);
        }
        continue;
      }
      if (current.startsWith(dropUnselected) && selected.has(position)) {
        additions.push(current);
      }
    }

    // Additions land after the last removal actually taken; with none taken
    // they lead the run, so they still sit where the change belongs.
    const at = lastKeptRemoval === -1 ? 0 : lastKeptRemoval;
    body.push(...oldSide.slice(0, at), ...additions, ...oldSide.slice(at));
  }

  // A "\ No newline at end of file" marker belongs to whatever precedes it and
  // is carried along by the walk above.
  return body;
}

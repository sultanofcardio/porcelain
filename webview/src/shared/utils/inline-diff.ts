import { diffWordsWithSpace } from "diff";

export interface InlineDiff {
  value: string;
  added?: boolean;
  removed?: boolean;
}

/**
 * Word-level differences between two multi-line strings, mapped back to an
 * array of lines, where each line is an array of inline tokens (added,
 * removed, or unchanged).
 *
 * Shared home: the diff viewer's `changedRanges` and the merge surface both
 * consume this — it used to live under `conflicts/`, imported across stacks.
 */
export function calculateInlineDiffs(
  baseText: string,
  compareText: string,
): InlineDiff[][] {
  const changes = diffWordsWithSpace(baseText, compareText);
  const lines: InlineDiff[][] = [[]];

  for (const change of changes) {
    const parts = change.value.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) lines.push([]);
      if (parts[i]) {
        lines[lines.length - 1].push({
          value: parts[i],
          added: change.added,
          removed: change.removed,
        });
      }
    }
  }

  return lines;
}

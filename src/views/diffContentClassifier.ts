/**
 * Classifies what `getDiffSides` read, so the webview receives a typed answer
 * instead of whatever UTF-8 decoding makes of arbitrary bytes.
 *
 * Before this existed, a PNG was decoded as UTF-8, split on `\n`, line-diffed
 * and rendered as replacement characters — and a file that failed to read was
 * indistinguishable from a deleted one, because both arrived as the empty
 * string. Classification lives on the host because the host holds the bytes;
 * the webview only ever sees the verdict.
 */

/** How many leading bytes to scan for a NUL. Git's own binary heuristic. */
const BINARY_SCAN_LIMIT = 8000;

/**
 * Whether a buffer is binary, by git's rule: a NUL byte near the start.
 * An empty buffer is not binary — it is an absent or empty side, and those
 * must keep collapsing to a single text pane.
 */
export function isBinaryContent(content: Buffer): boolean {
  const limit = Math.min(content.length, BINARY_SCAN_LIMIT);
  for (let index = 0; index < limit; index += 1) {
    if (content[index] === 0) return true;
  }
  return false;
}

/**
 * MIME type for extensions the webview can render with a `data:` URI, which
 * the webview CSP already permits (`img-src ${cspSource} data:`). SVG is
 * deliberately absent: it is text, and diffs as text.
 */
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

export function imageMimeType(filePath: string): string | null {
  const ext = filePath.split(".").pop() ?? "";
  return IMAGE_MIME[ext.toLowerCase()] ?? null;
}

/**
 * The most an image side may weigh before the diff degrades to the binary
 * placeholder. A data: URI costs ~4/3 of the file serialized through
 * postMessage and held in webview memory, so an unbounded image could stall
 * the extension host; past the cap the placeholder still shows both sizes
 * and offers Open in editor.
 */
export const IMAGE_BYTE_LIMIT = 10 * 1024 * 1024;

/** A `data:` URI for an image side, or undefined for an absent side. */
export function toImageDataUri(
  content: Buffer,
  mime: string,
): string | undefined {
  if (content.length === 0) return undefined;
  return `data:${mime};base64,${content.toString("base64")}`;
}

export type BinaryClassification =
  | {
      kind: "image";
      leftUri?: string;
      rightUri?: string;
      leftBytes: number;
      rightBytes: number;
    }
  | {
      kind: "binary";
      leftBytes: number;
      rightBytes: number;
      differs: boolean;
    };

/**
 * What a binary pair renders as: images inline, everything else — including
 * an image too heavy for the cap — the placeholder with sizes.
 */
export function classifyBinaryPair(
  left: Buffer,
  right: Buffer,
  filePath: string,
): BinaryClassification {
  const mime = imageMimeType(filePath);
  if (
    mime &&
    left.length <= IMAGE_BYTE_LIMIT &&
    right.length <= IMAGE_BYTE_LIMIT
  ) {
    // Only a side that is actually binary renders as an image: a text side
    // with an image extension (an LFS pointer, say) base64ed into a data:
    // URI would draw a broken <img>, so it degrades to an absent side.
    return {
      kind: "image",
      leftUri: isBinaryContent(left) ? toImageDataUri(left, mime) : undefined,
      rightUri: isBinaryContent(right)
        ? toImageDataUri(right, mime)
        : undefined,
      leftBytes: left.length,
      rightBytes: right.length,
    };
  }
  return {
    kind: "binary",
    leftBytes: left.length,
    rightBytes: right.length,
    differs: !left.equals(right),
  };
}

/**
 * Lines the diff would have to chew through, without decoding the buffer.
 * Counted the way the model counts: a trailing newline does not start a line.
 */
export function countLines(content: Buffer): number {
  if (content.length === 0) return 0;
  let lines = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === 0x0a && index !== content.length - 1) lines += 1;
  }
  return lines;
}

/**
 * Where a text diff becomes a "tooLarge" answer unless the user insists.
 *
 * Measured, not guessed: `diffLines` — the dominant cost of a cold open —
 * benchmarked over the same `diff` package the webview bundles, at ~5%
 * change density on an M-series laptop: 188ms at 20k lines, 1253ms at 50k.
 * Myers is O(ND), so at fixed density the cost grows superlinearly; the
 * ~400ms budget falls just past 25k lines. It is a soft limit — the webview
 * offers "Show anyway", which re-requests with `force` — because density is
 * the other axis: a one-line edit in a 100k-line file diffs quickly, and a
 * refusal would have no escape.
 */
export const LARGE_DIFF_LINE_LIMIT = 25_000;

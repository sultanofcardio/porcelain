import * as assert from "node:assert";
import {
  countLines,
  imageMimeType,
  isBinaryContent,
  toImageDataUri,
} from "../../views/diffContentClassifier";

describe("isBinaryContent", () => {
  it("flags a NUL byte near the start, which is git's own heuristic", () => {
    assert.strictEqual(isBinaryContent(Buffer.from([0x89, 0x50, 0x00])), true);
  });

  it("passes ordinary text through", () => {
    assert.strictEqual(isBinaryContent(Buffer.from("const a = 1;\n")), false);
  });

  it("treats an empty buffer as text", () => {
    // An empty side is an absent or empty file, and those must keep
    // collapsing to a single text pane rather than becoming a placeholder.
    assert.strictEqual(isBinaryContent(Buffer.alloc(0)), false);
  });

  it("ignores a NUL past the scan limit, matching git", () => {
    const content = Buffer.concat([Buffer.alloc(9000, 0x61), Buffer.from([0])]);
    assert.strictEqual(isBinaryContent(content), false);
  });
});

describe("imageMimeType", () => {
  it("recognises the extensions the webview can render", () => {
    assert.strictEqual(imageMimeType("assets/logo.png"), "image/png");
    assert.strictEqual(imageMimeType("photo.JPG"), "image/jpeg");
  });

  it("leaves svg alone: it is text, and diffs as text", () => {
    assert.strictEqual(imageMimeType("icon.svg"), null);
  });

  it("returns null for everything else", () => {
    assert.strictEqual(imageMimeType("src/app.ts"), null);
  });
});

describe("toImageDataUri", () => {
  it("encodes bytes as a data URI", () => {
    assert.strictEqual(
      toImageDataUri(Buffer.from([1, 2, 3]), "image/png"),
      "data:image/png;base64,AQID",
    );
  });

  it("returns undefined for an absent side", () => {
    assert.strictEqual(toImageDataUri(Buffer.alloc(0), "image/png"), undefined);
  });
});

describe("countLines", () => {
  it("counts the way the model counts: no trailing empty line", () => {
    assert.strictEqual(countLines(Buffer.from("a\nb\nc\n")), 3);
  });

  it("counts a file without a trailing newline the same way", () => {
    assert.strictEqual(countLines(Buffer.from("a\nb\nc")), 3);
  });

  it("counts an empty buffer as zero lines", () => {
    assert.strictEqual(countLines(Buffer.alloc(0)), 0);
  });
});

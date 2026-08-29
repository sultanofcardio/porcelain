import * as assert from "node:assert";
import {
  classifyBinaryPair,
  countLines,
  IMAGE_BYTE_LIMIT,
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

describe("classifyBinaryPair", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);

  it("renders a small image pair inline as data URIs", () => {
    const result = classifyBinaryPair(png, png, "logo.png");
    assert.strictEqual(result.kind, "image");
    if (result.kind === "image") {
      assert.ok(result.leftUri?.startsWith("data:image/png;base64,"));
    }
  });

  it("degrades an image past the byte cap to the binary placeholder", () => {
    // The cap exists so a tens-of-MB image never rides postMessage as
    // base64; the placeholder still carries both sizes.
    const huge = Buffer.alloc(IMAGE_BYTE_LIMIT + 1);
    huge[0] = 0; // NUL keeps it classified binary
    const result = classifyBinaryPair(png, huge, "photo.jpg");
    assert.strictEqual(result.kind, "binary");
    if (result.kind === "binary") {
      assert.strictEqual(result.rightBytes, IMAGE_BYTE_LIMIT + 1);
      assert.strictEqual(result.differs, true);
    }
  });

  it("reports identical binaries as such", () => {
    const result = classifyBinaryPair(png, Buffer.from(png), "a.bin");
    assert.strictEqual(result.kind, "binary");
    if (result.kind === "binary") {
      assert.strictEqual(result.differs, false);
    }
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

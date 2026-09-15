import * as assert from "node:assert";
import * as vscode from "vscode";
import { noteWrite, sameLines, writtenWithin } from "../../views/diskSync";

describe("diskSync: the note of a just-written file", () => {
  it("finds a write noted by its resolved path through the document's fsPath", () => {
    const resolved = "C:/repo/src/a.ts";
    const asDocument = vscode.Uri.file(resolved).fsPath;
    assert.notStrictEqual(asDocument, resolved);
    noteWrite(resolved, 1000);
    assert.strictEqual(writtenWithin(asDocument, 2000, 1500), true);
  });

  it("forgets a write once the window has passed", () => {
    noteWrite("/repo/src/b.ts", 1000);
    assert.strictEqual(writtenWithin("/repo/src/b.ts", 2000, 3000), true);
    assert.strictEqual(writtenWithin("/repo/src/b.ts", 2000, 3001), false);
    assert.strictEqual(writtenWithin("/repo/src/b.ts", 2000, 1001), false);
  });

  it("knows nothing of a file never written", () => {
    assert.strictEqual(writtenWithin("/repo/src/c.ts", 2000), false);
  });
});

describe("diskSync: sameLines", () => {
  it("reads texts as equal whatever their line endings", () => {
    assert.strictEqual(sameLines("a\r\nb\nc\r", "a\nb\nc\n"), true);
    assert.strictEqual(sameLines("a\nb", "a\nc"), false);
  });
});

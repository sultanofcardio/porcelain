import * as assert from "node:assert";
import { caretSelection } from "../../views/editSource";

describe("caretSelection: the position Edit Source hands to the native editor", () => {
  it("builds an empty range at the caret's line and column", () => {
    const range = caretSelection({ filePath: "a.ts", line: 45, column: 26 });
    assert.ok(range);
    assert.strictEqual(range.start.line, 45);
    assert.strictEqual(range.start.character, 26);
    assert.ok(range.isEmpty);
  });

  it("lands at the start of the line when only a line is given", () => {
    const range = caretSelection({ filePath: "a.ts", line: 3 });
    assert.ok(range);
    assert.deepStrictEqual([range.start.line, range.start.character], [3, 0]);
  });

  it("means no position without a usable line", () => {
    for (const params of [
      { filePath: "a.ts" },
      { filePath: "a.ts", line: -1 },
      { filePath: "a.ts", line: 1.5 },
      { filePath: "a.ts", line: "4" },
      { filePath: "a.ts", line: Number.NaN },
    ]) {
      assert.strictEqual(caretSelection(params), null, JSON.stringify(params));
    }
  });

  it("ignores a malformed column rather than refusing the line", () => {
    const range = caretSelection({ filePath: "a.ts", line: 2, column: -4 });
    assert.ok(range);
    assert.strictEqual(range.start.character, 0);
  });
});

import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { caretSelection, openAtCaret } from "../../views/editSource";

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

describe("openAtCaret: the caret survives the editor reloading from disk", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const encode = (lines: string[]) => Buffer.from(lines.join("\n"), "utf8");
  let file: vscode.Uri;
  let lines: string[];

  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "porcelain-edit-"));
    file = vscode.Uri.file(path.join(dir, "a.ts"));
    lines = Array.from({ length: 60 }, (_, i) => `line ${i}`);
    await vscode.workspace.fs.writeFile(file, encode(lines));
  });

  afterEach(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  it("opens a file that is not showing yet at the caret", async function () {
    this.timeout(10000);
    const at = new vscode.Position(44, 3);
    await openAtCaret(file, new vscode.Range(at, at));
    await sleep(500);
    const active = vscode.window.activeTextEditor?.selection.active;
    assert.deepStrictEqual([active?.line, active?.character], [44, 3]);
  });

  it("keeps the caret on its line when an open editor reloads a rewritten line", async function () {
    this.timeout(10000);
    // The tab exists first, as it does after a previous Edit Source; then
    // the diff surface rewrites the caret's line on disk, as its save does.
    await vscode.commands.executeCommand("vscode.open", file, {
      preview: false,
    });
    await sleep(300);
    lines[44] = `X${lines[44]}`;
    await vscode.workspace.fs.writeFile(file, encode(lines));
    const at = new vscode.Position(44, 1);
    await openAtCaret(file, new vscode.Range(at, at));
    // Long enough for the reload that used to carry the caret to line 45.
    await sleep(1500);
    const editor = vscode.window.activeTextEditor;
    assert.strictEqual(editor?.document.lineAt(44).text, "Xline 44");
    const active = editor?.selection.active;
    assert.deepStrictEqual([active?.line, active?.character], [44, 1]);
  });

  it("leaves the selection alone when no reload arrives", async function () {
    this.timeout(10000);
    // Mixed line endings are normalised by VS Code, so this document can
    // never match the bytes on disk and the settle wait can only time out.
    lines[3] = `${lines[3]}\r`;
    await vscode.workspace.fs.writeFile(file, encode(lines));
    const at = new vscode.Position(44, 1);
    const opening = openAtCaret(file, new vscode.Range(at, at), 1000);
    await sleep(300);
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor);
    assert.notStrictEqual(editor.document.getText(), lines.join("\n"));
    // The reader looks somewhere else while the wait is still running.
    const moved = new vscode.Position(7, 2);
    editor.selection = new vscode.Selection(moved, moved);
    await opening;
    await sleep(200);
    const active = vscode.window.activeTextEditor?.selection.active;
    assert.deepStrictEqual([active?.line, active?.character], [7, 2]);
  });

  it("leaves an editor holding unsaved edits alone", async function () {
    this.timeout(10000);
    await vscode.commands.executeCommand("vscode.open", file, {
      preview: false,
    });
    await sleep(300);
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor);
    await editor.edit((edit) => {
      edit.insert(new vscode.Position(0, 0), "unsaved ");
    });
    assert.ok(editor.document.isDirty);
    const at = new vscode.Position(44, 1);
    const opening = openAtCaret(file, new vscode.Range(at, at), 1000);
    await sleep(300);
    // The reader clicks elsewhere and carries on typing in the tab Edit
    // Source just focused. No reload can come for a dirty document, so that
    // first keystroke must not be mistaken for one.
    const clicked = new vscode.Position(5, 0);
    editor.selection = new vscode.Selection(clicked, clicked);
    await editor.edit((edit) => {
      edit.insert(clicked, "typed");
    });
    const typing = editor.selection.active;
    assert.strictEqual(typing.line, 5);
    await opening;
    await sleep(200);
    const active = vscode.window.activeTextEditor?.selection.active;
    assert.deepStrictEqual(
      [active?.line, active?.character],
      [typing.line, typing.character],
    );
  });
});

import * as vscode from "vscode";

/**
 * The selection Edit Source opens a file with, from the caret a diff webview
 * sends along: a 0-based line and column, the editor core's own coordinates.
 * Anything malformed means "no position", and the file opens as it always
 * did. A missing column lands at the start of the line.
 */
export function caretSelection(
  params: Record<string, unknown>,
): vscode.Range | null {
  const { line, column } = params;
  if (!isIndex(line)) return null;
  const position = new vscode.Position(line, isIndex(column) ? column : 0);
  return new vscode.Range(position, position);
}

function isIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Open `uri` in whichever editor VS Code resolves for it, with the caret at
 * `selection`, and keep the caret there through a pending reload.
 *
 * The diff surface writes the file to disk right before asking for it to be
 * opened. When that file is already showing in a tab, VS Code reloads the
 * document from disk asynchronously, line by line, and a selection placed
 * inside a replaced line is carried to the end of the replacement: one line
 * down, column 0. So the selection is placed a second time, but only once the
 * document has caught up with the disk: a change that is not that reload
 * belongs to whoever made it.
 *
 * The disk is read before the open so that comparing against it is the first
 * thing that happens afterwards, with no await for the reload to land inside.
 * A document already holding the disk text has either never been behind it,
 * where placing the selection again changes nothing, or was caught up during
 * the open, where the caret is exactly the one that needs placing again.
 *
 * Only the open itself rejects. Everything after it is the caret's own
 * business and never fails the request.
 */
export async function openAtCaret(
  uri: vscode.Uri,
  selection: vscode.Range,
  settleMs = 2000,
): Promise<void> {
  const onDisk = await readText(uri);
  await vscode.commands.executeCommand("vscode.open", uri, {
    selection,
    preview: false,
  });
  try {
    await keepCaret(uri, selection, onDisk, settleMs);
  } catch (error) {
    console.error("[porcelain] keeping the Edit Source caret failed:", error);
  }
}

async function keepCaret(
  uri: vscode.Uri,
  selection: vscode.Range,
  onDisk: string | null,
  settleMs: number,
): Promise<void> {
  if (onDisk === null) return;
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.toString() !== uri.toString()) return;
  const { document } = editor;
  // Unsaved edits in the native tab: VS Code will not replace them with the
  // disk, so there is no reload coming and nothing to place a second time.
  if (document.isDirty) return;
  // A document whose line endings VS Code normalises never matches the disk
  // byte for byte, so the wait can time out with no reload having happened.
  // Then the selection is whatever the reader last made it: leave it be.
  const settled =
    document.getText() === onDisk ||
    (await reloadedFrom(document, onDisk, settleMs));
  if (!settled) return;
  editor.selection = new vscode.Selection(selection.start, selection.end);
  editor.revealRange(
    selection,
    vscode.TextEditorRevealType.InCenterIfOutsideViewport,
  );
}

async function readText(uri: vscode.Uri): Promise<string | null> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    // Unreadable means nothing to compare against.
    return null;
  }
}

/**
 * Resolve true once `document` holds `onDisk`, false if that has not happened
 * within `timeoutMs`. Changes that leave the document short of the disk text
 * are steps of a reload still in flight; one that leaves it dirty is the
 * reader typing, and their caret is theirs to keep.
 */
function reloadedFrom(
  document: vscode.TextDocument,
  onDisk: string,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (reloaded: boolean) => {
      clearTimeout(timer);
      listener.dispose();
      resolve(reloaded);
    };
    const listener = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document !== document) return;
      if (event.document.getText() === onDisk) done(true);
      else if (event.document.isDirty) done(false);
    });
    const timer = setTimeout(() => done(false), timeoutMs);
  });
}

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
 * down, column 0. So once the document has caught up with the disk the
 * selection is placed a second time. The wait is bounded, since a document
 * whose line endings VS Code normalises never matches the disk byte for byte.
 */
export async function openAtCaret(
  uri: vscode.Uri,
  selection: vscode.Range,
  settleMs = 2000,
): Promise<void> {
  await vscode.commands.executeCommand("vscode.open", uri, {
    selection,
    preview: false,
  });
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.toString() !== uri.toString()) return;
  const { document } = editor;
  if (!(await matchesDisk(document))) await nextChange(document, settleMs);
  editor.selection = new vscode.Selection(selection.start, selection.end);
  editor.revealRange(
    selection,
    vscode.TextEditorRevealType.InCenterIfOutsideViewport,
  );
}

async function matchesDisk(document: vscode.TextDocument): Promise<boolean> {
  try {
    const bytes = await vscode.workspace.fs.readFile(document.uri);
    return new TextDecoder().decode(bytes) === document.getText();
  } catch {
    // Unreadable means nothing to wait for.
    return true;
  }
}

function nextChange(
  document: vscode.TextDocument,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      listener.dispose();
      resolve();
    };
    const listener = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === document) done();
    });
    const timer = setTimeout(done, timeoutMs);
  });
}

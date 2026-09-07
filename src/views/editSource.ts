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

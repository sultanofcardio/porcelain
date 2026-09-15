import * as vscode from "vscode";

/**
 * The diff surface writes working-tree files with plain fs, and VS Code
 * refreshes a document it already has open from its watcher, a beat later.
 * Everything that has to read such a document right after such a write
 * meets here: the disk text, the wait for the document to hold it, and a
 * note of which files were just written so nothing else pays for the wait.
 */

/** How long a document gets to catch up with the disk after a write. */
export const DISK_SETTLE_MS = 2000;

export async function readText(uri: vscode.Uri): Promise<string | null> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    // Unreadable means nothing to compare against.
    return null;
  }
}

/**
 * Whether two texts read the same line by line, whatever their line endings:
 * VS Code normalises mixed endings to the dominant one when it loads a file,
 * so such a document never matches its bytes on disk.
 */
export function sameLines(a: string, b: string): boolean {
  return a.replace(/\r\n?/g, "\n") === b.replace(/\r\n?/g, "\n");
}

/**
 * Resolve true once `document` holds `onDisk` by `same`, false if that has
 * not happened within `timeoutMs`. Changes that leave the document short of
 * the disk text are steps of a reload still in flight; one that leaves it
 * dirty is the reader typing, and no reload is coming for a dirty document.
 */
export function reloadedFrom(
  document: vscode.TextDocument,
  onDisk: string,
  timeoutMs: number,
  same: (document: string, disk: string) => boolean = (a, b) => a === b,
): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (reloaded: boolean) => {
      clearTimeout(timer);
      listener.dispose();
      resolve(reloaded);
    };
    const listener = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document !== document) return;
      if (same(event.document.getText(), onDisk)) done(true);
      else if (event.document.isDirty) done(false);
    });
    const timer = setTimeout(() => done(false), timeoutMs);
  });
}

const recentWrites = new Map<string, number>();

/**
 * One key for a file however its path was spelt: the write handler holds the
 * resolved path, the language channel a document's `fsPath`, and on Windows
 * the two differ in the drive letter's case.
 */
function writeKey(fsPath: string): string {
  return vscode.Uri.file(fsPath).toString();
}

/** Record that the diff surface just wrote `fsPath`. */
export function noteWrite(fsPath: string, now = Date.now()): void {
  recentWrites.set(writeKey(fsPath), now);
}

/** Whether the diff surface wrote `fsPath` within the last `withinMs`. */
export function writtenWithin(
  fsPath: string,
  withinMs: number,
  now = Date.now(),
): boolean {
  const key = writeKey(fsPath);
  const at = recentWrites.get(key);
  if (at === undefined) return false;
  if (now - at > withinMs) {
    recentWrites.delete(key);
    return false;
  }
  return true;
}

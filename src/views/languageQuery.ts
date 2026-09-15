import { existsSync, realpathSync } from "node:fs";
import * as nodepath from "node:path";
import * as vscode from "vscode";
import type {
  DefinitionResult,
  DefinitionTarget,
  DocumentRange,
  DocumentSymbolNode,
  HoverResult,
  LanguageQueryKind,
  LanguageQueryResult,
  SymbolsResult,
} from "../messages/protocol";
import {
  DISK_SETTLE_MS,
  readText,
  reloadedFrom,
  sameLines,
  writtenWithin,
} from "./diskSync";
import { buildGitContentUri } from "./gitUri";
import {
  EMPTY_CONTENT_REF,
  resolveRepoReadPath,
  WORKING_TREE_REF,
} from "./workingTreeDiffModel";

/**
 * The language channel: the diff webview asks about a position on one of
 * its sides, the host maps that side to the document VS Code knows it as,
 * runs the provider commands every language extension already answers, and
 * returns what they said as plain data. Nothing here renders, and every
 * conversion is a pure function so it can be tested without an editor.
 */

/** A `languageQuery` request, once its params have been checked. */
export interface LanguageQuery {
  kind: LanguageQueryKind;
  ref: string;
  path: string;
  line: number;
  character: number;
}

const QUERY_KINDS: ReadonlySet<string> = new Set<LanguageQueryKind>([
  "hover",
  "definition",
  "symbols",
]);

function isQueryKind(value: unknown): value is LanguageQueryKind {
  return typeof value === "string" && QUERY_KINDS.has(value);
}

/**
 * The query the webview sent, or null for anything malformed. A symbols
 * query is about the whole document and needs no position; the other two
 * need a line and a character, both 0-based.
 */
export function parseLanguageQuery(
  params: Record<string, unknown>,
): LanguageQuery | null {
  const { kind, ref, path, line, character } = params;
  if (!isQueryKind(kind)) return null;
  if (typeof ref !== "string" || typeof path !== "string" || path === "") {
    return null;
  }
  if (kind === "symbols") {
    return { kind, ref, path, line: 0, character: 0 };
  }
  if (!isIndex(line) || !isIndex(character)) return null;
  return { kind, ref, path, line, character };
}

function isIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** The filesystem the read fence sees through symlinks with; see the model. */
const FENCE_FS = { existsSync, realpathSync };

/**
 * The document a diff side is, to the language providers. The working tree
 * is the file on disk, the one the servers already index; a revision is the
 * `porcelain:` document the content provider serves, from which built-in
 * servers that accept any scheme (JSON, CSS, HTML) still answer. An empty
 * side is no document at all.
 *
 * The working-tree path goes through the same containment fence every
 * other read of the webview's takes: the webview names files, not paths.
 */
export function sideDocumentUri(
  repo: { repoId: string; workTreeRoot: string },
  ref: string,
  path: string,
): vscode.Uri | null {
  if (!ref || ref === EMPTY_CONTENT_REF) return null;
  if (ref === WORKING_TREE_REF) {
    return vscode.Uri.file(
      resolveRepoReadPath(repo.workTreeRoot, path, nodepath, FENCE_FS),
    );
  }
  return buildGitContentUri(ref, path, repo.repoId);
}

/** What a side with no document, or a provider with nothing to say, gets. */
export function emptyLanguageResult(
  kind: LanguageQueryKind,
): LanguageQueryResult {
  switch (kind) {
    case "hover":
      return { kind, contents: [] };
    case "definition":
      return { kind, targets: [], origin: null };
    case "symbols":
      return { kind, symbols: [] };
  }
}

function serializeRange(range: vscode.Range): DocumentRange {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

/**
 * A `MarkedString` object is a code block in disguise; the fence it gets
 * is one backtick longer than any run inside it, so the content can never
 * close it early.
 */
function fenced(language: string, value: string): string {
  let longest = 2;
  for (const run of value.matchAll(/`+/g)) {
    longest = Math.max(longest, run[0].length);
  }
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${value}\n${fence}`;
}

/** The markdown one hover content stands for, whichever type carried it. */
function markdownOf(
  content: vscode.MarkdownString | vscode.MarkedString,
): string {
  if (typeof content === "string") return content;
  if ("language" in content) return fenced(content.language, content.value);
  return typeof content.value === "string" ? content.value : "";
}

/**
 * Every provider's hover, flattened to the markdown strings the card
 * renders in order. Blank contents are dropped: a provider that answers
 * with an empty string has said nothing.
 */
export function flattenHover(
  hovers: readonly vscode.Hover[] | null | undefined,
): HoverResult {
  const contents: string[] = [];
  for (const hover of hovers ?? []) {
    for (const content of hover.contents ?? []) {
      const markdown = markdownOf(content);
      if (markdown.trim() !== "") contents.push(markdown);
    }
  }
  return { kind: "hover", contents };
}

function isRange(value: unknown): value is vscode.Range {
  return (
    typeof value === "object" &&
    value !== null &&
    "start" in value &&
    "end" in value &&
    typeof (value as vscode.Range).start?.line === "number" &&
    typeof (value as vscode.Range).end?.line === "number"
  );
}

function isUri(value: unknown): value is vscode.Uri {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as vscode.Uri).toString === "function" &&
    typeof (value as vscode.Uri).scheme === "string"
  );
}

function isLocationLink(value: unknown): value is vscode.LocationLink {
  return (
    typeof value === "object" &&
    value !== null &&
    isUri((value as vscode.LocationLink).targetUri) &&
    isRange((value as vscode.LocationLink).targetRange)
  );
}

function isLocation(value: unknown): value is vscode.Location {
  return (
    typeof value === "object" &&
    value !== null &&
    isUri((value as vscode.Location).uri) &&
    isRange((value as vscode.Location).range)
  );
}

/**
 * Definition providers answer with locations or location links, and the
 * command may hand back either list. Both flatten to a URI and the range
 * to select there: a link's selection range where it has one, since the
 * full target range of a function is its whole body and the caret belongs
 * on its name. The first link that names the symbol's own span provides
 * the origin, which is what gets underlined under a held modifier.
 */
export function flattenLocations(results: unknown): DefinitionResult {
  const targets: DefinitionTarget[] = [];
  const seen = new Set<string>();
  let origin: DocumentRange | null = null;
  const items = Array.isArray(results) ? results : results ? [results] : [];
  for (const item of items) {
    let target: DefinitionTarget | null = null;
    if (isLocationLink(item)) {
      target = {
        uri: item.targetUri.toString(),
        range: serializeRange(item.targetSelectionRange ?? item.targetRange),
      };
      if (origin === null && item.originSelectionRange) {
        origin = serializeRange(item.originSelectionRange);
      }
    } else if (isLocation(item)) {
      target = { uri: item.uri.toString(), range: serializeRange(item.range) };
    }
    if (!target) continue;
    const key = `${target.uri}#${JSON.stringify(target.range)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }
  return { kind: "definition", targets, origin };
}

function isDocumentSymbol(value: unknown): value is vscode.DocumentSymbol {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as vscode.DocumentSymbol).name === "string" &&
    isRange((value as vscode.DocumentSymbol).range)
  );
}

function isSymbolInformation(
  value: unknown,
): value is vscode.SymbolInformation {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as vscode.SymbolInformation).name === "string" &&
    isLocation((value as vscode.SymbolInformation).location)
  );
}

/**
 * The outline as plain nodes. A `DocumentSymbol` keeps its children; the
 * flat `SymbolInformation` list some providers still return becomes a list
 * of leaves, and the lookup on the other end searches by range containment
 * either way, so the two shapes answer the same questions.
 */
export function symbolTree(symbols: unknown): DocumentSymbolNode[] {
  if (!Array.isArray(symbols)) return [];
  const nodes: DocumentSymbolNode[] = [];
  for (const symbol of symbols) {
    if (isDocumentSymbol(symbol)) {
      nodes.push({
        name: symbol.name,
        kind: symbol.kind,
        range: serializeRange(symbol.range),
        children: symbolTree(symbol.children),
      });
    } else if (isSymbolInformation(symbol)) {
      nodes.push({
        name: symbol.name,
        kind: symbol.kind,
        range: serializeRange(symbol.location.range),
        children: [],
      });
    }
  }
  return nodes;
}

/**
 * Run one provider command and treat a throw as "no answer". Some language
 * extensions throw on a scheme they do not serve where others return an
 * empty list, and neither is the diff viewer's problem to report.
 */
async function provide<T>(
  command: string,
  ...args: unknown[]
): Promise<T | undefined> {
  try {
    return await vscode.commands.executeCommand<T>(command, ...args);
  } catch (error) {
    console.debug(`[porcelain] ${command} answered with an error:`, error);
    return undefined;
  }
}

/**
 * The document a working-tree query runs over, once it holds what the file
 * on disk holds. The diff writes the file with plain fs, and VS Code only
 * refreshes a document it already has open through its watcher, a beat
 * later; a query sent the moment the write resolved would otherwise be
 * answered from the text before the save. The wait exists for that window
 * alone: a file the diff has not just written, a document VS Code has not
 * seen yet, a dirty one, or one already reading the same line by line waits
 * for nothing, and one still behind after the bound is what the providers
 * get.
 */
async function settledDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
  const open = vscode.workspace.textDocuments.find(
    (candidate) => candidate.uri.toString() === uri.toString(),
  );
  if (!open) return vscode.workspace.openTextDocument(uri);
  if (
    uri.scheme !== "file" ||
    open.isDirty ||
    !writtenWithin(uri.fsPath, DISK_SETTLE_MS)
  ) {
    return open;
  }
  const onDisk = await readText(uri);
  if (onDisk !== null && !sameLines(open.getText(), onDisk)) {
    await reloadedFrom(open, onDisk, DISK_SETTLE_MS, sameLines);
  }
  return open;
}

/**
 * Answer a query over `uri`. The document is opened first so the position
 * can be clamped into it: the webview's buffer and the document can differ
 * in length, and a position past the end is not worth an error.
 */
export async function runLanguageQuery(
  uri: vscode.Uri,
  query: LanguageQuery,
): Promise<LanguageQueryResult> {
  const document = await settledDocument(uri);
  const position = document.validatePosition(
    new vscode.Position(query.line, query.character),
  );
  switch (query.kind) {
    case "hover":
      return flattenHover(
        await provide<vscode.Hover[]>(
          "vscode.executeHoverProvider",
          document.uri,
          position,
        ),
      );
    case "definition":
      return flattenLocations(
        await provide<vscode.Location[] | vscode.LocationLink[]>(
          "vscode.executeDefinitionProvider",
          document.uri,
          position,
        ),
      );
    case "symbols": {
      const result: SymbolsResult = {
        kind: "symbols",
        symbols: symbolTree(
          await provide<vscode.DocumentSymbol[] | vscode.SymbolInformation[]>(
            "vscode.executeDocumentSymbolProvider",
            document.uri,
          ),
        ),
      };
      return result;
    }
  }
}

function isDocumentRange(value: unknown): value is DocumentRange {
  if (typeof value !== "object" || value === null) return false;
  const { start, end } = value as DocumentRange;
  return (
    isIndex(start?.line) &&
    isIndex(start?.character) &&
    isIndex(end?.line) &&
    isIndex(end?.character)
  );
}

/** The targets an `openLocation` request carries, malformed entries dropped. */
export function parseTargets(value: unknown): DefinitionTarget[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is DefinitionTarget =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as DefinitionTarget).uri === "string" &&
      isDocumentRange((item as DefinitionTarget).range),
  );
}

interface TargetPick extends vscode.QuickPickItem {
  target: DefinitionTarget;
}

/** The label a target gets in the pick: the path as the workspace knows it, and its line. */
export function targetLabel(target: DefinitionTarget): string {
  const uri = vscode.Uri.parse(target.uri);
  const path =
    uri.scheme === "file"
      ? vscode.workspace.asRelativePath(uri, false)
      : uri.path.replace(/^\//, "");
  return `${path}:${target.range.start.line + 1}`;
}

/**
 * Open a definition in the native editor, always: one target opens at once,
 * several go through a pick listed as path:line, the way the other picks in
 * the extension read. Resolves to whether anything opened.
 */
export async function openLocation(
  targets: readonly DefinitionTarget[],
  pick: (items: TargetPick[]) => Thenable<TargetPick | undefined> = (items) =>
    vscode.window.showQuickPick(items, { placeHolder: "Go to definition" }),
): Promise<boolean> {
  if (targets.length === 0) return false;
  let target: DefinitionTarget | undefined = targets[0];
  if (targets.length > 1) {
    const chosen = await pick(
      targets.map((candidate) => ({
        label: targetLabel(candidate),
        target: candidate,
      })),
    );
    target = chosen?.target;
  }
  if (!target) return false;
  const { start, end } = target.range;
  await vscode.commands.executeCommand(
    "vscode.open",
    vscode.Uri.parse(target.uri),
    {
      selection: new vscode.Range(
        start.line,
        start.character,
        end.line,
        end.character,
      ),
    },
  );
  return true;
}

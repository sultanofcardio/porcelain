import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { noteWrite } from "../../views/diskSync";
import {
  emptyLanguageResult,
  flattenHover,
  flattenLocations,
  openLocation,
  parseLanguageQuery,
  parseTargets,
  runLanguageQuery,
  sideDocumentUri,
  symbolTree,
  targetLabel,
} from "../../views/languageQuery";
import {
  EMPTY_CONTENT_REF,
  WORKING_INDEX_REF,
  WORKING_TREE_REF,
} from "../../views/workingTreeDiffModel";

const range = (
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
) => new vscode.Range(startLine, startCharacter, endLine, endCharacter);

const plain = (
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
) => ({
  start: { line: startLine, character: startCharacter },
  end: { line: endLine, character: endCharacter },
});

describe("parseLanguageQuery: what the webview may ask", () => {
  it("accepts a positioned hover or definition query", () => {
    assert.deepStrictEqual(
      parseLanguageQuery({
        kind: "hover",
        ref: WORKING_TREE_REF,
        path: "src/a.ts",
        line: 3,
        character: 7,
      }),
      {
        kind: "hover",
        ref: WORKING_TREE_REF,
        path: "src/a.ts",
        line: 3,
        character: 7,
      },
    );
    assert.strictEqual(
      parseLanguageQuery({
        kind: "definition",
        ref: "HEAD",
        path: "a.ts",
        line: 0,
        character: 0,
      })?.kind,
      "definition",
    );
  });

  it("needs no position for the outline", () => {
    assert.deepStrictEqual(
      parseLanguageQuery({ kind: "symbols", ref: "HEAD", path: "a.ts" }),
      { kind: "symbols", ref: "HEAD", path: "a.ts", line: 0, character: 0 },
    );
  });

  it("refuses anything malformed rather than guessing", () => {
    for (const params of [
      { kind: "rename", ref: "HEAD", path: "a.ts", line: 0, character: 0 },
      { kind: "hover", ref: "HEAD", path: "", line: 0, character: 0 },
      { kind: "hover", ref: "HEAD", path: "a.ts", line: -1, character: 0 },
      { kind: "hover", ref: "HEAD", path: "a.ts", line: 1.5, character: 0 },
      { kind: "hover", ref: "HEAD", path: "a.ts", line: "1", character: 0 },
      { kind: "hover", ref: "HEAD", path: "a.ts", line: 1 },
      { kind: "hover", ref: 4, path: "a.ts", line: 1, character: 0 },
    ]) {
      assert.strictEqual(
        parseLanguageQuery(params),
        null,
        JSON.stringify(params),
      );
    }
  });
});

describe("sideDocumentUri: the document a diff side is to the providers", () => {
  const repo = { repoId: "/repo", workTreeRoot: "/repo" };

  it("is the file on disk for the working tree", () => {
    const uri = sideDocumentUri(repo, WORKING_TREE_REF, "src/a.ts");
    assert.strictEqual(uri?.scheme, "file");
    assert.strictEqual(uri?.fsPath, path.resolve("/repo", "src/a.ts"));
  });

  it("is the porcelain revision for a ref, the index included", () => {
    const head = sideDocumentUri(repo, "HEAD", "src/a.ts");
    assert.strictEqual(head?.scheme, "porcelain");
    assert.strictEqual(head?.path, "/src/a.ts");
    assert.strictEqual(new URLSearchParams(head?.query).get("ref"), "HEAD");
    assert.strictEqual(new URLSearchParams(head?.query).get("repo"), "/repo");
    assert.strictEqual(
      new URLSearchParams(
        sideDocumentUri(repo, WORKING_INDEX_REF, "a.ts")?.query,
      ).get("ref"),
      WORKING_INDEX_REF,
    );
  });

  it("is nothing for an empty side", () => {
    assert.strictEqual(sideDocumentUri(repo, "", "a.ts"), null);
    assert.strictEqual(sideDocumentUri(repo, EMPTY_CONTENT_REF, "a.ts"), null);
  });

  it("keeps the working-tree read inside the repository", () => {
    assert.throws(() =>
      sideDocumentUri(repo, WORKING_TREE_REF, "../etc/passwd"),
    );
  });
});

describe("emptyLanguageResult", () => {
  it("answers each kind with nothing", () => {
    assert.deepStrictEqual(emptyLanguageResult("hover"), {
      kind: "hover",
      contents: [],
    });
    assert.deepStrictEqual(emptyLanguageResult("definition"), {
      kind: "definition",
      targets: [],
      origin: null,
    });
    assert.deepStrictEqual(emptyLanguageResult("symbols"), {
      kind: "symbols",
      symbols: [],
    });
  });
});

describe("flattenHover: every provider's hover as markdown", () => {
  it("takes markdown strings, plain strings and code objects in order", () => {
    const result = flattenHover([
      new vscode.Hover(
        [
          new vscode.MarkdownString("```typescript\nconst a: number\n```"),
          "Plain *markdown*",
        ],
        range(2, 4, 2, 9),
      ),
      new vscode.Hover({ language: "json", value: '{ "a": 1 }' }),
    ]);
    assert.deepStrictEqual(result, {
      kind: "hover",
      contents: [
        "```typescript\nconst a: number\n```",
        "Plain *markdown*",
        '```json\n{ "a": 1 }\n```',
      ],
    });
  });

  it("drops blank contents", () => {
    const result = flattenHover([
      new vscode.Hover(["", "  \n", new vscode.MarkdownString("")]),
      new vscode.Hover("kept"),
    ]);
    assert.deepStrictEqual(result, {
      kind: "hover",
      contents: ["kept"],
    });
    assert.deepStrictEqual(flattenHover(undefined).contents, []);
    assert.deepStrictEqual(flattenHover(null).contents, []);
  });

  it("fences a code object longer than any backtick run inside it", () => {
    const [content] = flattenHover([
      new vscode.Hover({ language: "md", value: "a ``` b ```` c" }),
    ]).contents;
    assert.strictEqual(content, "`````md\na ``` b ```` c\n`````");
  });
});

describe("flattenLocations: definition answers as targets", () => {
  const uri = vscode.Uri.file("/repo/src/a.ts");
  const other = vscode.Uri.file("/repo/src/b.ts");

  it("prefers a link's selection range and reads its origin", () => {
    const result = flattenLocations([
      {
        originSelectionRange: range(5, 2, 5, 8),
        targetUri: uri,
        targetRange: range(10, 0, 20, 1),
        targetSelectionRange: range(10, 9, 10, 15),
      } satisfies vscode.LocationLink,
      {
        targetUri: other,
        targetRange: range(1, 0, 3, 0),
      } satisfies vscode.LocationLink,
    ]);
    assert.deepStrictEqual(result, {
      kind: "definition",
      targets: [
        { uri: uri.toString(), range: plain(10, 9, 10, 15) },
        { uri: other.toString(), range: plain(1, 0, 3, 0) },
      ],
      origin: plain(5, 2, 5, 8),
    });
  });

  it("takes plain locations, a single one included, and drops duplicates", () => {
    const location = new vscode.Location(uri, range(4, 0, 4, 3));
    assert.deepStrictEqual(flattenLocations([location, location]).targets, [
      { uri: uri.toString(), range: plain(4, 0, 4, 3) },
    ]);
    assert.deepStrictEqual(flattenLocations(location).targets, [
      { uri: uri.toString(), range: plain(4, 0, 4, 3) },
    ]);
    assert.deepStrictEqual(flattenLocations(undefined), {
      kind: "definition",
      targets: [],
      origin: null,
    });
  });
});

describe("symbolTree: the outline as plain nodes", () => {
  it("keeps a DocumentSymbol tree's shape", () => {
    const method = new vscode.DocumentSymbol(
      "handle",
      "",
      vscode.SymbolKind.Method,
      range(3, 2, 8, 3),
      range(3, 8, 3, 14),
    );
    const cls = new vscode.DocumentSymbol(
      "Router",
      "",
      vscode.SymbolKind.Class,
      range(1, 0, 10, 1),
      range(1, 6, 1, 12),
    );
    cls.children = [method];
    assert.deepStrictEqual(symbolTree([cls]), [
      {
        name: "Router",
        kind: vscode.SymbolKind.Class,
        range: plain(1, 0, 10, 1),
        children: [
          {
            name: "handle",
            kind: vscode.SymbolKind.Method,
            range: plain(3, 2, 8, 3),
            children: [],
          },
        ],
      },
    ]);
  });

  it("flattens SymbolInformation to leaves", () => {
    const info = new vscode.SymbolInformation(
      "createRouter",
      vscode.SymbolKind.Function,
      "",
      new vscode.Location(vscode.Uri.file("/repo/a.ts"), range(0, 0, 4, 1)),
    );
    assert.deepStrictEqual(symbolTree([info]), [
      {
        name: "createRouter",
        kind: vscode.SymbolKind.Function,
        range: plain(0, 0, 4, 1),
        children: [],
      },
    ]);
    assert.deepStrictEqual(symbolTree(undefined), []);
  });
});

describe("parseTargets and targetLabel", () => {
  it("keeps well-formed targets and drops the rest", () => {
    const good = { uri: "file:///a.ts", range: plain(1, 2, 1, 5) };
    assert.deepStrictEqual(
      parseTargets([
        good,
        { uri: 3 },
        { uri: "file:///b", range: { start: {} } },
        null,
      ]),
      [good],
    );
    assert.deepStrictEqual(parseTargets("nope"), []);
  });

  it("labels a target as path:line, one-based", () => {
    assert.strictEqual(
      targetLabel({
        uri: "porcelain:/src/a.ts?ref=HEAD",
        range: plain(4, 0, 4, 1),
      }),
      "src/a.ts:5",
    );
    const onDisk = vscode.Uri.file("/somewhere/else/b.ts");
    assert.strictEqual(
      targetLabel({ uri: onDisk.toString(), range: plain(0, 0, 0, 1) }),
      `${vscode.workspace.asRelativePath(onDisk, false)}:1`,
    );
  });
});

/**
 * The channel end to end, against providers registered by the test: the
 * document is opened, the position clamped, each command run, and its
 * answer flattened. Registering our own providers keeps the answers exact
 * and independent of whichever language servers the test host happens to
 * ship or has finished starting.
 */
describe("runLanguageQuery and openLocation in the editor", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const selector: vscode.DocumentSelector = {
    scheme: "file",
    language: "plaintext",
  };
  let dir: string;
  let file: vscode.Uri;
  let target: vscode.Uri;
  const disposables: vscode.Disposable[] = [];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "porcelain-lang-"));
    file = vscode.Uri.file(path.join(dir, "notes.txt"));
    target = vscode.Uri.file(path.join(dir, "target.txt"));
    await fs.writeFile(file.fsPath, "alpha beta\ngamma delta\n");
    await fs.writeFile(target.fsPath, "one\ntwo\nthree\n");
    disposables.push(
      vscode.languages.registerHoverProvider(selector, {
        provideHover(document, position) {
          const word = document.getWordRangeAtPosition(position);
          if (!word) return null;
          return new vscode.Hover(
            new vscode.MarkdownString(`**${document.getText(word)}**`),
            word,
          );
        },
      }),
      vscode.languages.registerDefinitionProvider(selector, {
        provideDefinition(document, position) {
          const word = document.getWordRangeAtPosition(position);
          if (!word) return null;
          const link: vscode.LocationLink = {
            originSelectionRange: word,
            targetUri: target,
            targetRange: range(0, 0, 2, 5),
            targetSelectionRange: range(1, 0, 1, 3),
          };
          return [link];
        },
      }),
      vscode.languages.registerDocumentSymbolProvider(selector, {
        provideDocumentSymbols() {
          const inner = new vscode.DocumentSymbol(
            "gamma",
            "",
            vscode.SymbolKind.Function,
            range(1, 0, 1, 11),
            range(1, 0, 1, 5),
          );
          const outer = new vscode.DocumentSymbol(
            "notes",
            "",
            vscode.SymbolKind.Module,
            range(0, 0, 2, 0),
            range(0, 0, 0, 5),
          );
          outer.children = [inner];
          return [outer];
        },
      }),
    );
  });

  afterEach(async () => {
    for (const disposable of disposables.splice(0)) disposable.dispose();
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  it("answers a hover at a position with the provider's markdown", async function () {
    this.timeout(10000);
    const result = await runLanguageQuery(file, {
      kind: "hover",
      ref: WORKING_TREE_REF,
      path: "notes.txt",
      line: 1,
      character: 7,
    });
    assert.deepStrictEqual(result, {
      kind: "hover",
      contents: ["**delta**"],
    });
  });

  it("answers from the disk after the diff rewrote the file under an open document", async function () {
    this.timeout(15000);
    await vscode.commands.executeCommand("vscode.open", file, {
      preview: false,
    });
    await sleep(300);
    const before = await runLanguageQuery(file, {
      kind: "hover",
      ref: WORKING_TREE_REF,
      path: "notes.txt",
      line: 1,
      character: 7,
    });
    assert.deepStrictEqual(before, { kind: "hover", contents: ["**delta**"] });
    await fs.writeFile(file.fsPath, "alpha beta\nomega sigma\n");
    noteWrite(path.join(dir, "notes.txt"));
    const after = await runLanguageQuery(file, {
      kind: "hover",
      ref: WORKING_TREE_REF,
      path: "notes.txt",
      line: 1,
      character: 7,
    });
    assert.deepStrictEqual(after, { kind: "hover", contents: ["**sigma**"] });
  });

  it("waits for nothing on a file the diff did not just write, mixed line endings included", async function () {
    this.timeout(15000);
    await fs.writeFile(file.fsPath, "alpha beta\r\ngamma delta\nepsilon\n");
    await vscode.commands.executeCommand("vscode.open", file, {
      preview: false,
    });
    await sleep(300);
    const document = vscode.window.activeTextEditor?.document;
    assert.ok(document);
    assert.notStrictEqual(
      document.getText(),
      "alpha beta\r\ngamma delta\nepsilon\n",
    );
    const started = Date.now();
    const result = await runLanguageQuery(file, {
      kind: "hover",
      ref: WORKING_TREE_REF,
      path: "notes.txt",
      line: 1,
      character: 7,
    });
    assert.deepStrictEqual(result, { kind: "hover", contents: ["**delta**"] });
    assert.ok(Date.now() - started < 1000, "answered without a settle wait");
  });

  it("settles a just-written file with mixed line endings once the lines agree", async function () {
    this.timeout(15000);
    await vscode.commands.executeCommand("vscode.open", file, {
      preview: false,
    });
    await sleep(300);
    await fs.writeFile(file.fsPath, "alpha beta\r\nomega sigma\nepsilon\n");
    noteWrite(path.join(dir, "notes.txt"));
    const started = Date.now();
    const result = await runLanguageQuery(file, {
      kind: "hover",
      ref: WORKING_TREE_REF,
      path: "notes.txt",
      line: 1,
      character: 7,
    });
    assert.deepStrictEqual(result, { kind: "hover", contents: ["**sigma**"] });
    assert.ok(Date.now() - started < 1500, "settled before the bound");
  });

  it("clamps a position past the document rather than failing", async function () {
    this.timeout(10000);
    const result = await runLanguageQuery(file, {
      kind: "hover",
      ref: WORKING_TREE_REF,
      path: "notes.txt",
      line: 40,
      character: 400,
    });
    assert.strictEqual(result.kind, "hover");
  });

  it("answers a definition with its targets and origin", async function () {
    this.timeout(10000);
    const result = await runLanguageQuery(file, {
      kind: "definition",
      ref: WORKING_TREE_REF,
      path: "notes.txt",
      line: 0,
      character: 1,
    });
    assert.deepStrictEqual(result, {
      kind: "definition",
      targets: [{ uri: target.toString(), range: plain(1, 0, 1, 3) }],
      origin: plain(0, 0, 0, 5),
    });
  });

  it("answers the outline as a tree", async function () {
    this.timeout(10000);
    const result = await runLanguageQuery(file, {
      kind: "symbols",
      ref: WORKING_TREE_REF,
      path: "notes.txt",
      line: 0,
      character: 0,
    });
    assert.strictEqual(result.kind, "symbols");
    assert.deepStrictEqual(result.kind === "symbols" ? result.symbols : [], [
      {
        name: "notes",
        kind: vscode.SymbolKind.Module,
        range: plain(0, 0, 2, 0),
        children: [
          {
            name: "gamma",
            kind: vscode.SymbolKind.Function,
            range: plain(1, 0, 1, 11),
            children: [],
          },
        ],
      },
    ]);
  });

  it("opens a single target in the native editor at its range", async function () {
    this.timeout(10000);
    const opened = await openLocation([
      { uri: target.toString(), range: plain(1, 0, 1, 3) },
    ]);
    assert.strictEqual(opened, true);
    await sleep(300);
    const editor = vscode.window.activeTextEditor;
    assert.strictEqual(editor?.document.uri.toString(), target.toString());
    assert.deepStrictEqual(
      [
        editor?.selection.start.line,
        editor?.selection.start.character,
        editor?.selection.end.character,
      ],
      [1, 0, 3],
    );
  });

  it("offers several targets as a pick and opens the chosen one", async function () {
    this.timeout(10000);
    const picked: string[] = [];
    const opened = await openLocation(
      [
        { uri: file.toString(), range: plain(0, 0, 0, 5) },
        { uri: target.toString(), range: plain(2, 0, 2, 5) },
      ],
      (items) => {
        picked.push(...items.map((item) => item.label));
        return Promise.resolve(items[1]);
      },
    );
    assert.strictEqual(opened, true);
    assert.deepStrictEqual(picked, [
      `${vscode.workspace.asRelativePath(file, false)}:1`,
      `${vscode.workspace.asRelativePath(target, false)}:3`,
    ]);
    await sleep(300);
    assert.strictEqual(
      vscode.window.activeTextEditor?.document.uri.toString(),
      target.toString(),
    );
    assert.strictEqual(vscode.window.activeTextEditor?.selection.start.line, 2);
  });

  it("opens nothing for no targets or a dismissed pick", async function () {
    this.timeout(10000);
    assert.strictEqual(await openLocation([]), false);
    assert.strictEqual(
      await openLocation(
        [
          { uri: file.toString(), range: plain(0, 0, 0, 1) },
          { uri: target.toString(), range: plain(0, 0, 0, 1) },
        ],
        () => Promise.resolve(undefined),
      ),
      false,
    );
    assert.strictEqual(vscode.window.activeTextEditor, undefined);
  });
});

import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

/**
 * Enumerate every host TypeScript source under src/, excluding src/test/**
 * so test fixtures do not count as production URI constructions. Returns
 * paths relative to the repo root, prefixed with `src/`.
 */
function listHostTsFiles(): string[] {
  // Host tests run under @vscode/test-cli with the repo root as cwd.
  const root = path.join(process.cwd(), "src");
  // recursive read (Node 18.17+/20+); filter to .ts, drop src/test/**.
  const entries = fs.readdirSync(root, { recursive: true }) as string[];
  return entries
    .filter((rel) => rel.endsWith(".ts"))
    .filter((rel) => !rel.split(path.sep).includes("test"))
    .map((rel) => path.join("src", rel));
}

interface DirectUriConstruction {
  file: string;
  line: number;
  source: string;
}

/**
 * Find direct vscode.Uri.parse/Uri.from constructions whose arguments mention
 * the IDEA Git content scheme, including component construction such as
 * `vscode.Uri.from({ scheme: IDEA_GIT_SCHEME, ... })`.
 */
function collectDirectUriConstructions(): DirectUriConstruction[] {
  const out: DirectUriConstruction[] = [];
  for (const rel of listHostTsFiles()) {
    const source = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    const sourceFile = ts.createSourceFile(
      rel,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        (node.expression.name.text === "parse" ||
          node.expression.name.text === "from") &&
        /(?:^|\.)Uri$/.test(node.expression.expression.getText(sourceFile))
      ) {
        const args = node.arguments
          .map((argument) => argument.getText(sourceFile))
          .join(", ");
        if (args.includes("IDEA_GIT_SCHEME") || args.includes("idea-git:")) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile),
          );
          out.push({
            file: rel,
            line: line + 1,
            source: node.getText(sourceFile),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return out;
}

describe("IDEA Git content URI repository binding", () => {
  it("centralizes every direct content URI construction in gitUri.ts", () => {
    const constructions = collectDirectUriConstructions();
    assert.ok(
      constructions.length > 0,
      "URI audit is vacuous — expected at least one direct IDEA Git " +
        "content URI construction in the host sources.",
    );
    const builderFile = path.normalize("src/views/gitUri.ts");
    const offenders = constructions.filter(
      (entry) => path.normalize(entry.file) !== builderFile,
    );
    assert.strictEqual(
      offenders.length,
      0,
      "Construct IDEA Git content URIs through buildGitContentUri instead of " +
        "calling Uri.parse/Uri.from directly:\n" +
        offenders
          .map(
            (entry) =>
              `  ${entry.file}:${entry.line}: ${entry.source.replace(/\s+/g, " ")}`,
          )
          .join("\n"),
    );
  });

  it("buildGitContentUri includes the repository identity", () => {
    const { buildGitContentUri } =
      require("../../views/gitUri") as typeof import("../../views/gitUri");
    const uri = buildGitContentUri("base", "shelved/myshelf/src/a.ts", "RID");
    const params = new URLSearchParams(uri.query);
    assert.strictEqual(params.get("repo"), "RID");
    assert.strictEqual(params.get("ref"), "base");
  });
});

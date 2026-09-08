import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

const HOST_PROTOCOL = "src/messages/protocol.ts";
const WEBVIEW_PROTOCOL = "webview/src/shared/bridge/types.ts";

function sourceFile(relativePath: string): ts.SourceFile {
  const source = fs.readFileSync(
    path.join(process.cwd(), relativePath),
    "utf8",
  );
  return ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function stringUnion(relativePath: string, aliasName: string): string[] {
  const file = sourceFile(relativePath);
  let values: string[] | undefined;
  file.forEachChild((node) => {
    if (
      ts.isTypeAliasDeclaration(node) &&
      node.name.text === aliasName &&
      ts.isUnionTypeNode(node.type)
    ) {
      values = node.type.types.flatMap((member) =>
        ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)
          ? [member.literal.text]
          : [],
      );
    }
  });
  assert.ok(values, `${aliasName} not found in ${relativePath}`);
  return values.sort();
}

function hostEventLiterals(): string[] {
  const srcRoot = path.join(process.cwd(), "src");
  const relativeFiles = (
    fs.readdirSync(srcRoot, { recursive: true }) as string[]
  ).filter(
    (relativePath) =>
      relativePath.endsWith(".ts") &&
      !relativePath.split(path.sep).includes("test"),
  );
  const events = new Set<string>();
  for (const relativePath of relativeFiles) {
    const file = sourceFile(path.join("src", relativePath));
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "broadcastEvent" &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        events.add(node.arguments[0].text);
      }
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(file) === "event" &&
        ts.isStringLiteral(node.initializer)
      ) {
        events.add(node.initializer.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return [...events].sort();
}

describe("host/Webview protocol parity", () => {
  it("keeps command unions synchronized", () => {
    assert.deepStrictEqual(
      stringUnion(HOST_PROTOCOL, "CommandType"),
      stringUnion(WEBVIEW_PROTOCOL, "CommandType"),
    );
  });

  it("keeps the auto-save mode union synchronized", () => {
    assert.deepStrictEqual(
      stringUnion(HOST_PROTOCOL, "AutoSaveMode"),
      stringUnion(WEBVIEW_PROTOCOL, "AutoSaveMode"),
    );
  });

  it("keeps event unions synchronized and covers every emitted host event", () => {
    const hostEvents = stringUnion(HOST_PROTOCOL, "EventType");
    const webviewEvents = stringUnion(WEBVIEW_PROTOCOL, "EventType");
    assert.deepStrictEqual(hostEvents, webviewEvents);

    const missing = hostEventLiterals().filter(
      (event) => !hostEvents.includes(event),
    );
    assert.deepStrictEqual(
      missing,
      [],
      `EventType is missing emitted event(s): ${missing.join(", ")}`,
    );
  });
});

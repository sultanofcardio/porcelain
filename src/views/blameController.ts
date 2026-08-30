import { relative, sep } from "node:path";
import * as vscode from "vscode";
import type { RepoRegistry } from "../git/repoRegistry";
import type { BlameLine, BlameOptions } from "../git/types";

/** How a blame line's age is coloured, mirroring IntelliJ's Colors menu. */
export type BlameColorMode = "author" | "age" | "none";

export interface BlameDisplayOptions extends BlameOptions {
  colorMode?: BlameColorMode;
  /** How the author is written in the gutter. */
  nameStyle?: "initials" | "first" | "last" | "full" | "email";
}

/** Age ramp, newest to oldest — IntelliJ's five annotation colour anchors. */
const AGE_COLORS = [
  "rgba(90, 160, 240, 0.55)",
  "rgba(90, 160, 240, 0.42)",
  "rgba(90, 160, 240, 0.30)",
  "rgba(90, 160, 240, 0.20)",
  "rgba(90, 160, 240, 0.12)",
];

function shortName(
  author: string,
  email: string,
  style: BlameDisplayOptions["nameStyle"],
): string {
  if (style === "email") return email;
  const parts = author.split(/\s+/).filter(Boolean);
  switch (style) {
    case "initials":
      return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
    case "first":
      return parts[0] ?? author;
    case "last":
      return parts[parts.length - 1] ?? author;
    default:
      return author;
  }
}

function formatDate(seconds: number): string {
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Blame rendered as editor decorations: one before-the-line annotation per
 * line, with a hover carrying the commit. VS Code has no annotation gutter of
 * its own, so the column is drawn as `before` content on each line.
 */
export class BlameController implements vscode.Disposable {
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    before: {
      margin: "0 12px 0 0",
      textDecoration: "none; opacity: 0.75;",
    },
  });
  /** Editors currently annotated, by document URI. */
  private readonly annotated = new Set<string>();
  private options: BlameDisplayOptions = {
    colorMode: "age",
    nameStyle: "initials",
  };

  constructor(private readonly repoRegistry: RepoRegistry) {}

  isAnnotated(editor: vscode.TextEditor): boolean {
    return this.annotated.has(editor.document.uri.toString());
  }

  /** Turn annotations on or off for one editor. */
  async toggle(editor: vscode.TextEditor): Promise<void> {
    if (this.isAnnotated(editor)) {
      this.clear(editor);
      return;
    }
    await this.annotate(editor);
  }

  setOptions(options: BlameDisplayOptions): void {
    this.options = { ...this.options, ...options };
  }

  /** Re-render every annotated editor, e.g. after an option changes. */
  async refreshAll(): Promise<void> {
    for (const editor of vscode.window.visibleTextEditors) {
      if (this.isAnnotated(editor)) await this.annotate(editor);
    }
  }

  clear(editor: vscode.TextEditor): void {
    editor.setDecorations(this.decoration, []);
    this.annotated.delete(editor.document.uri.toString());
  }

  /**
   * The repository a file belongs to: the registered root that is a prefix of
   * its path, longest first so a nested repository wins over its parent.
   */
  private repoForDocument(uri: vscode.Uri) {
    if (uri.scheme !== "file") return null;
    const filePath = uri.fsPath;
    const candidates = this.repoRegistry
      .list()
      .filter(
        (repo) =>
          filePath === repo.rootPath ||
          filePath.startsWith(`${repo.rootPath}${sep}`),
      )
      .sort((a, b) => b.rootPath.length - a.rootPath.length);
    const best = candidates[0];
    return best ? (this.repoRegistry.get(best.id) ?? null) : null;
  }

  private async annotate(editor: vscode.TextEditor): Promise<void> {
    const runtime = this.repoForDocument(editor.document.uri);
    if (!runtime) {
      void vscode.window.showInformationMessage(
        "This file is not inside a Git repository.",
      );
      return;
    }
    // git needs the path relative to the repository root, which is not
    // necessarily the workspace folder.
    const relativePath = relative(
      runtime.paths.workTreeRoot,
      editor.document.uri.fsPath,
    );

    let lines: BlameLine[];
    try {
      lines = await runtime.gitService.blameFile(relativePath, this.options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Could not annotate: ${message}`);
      return;
    }

    const now = Date.now() / 1000;
    const decorations = lines.map((line) =>
      this.decorationFor(line, now, editor.document.lineCount),
    );
    editor.setDecorations(
      this.decoration,
      decorations.filter((entry): entry is vscode.DecorationOptions =>
        Boolean(entry),
      ),
    );
    this.annotated.add(editor.document.uri.toString());
  }

  private decorationFor(
    line: BlameLine,
    now: number,
    lineCount: number,
  ): vscode.DecorationOptions | null {
    // A blame result can outrun the buffer if the file changed underneath.
    if (line.line < 1 || line.line > lineCount) return null;
    const zeroBased = line.line - 1;
    const label = line.uncommitted
      ? "Uncommitted"
      : `${shortName(line.author, line.authorEmail, this.options.nameStyle)} ${formatDate(line.authorTime)}`;

    const hover = new vscode.MarkdownString();
    if (line.uncommitted) {
      hover.appendMarkdown("**Not committed yet**");
    } else {
      hover.appendMarkdown(`**${line.summary}**\n\n`);
      hover.appendMarkdown(
        `${line.author} <${line.authorEmail}> · ${formatDate(line.authorTime)}\n\n`,
      );
      hover.appendMarkdown(`\`${line.hash.slice(0, 8)}\``);
    }

    return {
      range: new vscode.Range(zeroBased, 0, zeroBased, 0),
      hoverMessage: hover,
      renderOptions: {
        before: {
          contentText: label,
          color: this.colorFor(line, now),
        },
      },
    };
  }

  private colorFor(line: BlameLine, now: number): string | undefined {
    if (this.options.colorMode === "none" || line.uncommitted) {
      return new vscode.ThemeColor("editorLineNumber.foreground") as never;
    }
    if (this.options.colorMode === "author") {
      // A stable colour per author: the hash of the name picks the bucket.
      let hash = 0;
      for (const char of line.authorEmail || line.author) {
        hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
      }
      return AGE_COLORS[hash % AGE_COLORS.length];
    }
    // Age: newer lines are stronger. The buckets step at a week, a month, a
    // quarter and a year.
    const ageDays = (now - line.authorTime) / 86400;
    const bucket =
      ageDays < 7
        ? 0
        : ageDays < 30
          ? 1
          : ageDays < 90
            ? 2
            : ageDays < 365
              ? 3
              : 4;
    return AGE_COLORS[bucket];
  }

  dispose(): void {
    this.decoration.dispose();
    this.annotated.clear();
  }
}

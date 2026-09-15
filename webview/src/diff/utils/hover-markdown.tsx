import { Lexer, type Token, type Tokens } from "marked";
import type { ReactNode } from "react";
import type { Highlighter } from "shiki";
import { normalizeLanguage, shikiTheme } from "./highlight";

/**
 * Provider markdown, rendered to a restricted DOM.
 *
 * VS Code's hover widget runs a vendored copy of marked through its own
 * sanitiser; both live in the renderer process with no API to extensions,
 * so the diff viewer ships the published package and mirrors the approach.
 * marked only tokenises here. The tokens are turned into React elements by
 * the allow-list below, so no HTML string is ever built or injected: raw
 * HTML in the source is a token this renderer drops, a link is an anchor
 * only for the schemes the webview host opens externally, and everything
 * else becomes text.
 */

export interface MarkdownContext {
  /** The Shiki singleton, for fenced code; null renders code plain. */
  highlighter: Highlighter | null;
}

const LINK_SCHEMES = /^(https?:|mailto:)/i;

/** Whether an anchor may carry `href`: what the webview host opens. */
export function isAllowedLink(href: string): boolean {
  return LINK_SCHEMES.test(href.trim());
}

/** The elements for one markdown string. */
export function renderMarkdown(
  source: string,
  context: MarkdownContext,
): ReactNode {
  const tokens = Lexer.lex(source, { gfm: true });
  return blocks(tokens, context, "b");
}

function blocks(
  tokens: readonly Token[],
  context: MarkdownContext,
  prefix: string,
): ReactNode[] {
  const out: ReactNode[] = [];
  tokens.forEach((token, index) => {
    const node = block(token, context, `${prefix}${index}`);
    if (node !== null) out.push(node);
  });
  return out;
}

function block(
  token: Token,
  context: MarkdownContext,
  key: string,
): ReactNode | null {
  switch (token.type) {
    case "space":
    case "def":
    case "html":
    case "checkbox":
      return null;
    case "hr":
      return <hr key={key} />;
    case "heading": {
      const heading = token as Tokens.Heading;
      return (
        <p
          key={key}
          className={`diff-hover-heading diff-hover-h${heading.depth}`}
        >
          {inline(heading.tokens, context, key)}
        </p>
      );
    }
    case "code":
      return codeBlock(token as Tokens.Code, context, key);
    case "blockquote":
      return (
        <blockquote key={key}>
          {blocks((token as Tokens.Blockquote).tokens, context, key)}
        </blockquote>
      );
    case "list":
      return list(token as Tokens.List, context, key);
    case "table":
      return table(token as Tokens.Table, context, key);
    case "paragraph":
      return (
        <p key={key}>
          {inline((token as Tokens.Paragraph).tokens, context, key)}
        </p>
      );
    case "text": {
      // A tight list item carries its text as a bare block token.
      const text = token as Tokens.Text;
      return (
        <span key={key}>
          {text.tokens ? inline(text.tokens, context, key) : text.text}
        </span>
      );
    }
    default:
      // A token this renderer does not know renders as its source text,
      // which shows the reader something rather than nothing.
      return <p key={key}>{token.raw}</p>;
  }
}

function list(token: Tokens.List, context: MarkdownContext, key: string) {
  const items = token.items.map((item, index) => (
    <li key={`${key}i${index}`}>
      {blocks(item.tokens, context, `${key}i${index}`)}
    </li>
  ));
  return token.ordered ? (
    <ol
      key={key}
      start={typeof token.start === "number" ? token.start : undefined}
    >
      {items}
    </ol>
  ) : (
    <ul key={key}>{items}</ul>
  );
}

function table(token: Tokens.Table, context: MarkdownContext, key: string) {
  return (
    <table key={key}>
      <thead>
        <tr>
          {token.header.map((cell, index) => (
            <th key={`${key}h${index}`} style={alignment(cell.align)}>
              {inline(cell.tokens, context, `${key}h${index}`)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {token.rows.map((row, rowIndex) => (
          <tr key={`${key}r${rowIndex}`}>
            {row.map((cell, index) => (
              <td
                key={`${key}r${rowIndex}c${index}`}
                style={alignment(cell.align)}
              >
                {inline(cell.tokens, context, `${key}r${rowIndex}c${index}`)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function alignment(align: "center" | "left" | "right" | null) {
  return align ? { textAlign: align } : undefined;
}

/**
 * A fenced block, coloured through the same Shiki singleton the panes use
 * when its language is one Shiki was loaded with; anything else stays
 * plain. Plain beats wrong: colouring an unknown language with another's
 * grammar looks authoritative and is not.
 */
function codeBlock(token: Tokens.Code, context: MarkdownContext, key: string) {
  const code = token.text.replace(/\n$/, "");
  const language = normalizeLanguage(token.lang?.trim().split(/\s+/)[0] ?? "");
  let lines: ReactNode[] | null = null;
  if (context.highlighter && language !== "text" && code !== "") {
    try {
      const result = context.highlighter.codeToTokens(code, {
        lang: language,
        theme: shikiTheme(),
      });
      lines = result.tokens.map((line, lineIndex) => (
        <span key={`${key}l${lineIndex}`} className="diff-hover-code-line">
          {line.map((piece, pieceIndex) => (
            <span
              key={`${key}l${lineIndex}p${pieceIndex}`}
              style={piece.color ? { color: piece.color } : undefined}
            >
              {piece.content}
            </span>
          ))}
        </span>
      ));
    } catch {
      lines = null;
    }
  }
  return (
    <pre key={key} className="diff-hover-code">
      <code>{lines ?? code}</code>
    </pre>
  );
}

function inline(
  tokens: readonly Token[],
  context: MarkdownContext,
  prefix: string,
): ReactNode[] {
  const out: ReactNode[] = [];
  tokens.forEach((token, index) => {
    const node = inlineToken(token, context, `${prefix}n${index}`);
    if (node !== null) out.push(node);
  });
  return out;
}

function inlineToken(
  token: Token,
  context: MarkdownContext,
  key: string,
): ReactNode | null {
  switch (token.type) {
    case "html":
    case "checkbox":
      return null;
    case "escape":
      return (token as Tokens.Escape).text;
    case "text": {
      const text = token as Tokens.Text;
      return text.tokens ? (
        <span key={key}>{inline(text.tokens, context, key)}</span>
      ) : (
        text.text
      );
    }
    case "br":
      return <br key={key} />;
    case "codespan":
      return <code key={key}>{(token as Tokens.Codespan).text}</code>;
    case "strong":
      return (
        <strong key={key}>
          {inline((token as Tokens.Strong).tokens, context, key)}
        </strong>
      );
    case "em":
      return (
        <em key={key}>{inline((token as Tokens.Em).tokens, context, key)}</em>
      );
    case "del":
      return (
        <del key={key}>
          {inline((token as Tokens.Del).tokens, context, key)}
        </del>
      );
    case "link": {
      const link = token as Tokens.Link;
      const children = inline(link.tokens, context, key);
      if (!isAllowedLink(link.href)) return <span key={key}>{children}</span>;
      return (
        <a key={key} href={link.href} title={link.title ?? undefined}>
          {children}
        </a>
      );
    }
    case "image":
      // No images: the CSP admits none from a provider, and the alt text
      // is what the reader would get anyway.
      return (token as Tokens.Image).text;
    default:
      return token.raw;
  }
}

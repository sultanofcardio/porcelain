import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { isAllowedLink, renderMarkdown } from "./hover-markdown";

function show(source: string) {
  return render(<div>{renderMarkdown(source, { highlighter: null })}</div>)
    .container;
}

describe("renderMarkdown: provider markdown behind an allow-list", () => {
  afterEach(cleanup);

  it("renders the shapes a hover uses: a fenced signature, prose, emphasis, code", () => {
    const container = show(
      "```typescript\n(method) Response.setHeader(name: string): this\n```\n\nSets a *single* **header** value for the `header` object.\n\n@since v0.4.0",
    );
    const pre = container.querySelector("pre.diff-hover-code code");
    expect(pre?.textContent).toBe(
      "(method) Response.setHeader(name: string): this",
    );
    expect(container.querySelector("em")?.textContent).toBe("single");
    expect(container.querySelector("strong")?.textContent).toBe("header");
    expect(container.querySelector("p code")?.textContent).toBe("header");
    expect(container.textContent).toContain("@since v0.4.0");
  });

  it("drops raw HTML rather than rendering it", () => {
    const container = show(
      'Before <img src="x" onerror="alert(1)"> after\n\n<script>alert(2)</script>\n\n<b>bold</b> text',
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).not.toContain("onerror");
    expect(container.textContent).toContain("Before  after");
    expect(container.textContent).toContain(" text");
  });

  it("links only to what the webview host opens, and keeps other link text plain", () => {
    const container = show(
      "[docs](https://nodejs.org/api) and [mail](mailto:a@b.c) and [run](command:workbench.action.reloadWindow) and [js](javascript:alert(1))",
    );
    const anchors = [...container.querySelectorAll("a")];
    expect(anchors.map((a) => a.getAttribute("href"))).toEqual([
      "https://nodejs.org/api",
      "mailto:a@b.c",
    ]);
    expect(container.textContent).toContain("run");
    expect(container.textContent).toContain("js");
  });

  it("keeps codespan characters literal and honours escapes", () => {
    const container = show("a `x < y && z` b \\*not emphasis\\*");
    expect(container.querySelector("code")?.textContent).toBe("x < y && z");
    expect(container.textContent).toContain("*not emphasis*");
    expect(container.querySelector("em")).toBeNull();
  });

  it("renders lists, headings, quotes, rules and tables", () => {
    const container = show(
      "# Title\n\n- one\n- two\n\n1. first\n\n> quoted\n\n---\n\n| a | b |\n| - | - |\n| 1 | 2 |",
    );
    expect(container.querySelector(".diff-hover-heading")?.textContent).toBe(
      "Title",
    );
    expect(
      [...container.querySelectorAll("ul li")].map((li) => li.textContent),
    ).toEqual(["one", "two"]);
    expect(container.querySelector("ol li")?.textContent).toBe("first");
    expect(container.querySelector("blockquote")?.textContent).toBe("quoted");
    expect(container.querySelector("hr")).not.toBeNull();
    expect(container.querySelector("td")?.textContent).toBe("1");
  });

  it("shows an image's alt text and never an image", () => {
    const container = show("![diagram](https://x.y/z.png)");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("diagram");
  });
});

describe("isAllowedLink", () => {
  it("admits http, https and mailto only", () => {
    expect(isAllowedLink("https://a.b")).toBe(true);
    expect(isAllowedLink("HTTP://a.b")).toBe(true);
    expect(isAllowedLink(" mailto:x@y.z")).toBe(true);
    expect(isAllowedLink("command:foo")).toBe(false);
    expect(isAllowedLink("javascript:alert(1)")).toBe(false);
    expect(isAllowedLink("file:///etc/passwd")).toBe(false);
    expect(isAllowedLink("relative/path")).toBe(false);
  });
});

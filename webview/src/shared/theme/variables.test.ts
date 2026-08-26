import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(
  resolve(process.cwd(), "src/shared/theme/variables.css"),
  "utf8",
);

function ruleBody(selector: RegExp): string | undefined {
  return stylesheet.match(selector)?.[1];
}

describe("commit reachability theme", () => {
  it("dims commits outside the current branch instead of tinting the rest", () => {
    const dimRule = ruleBody(/\.commit-row\.not-reachable\s*\{([\s\S]*?)\}/);

    expect(dimRule).toContain("opacity: var(--unreachable-opacity");
    expect(stylesheet).toMatch(/--unreachable-opacity:\s*0?\.\d+;/);
    // Backgrounds would be overridden in forced-colors mode; opacity survives.
    expect(dimRule).not.toContain("background");
  });

  it("never dims the row the user selected", () => {
    const selectedDim = ruleBody(
      /\.commit-row\.not-reachable\.selected\s*\{([\s\S]*?)\}/,
    );

    expect(selectedDim).toContain("opacity: 1");
    expect(
      stylesheet.indexOf(".commit-row.not-reachable.selected"),
    ).toBeGreaterThan(stylesheet.indexOf(".commit-row.not-reachable {"));
  });

  it("takes hover and selection from the editor theme rather than a fixed hue", () => {
    const hoverRule = ruleBody(
      /\.commit-row:hover:not\(\.selected\)\s*\{([\s\S]*?)\}/,
    );
    const selectedRule = ruleBody(
      /\.selectable-row\.selected\s*\{([\s\S]*?)\}/,
    );

    expect(hoverRule).toContain("background: var(--hover-bg)");
    expect(selectedRule).toContain("background: var(--selected-bg)");
  });

  it("keeps no blue wash over reachable commits", () => {
    expect(stylesheet).not.toContain("--current-reachable-bg");
    expect(stylesheet).not.toContain("--commit-row-hover-bg");
    // The washes were the only place a focus-border hue was mixed into a fill.
    expect(stylesheet).not.toMatch(/color-mix\([\s\S]*?--vscode-focusBorder/);
  });

  it("outlines a selected commit", () => {
    const selectedRule = ruleBody(
      /\.commit-row\.selected[\s\S]*?\{([\s\S]*?)\}/,
    );

    expect(selectedRule).toMatch(
      /outline:\s*1px solid\s+var\(--vscode-list-focusOutline,\s*var\(--vscode-focusBorder,\s*#007fd4\)\)/,
    );
    expect(selectedRule).toContain("outline-offset: -1px");
  });

  it("preserves a stronger selected outline in high contrast mode", () => {
    const highContrast = ruleBody(
      /body\.vscode-high-contrast \.commit-row\.selected\s*\{([\s\S]*?)\}/,
    );
    const forcedColors = ruleBody(
      /@media \(forced-colors: active\)\s*\{\s*\.commit-row\.selected\s*\{([\s\S]*?)\}/,
    );

    for (const rule of [highContrast, forcedColors]) {
      expect(rule).toContain("outline: 2px solid");
      expect(rule).toContain("outline-offset: -2px");
    }
  });
});

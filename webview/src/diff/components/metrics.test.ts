import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLineMeasurer,
  GUTTER_GAP,
  gutterMetrics,
  measureCharWidth,
  paneContentWidth,
  widestLine,
  widestLineWidth,
} from "./metrics";

describe("gutterMetrics", () => {
  it("keeps the familiar proportions for files up to four digits", () => {
    expect(gutterMetrics(1).numberWidth).toBe(gutterMetrics(9999).numberWidth);
  });

  it("widens the columns once line numbers pass four digits", () => {
    // The rough edge this closes: a fixed 26px column crowded past 9999.
    expect(gutterMetrics(10000).numberWidth).toBeGreaterThan(
      gutterMetrics(9999).numberWidth,
    );
    expect(gutterMetrics(100000).numberWidth).toBeGreaterThan(
      gutterMetrics(10000).numberWidth,
    );
  });

  it("moves the gap with the columns so the bend zone stays gap-wide", () => {
    const metrics = gutterMetrics(123456);
    expect(metrics.gapStart).toBe(metrics.numberWidth);
    expect(metrics.gapEnd - metrics.gapStart).toBe(GUTTER_GAP);
    expect(metrics.width).toBe(metrics.numberWidth * 2 + GUTTER_GAP);
  });

  it("never narrows below the four-digit floor", () => {
    expect(gutterMetrics(0).numberWidth).toBeGreaterThanOrEqual(26);
  });
});

describe("widestLine", () => {
  it("is the longest line in visual cells, not code units", () => {
    expect(widestLine([])).toBe(0);
    expect(widestLine(["", "abc", "ab"])).toBe(3);
    // A tab runs to the next stop of eight; a surrogate pair is one cell.
    expect(widestLine(["\tx"])).toBe(9);
    expect(widestLine(["a\tb", "abcdefghij"])).toBe(10);
    expect(widestLine(["😀😀"])).toBe(2);
  });
});

describe("paneContentWidth", () => {
  it("adds the text inset on both sides and rounds up to whole pixels", () => {
    expect(paneContentWidth(0)).toBe(20);
    expect(paneContentWidth(72)).toBe(92);
    expect(paneContentWidth(21.6)).toBe(42);
  });
});

/**
 * A stand-in for canvas text measurement: one unit per ASCII character, two
 * per full-width East Asian character — the ratio a monospace face actually
 * paints, and the one the cell count gets wrong.
 */
function stubMeasurer(calls: string[] = []) {
  return (line: string) => {
    calls.push(line);
    let width = 0;
    for (const char of line) width += char.charCodeAt(0) > 0x2e7f ? 2 : 1;
    return width;
  };
}

describe("widestLineWidth", () => {
  const CHAR_WIDTH = 1;

  it("falls back to the cell estimate with nothing to measure with", () => {
    expect(widestLineWidth(["abc", "ab"], 7.2, null)).toBeCloseTo(3 * 7.2);
  });

  it("picks the row that renders widest, not the one with most cells", () => {
    // 100 full-width glyphs paint 200 units; 150 ASCII characters paint 150.
    // By cells the ASCII line looks wider, and a pane sized to it would cut
    // the CJK line off 50 units short.
    const cjk = "中".repeat(100);
    const ascii = "a".repeat(150);
    expect(widestLine([ascii, cjk]) * CHAR_WIDTH).toBe(150);
    expect(widestLineWidth([ascii, cjk], CHAR_WIDTH, stubMeasurer())).toBe(200);
  });

  it("stops once no remaining row could beat the widest found", () => {
    // The 100-cell row cannot reach 400 units even at the wide-glyph bound,
    // so it and every narrower row are skipped.
    const calls: string[] = [];
    const lines = [
      "中".repeat(200),
      ...Array.from({ length: 500 }, (_, i) => "a".repeat(100 - (i % 50))),
    ];
    expect(widestLineWidth(lines, CHAR_WIDTH, stubMeasurer(calls))).toBe(400);
    expect(calls.length).toBe(1);
  });
});

describe("createLineMeasurer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("expands tabs to their stops before measuring", () => {
    // The rows are `white-space: pre`: a tab has no width of its own, it
    // advances to the next eight-column stop.
    const measured: string[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          font: "",
          measureText: (text: string) => {
            measured.push(text);
            return { width: text.length };
          },
        }) as unknown as CanvasRenderingContext2D,
    );
    const measure = createLineMeasurer(document.body);
    expect(measure?.("\tx")).toBe(9);
    expect(measure?.("ab\tc")).toBe(9);
    expect(measured).toEqual(["        x", "ab      c"]);
  });

  it("is null where nothing can be measured", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(createLineMeasurer(document.body)).toBeNull();
  });
});

describe("measureCharWidth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("measures a cell in the editor font the custom properties name", () => {
    // The element's own computed font is the UI face; the rows render in the
    // editor face, and only a cell measured there matches them.
    let font = "";
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          set font(value: string) {
            font = value;
          },
          get font() {
            return font;
          },
          measureText: () => ({ width: font === "12px TestMono" ? 7 : 9 }),
        }) as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          fontSize: "13px",
          fontFamily: "UISans",
          getPropertyValue: (name: string) =>
            name === "--editor-font-size"
              ? "12px"
              : name === "--editor-font"
                ? "TestMono"
                : "",
        }) as unknown as CSSStyleDeclaration,
    );
    expect(measureCharWidth(document.body)).toBe(7);
  });

  it("is null where nothing can be measured", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(measureCharWidth(document.body)).toBeNull();
  });
});

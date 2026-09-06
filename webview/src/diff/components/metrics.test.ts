import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLineMeasurer,
  GUTTER_GAP,
  gutterMetrics,
  type LineMeasurer,
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

  it("never measures a document of ASCII code", () => {
    // ASCII advances one cell per code unit in the monospace face, so the
    // cell count is already the width and nothing needs the canvas.
    const calls: string[] = [];
    const lines = Array.from({ length: 200 }, (_, i) => "a".repeat(200 - i));
    expect(widestLineWidth(lines, 2, stubMeasurer(calls))).toBe(400);
    expect(calls).toEqual([]);
  });

  it("measures only the rows a cell count cannot describe", () => {
    const cjk = "中".repeat(60);
    const ascii = Array.from({ length: 100 }, () => "a".repeat(100));
    const calls: string[] = [];
    // The CJK row paints 120 against the ASCII rows' 100, so it wins — and
    // it is the only row of the 101 that the canvas is asked about.
    expect(
      widestLineWidth([...ascii, cjk], CHAR_WIDTH, stubMeasurer(calls)),
    ).toBe(120);
    expect(calls).toEqual([cjk]);

    // Against ASCII rows of 200 the same row cannot reach the wide-glyph
    // bound, so it is skipped and the ASCII width stands.
    const wider = Array.from({ length: 100 }, () => "a".repeat(200));
    const skipped: string[] = [];
    expect(
      widestLineWidth([...wider, cjk], CHAR_WIDTH, stubMeasurer(skipped)),
    ).toBe(200);
    expect(skipped).toEqual([]);
  });

  it("measures a line once however often the width is recomputed", () => {
    // Every keystroke on an editable side recomputes the whole document's
    // width; only the edited line is new.
    let measured = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          font: "",
          measureText: (text: string) => {
            measured += 1;
            return { width: text.length * 2 };
          },
        }) as unknown as CanvasRenderingContext2D,
    );
    try {
      const measure = createLineMeasurer(document.body) as LineMeasurer;
      measured = 0; // the tab width the measurer takes at creation
      const lines = ["中".repeat(10), "中".repeat(9), "a".repeat(5)];
      expect(widestLineWidth(lines, CHAR_WIDTH, measure)).toBe(20);
      expect(measured).toBe(2); // the two rows the cell count cannot describe
      expect(widestLineWidth(lines, CHAR_WIDTH, measure)).toBe(20);
      expect(measured).toBe(2); // the same rows, remembered
    } finally {
      vi.restoreAllMocks();
    }
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

  /** A canvas whose face paints two units per wide glyph, one per ASCII. */
  function stubCanvas() {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          font: "",
          measureText: (text: string) => {
            let width = 0;
            for (const char of text) {
              width += char.charCodeAt(0) > 0x2e7f ? 2 : 1;
            }
            return { width };
          },
        }) as unknown as CanvasRenderingContext2D,
    );
  }

  it("advances a tab to its stop in rendered space, not in cells", () => {
    // The rows are `white-space: pre`: a tab has no width of its own, it
    // advances to the next stop, and the stop is a multiple of eight *space
    // advances*. Once a row carries glyphs wider than one advance the two
    // coordinates part company, and only the rendered one is the row's width.
    stubCanvas();
    const measure = createLineMeasurer(document.body) as LineMeasurer;
    // Four full-width glyphs sit at 8 advances, exactly on a stop: the tab
    // still takes a whole tab width, to 16, and `value` follows.
    expect(measure("数据处理\tvalue")).toBe(16 + 5);
    // The cell count of that same line is 4 + tab + 5, which would put the
    // tab stop at 8 and the row at 13 — 8 advances short of what it paints.
    expect(measure("ab\tc")).toBe(9);
    expect(measure("\tx")).toBe(9);
    // A tab already flush against a stop advances a full tab width.
    expect(measure("abcdefgh\tx")).toBe(17);
    expect(measure("value")).toBe(5);
  });

  it("measures a line's prefix in rendered space", () => {
    // A find match past a run of full-width glyphs paints twice as far along
    // as its column count says; the reveal has to aim at the rendered x.
    stubCanvas();
    const measure = createLineMeasurer(document.body) as LineMeasurer;
    const line = `${"中".repeat(200)}needle`;
    expect(measure.prefix(line, 200)).toBe(400);
    expect(measure.prefix(line, 206)).toBe(406);
    // A prefix ending right after a tab lands on the tab stop.
    expect(measure.prefix("数据处理\tvalue", 5)).toBe(16);
    expect(measure.prefix("ab\tc", 0)).toBe(0);
  });

  it("keeps prefixes out of the whole-line cache", () => {
    let measured = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          font: "",
          measureText: (text: string) => {
            measured += 1;
            return { width: text.length };
          },
        }) as unknown as CanvasRenderingContext2D,
    );
    const measure = createLineMeasurer(document.body) as LineMeasurer;
    measured = 0; // the tab width the measurer takes at creation
    measure.prefix("abcdef", 3);
    measure.prefix("abcdef", 3);
    // Asked twice, measured twice: a prefix is never remembered…
    expect(measured).toBe(2);
    measure("abcdef");
    measure("abcdef");
    // …while a whole line still is.
    expect(measured).toBe(3);
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

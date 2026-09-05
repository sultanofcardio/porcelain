import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GUTTER_GAP,
  gutterMetrics,
  measureCharWidth,
  paneContentWidth,
  widestLine,
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
    expect(paneContentWidth(0, 7.2)).toBe(20);
    expect(paneContentWidth(10, 7.2)).toBe(92);
    expect(paneContentWidth(3, 7.2)).toBe(42);
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

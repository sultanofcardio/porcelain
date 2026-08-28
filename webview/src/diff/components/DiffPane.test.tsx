import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { computeChunks } from "../utils/diff-model";
import { DiffPane } from "./DiffPane";

const left = ["alpha", "beta", "gamma", "delta", "epsilon"];
const right = ["alpha", "BETA", "gamma", "delta", "epsilon"];
const chunks = computeChunks(`${left.join("\n")}\n`, `${right.join("\n")}\n`);

function renderPane(overrides: Partial<Parameters<typeof DiffPane>[0]> = {}) {
  return render(
    <DiffPane
      side="left"
      lines={left}
      counterpart={right}
      chunks={chunks}
      language="typescript"
      granularity="word"
      offset={0}
      visibleLines={10}
      {...overrides}
    />,
  );
}

describe("DiffPane", () => {
  afterEach(cleanup);

  // Syntax highlighting loads asynchronously and splits a line into several
  // spans once it arrives, so assertions read whole-row text rather than
  // looking for a single element holding the string.
  const textOf = (container: HTMLElement) =>
    [...container.querySelectorAll(".diff-line")].map((row) => row.textContent);

  it("renders the visible window of lines", () => {
    const { container } = renderPane();
    expect(textOf(container)).toEqual(left);
  });

  it("renders nothing when the viewport has no height yet", () => {
    // The regression this pins: the viewport was measured before it mounted,
    // so `visibleLines` stayed 0 and the panes rendered into a clipped box.
    // Two rows is the floor the window deliberately keeps, not a full pane.
    const { container } = renderPane({ visibleLines: 0 });
    expect(container.querySelectorAll(".diff-line").length).toBe(2);
  });

  it("marks the changed line and leaves the unchanged ones plain", () => {
    const { container } = renderPane();
    const rows = [...container.querySelectorAll(".diff-line")];
    expect(rows[1].className).toContain("diff-line-modified");
    expect(rows[0].className).toContain("diff-line-equal");
  });

  it("windows to the offset instead of rendering the whole file", () => {
    const many = Array.from({ length: 500 }, (_, i) => `line ${i}`);
    const { container } = renderPane({
      lines: many,
      counterpart: many,
      chunks: computeChunks(`${many.join("\n")}\n`, `${many.join("\n")}\n`),
      offset: 200,
      visibleLines: 10,
    });
    const text = textOf(container);
    expect(text.length).toBeLessThan(20);
    expect(text).toContain("line 200");
    expect(text).not.toContain("line 0");
  });

  it("offsets by the fractional part so scrolling is smooth, not stepped", () => {
    const { container } = renderPane({ offset: 2.5 });
    const inner = container.querySelector(".diff-pane-lines") as HTMLElement;
    expect(inner.style.transform).toBe("translateY(-10px)");
  });

  it("leaves added lines to the row background instead of double-painting them", () => {
    // A wholly new line is already marked by its row background; highlighting
    // every token on top of that paints the row twice and leaves gaps between
    // the spans.
    const base = ["a", "b"];
    const withAdd = ["a", "inserted", "b"];
    const { container } = renderPane({
      lines: withAdd,
      counterpart: base,
      side: "right",
      chunks: computeChunks(`${base.join("\n")}\n`, `${withAdd.join("\n")}\n`),
    });
    const addedRow = container.querySelector(".diff-line-added");
    expect(addedRow).toBeTruthy();
    expect(addedRow?.querySelector(".diff-changed")).toBeNull();
  });

  it("still highlights the edited part of a modified line", () => {
    const { container } = renderPane();
    const modified = container.querySelector(".diff-line-modified");
    expect(modified?.querySelector(".diff-changed")).toBeTruthy();
  });

  it("marks where an insertion lands on the side that has no lines for it", () => {
    // Without this the connector tapers to a point at the gutter edge and the
    // left pane gives no clue where the new lines go.
    const base = ["a", "b"];
    const withAdd = ["a", "x", "y", "b"];
    const { container } = renderPane({
      side: "left",
      lines: base,
      counterpart: withAdd,
      chunks: computeChunks(`${base.join("\n")}\n`, `${withAdd.join("\n")}\n`),
    });
    const anchor = container.querySelector(".diff-anchor-added");
    expect(anchor).toBeTruthy();
    // Anchored at left line 1, the boundary the insertion sits at.
    expect((anchor as HTMLElement).style.top).toBe("20px");
  });

  it("does not mark a side that already has lines for the chunk", () => {
    const { container } = renderPane();
    expect(container.querySelector(".diff-anchor")).toBeNull();
  });

  it("survives an empty side, which is how an added file diffs", () => {
    const { container } = renderPane({ lines: [], counterpart: right });
    expect(container.querySelectorAll(".diff-line").length).toBe(0);
  });
});

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock("../shared/bridge", () => ({
  bridge: { request: mocks.request, onEvent: vi.fn(() => () => {}) },
}));

import { WORKING_TREE_REF } from "../shared/bridge/types";
import { useDiffStore } from "../shared/store/diff-store";
import { DiffApp } from "./App";
import {
  gutterMetrics,
  LINE_HEIGHT,
  PANE_TEXT_PADDING,
} from "./components/metrics";
import { caretAt } from "./editor/editor-model";

const pristine = useDiffStore.getState();

// Long enough that a caret can walk well past the bottom of the viewport,
// with one line wide enough that it walks off the right edge too.
const WIDE = "x".repeat(400);
const body = Array.from({ length: 200 }, (_, i) =>
  i === 2 ? WIDE : `line ${i}`,
);
const leftText = `${body.join("\n")}\n`;
const rightText = `${body.map((l, i) => (i === 5 ? "changed" : l)).join("\n")}\n`;

/** The first source line a pane is showing, 1-based, as its rows announce it. */
function firstLineOf(pane: Element): number {
  const label = pane.querySelector(".diff-sr-only")?.textContent ?? "";
  return Number(/Line (\d+)/.exec(label)?.[1] ?? 0);
}

describe("revealing a read-only caret", () => {
  beforeEach(() => {
    useDiffStore.setState(pristine, true);
    useDiffStore.setState({ collapseUnchanged: false });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    // jsdom lays nothing out, so the viewport would measure zero rows and
    // every follow effect would bow out before doing anything.
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      value: 500,
    });
    const root = document.createElement("div");
    root.id = "root";
    root.dataset.diffPath = "a.txt";
    root.dataset.leftRef = "HEAD";
    root.dataset.rightRef = WORKING_TREE_REF;
    document.body.appendChild(root);
    mocks.request.mockImplementation((command: string) => {
      if (command === "getDiffSides") {
        return Promise.resolve({
          kind: "text",
          left: leftText,
          right: rightText,
          filePath: "a.txt",
          leftRef: "HEAD",
          rightRef: WORKING_TREE_REF,
          leftLabel: "HEAD",
          rightLabel: "Working tree",
          language: "plaintext",
        });
      }
      return Promise.resolve(undefined);
    });
  });

  afterEach(() => {
    cleanup();
    document.getElementById("root")?.remove();
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    vi.unstubAllGlobals();
    mocks.request.mockReset();
  });

  it("brings a first change below the fold into view, two rows above it", async () => {
    const changed = body.map((line, i) => (i === 100 ? "changed" : line));
    mocks.request.mockImplementation((command: string) =>
      command === "getDiffSides"
        ? Promise.resolve({
            kind: "text",
            left: leftText,
            right: `${changed.join("\n")}\n`,
            filePath: "a.txt",
            leftRef: "HEAD",
            rightRef: WORKING_TREE_REF,
            leftLabel: "HEAD",
            rightLabel: "Working tree",
            language: "plaintext",
          })
        : Promise.resolve(undefined),
    );
    render(<DiffApp />);
    await waitFor(() => expect(useDiffStore.getState().loading).toBe(false));

    const viewport = screen.getByRole("region", { name: "Diff of a.txt" });
    await waitFor(() =>
      expect(viewport.scrollTop).toBe((100 - 2) * LINE_HEIGHT),
    );
  });

  it("stays where the reader left it when the banner reloads the same file", async () => {
    const changed = body.map((line, i) => (i === 100 ? "changed" : line));
    const sides = {
      kind: "text",
      left: leftText,
      right: `${changed.join("\n")}\n`,
      filePath: "a.txt",
      leftRef: "HEAD",
      rightRef: WORKING_TREE_REF,
      leftLabel: "HEAD",
      rightLabel: "Working tree",
      language: "plaintext",
    };
    mocks.request.mockImplementation((command: string) =>
      Promise.resolve(command === "getDiffSides" ? sides : undefined),
    );
    render(<DiffApp />);
    await waitFor(() => expect(useDiffStore.getState().loading).toBe(false));

    const viewport = screen.getByRole("region", { name: "Diff of a.txt" });
    await waitFor(() =>
      expect(viewport.scrollTop).toBe((100 - 2) * LINE_HEIGHT),
    );

    // The reader reads on somewhere else, then takes the banner's offer.
    act(() => {
      viewport.scrollTop = 40 * LINE_HEIGHT;
      fireEvent.scroll(viewport);
    });
    act(() => useDiffStore.getState().setDiskChanged(true));
    const before = mocks.request.mock.calls.filter(
      ([command]) => command === "getDiffSides",
    ).length;
    fireEvent.click(screen.getByRole("button", { name: "Reload from disk" }));
    await waitFor(() =>
      expect(
        mocks.request.mock.calls.filter(
          ([command]) => command === "getDiffSides",
        ).length,
      ).toBe(before + 1),
    );
    await waitFor(() => expect(useDiffStore.getState().loading).toBe(false));

    expect(viewport.scrollTop).toBe(40 * LINE_HEIGHT);
  });

  it("scrolls the decoupled left pane itself, not the axis the right pane rides", async () => {
    render(<DiffApp />);
    await waitFor(() => expect(useDiffStore.getState().loading).toBe(false));

    act(() => useDiffStore.getState().toggleSyncScroll());
    expect(useDiffStore.getState().syncScroll).toBe(false);

    const panes = [...document.querySelectorAll(".diff-pane")];
    const [leftPane, rightPane] = [panes[0], panes.at(-1) as Element];
    const rightBefore = firstLineOf(rightPane);

    // Driving the read-only caret down the left pane, past its viewport.
    act(() =>
      useDiffStore.getState().placeCaret("left", { line: 150, col: 0 }),
    );

    await waitFor(() => expect(firstLineOf(leftPane)).toBeGreaterThan(100));
    expect(firstLineOf(rightPane)).toBe(rightBefore);
  });

  it("scrolls with a fold opening above the caret, so the caret's line stays put", async () => {
    // Changes at 5 and 150 leave a foldable run between them: lines 9..146
    // hidden behind one row, with the caret starting on line 5 above it.
    const changed = body.map((line, i) =>
      i === 5 || i === 150 ? "changed" : line,
    );
    mocks.request.mockImplementation((command: string) =>
      command === "getDiffSides"
        ? Promise.resolve({
            kind: "text",
            left: leftText,
            right: `${changed.join("\n")}\n`,
            filePath: "a.txt",
            leftRef: "HEAD",
            rightRef: WORKING_TREE_REF,
            leftLabel: "HEAD",
            rightLabel: "Working tree",
            language: "plaintext",
          })
        : Promise.resolve(undefined),
    );
    useDiffStore.setState({ collapseUnchanged: true });
    render(<DiffApp />);
    await waitFor(() => expect(useDiffStore.getState().loading).toBe(false));
    const viewport = screen.getByRole("region", { name: "Diff of a.txt" });
    expect(viewport.scrollTop).toBe(0);

    // Below the caret, the run opens from its head: nothing above the caret
    // moves, so the view stays where it is.
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Show 4 of 138 unchanged lines above",
      })[0],
    );
    expect(useDiffStore.getState().folds[0].revealed).toEqual({
      head: 4,
      tail: 0,
    });
    expect(viewport.scrollTop).toBe(0);

    // With the caret on the change below the run, the next step comes from
    // the tail, between the row and the caret; the view follows by as much.
    act(() => useDiffStore.getState().setCursor(caretAt(150, 0)));
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Show 4 of 134 unchanged lines below",
      })[0],
    );
    expect(useDiffStore.getState().folds[0].revealed).toEqual({
      head: 4,
      tail: 4,
    });
    expect(viewport.scrollTop).toBe(4 * LINE_HEIGHT);
  });

  it("holds a decoupled left caret still when its fold opens from the tail", async () => {
    const changed = body.map((line, i) =>
      i === 5 || i === 150 ? "changed" : line,
    );
    mocks.request.mockImplementation((command: string) =>
      command === "getDiffSides"
        ? Promise.resolve({
            kind: "text",
            left: leftText,
            right: `${changed.join("\n")}\n`,
            filePath: "a.txt",
            leftRef: "HEAD",
            rightRef: WORKING_TREE_REF,
            leftLabel: "HEAD",
            rightLabel: "Working tree",
            language: "plaintext",
          })
        : Promise.resolve(undefined),
    );
    useDiffStore.setState({ collapseUnchanged: true });
    render(<DiffApp />);
    await waitFor(() => expect(useDiffStore.getState().loading).toBe(false));

    act(() => useDiffStore.getState().toggleSyncScroll());
    expect(useDiffStore.getState().syncScroll).toBe(false);

    const viewport = screen.getByRole("region", { name: "Diff of a.txt" });
    const panes = [...document.querySelectorAll(".diff-pane")];
    const [leftPane, rightPane] = [panes[0], panes.at(-1) as Element];

    // The reference caret is the left pane's, below the foldable run and far
    // enough down that the decoupled pane has scrolled to reach it.
    act(() =>
      useDiffStore.getState().placeCaret("left", { line: 190, col: 0 }),
    );
    await waitFor(() => expect(firstLineOf(leftPane)).toBeGreaterThan(150));
    const leftBefore = firstLineOf(leftPane);
    const rightBefore = firstLineOf(rightPane);
    const scrollBefore = viewport.scrollTop;

    // The run opens from its tail, inserting rows between the separator and
    // the caret: the left pane absorbs the push on its own scroller.
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Show 4 of 138 unchanged lines below",
      })[0],
    );
    expect(useDiffStore.getState().folds[0].revealed).toEqual({
      head: 0,
      tail: 4,
    });
    expect(firstLineOf(leftPane)).toBe(leftBefore);
    expect(viewport.scrollTop).toBe(scrollBefore);
    expect(firstLineOf(rightPane)).toBe(rightBefore);
  });

  it("clears the unified view's parked number columns when it scrolls back", async () => {
    render(<DiffApp />);
    await waitFor(() => expect(useDiffStore.getState().loading).toBe(false));
    act(() => useDiffStore.getState().setViewMode("unified"));

    const pane = document.querySelector(".diff-unified") as HTMLElement;
    const numberColumns = gutterMetrics(body.length).numberWidth * 2;
    // Out to the end of the wide line, then back to its start.
    act(() =>
      useDiffStore.getState().placeCaret("right", { line: 2, col: 400 }),
    );
    expect(pane.scrollLeft).toBeGreaterThan(0);
    act(() => useDiffStore.getState().placeCaret("right", { line: 2, col: 0 }));

    // The caret sits at the text inset, which has to clear the columns
    // parked over the pane's left edge.
    expect(pane.scrollLeft + numberColumns).toBeLessThanOrEqual(
      numberColumns + PANE_TEXT_PADDING,
    );
    // The pane reports its new position the way the browser does, and the
    // caret is drawn again rather than hidden behind the numbers.
    fireEvent.scroll(pane);
    expect(document.querySelector(".diff-readonly-caret")).not.toBeNull();
  });
});

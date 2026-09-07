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

import { useDiffStore } from "../shared/store/diff-store";
import { DiffApp } from "./App";

const pristine = useDiffStore.getState();

describe("diff keyboard bindings", () => {
  beforeEach(() => {
    useDiffStore.setState(pristine, true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const root = document.createElement("div");
    root.id = "root";
    root.dataset.diffPath = "a.txt";
    root.dataset.leftRef = "HEAD";
    root.dataset.rightRef = "";
    document.body.appendChild(root);
    mocks.request.mockImplementation((command: string) => {
      if (command === "getDiffSides") {
        return Promise.resolve({
          kind: "text",
          left: "one\ntwo\nthree\n",
          right: "one\nTWO\nthree\n",
          filePath: "a.txt",
          leftRef: "HEAD",
          rightRef: "",
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
    vi.unstubAllGlobals();
    mocks.request.mockReset();
  });

  async function renderLoaded() {
    render(<DiffApp />);
    await waitFor(() => expect(useDiffStore.getState().loading).toBe(false));
  }

  it("steps with F7 while a toolbar button holds focus", async () => {
    // Buttons carry a `value` property too; a guard written as
    // `"value" in target` silently killed F7 after any toolbar click.
    await renderLoaded();
    expect(useDiffStore.getState().activeChunk).toBe(-1);

    const button = screen.getByRole("button", { name: "Next difference" });
    button.focus();
    fireEvent.keyDown(button, { key: "F7" });

    expect(useDiffStore.getState().activeChunk).not.toBe(-1);
  });

  it("routes Alt+ArrowDown to the next file from a focused button", async () => {
    await renderLoaded();
    const button = screen.getByRole("button", { name: "Next file" });
    button.focus();
    fireEvent.keyDown(button, { key: "ArrowDown", altKey: true });

    expect(mocks.request).toHaveBeenCalledWith("stepDiffFile", { delta: 1 });
  });

  it("leaves F7 alone while an editable element has focus", async () => {
    await renderLoaded();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "F7" });

    expect(useDiffStore.getState().activeChunk).toBe(-1);
    input.remove();
  });

  it("brings the panes back together when sync scrolling is switched on", async () => {
    // Vertically, re-coupling snaps the left pane to the axis at once. It has
    // to mean the same thing sideways, or the split view sits visibly
    // misaligned until the next scroll event of either pane.
    await renderLoaded();
    act(() => useDiffStore.getState().toggleSyncScroll());
    expect(useDiffStore.getState().syncScroll).toBe(false);
    const panes = [...document.querySelectorAll<HTMLElement>(".diff-pane")];
    const [leftPane, rightPane] = [panes[0], panes.at(-1) as HTMLElement];
    fireEvent.scroll(rightPane, { target: { scrollLeft: 200 } });
    fireEvent.scroll(leftPane, { target: { scrollLeft: 300 } });
    expect(rightPane.scrollLeft).toBe(200);

    act(() => useDiffStore.getState().toggleSyncScroll());
    expect(leftPane.scrollLeft).toBe(200);
  });

  it("scrolls the panes sideways with left and right from the focused viewport", async () => {
    // The viewport's own arrows move the axis natively, but it has no
    // sideways range of its own: left and right drive the pane instead.
    await renderLoaded();
    const viewport = screen.getByRole("region", { name: "Diff of a.txt" });
    const rightPane = [
      ...document.querySelectorAll<HTMLElement>(".diff-pane"),
    ].at(-1) as HTMLElement;
    viewport.focus();
    fireEvent.keyDown(viewport, { key: "ArrowRight" });
    expect(rightPane.scrollLeft).toBe(40);
    fireEvent.keyDown(viewport, { key: "ArrowLeft" });
    expect(rightPane.scrollLeft).toBe(0);
  });

  it("steps files with Alt+ArrowDown while a read-only pane holds the caret", async () => {
    // A click focuses a read-only pane for its caret; the file-stepping
    // binding lives on the window and has to survive that.
    await renderLoaded();
    const leftPane = document.querySelector(".diff-pane") as HTMLElement;
    leftPane.focus();
    fireEvent.keyDown(leftPane, { key: "ArrowDown", altKey: true });

    expect(mocks.request).toHaveBeenCalledWith("stepDiffFile", { delta: 1 });
  });
});

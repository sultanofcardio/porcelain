import {
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
});

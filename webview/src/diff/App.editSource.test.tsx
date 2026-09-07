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

const pristine = useDiffStore.getState();

/**
 * Edit Source over an editable diff: the working tree on the right, so the
 * pane carries a buffer that can be dirty when the button is pressed.
 */
describe("Edit source", () => {
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
    root.dataset.rightRef = WORKING_TREE_REF;
    document.body.appendChild(root);
    mocks.request.mockImplementation((command: string) => {
      if (command === "getDiffSides") {
        return Promise.resolve({
          kind: "text",
          left: "one\ntwo\nthree\n",
          right: "one\nTWO\nthree\n",
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
    vi.unstubAllGlobals();
    mocks.request.mockReset();
  });

  async function renderLoaded() {
    render(<DiffApp />);
    await waitFor(() => expect(useDiffStore.getState().loading).toBe(false));
  }

  function typeALine() {
    act(() =>
      useDiffStore
        .getState()
        .editAt(
          { anchor: { line: 0, col: 0 }, head: { line: 0, col: 0 } },
          "added\n",
          null,
        ),
    );
    expect(useDiffStore.getState().dirty).toBe(true);
  }

  function press() {
    fireEvent.click(screen.getByRole("button", { name: "Edit source" }));
  }

  it("opens the file at the caret with nothing to save", async () => {
    await renderLoaded();
    press();
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith("openFile", {
        filePath: "a.txt",
        line: 1,
        column: 0,
      }),
    );
    expect(mocks.request).not.toHaveBeenCalledWith(
      "writeFileContent",
      expect.anything(),
    );
  });

  it("writes unsaved edits to disk before opening, so the caret means the same line", async () => {
    await renderLoaded();
    typeALine();
    press();

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith("writeFileContent", {
        filePath: "a.txt",
        content: "added\none\nTWO\nthree\n",
      }),
    );
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith(
        "openFile",
        expect.objectContaining({ filePath: "a.txt" }),
      ),
    );
    expect(useDiffStore.getState().dirty).toBe(false);
  });

  it("opens nothing when that save fails, and says why", async () => {
    await renderLoaded();
    typeALine();
    mocks.request.mockImplementation((command: string) =>
      command === "writeFileContent"
        ? Promise.reject(new Error("read-only file system"))
        : Promise.resolve(undefined),
    );
    press();

    await waitFor(() =>
      expect(useDiffStore.getState().error).toMatch(/Save failed/),
    );
    expect(mocks.request).not.toHaveBeenCalledWith(
      "openFile",
      expect.anything(),
    );
  });
});

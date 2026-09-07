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
  handlers: [] as Array<(event: string, data: unknown) => void>,
}));

vi.mock("../shared/bridge", () => ({
  bridge: {
    request: mocks.request,
    onEvent: vi.fn((handler: (event: string, data: unknown) => void) => {
      mocks.handlers.push(handler);
      return () => {
        mocks.handlers = mocks.handlers.filter((h) => h !== handler);
      };
    }),
  },
}));

import { WORKING_TREE_REF } from "../shared/bridge/types";
import { useDiffStore } from "../shared/store/diff-store";
import { DiffApp } from "./App";
import { caretAt } from "./editor/editor-model";

const pristine = useDiffStore.getState();

const broadcast = (event: string, data: unknown) => {
  for (const handler of mocks.handlers) handler(event, data);
};

/**
 * The settings channel end to end in the webview: the values the host put
 * on the root element reach the store, a configChanged event replaces them,
 * and the editable pane's blur reaches the save under onFocusChange.
 */
describe("diff autosave wiring", () => {
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
    root.dataset.autoSave = "onFocusChange";
    root.dataset.autoSaveDelay = "250";
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
    mocks.handlers = [];
  });

  async function renderLoaded() {
    render(<DiffApp />);
    await waitFor(() => expect(useDiffStore.getState().loading).toBe(false));
  }

  it("seeds the store from the root element's data attributes", async () => {
    await renderLoaded();
    expect(useDiffStore.getState().settings).toMatchObject({
      autoSave: "onFocusChange",
      autoSaveDelay: 250,
    });
  });

  it("replaces the settings on configChanged", async () => {
    await renderLoaded();
    act(() =>
      broadcast("configChanged", {
        autoSave: "afterDelay",
        autoSaveDelay: 2000,
        hoverEnabled: false,
        hoverDelay: 100,
      }),
    );
    expect(useDiffStore.getState().settings).toEqual({
      autoSave: "afterDelay",
      autoSaveDelay: 2000,
      hoverEnabled: false,
      hoverDelay: 100,
    });
  });

  it("names the mode on the dirty dot", async () => {
    await renderLoaded();
    act(() => useDiffStore.getState().editAt(caretAt(1, 3), "!", "type"));
    expect(
      screen
        .getByRole("img", { name: "Unsaved changes" })
        .getAttribute("title"),
    ).toBe("Unsaved changes, autosaves when the editor loses focus");
  });

  it("saves the working tree when the editor loses focus", async () => {
    await renderLoaded();
    act(() => useDiffStore.getState().editAt(caretAt(1, 3), "!", "type"));
    expect(useDiffStore.getState().dirty).toBe(true);
    const editor = screen.getByRole("textbox", {
      name: /Working-tree editor/,
    });
    fireEvent.blur(editor);
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith("writeFileContent", {
        filePath: "a.txt",
        content: "one\nTWO!\nthree\n",
      }),
    );
    await waitFor(() => expect(useDiffStore.getState().dirty).toBe(false));
  });
});

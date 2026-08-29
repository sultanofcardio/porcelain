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

import { useMergeStore } from "../shared/store/merge-store";
import { MergeApp } from "./MergeApp";

const pristine = useMergeStore.getState();

/**
 * App-level regression for the accept-both flow the user twice reported
 * broken in hand-tests while component-level tests stayed green: the whole
 * MergeApp renders, and the second side's accept verb must be clickable in
 * its own gutter after the first side lands — IntelliJ's shape.
 */
describe("MergeApp accept-both", () => {
  beforeEach(() => {
    useMergeStore.setState(pristine, true);
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
    root.dataset.file = "src/db/pool.ts";
    root.dataset.repoId = "/repos/demo";
    document.body.appendChild(root);
    mocks.request.mockImplementation((command: string) => {
      if (command === "getFileVersions") {
        // The demo shape: both sides append different methods at the same
        // anchor — an empty-base refined conflict (a zero-height slot).
        return Promise.resolve({
          kind: "text",
          base: "a\nz\n",
          ours: "a\nclose() {\n}\nz\n",
          theirs: "a\ndrain() {\n}\nz\n",
          filePath: "src/db/pool.ts",
          language: "typescript",
          mergeMsg: "",
          oursLabel: "main",
          theirsLabel: "fix/pool-leak",
        });
      }
      return Promise.resolve({ success: true });
    });
  });

  afterEach(() => {
    cleanup();
    document.getElementById("root")?.remove();
    vi.unstubAllGlobals();
    mocks.request.mockReset();
  });

  it("keeps the other side's accept clickable after the first side lands", async () => {
    render(<MergeApp />);
    const acceptOurs = await waitFor(() =>
      screen.getByRole("button", { name: "Accept ours for conflict 1" }),
    );
    fireEvent.click(acceptOurs);
    expect(useMergeStore.getState().result.lines).toEqual([
      "a",
      "close() {",
      "}",
      "z",
    ]);

    // The IntelliJ contract under test: theirs' accept survives resolution
    // and appends below the accepted side.
    const acceptTheirs = await waitFor(() =>
      screen.getByRole("button", { name: "Accept theirs for conflict 1" }),
    );
    fireEvent.click(acceptTheirs);
    expect(useMergeStore.getState().result.lines).toEqual([
      "a",
      "close() {",
      "}",
      "drain() {",
      "}",
      "z",
    ]);
  });
});

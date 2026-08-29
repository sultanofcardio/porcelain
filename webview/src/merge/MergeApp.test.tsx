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

  /**
   * The paint half of the same hand-test: after accepting ours, the theirs
   * block must stay in conflict colour with its polygon tapering to the row
   * an accept would splice at — not fall back to the raw result-vs-theirs
   * diff (intraline noise, add/remove polygons), which is what shipped. And
   * once both sides land, everything region-owned paints resolved, with no
   * leftover raw-diff polygons.
   */
  it("keeps region paint state-driven through accept-both", async () => {
    const CONFLICT = "var(--diff-conflict-connector)";
    const RESOLVED = "var(--diff-resolved-connector)";
    const { container } = render(<MergeApp />);
    const gutterFills = () =>
      [
        ...container.querySelectorAll<SVGPathElement>(
          ".diff-gutter-connectors path",
        ),
      ].map((path) => path.getAttribute("fill"));

    const acceptOurs = await waitFor(() =>
      screen.getByRole("button", { name: "Accept ours for conflict 1" }),
    );
    // Pending: both gutters carry the region's conflict polygon and nothing
    // from the raw pair diffs (which see the flank adds as plain chunks).
    expect(gutterFills()).toEqual([CONFLICT, CONFLICT]);

    fireEvent.click(acceptOurs);
    // Ours landed (resolved), theirs still takeable (conflict) — and the raw
    // close()-vs-drain() modified chunk must not surface anywhere.
    expect(gutterFills().sort()).toEqual([CONFLICT, RESOLVED]);
    const theirsPane = [...container.querySelectorAll(".diff-pane")].at(-1);
    expect(theirsPane?.querySelector(".diff-line-conflict")).toBeTruthy();
    expect(theirsPane?.querySelector(".diff-changed")).toBeFalsy();

    const acceptTheirs = await waitFor(() =>
      screen.getByRole("button", { name: "Accept theirs for conflict 1" }),
    );
    fireEvent.click(acceptTheirs);
    // Fully resolved: quiet green polygons only, in both gutters.
    expect(gutterFills()).toEqual([RESOLVED, RESOLVED]);
  });
});

/**
 * Delete-vs-modify: ours deletes the base line, theirs rewrites it, so the
 * ours flank is a pending empty slice. Its accept verb must still render —
 * an accepted empty flank is an accepted deletion, the one-click way to take
 * the removal — and must survive into the ignored state after theirs lands.
 */
describe("MergeApp delete-vs-modify", () => {
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
        return Promise.resolve({
          kind: "text",
          base: "x\n",
          ours: "",
          theirs: "X\n",
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

  it("offers accept on the pending empty ours flank, resolving as a deletion", async () => {
    render(<MergeApp />);
    const acceptOurs = await waitFor(() =>
      screen.getByRole("button", { name: "Accept ours for conflict 1" }),
    );
    fireEvent.click(acceptOurs);

    expect(useMergeStore.getState().result.lines).toEqual([]);
    const region = useMergeStore.getState().regions[0];
    expect(region.oursState).toBe("accepted");
    expect(region.theirsState).toBe("ignored");
  });

  it("keeps accept on the ignored empty ours flank after theirs lands", async () => {
    render(<MergeApp />);
    const acceptTheirs = await waitFor(() =>
      screen.getByRole("button", { name: "Accept theirs for conflict 1" }),
    );
    fireEvent.click(acceptTheirs);
    expect(useMergeStore.getState().result.lines).toEqual(["X"]);
    expect(useMergeStore.getState().regions[0].oursState).toBe("ignored");

    const acceptOurs = await waitFor(() =>
      screen.getByRole("button", { name: "Accept ours for conflict 1" }),
    );
    fireEvent.click(acceptOurs);
    expect(useMergeStore.getState().result.lines).toEqual(["X"]);
    expect(useMergeStore.getState().regions[0].oursState).toBe("accepted");
  });
});

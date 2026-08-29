import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiffPane } from "../diff/components/DiffPane";
import { computeChunks } from "../diff/utils/diff-model";
import type { FileVersionsResult } from "../shared/bridge/types";
import { useMergeStore } from "../shared/store/merge-store";
import { MergeGutterVerbs } from "./components/MergeGutterVerbs";
import { MergeToolbar } from "./components/MergeToolbar";

/**
 * The merge surface's accessibility gate, holding the bar the diff viewer
 * set: the whole resolve flow — step, accept, edit, apply — must be operable
 * from the keyboard and announced. Per the standing rule from the diff scope
 * review, a regression here is a shipping blocker, not polish.
 */

const META = {
  filePath: "src/db/pool.ts",
  language: "typescript",
  mergeMsg: "",
  oursLabel: "main",
  theirsLabel: "fix/pool-leak",
};

function loadConflict() {
  useMergeStore.getState().load({
    kind: "text",
    base: "a\nb\nc\n",
    ours: "a\nOURS\nc\n",
    theirs: "a\nTHEIRS\nc\n",
    ...META,
  } satisfies FileVersionsResult);
}

describe("merge surface accessibility", () => {
  beforeEach(loadConflict);
  afterEach(cleanup);

  it("names every toolbar control — the glyphs carry no accessible name", () => {
    render(
      <MergeToolbar
        onStep={() => {}}
        onApply={() => {}}
        onCancel={() => {}}
        applying={false}
      />,
    );
    for (const name of [
      "Previous conflict",
      "Next conflict",
      "Undo",
      "Collapse unchanged regions",
      "Find in merge",
      "Cancel",
      "Apply",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("gates Apply on every conflict being resolved", () => {
    const { unmount } = render(
      <MergeToolbar
        onStep={() => {}}
        onApply={() => {}}
        onCancel={() => {}}
        applying={false}
      />,
    );
    const apply = () =>
      screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement;
    expect(apply().disabled).toBe(true);
    unmount();

    useMergeStore
      .getState()
      .decideRegion(0, { action: "accept", side: "ours" });
    render(
      <MergeToolbar
        onStep={() => {}}
        onApply={() => {}}
        onCancel={() => {}}
        applying={false}
      />,
    );
    expect(apply().disabled).toBe(false);
  });

  it("announces the stepped conflict through a live region", () => {
    useMergeStore.getState().stepConflict(1);
    const { container } = render(
      <MergeToolbar
        onStep={() => {}}
        onApply={() => {}}
        onCancel={() => {}}
        applying={false}
      />,
    );
    const live = container.querySelector("[aria-live='polite']");
    expect(live?.textContent).toBe("Conflict 1 of 1");
  });

  it("names the gutter verbs after their conflict and their side", () => {
    const { folds } = useMergeStore.getState();
    render(
      <MergeGutterVerbs
        flank="ours"
        folds={folds}
        flankOffset={0}
        resultOffset={0}
        visibleLines={30}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Accept ours for conflict 1" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Ignore ours for conflict 1" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Edit result for conflict 1" }),
    ).toBeTruthy();
  });

  it("offers revert once a conflict is resolved", () => {
    useMergeStore
      .getState()
      .decideRegion(0, { action: "accept", side: "theirs" });
    const { folds } = useMergeStore.getState();
    render(
      <MergeGutterVerbs
        flank="theirs"
        folds={folds}
        flankOffset={0}
        resultOffset={0}
        visibleLines={30}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Revert conflict 1" }),
    ).toBeTruthy();
  });

  it("announces conflict rows in the result pane's invisible prefix", () => {
    const state = useMergeStore.getState();
    const { container } = render(
      <DiffPane
        side="right"
        lines={state.result.lines}
        counterpart={state.ours.lines}
        chunks={state.chunksOurs}
        language="plaintext"
        granularity="word"
        offset={0}
        visibleLines={10}
        overrideKinds={state.resultKinds}
      />,
    );
    const prefixes = [...container.querySelectorAll(".diff-sr-only")].map(
      (el) => el.textContent,
    );
    expect(prefixes).toContain("Line 2, conflict: ");
  });

  it("gives the edit island an accessible name and native text semantics", () => {
    render(
      <DiffPane
        side="right"
        lines={["a", "b", "c"]}
        counterpart={["a", "b", "c"]}
        chunks={computeChunks("a\nb\nc\n", "a\nb\nc\n")}
        language="plaintext"
        granularity="word"
        offset={0}
        visibleLines={10}
        island={{
          start: 1,
          lines: ["b"],
          label: "Editing result lines 2 to 2 — Escape commits",
          onLinesChange: () => {},
          onCommit: () => {},
        }}
      />,
    );
    expect(
      screen.getByRole("textbox", {
        name: "Editing result lines 2 to 2 — Escape commits",
      }),
    ).toBeTruthy();
  });
});

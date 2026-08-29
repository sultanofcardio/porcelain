import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDiffStore } from "../../shared/store/diff-store";
import { FindBar } from "./FindBar";

// A pristine copy of the store, actions included, to restore between tests —
// the store is a module-level singleton.
const pristine = useDiffStore.getState();

function loadTextDiff(left: string, right: string) {
  useDiffStore.getState().setSides({
    kind: "text",
    left,
    right,
    filePath: "a.txt",
    leftRef: "HEAD",
    rightRef: "",
    leftLabel: "HEAD",
    rightLabel: "Working tree",
    language: "plaintext",
  });
}

describe("FindBar reveal", () => {
  beforeEach(() => {
    useDiffStore.setState(pristine, true);
  });
  afterEach(cleanup);

  it("re-reveals when the query changes the match but the index stays 0", () => {
    // "ap" hits line 1 ("ape"); "app" only hits line 40 ("apple"). Both
    // queries leave activeMatch at 0, so the reveal must be keyed on the
    // match itself — an index-keyed effect never re-fires and the view
    // silently stays parked on the stale hit.
    const lines = Array.from({ length: 60 }, (_, i) => `filler ${i + 1}`);
    lines[0] = "ape";
    lines[39] = "apple";
    const text = `${lines.join("\n")}\n`;
    loadTextDiff(text, text);
    useDiffStore.getState().openFind();

    const onJump = vi.fn();
    render(<FindBar onJump={onJump} />);
    const input = screen.getByLabelText("Find in diff");

    fireEvent.change(input, { target: { value: "ap" } });
    expect(useDiffStore.getState().activeMatch).toBe(0);
    expect(onJump).toHaveBeenCalledTimes(1);
    const firstJump = onJump.mock.calls[0][0];

    fireEvent.change(input, { target: { value: "app" } });
    expect(useDiffStore.getState().activeMatch).toBe(0);
    // The new first match sits at an unchanged index; the reveal must still
    // fire, and at the deeper line's axis position.
    expect(onJump).toHaveBeenCalledTimes(2);
    expect(onJump.mock.calls[1][0]).toBeGreaterThan(firstJump);
  });

  it("auto-expands a fold hiding the new first match", () => {
    // Line 40 sits inside the collapsed unchanged run of an all-equal diff;
    // revealing the match must expand that fold rather than jump blind.
    const lines = Array.from({ length: 60 }, (_, i) => `filler ${i + 1}`);
    lines[39] = "needle";
    const text = `${lines.join("\n")}\n`;
    loadTextDiff(text, text);
    expect(useDiffStore.getState().folds.length).toBeGreaterThan(0);
    useDiffStore.getState().openFind();

    render(<FindBar onJump={() => {}} />);
    fireEvent.change(screen.getByLabelText("Find in diff"), {
      target: { value: "needle" },
    });
    expect(useDiffStore.getState().folds).toHaveLength(0);
    expect(useDiffStore.getState().expandedFolds.size).toBeGreaterThan(0);
  });
});

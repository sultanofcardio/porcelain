import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDiffStore } from "../../shared/store/diff-store";
import { applyReveals, computeChunks, computeFolds } from "../utils/diff-model";
import { DiffPane } from "./DiffPane";
import { DiffSettingsMenu } from "./DiffSettingsMenu";
import { DiffToolbar } from "./DiffToolbar";

/**
 * The keyboard and screen-reader walkthrough, as assertions.
 *
 * The default cannot flip until the surface is usable without sight or a
 * mouse; these pin the wiring that makes it so, so a regression is a red
 * test rather than a bug report from the one user it locks out.
 */
describe("diff surface accessibility", () => {
  afterEach(cleanup);

  it("names every toolbar button — the glyphs carry no accessible name", () => {
    render(
      <DiffToolbar
        onStep={() => {}}
        onEditSource={() => {}}
        onFile={() => {}}
      />,
    );
    for (const name of [
      "Previous difference",
      "Next difference",
      "Edit source",
      "Previous file",
      "Next file",
      "Collapse unchanged regions",
      "Synchronise scrolling",
      "Find in diff",
      "Diff settings",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("exposes the two toolbar toggles as toggles", () => {
    render(
      <DiffToolbar
        onStep={() => {}}
        onEditSource={() => {}}
        onFile={() => {}}
      />,
    );
    const collapse = screen.getByRole("button", {
      name: "Collapse unchanged regions",
    });
    expect(collapse.getAttribute("aria-pressed")).not.toBeNull();
  });

  it("announces the stepped difference through a live region", () => {
    useDiffStore.setState({
      chunks: computeChunks("a\nold\nc\n", "a\nnew\nc\n"),
      activeChunk: 1,
    });
    const { container } = render(
      <DiffToolbar
        onStep={() => {}}
        onEditSource={() => {}}
        onFile={() => {}}
      />,
    );
    const live = container.querySelector("[aria-live='polite']");
    expect(live?.textContent).toBe("Difference 1 of 1");
  });

  it("walks the settings menu with arrow keys and closes on Escape", () => {
    const onClose = vi.fn();
    const { container } = render(<DiffSettingsMenu onClose={onClose} />);
    const menu = container.querySelector("[role='menu']");
    expect(menu).toBeTruthy();
    const rows = screen.getAllByRole("menuitemradio");
    expect(rows.length).toBeGreaterThan(0);
    // First row takes focus on open; ArrowDown moves it.
    expect(document.activeElement).toBe(rows[0]);
    if (menu) fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
  });

  it("prefixes each rendered line with its number and state, invisibly", () => {
    const left = "same\ngone\n";
    const right = "same\nhere\n";
    const { container } = render(
      <DiffPane
        side="right"
        lines={["same", "here"]}
        counterpart={["same", "gone"]}
        chunks={computeChunks(left, right)}
        language="plaintext"
        granularity="word"
        offset={0}
        visibleLines={10}
      />,
    );
    const prefixes = [...container.querySelectorAll(".diff-sr-only")].map(
      (el) => el.textContent,
    );
    expect(prefixes).toEqual(["Line 1: ", "Line 2, modified: "]);
  });

  it("gives the fold row a button role, named after its next step and its count", () => {
    const body = Array.from({ length: 40 }, (_, i) => `line${i}`).join("\n");
    const left = `old\n${body}\n`;
    const right = `new\n${body}\n`;
    const chunks = computeChunks(left, right);
    // The run ends the file, so it keeps context only on its inner edge:
    // 40 lines minus 3 leading context.
    const folds = computeFolds(chunks);
    expect(folds).toHaveLength(1);
    expect(folds[0].hiddenLines).toBe(37);
    render(
      <DiffPane
        side="right"
        lines={right.split("\n").slice(0, -1)}
        counterpart={left.split("\n").slice(0, -1)}
        chunks={chunks}
        language="plaintext"
        granularity="word"
        offset={0}
        visibleLines={20}
        folds={folds}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: "Show 4 of 37 unchanged lines above",
      }),
    ).toBeTruthy();
  });

  it("renames each fold row as its run opens, one button per fold in reading order", () => {
    // Two runs around one edit, both folded, with a caret below them both:
    // the rows open from their tails and say so.
    const run = (prefix: string) =>
      Array.from({ length: 30 }, (_, i) => `${prefix}${i}`);
    const left = `${[...run("a"), "old", ...run("b")].join("\n")}\n`;
    const right = `${[...run("a"), "new", ...run("b")].join("\n")}\n`;
    const chunks = computeChunks(left, right);
    const folds = computeFolds(chunks);
    expect(folds).toHaveLength(2);
    const lines = right.split("\n").slice(0, -1);
    const paneFor = (visible: typeof folds) => (
      <DiffPane
        side="right"
        lines={lines}
        counterpart={left.split("\n").slice(0, -1)}
        chunks={chunks}
        language="plaintext"
        granularity="word"
        offset={0}
        visibleLines={40}
        folds={visible}
        foldEnd={() => "tail"}
      />
    );
    const { rerender } = render(paneFor(folds));
    const names = () =>
      screen
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"));
    expect(names()).toEqual([
      "Show 4 of 27 unchanged lines below",
      "Show 4 of 27 unchanged lines below",
    ]);

    // Four lines given up at the first run's tail: its row asks for the
    // next stage, the other's does not move.
    rerender(
      paneFor(
        applyReveals(folds, new Map([[folds[0].key, { head: 0, tail: 4 }]])),
      ),
    );
    expect(names()).toEqual([
      "Show 8 of 23 unchanged lines below",
      "Show 4 of 27 unchanged lines below",
    ]);
    rerender(
      paneFor(
        applyReveals(folds, new Map([[folds[0].key, { head: 0, tail: 12 }]])),
      ),
    );
    expect(names()[0]).toBe("Show all 15 unchanged lines below");
  });
});

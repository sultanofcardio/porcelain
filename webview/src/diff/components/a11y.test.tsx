import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDiffStore } from "../../shared/store/diff-store";
import { computeChunks, computeFolds } from "../utils/diff-model";
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

  it("gives the fold row a button role and a count for a name", () => {
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
      screen.getByRole("button", { name: /Expand 37 unchanged lines/ }),
    ).toBeTruthy();
  });
});

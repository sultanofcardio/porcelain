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
import { LINE_HEIGHT, PANE_TEXT_PADDING } from "./components/metrics";
import { SAVE_NOTICE } from "./hooks/useLanguageHover";

const pristine = useDiffStore.getState();

// jsdom cannot measure the editor font, so the panes keep their default cell.
const CELL = 7.2;

/** A pointer over column `col` of line `line` of a pane at the origin. */
const over = (line: number, col: number) => ({
  clientX: PANE_TEXT_PADDING + (col + 0.5) * CELL,
  clientY: line * LINE_HEIGHT + 4,
});

const HOVER = {
  kind: "hover",
  contents: ["```typescript\nconst TWO: string\n```", "The **second** word"],
  range: null,
};
const DEFINITION = {
  kind: "definition",
  targets: [
    {
      uri: "file:///repo/a.txt",
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 3 },
      },
    },
  ],
  origin: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
};
const NO_DEFINITION = { kind: "definition", targets: [], origin: null };

interface Options {
  rightRef?: string;
  right?: string;
  left?: string;
  hoverEnabled?: string;
  definition?: unknown;
  symbols?: unknown;
}

describe("hover and go to definition over the diff", () => {
  let queries: Array<Record<string, unknown>>;

  function mount({
    rightRef = "",
    left = "one\ntwo\nthree\n",
    right = "one\nTWO\nthree\n",
    hoverEnabled,
    definition = DEFINITION,
    symbols = { kind: "symbols", symbols: [] },
  }: Options = {}) {
    queries = [];
    const root = document.createElement("div");
    root.id = "root";
    root.dataset.diffPath = "a.txt";
    root.dataset.leftRef = "HEAD";
    root.dataset.rightRef = rightRef;
    root.dataset.hoverDelay = "300";
    if (hoverEnabled !== undefined) root.dataset.hoverEnabled = hoverEnabled;
    document.body.appendChild(root);
    mocks.request.mockImplementation(
      (command: string, params: Record<string, unknown>) => {
        if (command === "getDiffSides") {
          return Promise.resolve({
            kind: "text",
            left,
            right,
            filePath: "a.txt",
            leftRef: "HEAD",
            rightRef,
            leftLabel: "HEAD",
            rightLabel: rightRef ? "Working tree" : "",
            language: "typescript",
          });
        }
        if (command === "languageQuery") {
          queries.push(params);
          if (params.kind === "hover") return Promise.resolve(HOVER);
          if (params.kind === "definition") return Promise.resolve(definition);
          return Promise.resolve(symbols);
        }
        if (command === "openLocation")
          return Promise.resolve({ opened: true });
        return Promise.resolve(undefined);
      },
    );
  }

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
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    document.getElementById("root")?.remove();
    vi.unstubAllGlobals();
    mocks.request.mockReset();
  });

  /** Mount, wait for the diff, then take over the clock. */
  async function renderLoaded() {
    render(<DiffApp />);
    await waitFor(() => expect(useDiffStore.getState().loading).toBe(false));
    const panes = [...document.querySelectorAll<HTMLElement>(".diff-pane")];
    for (const pane of panes) {
      Object.defineProperty(pane, "clientHeight", { value: 200 });
    }
    vi.useFakeTimers();
    return { left: panes[0], right: panes[panes.length - 1] };
  }

  const settle = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  const card = () => document.querySelector<HTMLElement>(".diff-hover");
  const hoverQueries = () => queries.filter((q) => q.kind === "hover");

  it("asks after the pointer has rested on a word, and shows the answer", async () => {
    mount();
    const { right } = await renderLoaded();
    fireEvent.mouseMove(right, over(1, 1));
    await settle(200);
    expect(hoverQueries()).toHaveLength(0);
    expect(card()).toBeNull();
    await settle(150);
    expect(hoverQueries()).toEqual([
      { kind: "hover", ref: "", path: "a.txt", line: 1, character: 0 },
    ]);
    const shown = card();
    expect(shown).not.toBeNull();
    expect(shown?.querySelector("pre code")?.textContent).toBe(
      "const TWO: string",
    );
    expect(shown?.querySelector("strong")?.textContent).toBe("second");
    expect(shown?.querySelector(".diff-hover-status")).toBeNull();
  });

  it("restarts the wait when the pointer moves to another word, and not within one", async () => {
    mount();
    const { left } = await renderLoaded();
    fireEvent.mouseMove(left, over(2, 0));
    await settle(200);
    // Still on "three": the clock keeps running.
    fireEvent.mouseMove(left, over(2, 4));
    await settle(150);
    expect(hoverQueries()).toHaveLength(1);
    expect(hoverQueries()[0]).toMatchObject({
      ref: "HEAD",
      line: 2,
      character: 0,
    });
    expect(card()).not.toBeNull();
    // Off to "one": the card outlives the word by the hiding delay, and the
    // wait for the new word starts over.
    fireEvent.mouseMove(left, over(0, 1));
    await settle(299);
    expect(card()).not.toBeNull();
    expect(hoverQueries()).toHaveLength(1);
    await settle(1);
    expect(hoverQueries()).toHaveLength(2);
    expect(hoverQueries()[1]).toMatchObject({ line: 0 });
  });

  it("asks again on a second rest, so a starting server's placeholder does not stick", async () => {
    mount();
    const { right } = await renderLoaded();
    fireEvent.mouseMove(right, over(1, 1));
    await settle(300);
    expect(card()).not.toBeNull();
    fireEvent.mouseLeave(right);
    await settle(300);
    expect(card()).toBeNull();
    fireEvent.mouseMove(right, over(1, 2));
    await settle(300);
    expect(card()).not.toBeNull();
    expect(hoverQueries()).toHaveLength(2);
  });

  it("shares one request between a rest and a modifier held on the same word", async () => {
    mount();
    const { right } = await renderLoaded();
    fireEvent.mouseMove(right, { ...over(1, 1), metaKey: true, ctrlKey: true });
    fireEvent.keyDown(window, { key: "Meta", metaKey: true });
    fireEvent.keyUp(window, { key: "Meta", metaKey: false, ctrlKey: false });
    fireEvent.keyDown(window, { key: "Meta", metaKey: true });
    await settle(0);
    expect(queries.filter((q) => q.kind === "definition")).toHaveLength(1);
  });

  it("keeps the card while the pointer is on it, and drops it once the pointer has left both", async () => {
    mount();
    const { right } = await renderLoaded();
    fireEvent.mouseMove(right, over(1, 1));
    await settle(300);
    const shown = card() as HTMLElement;
    fireEvent.mouseLeave(right);
    await settle(100);
    fireEvent.mouseEnter(shown);
    await settle(1000);
    expect(card()).not.toBeNull();
    fireEvent.mouseLeave(shown);
    await settle(299);
    expect(card()).not.toBeNull();
    await settle(1);
    expect(card()).toBeNull();
  });

  it("dismisses on Escape, on scrolling and on a press elsewhere", async () => {
    mount();
    const { right } = await renderLoaded();
    // A dismissed card stays dismissed while the pointer rests where it was;
    // it comes back once the pointer has left the word and returned.
    const show = async () => {
      fireEvent.mouseLeave(right);
      fireEvent.mouseMove(right, over(1, 1));
      await settle(300);
      expect(card()).not.toBeNull();
    };
    await show();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(card()).toBeNull();
    // Escape spent on the card leaves the find bar alone.
    act(() => useDiffStore.getState().openFind());
    await show();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(card()).toBeNull();
    expect(useDiffStore.getState().findOpen).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useDiffStore.getState().findOpen).toBe(false);

    await show();
    fireEvent.scroll(screen.getByRole("region", { name: "Diff of a.txt" }));
    expect(card()).toBeNull();

    await show();
    fireEvent.mouseDown(document.body);
    expect(card()).toBeNull();
  });

  it("asks nothing with editor.hover.enabled off", async () => {
    mount({ hoverEnabled: "false" });
    const { right } = await renderLoaded();
    fireEvent.mouseMove(right, over(1, 1));
    await settle(1000);
    expect(hoverQueries()).toHaveLength(0);
    expect(card()).toBeNull();
  });

  it("underlines a resolved definition under the modifier, and follows a modifier-click", async () => {
    mount();
    const { right } = await renderLoaded();
    fireEvent.mouseMove(right, { ...over(1, 1), metaKey: true, ctrlKey: true });
    await settle(0);
    expect(queries.filter((q) => q.kind === "definition")).toEqual([
      { kind: "definition", ref: "", path: "a.txt", line: 1, character: 0 },
    ]);
    const link = right.querySelector(".diff-link");
    expect(link?.textContent).toBe("TWO");
    expect(right.classList.contains("diff-pane-linking")).toBe(true);
    // The card, once it comes, says how to follow the link.
    await settle(300);
    expect(card()?.querySelector(".diff-hover-status")?.textContent).toContain(
      "click to go to definition",
    );
    // Releasing the modifier takes the underline away.
    fireEvent.keyUp(window, { key: "Meta", metaKey: false, ctrlKey: false });
    expect(right.querySelector(".diff-link")).toBeNull();
    fireEvent.mouseDown(right, { ...over(1, 1), metaKey: true, ctrlKey: true });
    await settle(0);
    expect(mocks.request).toHaveBeenCalledWith("openLocation", {
      targets: DEFINITION.targets,
    });
    expect(card()).toBeNull();
  });

  it("underlines nothing where no definition was found", async () => {
    mount({ definition: NO_DEFINITION });
    const { right } = await renderLoaded();
    fireEvent.mouseMove(right, { ...over(1, 1), metaKey: true, ctrlKey: true });
    await settle(0);
    expect(right.querySelector(".diff-link")).toBeNull();
    fireEvent.mouseDown(right, { ...over(1, 1), metaKey: true, ctrlKey: true });
    await settle(0);
    expect(mocks.request).not.toHaveBeenCalledWith(
      "openLocation",
      expect.anything(),
    );
  });

  it("shows the hover at the caret on ⌘K ⌘I, and goes to its definition on F12", async () => {
    mount();
    const { right } = await renderLoaded();
    // The right pane's caret starts on the first change: line 1, "TWO".
    expect(right.querySelector(".diff-readonly-caret")).not.toBeNull();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.keyDown(window, { key: "i", metaKey: true });
    await settle(0);
    expect(hoverQueries()).toEqual([
      { kind: "hover", ref: "", path: "a.txt", line: 1, character: 0 },
    ]);
    expect(card()).not.toBeNull();

    fireEvent.keyDown(window, { key: "F12" });
    await settle(0);
    expect(queries.filter((q) => q.kind === "definition")).toEqual([
      { kind: "definition", ref: "", path: "a.txt", line: 1, character: 0 },
    ]);
    expect(mocks.request).toHaveBeenCalledWith("openLocation", {
      targets: DEFINITION.targets,
    });
  });

  it("forgets an unfinished ⌘K once another key follows", async () => {
    mount();
    await renderLoaded();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "i", metaKey: true });
    await settle(0);
    expect(hoverQueries()).toHaveLength(0);
  });

  it("stays quiet on a dirty working-tree side, saying so once, and asks again after the save", async () => {
    mount({ rightRef: WORKING_TREE_REF });
    const { right } = await renderLoaded();
    act(() =>
      useDiffStore
        .getState()
        .editAt(
          { anchor: { line: 0, col: 0 }, head: { line: 0, col: 0 } },
          "x",
          null,
        ),
    );
    expect(useDiffStore.getState().dirty).toBe(true);
    fireEvent.mouseMove(right, over(1, 1));
    await settle(300);
    expect(hoverQueries()).toHaveLength(0);
    expect(card()?.querySelector(".diff-hover-notice")?.textContent).toBe(
      SAVE_NOTICE,
    );
    // Said once: the next word gets nothing.
    fireEvent.mouseMove(right, over(2, 1));
    await settle(600);
    expect(card()).toBeNull();
    expect(hoverQueries()).toHaveLength(0);
    // The modifier resolves nothing either.
    fireEvent.mouseMove(right, { ...over(1, 1), metaKey: true, ctrlKey: true });
    await settle(0);
    expect(queries.filter((q) => q.kind === "definition")).toHaveLength(0);
    // Saved: the side is on disk again and the servers can be asked.
    act(() => useDiffStore.getState().markSaved(useDiffStore.getState().right));
    fireEvent.mouseMove(right, over(2, 2));
    fireEvent.mouseMove(right, over(1, 1));
    await settle(300);
    expect(hoverQueries()).toEqual([
      {
        kind: "hover",
        ref: WORKING_TREE_REF,
        path: "a.txt",
        line: 1,
        character: 0,
      },
    ]);
    expect(card()?.querySelector(".diff-hover-part")).not.toBeNull();
  });

  it("badges the fold rows with the scope from the outline", async () => {
    const many = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    const changed = many.map((l, i) => (i === 30 ? "changed" : l));
    mount({
      left: `${many.join("\n")}\n`,
      right: `${changed.join("\n")}\n`,
      symbols: {
        kind: "symbols",
        symbols: [
          {
            name: "handle",
            kind: 11,
            range: {
              start: { line: 0, character: 0 },
              end: { line: 39, character: 1 },
            },
            children: [],
          },
        ],
      },
    });
    render(<DiffApp />);
    await waitFor(() => expect(useDiffStore.getState().loading).toBe(false));
    await waitFor(() =>
      expect(document.querySelector(".diff-fold-scope")?.textContent).toBe(
        "handle()",
      ),
    );
    // One outline for the right side, asked for once.
    expect(queries.filter((q) => q.kind === "symbols")).toEqual([
      { kind: "symbols", ref: "", path: "a.txt" },
    ]);
  });
});

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileVersionsResult } from "../../shared/bridge/types";
import { useMergeStore } from "../../shared/store/merge-store";
import { EditablePane } from "./EditablePane";

/**
 * The editor core's shipping gate, at the component level: every behaviour
 * here is driven through the real input receiver — keydown, input,
 * composition and clipboard events — against the real merge store, the way
 * the webview drives it. What jsdom cannot host (real IME candidate windows,
 * font metrics) is covered by the model tests plus the manual checklist in
 * the PR notes.
 */

const META = {
  filePath: "src/db/pool.ts",
  language: "typescript",
  mergeMsg: "",
  oursLabel: "main",
  theirsLabel: "fix/pool-leak",
};

function load(base: string, ours: string, theirs: string) {
  // Store mutations happen outside React's event path here, so they must be
  // act-wrapped for the mounted harness to re-render before the next event.
  act(() =>
    useMergeStore.getState().load({
      kind: "text",
      base,
      ours,
      theirs,
      ...META,
    } satisfies FileVersionsResult),
  );
}

/** EditablePane wired to the merge store exactly as MergeApp wires it. */
function Harness() {
  const store = useMergeStore();
  return (
    <EditablePane
      lines={store.result.lines}
      cursor={store.cursor}
      composition={store.composition}
      offset={0}
      visibleLines={20}
      mapping={{ toDisplayRow: (line) => line, toSourceLine: (row) => row }}
      label="Merge result editor"
      onSetCursor={(selection, goal) =>
        useMergeStore.getState().setCursor(selection, goal)
      }
      onEdit={(selection, text, key) =>
        useMergeStore.getState().editAt(selection, text, key)
      }
      onCompositionBegin={() => useMergeStore.getState().beginComposition()}
      onCompositionUpdate={(text) =>
        useMergeStore.getState().updateComposition(text)
      }
      onCompositionEnd={(text) => useMergeStore.getState().endComposition(text)}
      onUndo={() => useMergeStore.getState().undo()}
      onRedo={() => useMergeStore.getState().redo()}
      onRevealRow={() => {}}
    >
      <div />
    </EditablePane>
  );
}

function input(): HTMLTextAreaElement {
  return screen.getByRole("textbox", {
    name: "Merge result editor",
  }) as HTMLTextAreaElement;
}

function caret(line: number, col: number) {
  act(() =>
    useMergeStore.getState().setCursor({
      anchor: { line, col },
      head: { line, col },
    }),
  );
}

const lines = () => useMergeStore.getState().result.lines;

describe("EditablePane", () => {
  beforeEach(() => {
    load("a\nb\nc\n", "a\nOURS\nc\n", "a\nTHEIRS\nc\n");
    render(<Harness />);
  });
  afterEach(cleanup);

  it("is a labelled textbox — the accessible face of the editor", () => {
    expect(input()).toBeTruthy();
  });

  it("types through the input event, character by character", () => {
    caret(0, 1);
    const field = input();
    field.value = "x";
    fireEvent.input(field);
    expect(lines()[0]).toBe("ax");
    expect(field.value).toBe(""); // consumed, ready for the next key
    expect(useMergeStore.getState().cursor?.head).toEqual({ line: 0, col: 2 });
  });

  it("Enter arrives as typed text and splits the line", () => {
    caret(0, 1);
    const field = input();
    field.value = "\n";
    fireEvent.input(field);
    expect(lines().slice(0, 2)).toEqual(["a", ""]);
  });

  it("Backspace deletes one code point; word-backspace one word", () => {
    caret(1, 1);
    fireEvent.keyDown(input(), { key: "Backspace" });
    expect(lines()[1]).toBe("");
    load("word here\nb\nc\n", "x\nb\nc\n", "y\nb\nc\n");
    caret(0, 9);
    fireEvent.keyDown(input(), { key: "Backspace", altKey: true });
    expect(lines()[0]).toBe("word ");
  });

  it("arrows move, shift-arrows select, and typing replaces the selection", () => {
    caret(0, 0);
    fireEvent.keyDown(input(), { key: "ArrowRight" });
    expect(useMergeStore.getState().cursor?.head).toEqual({ line: 0, col: 1 });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(useMergeStore.getState().cursor?.head.line).toBe(1);
    // Shift+Right from EOL selects across the newline; typing over that
    // selection joins the lines around the insertion.
    fireEvent.keyDown(input(), { key: "ArrowRight", shiftKey: true });
    const selected = useMergeStore.getState().cursor;
    expect(selected?.anchor).toEqual({ line: 1, col: 1 });
    expect(selected?.head).toEqual({ line: 2, col: 0 });
    const field = input();
    field.value = "Z";
    fireEvent.input(field);
    expect(lines()).toEqual(["a", "bZc"]);
  });

  it("Cmd+A selects the document; a plain arrow collapses to its edge", () => {
    caret(1, 0);
    fireEvent.keyDown(input(), { key: "a", metaKey: true });
    const all = useMergeStore.getState().cursor;
    expect(all?.anchor).toEqual({ line: 0, col: 0 });
    expect(all?.head).toEqual({ line: 2, col: 1 });
    fireEvent.keyDown(input(), { key: "ArrowLeft" });
    expect(useMergeStore.getState().cursor?.head).toEqual({ line: 0, col: 0 });
  });

  it("Cmd+Z and Cmd+Shift+Z drive the shared history", () => {
    caret(0, 1);
    const field = input();
    field.value = "x";
    fireEvent.input(field);
    expect(lines()[0]).toBe("ax");
    fireEvent.keyDown(field, { key: "z", metaKey: true });
    expect(lines()[0]).toBe("a");
    fireEvent.keyDown(field, { key: "z", metaKey: true, shiftKey: true });
    expect(lines()[0]).toBe("ax");
  });

  it("a composition session renders live and commits once", () => {
    caret(1, 1);
    const field = input();
    fireEvent.compositionStart(field);
    field.value = "に";
    fireEvent.input(field);
    expect(lines()[1]).toBe("bに");
    field.value = "にほ";
    fireEvent.input(field);
    expect(lines()[1]).toBe("bにほ");
    fireEvent.compositionEnd(field, { data: "日本" });
    expect(lines()[1]).toBe("b日本");
    expect(useMergeStore.getState().composition).toBeNull();
    expect(field.value).toBe("");
    // One undo step for the whole session.
    fireEvent.keyDown(field, { key: "z", metaKey: true });
    expect(lines()[1]).toBe("b");
  });

  it("keydown commands stand down while a composition is live", () => {
    caret(1, 1);
    const field = input();
    fireEvent.compositionStart(field);
    field.value = "に";
    fireEvent.input(field);
    // Escape/Enter/Backspace during composition belong to the IME.
    fireEvent.keyDown(field, { key: "Backspace", isComposing: true });
    fireEvent.keyDown(field, { key: "Escape", isComposing: true });
    expect(lines()[1]).toBe("bに");
    expect(useMergeStore.getState().composition).not.toBeNull();
    fireEvent.compositionEnd(field, { data: "に" });
    expect(lines()[1]).toBe("bに");
  });

  it("blur mid-composition commits what the IME had — nothing is lost", () => {
    caret(1, 1);
    const field = input();
    fireEvent.compositionStart(field);
    field.value = "はん";
    fireEvent.input(field);
    fireEvent.blur(field);
    expect(lines()[1]).toBe("bはん");
    expect(useMergeStore.getState().composition).toBeNull();
  });

  it("copy carries the selection; cut also deletes it; paste inserts", () => {
    act(() =>
      useMergeStore.getState().setCursor({
        anchor: { line: 0, col: 0 },
        head: { line: 0, col: 1 },
      }),
    );
    const field = input();
    const clipboard = { setData: vi.fn(), getData: vi.fn(() => "PASTED") };
    fireEvent.copy(field, { clipboardData: clipboard });
    expect(clipboard.setData).toHaveBeenCalledWith("text/plain", "a");
    expect(lines()[0]).toBe("a");
    fireEvent.cut(field, { clipboardData: clipboard });
    expect(lines()[0]).toBe("");
    fireEvent.paste(field, { clipboardData: clipboard });
    expect(lines()[0]).toBe("PASTED");
  });

  it("typing inside a pending conflict resolves it", () => {
    caret(1, 0);
    const field = input();
    field.value = "!";
    fireEvent.input(field);
    const state = useMergeStore.getState();
    expect(state.regions[0].edited).toBe(true);
    expect(state.allResolved).toBe(true);
  });

  it("mouse down places the caret and focuses the input", () => {
    const host = input().closest(".diff-editor-host") as HTMLElement;
    fireEvent.mouseDown(host, { clientX: 12, clientY: 4, detail: 1 });
    const cursorNow = useMergeStore.getState().cursor;
    expect(cursorNow).not.toBeNull();
    expect(cursorNow?.head.line).toBe(0);
    expect(document.activeElement).toBe(input());
  });
});

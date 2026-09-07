import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutoSaveMode } from "../../shared/bridge/types";
import { WORKING_TREE_REF } from "../../shared/bridge/types";
import { useDiffStore } from "../../shared/store/diff-store";
import { caretAt } from "../editor/editor-model";
import { type AutoSaveControls, useAutoSave } from "./useAutoSave";

const pristine = useDiffStore.getState();

function Harness({
  mode,
  delay,
  save,
  expose,
}: {
  mode: AutoSaveMode;
  delay: number;
  save: () => Promise<boolean>;
  expose: (controls: AutoSaveControls) => void;
}) {
  const saveRef = { current: save };
  expose(useAutoSave(mode, delay, saveRef));
  return null;
}

/** A save the way App's behaves: writes what the buffer holds, then marks it. */
function writingSave() {
  return vi.fn(async () => {
    const content = useDiffStore.getState().right;
    useDiffStore.getState().markSaved(content);
    return true;
  });
}

function mount(mode: AutoSaveMode, delay: number, save = writingSave()) {
  let controls: AutoSaveControls | null = null;
  const view = render(
    <Harness
      mode={mode}
      delay={delay}
      save={save}
      expose={(c) => {
        controls = c;
      }}
    />,
  );
  const rerender = (nextMode: AutoSaveMode, nextDelay = delay) =>
    view.rerender(
      <Harness
        mode={nextMode}
        delay={nextDelay}
        save={save}
        expose={(c) => {
          controls = c;
        }}
      />,
    );
  return {
    save,
    rerender,
    blurEditor: () => (controls as AutoSaveControls | null)?.onEditorBlur(),
  };
}

const type = (text: string, line = 1, col = 3) =>
  act(() => useDiffStore.getState().editAt(caretAt(line, col), text, "type"));

describe("useAutoSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useDiffStore.setState(pristine, true);
    useDiffStore.getState().setSides({
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
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does nothing while autosave is off", () => {
    const { save, blurEditor } = mount("off", 1000);
    type("!");
    act(() => vi.advanceTimersByTime(5000));
    act(() => blurEditor());
    act(() => window.dispatchEvent(new Event("blur")));
    expect(save).not.toHaveBeenCalled();
    expect(useDiffStore.getState().dirty).toBe(true);
  });

  describe("afterDelay", () => {
    it("saves once the buffer has been quiet for the delay", async () => {
      const { save } = mount("afterDelay", 1000);
      type("!");
      act(() => vi.advanceTimersByTime(999));
      expect(save).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(save).toHaveBeenCalledTimes(1);
      expect(useDiffStore.getState().dirty).toBe(false);
    });

    it("restarts the wait on every keystroke", async () => {
      const { save } = mount("afterDelay", 1000);
      type("!");
      act(() => vi.advanceTimersByTime(600));
      type("?", 1, 4);
      act(() => vi.advanceTimersByTime(600));
      expect(save).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(400));
      expect(save).toHaveBeenCalledTimes(1);
    });

    it("does not save while an IME composition is in flight", async () => {
      const { save } = mount("afterDelay", 1000);
      type("!");
      act(() => useDiffStore.getState().beginComposition());
      act(() => useDiffStore.getState().updateComposition("か"));
      await act(() => vi.advanceTimersByTimeAsync(3000));
      expect(save).not.toHaveBeenCalled();
      act(() => useDiffStore.getState().endComposition("か"));
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(save).toHaveBeenCalledTimes(1);
    });

    it("pauses while the changed-on-disk banner is up and resumes on Keep", async () => {
      const { save } = mount("afterDelay", 1000);
      type("!");
      act(() => useDiffStore.getState().setDiskChanged(true));
      await act(() => vi.advanceTimersByTimeAsync(3000));
      expect(save).not.toHaveBeenCalled();
      act(() => useDiffStore.getState().setDiskChanged(false));
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(save).toHaveBeenCalledTimes(1);
    });

    it("stands down when the edits are undone before the delay", async () => {
      const { save } = mount("afterDelay", 1000);
      type("!");
      act(() => useDiffStore.getState().undo());
      expect(useDiffStore.getState().dirty).toBe(false);
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(save).not.toHaveBeenCalled();
    });

    it("starts the clock for edits that predate the mode", async () => {
      const { save, rerender } = mount("off", 1000);
      type("!");
      act(() => vi.advanceTimersByTime(5000));
      expect(save).not.toHaveBeenCalled();
      rerender("afterDelay");
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(save).toHaveBeenCalledTimes(1);
    });

    it("writes again for a keystroke typed while a save is in flight", async () => {
      let release: () => void = () => {};
      const save = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            const content = useDiffStore.getState().right;
            release = () => {
              useDiffStore.getState().markSaved(content);
              resolve(true);
            };
          }),
      );
      mount("afterDelay", 1000, save);
      type("!");
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(save).toHaveBeenCalledTimes(1);
      // Typed during the write: not in what is being written.
      type("?", 1, 4);
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(save).toHaveBeenCalledTimes(1);
      await act(async () => release());
      expect(useDiffStore.getState().dirty).toBe(true);
      expect(save).toHaveBeenCalledTimes(2);
      await act(async () => release());
      expect(useDiffStore.getState().dirty).toBe(false);
    });
  });

  describe("onFocusChange", () => {
    it("saves when the editor loses focus and when the window does", async () => {
      const { save, blurEditor } = mount("onFocusChange", 1000);
      type("!");
      await act(() => vi.advanceTimersByTimeAsync(5000));
      expect(save).not.toHaveBeenCalled();
      await act(async () => blurEditor());
      expect(save).toHaveBeenCalledTimes(1);
      type("?", 1, 4);
      await act(async () => window.dispatchEvent(new Event("blur")));
      expect(save).toHaveBeenCalledTimes(2);
    });

    it("issues one write when the editor and the window blur together", async () => {
      const { save, blurEditor } = mount("onFocusChange", 1000);
      type("!");
      await act(async () => {
        blurEditor();
        window.dispatchEvent(new Event("blur"));
      });
      expect(save).toHaveBeenCalledTimes(1);
    });

    it("leaves a clean buffer alone", async () => {
      const { save, blurEditor } = mount("onFocusChange", 1000);
      await act(async () => blurEditor());
      expect(save).not.toHaveBeenCalled();
    });

    it("does not save over the changed-on-disk banner", async () => {
      const { save, blurEditor } = mount("onFocusChange", 1000);
      type("!");
      act(() => useDiffStore.getState().setDiskChanged(true));
      await act(async () => blurEditor());
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe("onWindowChange", () => {
    it("saves on the window's blur only", async () => {
      const { save, blurEditor } = mount("onWindowChange", 1000);
      type("!");
      await act(async () => blurEditor());
      expect(save).not.toHaveBeenCalled();
      await act(async () => window.dispatchEvent(new Event("blur")));
      expect(save).toHaveBeenCalledTimes(1);
    });
  });

  it("drops its listeners when the mode changes", async () => {
    const { save, rerender } = mount("onWindowChange", 1000);
    rerender("off");
    type("!");
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(save).not.toHaveBeenCalled();
  });
});

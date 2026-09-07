import { useCallback, useEffect, useRef } from "react";
import { bridge } from "../../shared/bridge";
import type { AutoSaveMode, WindowState } from "../../shared/bridge/types";
import {
  type DiffStoreState,
  editableSide,
  useDiffStore,
} from "../../shared/store/diff-store";

/** What App hands the hook: the same save Cmd+S runs, behind a ref. */
export interface SaveRef {
  readonly current: () => Promise<boolean>;
}

/**
 * Where the host is rendering this diff, as it puts on the webview payload.
 * A floating window is its own OS window; an editor tab shares VS Code's.
 */
export type SurfacePresentation = "floatingWindow" | "editorTab";

export interface AutoSaveControls {
  /** The editable pane lost focus: `onFocusChange` saves here. */
  onEditorBlur: () => void;
}

/**
 * Whether an autosave may run right now. Unsaved edits are the reason; an
 * IME composition in flight is text the user has not committed yet; and the
 * changed-on-disk banner is a question the user has not answered, so writing
 * over the disk while it is up would decide it for them.
 */
export function canAutoSave(state: {
  dirty: boolean;
  composition: unknown;
  diskChanged: boolean;
}): boolean {
  return state.dirty && !state.composition && !state.diskChanged;
}

function editableText(state: DiffStoreState): string | null {
  const side = editableSide(state);
  if (!side) return null;
  return side === "left" ? state.left : state.right;
}

/**
 * VS Code's `files.autoSave`, applied to the editable side of a diff.
 *
 * `afterDelay` runs one timer that restarts on every edit and fires once the
 * buffer has been quiet for `delay` ms. `onFocusChange` saves when the editor
 * loses focus, whether to another element in the webview or to another part
 * of VS Code. `onWindowChange` saves only when the window loses focus.
 * `off` does nothing. Every mode is subject to `canAutoSave`.
 *
 * "The window" depends on where the host put the diff, which is why the
 * presentation is an argument. A floating diff window is its own window, so
 * the webview's own blur is the window's blur. An editor tab shares VS
 * Code's window, and a webview iframe blurs whenever focus leaves it (to the
 * Explorer, the terminal, another editor group), which is focus-change
 * semantics rather than window-change. Docked, the hook therefore ignores
 * its own blur and waits for the host's `windowStateChanged`.
 */
export function useAutoSave(
  mode: AutoSaveMode,
  delay: number,
  save: SaveRef,
  presentation: SurfacePresentation = "floatingWindow",
): AutoSaveControls {
  // Saves serialise: a second trigger while one write is in flight queues
  // exactly one more, run only if there is still something to save. Two
  // triggers can land in the same tick (the textarea's blur and the
  // window's), and an edit typed during a save must not be lost either.
  const inFlight = useRef<Promise<void> | null>(null);
  const queued = useRef(false);
  const requestSave = useCallback(() => {
    if (!canAutoSave(useDiffStore.getState())) return;
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    // A save that failed reports false rather than throwing, and a rejection
    // means the same thing. Either way the queued trigger is dropped without
    // running: the failure has put its own error up, and writing again at
    // once would only repeat it. The next edit or blur tries again.
    const run = (): Promise<void> =>
      save
        .current()
        .catch(() => false)
        .then((saved) => {
          const again = queued.current;
          queued.current = false;
          if (!saved || !again) return;
          if (canAutoSave(useDiffStore.getState())) return run();
        });
    inFlight.current = run().finally(() => {
      inFlight.current = null;
    });
  }, [save]);

  useEffect(() => {
    if (mode !== "afterDelay") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = () => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    };
    const arm = () => {
      clear();
      timer = setTimeout(() => {
        timer = null;
        requestSave();
      }, delay);
    };
    // Edits that predate this mode, because the setting just changed or the
    // banner just closed, start the clock as well.
    if (canAutoSave(useDiffStore.getState())) arm();
    const unsubscribe = useDiffStore.subscribe((state, previous) => {
      if (!canAutoSave(state)) {
        clear();
        return;
      }
      // Every edit restarts the wait, and so does becoming saveable again:
      // a composition ending or the disk banner being answered with "Keep".
      if (
        editableText(state) !== editableText(previous) ||
        !canAutoSave(previous)
      )
        arm();
    });
    return () => {
      clear();
      unsubscribe();
    };
  }, [mode, delay, requestSave]);

  useEffect(() => {
    if (mode !== "onFocusChange" && mode !== "onWindowChange") return;
    if (mode === "onWindowChange" && presentation === "editorTab") {
      return bridge.onEvent((event, data) => {
        if (event !== "windowStateChanged") return;
        if ((data as WindowState | undefined)?.focused === false) requestSave();
      });
    }
    const onBlur = () => requestSave();
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [mode, presentation, requestSave]);

  const onEditorBlur = useCallback(() => {
    if (mode === "onFocusChange") requestSave();
  }, [mode, requestSave]);

  return { onEditorBlur };
}

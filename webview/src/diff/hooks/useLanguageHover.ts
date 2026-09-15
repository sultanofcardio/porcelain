import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "../../shared/bridge";
import type {
  AutoSaveMode,
  DefinitionResult,
  HoverResult,
} from "../../shared/bridge/types";
import {
  caretOn,
  editableSide,
  referencePane,
  useDiffStore,
} from "../../shared/store/diff-store";
import { type Side, splitLines } from "../utils/diff-model";
import {
  type LineSpan,
  type LinkRange,
  linkModifierHeld,
  linkModifierName,
  type PointerTarget,
  type TextAnchor,
  wordAtCaret,
} from "../utils/text-target";

/** What the hover card shows, and the word it is about. */
export interface HoverCardState {
  /** The word the card explains: a pointer resting on it keeps the card. */
  key: string;
  anchor: TextAnchor;
  contents: string[];
  /** A sentence in place of contents, when the card cannot ask. */
  notice: string | null;
  /** The status line: how to go to the definition, once one is known. */
  hint: string | null;
}

export interface LanguageHoverOptions {
  /** `editor.hover.enabled`: whether a resting pointer asks at all. */
  enabled: boolean;
  /** `editor.hover.delay`, in ms: how long the pointer rests first. */
  delay: number;
  /** `files.autoSave`: whether a dirty side will catch up on its own. */
  autoSave: AutoSaveMode;
  /** The ref and path the host reads a side from. */
  sideRef: (side: Side) => string;
  sidePath: (side: Side) => string;
  /** Whether there are text panes to hover over at all. */
  active: boolean;
}

export interface LanguageHover {
  card: HoverCardState | null;
  /** The definition link to underline, while the modifier is held over one. */
  link: LinkRange | null;
  /** The panes report what the pointer rests on, and null when it leaves. */
  onPointerText: (target: PointerTarget | null) => void;
  /** A modifier-click on a word: go to its definition. */
  onActivateLink: (target: PointerTarget) => void;
  onCardEnter: () => void;
  onCardLeave: () => void;
  /** Hide the card. Answers whether one was showing. */
  dismiss: () => boolean;
  /** ⌘K ⌘I: the hover at the active pane's caret. */
  showAtCaret: () => void;
  /** F12: the definition at the active pane's caret. */
  goToDefinitionAtCaret: () => void;
}

/**
 * How long a card outlives the pointer leaving its word: enough to reach
 * the card, VS Code's own `editor.hover.hidingDelay`.
 */
const HIDE_DELAY = 300;

const EMPTY_HOVER: HoverResult = { kind: "hover", contents: [] };
const EMPTY_DEFINITION: DefinitionResult = {
  kind: "definition",
  targets: [],
  origin: null,
};

/** What the card says on a side whose buffer has moved past the disk. */
export const SAVE_NOTICE = "Save to enable hover";

function keyOf(side: Side, line: number, span: LineSpan): string {
  return `${side}:${line}:${span.start}:${span.end}`;
}

function targetKey(target: PointerTarget | null): string | null {
  return target?.word ? keyOf(target.side, target.line, target.word) : null;
}

/** The status line once a definition is known for the card's word. */
function definitionHint(): string {
  return `${linkModifierName()} click to go to definition · F12 from the caret`;
}

/**
 * Hover popovers and go to definition over the diff panes, through the
 * host's language channel.
 *
 * The panes resolve the pointer to a word and report it; this hook owns the
 * dwell timer, the requests and the card. A hover is asked for once the
 * pointer has rested on a word for the configured delay, and shown only if
 * the pointer is still there when the answer lands. Every rest asks anew: a
 * language server still starting answers with a placeholder, and an answer
 * remembered past that start would be the placeholder for good. Only a
 * request still in flight is shared. An edit drops the card, since every
 * position has moved.
 *
 * Where the editable side's buffer has unsaved edits, the language server's
 * document and the pane disagree, so hover and definition stay quiet on
 * that side until the next save. With autosave off the card says so once
 * per dirty stretch, then stays quiet.
 */
export function useLanguageHover(options: LanguageHoverOptions): LanguageHover {
  const [card, setCard] = useState<HoverCardState | null>(null);
  const [link, setLink] = useState<LinkRange | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const cardRef = useRef(card);
  cardRef.current = card;
  const targetRef = useRef<PointerTarget | null>(null);
  const modifierRef = useRef(false);
  const overCard = useRef(false);
  const dwell = useRef<number | null>(null);
  const hide = useRef<number | null>(null);
  const hovers = useRef(new Map<string, Promise<HoverResult>>());
  const definitions = useRef(new Map<string, Promise<DefinitionResult>>());
  /** The last definition answer, for the card's status line. */
  const known = useRef<{ key: string; result: DefinitionResult } | null>(null);
  const noticed = useRef(false);
  /** Bumped by every reset: an answer from before it speaks of other text. */
  const generation = useRef(0);

  const api = useMemo(() => {
    const clear = (timer: { current: number | null }) => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };

    const dismiss = (): boolean => {
      clear(dwell);
      clear(hide);
      overCard.current = false;
      const shown = cardRef.current !== null;
      if (shown) setCard(null);
      return shown;
    };

    const scheduleHide = () => {
      clear(hide);
      hide.current = window.setTimeout(() => {
        hide.current = null;
        if (overCard.current) return;
        setCard(null);
      }, HIDE_DELAY);
    };

    /** Why a side cannot be asked right now, or null. */
    const suppressed = (side: Side): boolean => {
      const state = useDiffStore.getState();
      return editableSide(state) === side && state.dirty;
    };

    const query = <T>(
      kind: "hover" | "definition",
      side: Side,
      line: number,
      character: number,
    ): Promise<T> => {
      const { sideRef, sidePath } = optionsRef.current;
      return bridge.request("languageQuery", {
        kind,
        ref: sideRef(side),
        path: sidePath(side),
        line,
        character,
      }) as Promise<T>;
    };

    /** One request per word at a time; a second asker joins the first. */
    const inFlight = <T>(
      pending: Map<string, Promise<T>>,
      key: string,
      ask: () => Promise<T>,
    ): Promise<T> => {
      let promise = pending.get(key);
      if (!promise) {
        promise = ask().finally(() => {
          if (pending.get(key) === promise) pending.delete(key);
        });
        pending.set(key, promise);
      }
      return promise;
    };

    const hoverAt = (side: Side, line: number, span: LineSpan) =>
      inFlight(hovers.current, keyOf(side, line, span), () =>
        query<HoverResult>("hover", side, line, span.start).then(
          (result) => (result?.kind === "hover" ? result : EMPTY_HOVER),
          () => EMPTY_HOVER,
        ),
      );

    const definitionAt = (side: Side, line: number, span: LineSpan) => {
      const key = keyOf(side, line, span);
      const asked = generation.current;
      return inFlight(definitions.current, key, () =>
        query<DefinitionResult>("definition", side, line, span.start).then(
          (result) => {
            const answer =
              result?.kind === "definition" ? result : EMPTY_DEFINITION;
            if (asked === generation.current) {
              known.current = { key, result: answer };
            }
            return answer;
          },
          () => EMPTY_DEFINITION,
        ),
      );
    };

    const hintFor = (key: string): string | null =>
      known.current?.key === key && known.current.result.targets.length > 0
        ? definitionHint()
        : null;

    const open = (result: DefinitionResult) => {
      if (result.targets.length === 0) return;
      void bridge.request("openLocation", { targets: result.targets });
    };

    const requestHover = async (
      target: PointerTarget,
      span: LineSpan,
      key: string,
    ) => {
      if (suppressed(target.side)) {
        if (optionsRef.current.autoSave === "off" && !noticed.current) {
          noticed.current = true;
          setCard({
            key,
            anchor: target.anchor,
            contents: [],
            notice: SAVE_NOTICE,
            hint: null,
          });
        }
        return;
      }
      const asked = generation.current;
      const result = await hoverAt(target.side, target.line, span);
      // Only a pointer still resting on the word, over text that has not
      // moved on, gets its answer.
      if (asked !== generation.current || suppressed(target.side)) return;
      const current = targetRef.current;
      if (!current || targetKey(current) !== key) return;
      if (result.contents.length === 0) return;
      clear(hide);
      setCard({
        key,
        anchor: current.anchor,
        contents: result.contents,
        notice: null,
        hint: hintFor(key),
      });
    };

    const resolveLink = async (
      target: PointerTarget,
      span: LineSpan,
      key: string,
    ) => {
      if (suppressed(target.side)) {
        setLink(null);
        return;
      }
      const asked = generation.current;
      const result = await definitionAt(target.side, target.line, span);
      if (asked !== generation.current || suppressed(target.side)) return;
      const current = targetRef.current;
      if (!current || targetKey(current) !== key || !modifierRef.current) {
        return;
      }
      if (result.targets.length === 0) {
        setLink(null);
        return;
      }
      // The providers' own span for the symbol, where it stays on the line;
      // the word otherwise.
      const origin = result.origin;
      const range =
        origin &&
        origin.start.line === target.line &&
        origin.end.line === target.line
          ? { start: origin.start.character, end: origin.end.character }
          : span;
      setLink({ side: target.side, line: target.line, ...range });
      setCard((shown) =>
        shown && shown.key === key && shown.notice === null
          ? { ...shown, hint: hintFor(key) }
          : shown,
      );
    };

    const onPointerText = (target: PointerTarget | null) => {
      const previous = targetRef.current;
      targetRef.current = target;
      if (target) modifierRef.current = target.modifier;
      const key = targetKey(target);
      const previousKey = targetKey(previous);
      const modifierChanged =
        target !== null &&
        previous !== null &&
        target.modifier !== previous.modifier;
      if (key === previousKey && !modifierChanged) return;
      clear(dwell);
      const shown = cardRef.current;
      // The card outlives the pointer leaving its word only long enough to
      // be reached; back on the word, it stays.
      if (shown && shown.key !== key) scheduleHide();
      if (!target || !key || !target.word) {
        setLink(null);
        return;
      }
      const span = target.word;
      if (shown && shown.key === key) clear(hide);
      const { enabled, delay, active } = optionsRef.current;
      if (enabled && active && !(shown && shown.key === key)) {
        dwell.current = window.setTimeout(() => {
          dwell.current = null;
          void requestHover(target, span, key);
        }, delay);
      }
      if (target.modifier) void resolveLink(target, span, key);
      else setLink(null);
    };

    const onActivateLink = (target: PointerTarget) => {
      if (!target.word || suppressed(target.side)) return;
      dismiss();
      void definitionAt(target.side, target.line, target.word).then(open);
    };

    /** The active pane's caret as a target: its word, and where it is drawn. */
    const caretTarget = () => {
      const state = useDiffStore.getState();
      if (state.loading || state.fallback || !optionsRef.current.active) {
        return null;
      }
      const side = referencePane(state);
      const caret = caretOn(state, side);
      if (!caret) return null;
      const text =
        splitLines(side === "left" ? state.left : state.right)[caret.line] ??
        "";
      const span = wordAtCaret(text, caret.col) ?? {
        start: caret.col,
        end: Math.min(text.length, caret.col + 1),
      };
      return { side, line: caret.line, span };
    };

    const showAtCaret = () => {
      const target = caretTarget();
      if (!target || suppressed(target.side)) return;
      const anchor = caretAnchor();
      if (!anchor) return;
      const key = keyOf(target.side, target.line, target.span);
      const asked = generation.current;
      void hoverAt(target.side, target.line, target.span).then((result) => {
        if (asked !== generation.current || suppressed(target.side)) return;
        if (result.contents.length === 0) return;
        clear(hide);
        setCard({
          key,
          anchor,
          contents: result.contents,
          notice: null,
          hint: hintFor(key),
        });
      });
    };

    const goToDefinitionAtCaret = () => {
      const target = caretTarget();
      if (!target || suppressed(target.side)) return;
      void definitionAt(target.side, target.line, target.span).then(open);
    };

    const onCardEnter = () => {
      overCard.current = true;
      clear(hide);
    };
    const onCardLeave = () => {
      overCard.current = false;
      scheduleHide();
    };

    /** A change of the modifier without the pointer moving: re-read the target. */
    const onModifier = (held: boolean) => {
      if (held === modifierRef.current) return;
      modifierRef.current = held;
      const target = targetRef.current;
      if (target) onPointerText({ ...target, modifier: held });
    };

    return {
      dismiss,
      onPointerText,
      onActivateLink,
      onCardEnter,
      onCardLeave,
      showAtCaret,
      goToDefinitionAtCaret,
      onModifier,
      reset: () => {
        // Answers still in flight speak of the old text; nothing waits on
        // them any more, and a fresh rest asks afresh.
        generation.current += 1;
        hovers.current.clear();
        definitions.current.clear();
        known.current = null;
        setLink(null);
        dismiss();
      },
      clearTimers: () => {
        clear(dwell);
        clear(hide);
      },
    };
  }, []);

  // Every position moved with either text: what was cached names other text
  // now, so the answers and the card go. The save notice is said once per
  // dirty stretch, and a save starts the next one.
  useEffect(
    () =>
      useDiffStore.subscribe((state, previous) => {
        if (state.left !== previous.left || state.right !== previous.right) {
          api.reset();
        }
        if (!state.dirty) noticed.current = false;
      }),
    [api],
  );

  useEffect(() => api.clearTimers, [api]);

  // The modifier can change while the pointer holds still, and the link has
  // to follow it: pressed, the word underlines; released, it stops.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) =>
      api.onModifier(linkModifierHeld(event));
    const onBlur = () => api.onModifier(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [api]);

  // The card is anchored to a point on screen: scrolling anything under it
  // moves the text out from under it, and a press anywhere but on the card
  // is the reader turning to something else. Scrolling the card itself is
  // reading it.
  useEffect(() => {
    const outsideCard = (event: Event): boolean => {
      if (!cardRef.current) return false;
      const target = event.target as Element | null;
      return !target?.closest?.(".diff-hover");
    };
    const onScroll = (event: Event) => {
      if (outsideCard(event)) api.dismiss();
    };
    const onMouseDown = (event: MouseEvent) => {
      if (outsideCard(event)) api.dismiss();
    };
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("mousedown", onMouseDown, true);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [api]);

  const showAtCaret = useCallback(() => api.showAtCaret(), [api]);
  const goToDefinitionAtCaret = useCallback(
    () => api.goToDefinitionAtCaret(),
    [api],
  );

  return {
    card,
    link,
    onPointerText: api.onPointerText,
    onActivateLink: api.onActivateLink,
    onCardEnter: api.onCardEnter,
    onCardLeave: api.onCardLeave,
    dismiss: api.dismiss,
    showAtCaret,
    goToDefinitionAtCaret,
  };
}

/**
 * Where the active pane draws its caret, for a card asked for from the
 * keyboard. The editable side's caret is the editor's; a read-only pane's is
 * its own, found through the side the pane is marked with; the unified view
 * draws the one caret it has. A caret scrolled out of view is not drawn, and
 * a card for it would have nothing to point at.
 */
function caretAnchor(): TextAnchor | null {
  const state = useDiffStore.getState();
  const side = referencePane(state);
  const selector =
    state.viewMode === "unified"
      ? ".diff-unified .diff-readonly-caret"
      : editableSide(state) === side
        ? ".diff-editor-caret"
        : `.diff-pane[data-side="${side}"] .diff-readonly-caret`;
  const element = document.querySelector(selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
  };
}

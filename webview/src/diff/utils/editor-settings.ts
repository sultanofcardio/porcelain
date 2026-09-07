import type { AutoSaveMode, EditorSettings } from "../../shared/bridge/types";

/**
 * The webview end of the settings channel. The host reads VS Code's settings
 * and sends them twice: as strings on the root element's data-* attributes
 * when the diff opens, and as a typed `configChanged` payload on every later
 * change. Both arrive here and leave as one `EditorSettings`, with VS Code's
 * own defaults standing in for anything missing or malformed.
 */

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  autoSave: "off",
  autoSaveDelay: 1000,
  hoverEnabled: true,
  hoverDelay: 300,
};

const AUTO_SAVE_MODES: ReadonlySet<string> = new Set<AutoSaveMode>([
  "off",
  "afterDelay",
  "onFocusChange",
  "onWindowChange",
]);

interface RawSettings {
  autoSave?: unknown;
  autoSaveDelay?: unknown;
  hoverEnabled?: unknown;
  hoverDelay?: unknown;
}

function normalize(raw: RawSettings): EditorSettings {
  return {
    autoSave:
      typeof raw.autoSave === "string" && AUTO_SAVE_MODES.has(raw.autoSave)
        ? (raw.autoSave as AutoSaveMode)
        : DEFAULT_EDITOR_SETTINGS.autoSave,
    autoSaveDelay: delayOf(
      raw.autoSaveDelay,
      DEFAULT_EDITOR_SETTINGS.autoSaveDelay,
    ),
    hoverEnabled: flagOf(
      raw.hoverEnabled,
      DEFAULT_EDITOR_SETTINGS.hoverEnabled,
    ),
    hoverDelay: delayOf(raw.hoverDelay, DEFAULT_EDITOR_SETTINGS.hoverDelay),
  };
}

/** A non-negative whole number of milliseconds, from a number or its string. */
function delayOf(value: unknown, fallback: number): number {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function flagOf(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/** The settings as the diff webview's html carries them. */
export function editorSettingsFromDataset(
  dataset: DOMStringMap,
): EditorSettings {
  return normalize({
    autoSave: dataset.autoSave,
    autoSaveDelay: dataset.autoSaveDelay,
    hoverEnabled: dataset.hoverEnabled,
    hoverDelay: dataset.hoverDelay,
  });
}

/** The settings as a `configChanged` event carries them. */
export function editorSettingsFromEvent(data: unknown): EditorSettings {
  return normalize(
    typeof data === "object" && data !== null ? (data as RawSettings) : {},
  );
}

/**
 * What the dirty dot's tooltip says. The dot keeps one meaning across every
 * mode, unsaved edits; the tooltip is where the mode shows, so a reader can
 * tell whether the dot will clear on its own.
 */
export function autoSaveHint(settings: EditorSettings): string {
  switch (settings.autoSave) {
    case "afterDelay":
      return `Unsaved changes, autosaves after ${formatDelay(settings.autoSaveDelay)}`;
    case "onFocusChange":
      return "Unsaved changes, autosaves when the editor loses focus";
    case "onWindowChange":
      return "Unsaved changes, autosaves when the window loses focus";
    default:
      return "Unsaved changes, Cmd+S saves";
  }
}

function formatDelay(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  // "1 s", "1.5 s", "2.25 s": whole seconds without a trailing ".0".
  return `${Number((ms / 1000).toFixed(2))} s`;
}

import * as vscode from "vscode";
import type { AutoSaveMode, EditorSettings } from "../messages/protocol";

/**
 * The settings channel: the handful of VS Code editor settings the Porcelain
 * diff surface honours, read here on the host, where the settings live, and
 * handed to the webview as plain values. The webview reads no settings of
 * its own.
 */

/** The setting keys forwarded, the way `affectsConfiguration` names them. */
export const EDITOR_SETTING_KEYS = [
  "files.autoSave",
  "files.autoSaveDelay",
  "editor.hover.enabled",
  "editor.hover.delay",
] as const;

/** VS Code's own defaults, used wherever a value is missing or malformed. */
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

/**
 * Coerce raw setting values into the shape the webview relies on. Settings
 * files are user-edited JSON, so a mode can be misspelt and a delay can be
 * negative or a string; each such value falls back to VS Code's default for
 * that key rather than taking the others down with it.
 */
export function normalizeEditorSettings(
  raw: Partial<Record<keyof EditorSettings, unknown>>,
): EditorSettings {
  return {
    autoSave:
      typeof raw.autoSave === "string" && AUTO_SAVE_MODES.has(raw.autoSave)
        ? (raw.autoSave as AutoSaveMode)
        : DEFAULT_EDITOR_SETTINGS.autoSave,
    autoSaveDelay: delayOf(
      raw.autoSaveDelay,
      DEFAULT_EDITOR_SETTINGS.autoSaveDelay,
    ),
    hoverEnabled:
      typeof raw.hoverEnabled === "boolean"
        ? raw.hoverEnabled
        : DEFAULT_EDITOR_SETTINGS.hoverEnabled,
    hoverDelay: delayOf(raw.hoverDelay, DEFAULT_EDITOR_SETTINGS.hoverDelay),
  };
}

function delayOf(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

/**
 * Read the forwarded settings as VS Code resolves them for `scope`: the
 * folder the file sits in, so a workspace that autosaves one folder and not
 * another is honoured per diff.
 */
export function readEditorSettings(
  scope?: vscode.ConfigurationScope,
): EditorSettings {
  const files = vscode.workspace.getConfiguration("files", scope);
  const hover = vscode.workspace.getConfiguration("editor.hover", scope);
  return normalizeEditorSettings({
    autoSave: files.get("autoSave"),
    autoSaveDelay: files.get("autoSaveDelay"),
    hoverEnabled: hover.get("enabled"),
    hoverDelay: hover.get("delay"),
  });
}

/** Whether a configuration change touches any forwarded key for `scope`. */
export function affectsEditorSettings(
  event: vscode.ConfigurationChangeEvent,
  scope?: vscode.ConfigurationScope,
): boolean {
  return EDITOR_SETTING_KEYS.some((key) =>
    event.affectsConfiguration(key, scope),
  );
}

/**
 * The settings as data-* attributes for the diff webview's html. Every value
 * is a string on the wire; the webview parses them back.
 */
export function editorSettingsAttrs(
  settings: EditorSettings,
): Record<string, string> {
  return {
    "auto-save": settings.autoSave,
    "auto-save-delay": String(settings.autoSaveDelay),
    "hover-enabled": String(settings.hoverEnabled),
    "hover-delay": String(settings.hoverDelay),
  };
}

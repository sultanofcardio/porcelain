import * as assert from "node:assert";
import * as vscode from "vscode";
import {
  affectsEditorSettings,
  DEFAULT_EDITOR_SETTINGS,
  EDITOR_SETTING_KEYS,
  editorSettingsAttrs,
  normalizeEditorSettings,
  readEditorSettings,
} from "../../views/editorSettings";

describe("normalizeEditorSettings", () => {
  it("passes well-formed values through", () => {
    assert.deepStrictEqual(
      normalizeEditorSettings({
        autoSave: "afterDelay",
        autoSaveDelay: 250,
        hoverEnabled: false,
        hoverDelay: 500,
      }),
      {
        autoSave: "afterDelay",
        autoSaveDelay: 250,
        hoverEnabled: false,
        hoverDelay: 500,
      },
    );
  });

  it("falls back per key, so one bad value does not reset the others", () => {
    assert.deepStrictEqual(
      normalizeEditorSettings({
        autoSave: "sometimes",
        autoSaveDelay: -5,
        hoverEnabled: "yes",
        hoverDelay: Number.NaN,
      }),
      DEFAULT_EDITOR_SETTINGS,
    );
    assert.strictEqual(
      normalizeEditorSettings({
        autoSave: "onWindowChange",
        autoSaveDelay: "1",
      }).autoSave,
      "onWindowChange",
    );
  });

  it("floors fractional delays to whole milliseconds", () => {
    assert.strictEqual(
      normalizeEditorSettings({ autoSaveDelay: 1500.9 }).autoSaveDelay,
      1500,
    );
  });
});

describe("editorSettingsAttrs", () => {
  it("serialises every value as a data-* string", () => {
    assert.deepStrictEqual(
      editorSettingsAttrs({
        autoSave: "onFocusChange",
        autoSaveDelay: 1000,
        hoverEnabled: true,
        hoverDelay: 300,
      }),
      {
        "auto-save": "onFocusChange",
        "auto-save-delay": "1000",
        "hover-enabled": "true",
        "hover-delay": "300",
      },
    );
  });
});

describe("affectsEditorSettings", () => {
  it("answers for exactly the forwarded keys", () => {
    for (const key of EDITOR_SETTING_KEYS) {
      const event = {
        affectsConfiguration: (section: string) => section === key,
      } as vscode.ConfigurationChangeEvent;
      assert.ok(affectsEditorSettings(event), key);
    }
    const unrelated = {
      affectsConfiguration: (section: string) => section === "editor.fontSize",
    } as vscode.ConfigurationChangeEvent;
    assert.strictEqual(affectsEditorSettings(unrelated), false);
  });

  it("passes the scope through, so a folder-level change is seen as one", () => {
    const scope = vscode.Uri.file("/repo/src/app.ts");
    const seen: unknown[] = [];
    const event = {
      affectsConfiguration: (_section: string, s: unknown) => {
        seen.push(s);
        return false;
      },
    } as vscode.ConfigurationChangeEvent;
    affectsEditorSettings(event, scope);
    assert.deepStrictEqual(
      seen,
      EDITOR_SETTING_KEYS.map(() => scope),
    );
  });
});

describe("readEditorSettings", () => {
  const files = () => vscode.workspace.getConfiguration("files");

  afterEach(async () => {
    await files().update(
      "autoSave",
      undefined,
      vscode.ConfigurationTarget.Global,
    );
    await files().update(
      "autoSaveDelay",
      undefined,
      vscode.ConfigurationTarget.Global,
    );
  });

  it("reads the mode and delay VS Code resolves", async () => {
    await files().update(
      "autoSave",
      "afterDelay",
      vscode.ConfigurationTarget.Global,
    );
    await files().update(
      "autoSaveDelay",
      750,
      vscode.ConfigurationTarget.Global,
    );
    const settings = readEditorSettings(vscode.Uri.file("/repo/src/app.ts"));
    assert.strictEqual(settings.autoSave, "afterDelay");
    assert.strictEqual(settings.autoSaveDelay, 750);
    // The hover keys are VS Code's, with VS Code's defaults.
    assert.strictEqual(settings.hoverEnabled, true);
    assert.strictEqual(settings.hoverDelay, 300);
  });
});

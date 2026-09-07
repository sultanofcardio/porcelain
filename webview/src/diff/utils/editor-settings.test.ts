import { describe, expect, it } from "vitest";
import {
  autoSaveHint,
  DEFAULT_EDITOR_SETTINGS,
  editorSettingsFromDataset,
  editorSettingsFromEvent,
} from "./editor-settings";

describe("editorSettingsFromDataset", () => {
  it("parses the strings the html carries", () => {
    expect(
      editorSettingsFromDataset({
        autoSave: "afterDelay",
        autoSaveDelay: "250",
        hoverEnabled: "false",
        hoverDelay: "600",
      }),
    ).toEqual({
      autoSave: "afterDelay",
      autoSaveDelay: 250,
      hoverEnabled: false,
      hoverDelay: 600,
    });
  });

  it("defaults every key that is missing or malformed, independently", () => {
    expect(editorSettingsFromDataset({})).toEqual(DEFAULT_EDITOR_SETTINGS);
    expect(
      editorSettingsFromDataset({
        autoSave: "onFocusChange",
        autoSaveDelay: "soon",
        hoverEnabled: "maybe",
        hoverDelay: "-1",
      }),
    ).toEqual({ ...DEFAULT_EDITOR_SETTINGS, autoSave: "onFocusChange" });
  });
});

describe("editorSettingsFromEvent", () => {
  it("accepts the host's typed payload", () => {
    expect(
      editorSettingsFromEvent({
        autoSave: "onWindowChange",
        autoSaveDelay: 2000,
        hoverEnabled: true,
        hoverDelay: 100,
      }),
    ).toEqual({
      autoSave: "onWindowChange",
      autoSaveDelay: 2000,
      hoverEnabled: true,
      hoverDelay: 100,
    });
  });

  it("treats a payload that is not an object as all defaults", () => {
    expect(editorSettingsFromEvent(null)).toEqual(DEFAULT_EDITOR_SETTINGS);
    expect(editorSettingsFromEvent("afterDelay")).toEqual(
      DEFAULT_EDITOR_SETTINGS,
    );
  });
});

describe("autoSaveHint", () => {
  const settings = (
    overrides: Partial<typeof DEFAULT_EDITOR_SETTINGS>,
  ): typeof DEFAULT_EDITOR_SETTINGS => ({
    ...DEFAULT_EDITOR_SETTINGS,
    ...overrides,
  });

  it("names the manual save when autosave is off", () => {
    expect(autoSaveHint(settings({}))).toBe("Unsaved changes, Cmd+S saves");
  });

  it("states the delay in seconds, trimmed", () => {
    expect(
      autoSaveHint(settings({ autoSave: "afterDelay", autoSaveDelay: 1000 })),
    ).toBe("Unsaved changes, autosaves after 1 s");
    expect(
      autoSaveHint(settings({ autoSave: "afterDelay", autoSaveDelay: 1500 })),
    ).toBe("Unsaved changes, autosaves after 1.5 s");
    expect(
      autoSaveHint(settings({ autoSave: "afterDelay", autoSaveDelay: 250 })),
    ).toBe("Unsaved changes, autosaves after 250 ms");
  });

  it("names the focus modes", () => {
    expect(autoSaveHint(settings({ autoSave: "onFocusChange" }))).toBe(
      "Unsaved changes, autosaves when the editor loses focus",
    );
    expect(autoSaveHint(settings({ autoSave: "onWindowChange" }))).toBe(
      "Unsaved changes, autosaves when the window loses focus",
    );
  });
});

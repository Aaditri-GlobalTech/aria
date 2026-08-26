import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_KEYBINDINGS,
  DEFAULT_EDITOR_KEYBINDINGS,
  formatKeybinding,
  matchesKey,
} from "../src/renderer/keybindings";

type KeyboardEventFields = Pick<
  KeyboardEvent,
  "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
>;

function keyboardEvent(overrides: Partial<KeyboardEventFields>): KeyboardEvent {
  return {
    key: "",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("keybindings", () => {
  it("matches the configured defaults", () => {
    expect(
      matchesKey(
        keyboardEvent({ key: "Enter" }),
        DEFAULT_EDITOR_KEYBINDINGS.submit,
      ),
    ).toBe(true);
    expect(
      matchesKey(
        keyboardEvent({ key: "Enter", shiftKey: true }),
        DEFAULT_EDITOR_KEYBINDINGS.submit,
      ),
    ).toBe(false);
    expect(
      matchesKey(
        keyboardEvent({ key: "Enter", ctrlKey: true }),
        DEFAULT_APP_KEYBINDINGS.commit,
      ),
    ).toBe(true);
    expect(formatKeybinding(DEFAULT_APP_KEYBINDINGS.commit)).toBe("Ctrl+Enter");
  });
});

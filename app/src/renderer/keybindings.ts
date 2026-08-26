export type Keybinding = {
  key: string;
  alt?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
};

/** Prompt editor shortcuts displayed in the composer hint. */
export const DEFAULT_EDITOR_KEYBINDINGS = {
  submit: { key: "Enter", shift: false },
  newline: { key: "Enter", shift: true },
} as const;

/** Application shortcuts used by commits and panel resizing. */
export const DEFAULT_APP_KEYBINDINGS = {
  commit: { key: "Enter", ctrl: true },
  resizePanel: {
    horizontal: {
      decrease: { key: "ArrowLeft" },
      increase: { key: "ArrowRight" },
    },
    vertical: {
      decrease: { key: "ArrowDown" },
      increase: { key: "ArrowUp" },
    },
  },
} as const;

export function matchesKey(event: KeyboardEvent, binding: Keybinding): boolean {
  return (
    event.key === binding.key &&
    (binding.alt === undefined || event.altKey === binding.alt) &&
    (binding.ctrl === undefined || event.ctrlKey === binding.ctrl) &&
    (binding.meta === undefined || event.metaKey === binding.meta) &&
    (binding.shift === undefined || event.shiftKey === binding.shift)
  );
}

export function formatKeybinding(binding: Keybinding): string {
  return [
    binding.ctrl && "Ctrl",
    binding.alt && "Alt",
    binding.shift && "Shift",
    binding.meta && "Meta",
    binding.key,
  ]
    .filter((part): part is string => Boolean(part))
    .join("+");
}

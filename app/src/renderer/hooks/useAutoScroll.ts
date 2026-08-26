import { createEffect } from "solid-js";

export type ScrollMetrics = Pick<
  HTMLElement,
  "clientHeight" | "scrollHeight" | "scrollTop"
>;

const BOTTOM_TOLERANCE = 24;

export function isAtBottom(
  element: ScrollMetrics,
  tolerance = BOTTOM_TOLERANCE,
): boolean {
  return (
    element.scrollHeight - element.clientHeight - element.scrollTop <= tolerance
  );
}

export function scrollToBottom(element: ScrollMetrics): void {
  element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
}

/** Follow streamed content until the user scrolls away from the bottom. */
export function useAutoScroll<T extends ScrollMetrics>(
  content: () => unknown,
  resetKey?: () => unknown,
) {
  let element: T | undefined;
  let following = true;
  let previousKey: unknown;
  let hasPreviousKey = false;

  const onScroll = (event: Event) => {
    const target = event.currentTarget as T | null;
    if (target) following = isAtBottom(target);
  };

  createEffect(() => {
    const key = resetKey?.();
    if (!hasPreviousKey || !Object.is(key, previousKey)) {
      following = true;
      previousKey = key;
      hasPreviousKey = true;
    }
    content();

    queueMicrotask(() => {
      if (following && element) scrollToBottom(element);
    });
  });

  return {
    onScroll,
    setElement: (value: T) => {
      element = value;
    },
  };
}

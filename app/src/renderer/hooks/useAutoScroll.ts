import { createEffect, createSignal, onCleanup } from "solid-js";

/** Minimum scroll metrics required by the auto-follow helpers. */
export type ScrollMetrics = Pick<
  HTMLElement,
  "clientHeight" | "scrollHeight" | "scrollTop"
>;

const BOTTOM_TOLERANCE = 24;

/** Return whether an element is within the bottom tolerance of its content. */
export function isAtBottom(
  element: ScrollMetrics,
  tolerance = BOTTOM_TOLERANCE,
): boolean {
  return (
    element.scrollHeight - element.clientHeight - element.scrollTop <= tolerance
  );
}

/** Scroll an element to the last visible line of its content. */
export function scrollToBottom(element: ScrollMetrics): void {
  element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
}

/** Follow streamed content until the user scrolls away from the bottom. */
/** Keep a scroll container at the bottom while streamed content changes. */
export function useAutoScroll<T extends ScrollMetrics>(
  content: () => unknown,
  resetKey?: () => unknown,
) {
  let element: T | undefined;
  const [isFollowing, setIsFollowing] = createSignal(true);
  let previousKey: unknown;
  let hasPreviousKey = false;
  let scrollFrame: number | undefined;
  let microtaskScheduled = false;
  let mutationObserver: MutationObserver | undefined;
  let disposed = false;

  const scheduleScroll = () => {
    if (scrollFrame !== undefined || microtaskScheduled) return;

    if (typeof requestAnimationFrame === "function") {
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = undefined;
        if (!disposed && isFollowing() && element) scrollToBottom(element);
      });
    } else {
      microtaskScheduled = true;
      queueMicrotask(() => {
        microtaskScheduled = false;
        if (!disposed && isFollowing() && element) scrollToBottom(element);
      });
    }
  };

  const onScroll = (event: Event) => {
    const target = event.currentTarget as T | null;
    if (target) setIsFollowing(isAtBottom(target));
  };

  createEffect(() => {
    const key = resetKey?.();
    if (!hasPreviousKey || !Object.is(key, previousKey)) {
      setIsFollowing(true);
      previousKey = key;
      hasPreviousKey = true;
    }
    content();
    scheduleScroll();
  });

  onCleanup(() => {
    disposed = true;
    mutationObserver?.disconnect();
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
  });

  const jumpToBottom = () => {
    setIsFollowing(true);
    if (element) scrollToBottom(element);
  };

  return {
    isFollowing,
    jumpToBottom,
    onScroll,
    setElement: (value: T) => {
      element = value;
      mutationObserver?.disconnect();
      mutationObserver = undefined;
      if (
        typeof MutationObserver !== "undefined" &&
        typeof Element !== "undefined" &&
        value instanceof Element
      ) {
        mutationObserver = new MutationObserver(scheduleScroll);
        mutationObserver.observe(value, {
          attributes: true,
          characterData: true,
          childList: true,
          subtree: true,
        });
      }
      scheduleScroll();
    },
  };
}

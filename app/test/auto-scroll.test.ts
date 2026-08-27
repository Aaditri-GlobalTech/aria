import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import {
  isAtBottom,
  scrollToBottom,
  useAutoScroll,
} from "../src/renderer/hooks/useAutoScroll";

type ScrollMetrics = {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
};

describe("auto-scroll", () => {
  it("follows the bottom within a small tolerance", () => {
    expect(
      isAtBottom({
        clientHeight: 200,
        scrollHeight: 500,
        scrollTop: 299,
      }),
    ).toBe(true);
    expect(
      isAtBottom({
        clientHeight: 200,
        scrollHeight: 500,
        scrollTop: 270,
      }),
    ).toBe(false);
  });

  it("moves a following container to its content bottom", () => {
    const element: ScrollMetrics = {
      clientHeight: 200,
      scrollHeight: 500,
      scrollTop: 0,
    };

    scrollToBottom(element);

    expect(element.scrollTop).toBe(300);
  });

  it("keeps following when content growth emits a scroll event", async () => {
    const element: ScrollMetrics = {
      clientHeight: 200,
      scrollHeight: 500,
      scrollTop: 0,
    };
    let setContent: (value: string) => void = () => undefined;
    let onScroll: (event: Event) => void = () => undefined;
    let isFollowing: () => boolean = () => false;
    let dispose!: () => void;

    createRoot((disposeRoot) => {
      dispose = disposeRoot;
      const [content, updateContent] = createSignal("first");
      setContent = updateContent;
      const autoScroll = useAutoScroll(() => content());
      onScroll = autoScroll.onScroll;
      isFollowing = autoScroll.isFollowing;
      autoScroll.setElement(element);
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(element.scrollTop).toBe(300);

    element.scrollHeight = 800;
    setContent("second");
    onScroll({ currentTarget: element } as unknown as Event);

    expect(isFollowing()).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(element.scrollTop).toBe(600);
    dispose();
  });

  it("stops following after the user scrolls away", async () => {
    const element: ScrollMetrics = {
      clientHeight: 200,
      scrollHeight: 500,
      scrollTop: 0,
    };
    let setContent: (value: string) => void = () => undefined;
    let onScroll: (event: Event) => void = () => undefined;
    let isFollowing: () => boolean = () => false;
    let jumpToBottom: () => void = () => undefined;
    let dispose!: () => void;

    createRoot((disposeRoot) => {
      dispose = disposeRoot;
      const [content, updateContent] = createSignal("first");
      setContent = updateContent;
      const autoScroll = useAutoScroll(() => content());
      onScroll = autoScroll.onScroll;
      isFollowing = autoScroll.isFollowing;
      jumpToBottom = autoScroll.jumpToBottom;
      autoScroll.setElement(element);
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(element.scrollTop).toBe(300);

    element.scrollTop = 0;
    onScroll({ currentTarget: element } as unknown as Event);
    expect(isFollowing()).toBe(false);
    setContent("second");
    await Promise.resolve();
    await Promise.resolve();

    expect(element.scrollTop).toBe(0);
    jumpToBottom();
    expect(element.scrollTop).toBe(300);
    expect(isFollowing()).toBe(true);
    dispose();
  });
});

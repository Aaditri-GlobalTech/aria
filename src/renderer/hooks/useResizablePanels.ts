import { createSignal, onCleanup } from "solid-js";

export const MIN_SIDE_WIDTH = 170;
export const MIN_PANEL_HEIGHT = 77;
export const COLLAPSED_SIDE_WIDTH = 0;
export const COLLAPSED_PANEL_HEIGHT = 0;

const MIN_VIEW_WIDTH = 320;
const MIN_TOP_HEIGHT = 240;

export type PanelResizeTarget = "left" | "right" | "bottom";

type ResizeAxis = "column" | "row";

export function useResizablePanels() {
  const [leftPanelWidth, setLeftPanelWidth] = createSignal(240);
  const [rightPanelWidth, setRightPanelWidth] = createSignal(280);
  const [expandedPanelHeight, setExpandedPanelHeight] = createSignal(200);
  const [leftCollapsed, setLeftCollapsed] = createSignal(false);
  const [rightCollapsed, setRightCollapsed] = createSignal(true);
  const [panelCollapsed, setPanelCollapsed] = createSignal(true);
  let layout: HTMLDivElement | undefined;
  let activeResize:
    | {
        move: (event: PointerEvent) => void;
        stop: () => void;
      }
    | undefined;

  const leftWidth = () =>
    leftCollapsed() ? COLLAPSED_SIDE_WIDTH : leftPanelWidth();
  const rightWidth = () =>
    rightCollapsed() ? COLLAPSED_SIDE_WIDTH : rightPanelWidth();
  const panelHeight = () =>
    panelCollapsed() ? COLLAPSED_PANEL_HEIGHT : expandedPanelHeight();

  const setPanelSize = (target: PanelResizeTarget, size: number) => {
    if (!layout) return;

    const bounds = layout.getBoundingClientRect();

    if (target === "bottom") {
      const maxHeight = Math.max(
        MIN_PANEL_HEIGHT,
        bounds.height - MIN_TOP_HEIGHT,
      );
      setPanelCollapsed(false);
      setExpandedPanelHeight(
        Math.min(Math.max(size, MIN_PANEL_HEIGHT), maxHeight),
      );
      return;
    }

    const availableWidth = bounds.width - MIN_VIEW_WIDTH;
    const otherWidth = target === "left" ? rightWidth() : leftWidth();
    const maxWidth = Math.max(MIN_SIDE_WIDTH, availableWidth - otherWidth);
    const nextWidth = Math.min(Math.max(size, MIN_SIDE_WIDTH), maxWidth);

    if (target === "left") {
      setLeftCollapsed(false);
      setLeftPanelWidth(nextWidth);
    } else {
      setRightCollapsed(false);
      setRightPanelWidth(nextWidth);
    }
  };

  const resizeFromPointer = (
    target: PanelResizeTarget,
    clientX: number,
    clientY: number,
  ) => {
    if (!layout) return;

    const bounds = layout.getBoundingClientRect();
    setPanelSize(
      target,
      target === "left"
        ? clientX - bounds.left
        : target === "right"
          ? bounds.right - clientX
          : bounds.bottom - clientY,
    );
  };

  const stopResize = () => {
    if (!activeResize) return;

    document.removeEventListener("pointermove", activeResize.move);
    document.removeEventListener("pointerup", activeResize.stop);
    document.removeEventListener("pointercancel", activeResize.stop);
    document.body.classList.remove(
      "is-resizing",
      "is-column-resizing",
      "is-row-resizing",
    );
    activeResize = undefined;
  };

  const startResize = (target: PanelResizeTarget, event: PointerEvent) => {
    event.preventDefault();
    stopResize();

    if (event.currentTarget instanceof Element) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    const axis: ResizeAxis = target === "bottom" ? "row" : "column";
    const move = (moveEvent: PointerEvent) =>
      resizeFromPointer(target, moveEvent.clientX, moveEvent.clientY);
    activeResize = { move, stop: stopResize };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stopResize);
    document.addEventListener("pointercancel", stopResize);
    document.body.classList.add("is-resizing", `is-${axis}-resizing`);
    resizeFromPointer(target, event.clientX, event.clientY);
  };

  const handleKeyDown = (target: PanelResizeTarget, event: KeyboardEvent) => {
    const isBottom = target === "bottom";
    const validKeys = isBottom
      ? ["ArrowUp", "ArrowDown"]
      : ["ArrowLeft", "ArrowRight"];

    if (!validKeys.includes(event.key)) return;

    event.preventDefault();

    if (isBottom) {
      setPanelSize(
        target,
        panelHeight() + (event.key === "ArrowUp" ? 16 : -16),
      );
      return;
    }

    const direction = event.key === "ArrowLeft" ? -1 : 1;
    setPanelSize(
      target,
      target === "left"
        ? leftWidth() + direction * 16
        : rightWidth() - direction * 16,
    );
  };

  const toggleCollapsed = (target: PanelResizeTarget) => {
    if (target === "left") {
      setLeftCollapsed((collapsed) => !collapsed);
    } else if (target === "right") {
      setRightCollapsed((collapsed) => !collapsed);
    } else {
      setPanelCollapsed((collapsed) => !collapsed);
    }
  };

  onCleanup(stopResize);

  return {
    handleKeyDown,
    leftCollapsed,
    leftWidth,
    panelCollapsed,
    panelHeight,
    rightCollapsed,
    rightWidth,
    setLayout: (element: HTMLDivElement) => {
      layout = element;
    },
    startResize,
    toggleCollapsed,
  };
}

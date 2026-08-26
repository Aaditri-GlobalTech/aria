/** Keep panel dimensions, collapse state, and pointer lifecycle in one hook. */
import { createSignal, onCleanup } from "solid-js";
import { DEFAULT_APP_KEYBINDINGS, matchesKey } from "../keybindings";

// These values preserve a usable view while allowing panels to collapse fully.
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
  const [rightCollapsed, setRightCollapsed] = createSignal(false);
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

    // Clamp each panel against the minimum space reserved for its neighbors.

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

    // Pointer listeners live on document so dragging remains active outside the grip.

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

    // Only one drag may own the document listeners at a time.
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
    const bindings = isBottom
      ? DEFAULT_APP_KEYBINDINGS.resizePanel.vertical
      : DEFAULT_APP_KEYBINDINGS.resizePanel.horizontal;
    const increase = matchesKey(event, bindings.increase);
    const decrease = matchesKey(event, bindings.decrease);
    if (!increase && !decrease) return;

    event.preventDefault();

    const direction = increase ? 1 : -1;
    if (isBottom) {
      setPanelSize(target, panelHeight() + direction * 16);
      return;
    }

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

  // Prevent a destroyed view from leaving global pointer listeners behind.
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

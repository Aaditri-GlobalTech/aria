import type { Accessor } from "solid-js";
import {
  COLLAPSED_PANEL_HEIGHT,
  COLLAPSED_SIDE_WIDTH,
  type PanelResizeTarget,
} from "../../hooks/useResizablePanels";

/** Accessible drag/keyboard handle shared by sidebars and the bottom panel. */
type PanelResizerProps = {
  controls: string;
  label: string;
  onKeyDown: (event: KeyboardEvent) => void;
  onPointerDown: (event: PointerEvent) => void;
  target: PanelResizeTarget;
  value: Accessor<number>;
};

export function PanelResizer(props: PanelResizerProps) {
  const isBottom = props.target === "bottom";

  return (
    // Range metadata makes the visual separator usable as a keyboard control.
    <hr
      class={`panel-border ${props.target}-panel-border`}
      aria-label={props.label}
      aria-controls={props.controls}
      aria-orientation={isBottom ? "horizontal" : "vertical"}
      aria-valuemin={isBottom ? COLLAPSED_PANEL_HEIGHT : COLLAPSED_SIDE_WIDTH}
      aria-valuenow={Math.round(props.value())}
      tabIndex={0}
      on:pointerdown={props.onPointerDown}
      on:keydown={props.onKeyDown}
    />
  );
}

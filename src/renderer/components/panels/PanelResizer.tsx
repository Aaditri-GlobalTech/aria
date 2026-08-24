import type { Accessor } from "solid-js";
import {
  COLLAPSED_PANEL_HEIGHT,
  COLLAPSED_SIDE_WIDTH,
  type PanelResizeTarget,
} from "../../hooks/useResizablePanels";

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

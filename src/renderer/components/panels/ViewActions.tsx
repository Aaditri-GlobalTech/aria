export type ViewActionsProps = {
  onTogglePanel: () => void;
  onTogglePrimarySidebar: () => void;
  onToggleSecondarySidebar: () => void;
  panelCollapsed: boolean;
  primarySidebarCollapsed: boolean;
  secondarySidebarCollapsed: boolean;
};

// Keep the icon direction consistent with the action's current collapsed state.
const iconClass = (
  collapsed: boolean,
  expandedIcon: string,
  collapsedIcon: string,
) => `codicon ${collapsed ? collapsedIcon : expandedIcon}`;

/** Toolbar for toggling the three resizable workbench regions. */
export function ViewActions(props: ViewActionsProps) {
  return (
    <div class="layout-actions">
      <button
        class="layout-action"
        type="button"
        aria-label={
          props.primarySidebarCollapsed
            ? "Expand Primary Side Bar"
            : "Collapse Primary Side Bar"
        }
        aria-pressed={!props.primarySidebarCollapsed}
        on:click={props.onTogglePrimarySidebar}
      >
        <span
          class={iconClass(
            props.primarySidebarCollapsed,
            "codicon-layout-sidebar-left",
            "codicon-layout-sidebar-left-off",
          )}
          aria-hidden="true"
        />
      </button>
      <button
        class="layout-action"
        type="button"
        aria-label={props.panelCollapsed ? "Expand Panel" : "Collapse Panel"}
        aria-pressed={!props.panelCollapsed}
        on:click={props.onTogglePanel}
      >
        <span
          class={iconClass(
            props.panelCollapsed,
            "codicon-layout-panel",
            "codicon-layout-panel-off",
          )}
          aria-hidden="true"
        />
      </button>
      <button
        class="layout-action"
        type="button"
        aria-label={
          props.secondarySidebarCollapsed
            ? "Expand Secondary Side Bar"
            : "Collapse Secondary Side Bar"
        }
        aria-pressed={!props.secondarySidebarCollapsed}
        on:click={props.onToggleSecondarySidebar}
      >
        <span
          class={iconClass(
            props.secondarySidebarCollapsed,
            "codicon-layout-sidebar-right",
            "codicon-layout-sidebar-right-off",
          )}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

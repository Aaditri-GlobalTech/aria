import { useResizablePanels } from "../../hooks/useResizablePanels";
import { ActivityBar } from "../layout/ActivityBar";
import { MenuBar } from "../layout/MenuBar";
import { StatusBar } from "../layout/StatusBar";
import { PanelHeader } from "./PanelHeader";
import { PanelResizer } from "./PanelResizer";

export function PanelLayout() {
  const panels = useResizablePanels();

  return (
    <main class="app-shell">
      <MenuBar
        primarySidebarCollapsed={panels.leftCollapsed()}
        secondarySidebarCollapsed={panels.rightCollapsed()}
        panelCollapsed={panels.panelCollapsed()}
        onTogglePrimarySidebar={() => panels.toggleCollapsed("left")}
        onToggleSecondarySidebar={() => panels.toggleCollapsed("right")}
        onTogglePanel={() => panels.toggleCollapsed("bottom")}
      />

      <div class="workbench">
        <ActivityBar />

        <div
          class={`workspace-layout ${panels.leftCollapsed() ? "is-primary-sidebar-collapsed" : ""} ${panels.rightCollapsed() ? "is-secondary-sidebar-collapsed" : ""}`}
          ref={panels.setLayout}
          style={`--left-panel-width: ${panels.leftWidth()}px; --right-panel-width: ${panels.rightWidth()}px; --panel-height: ${panels.panelHeight()}px;`}
        >
          <aside
            id="primary-sidebar"
            class={`panel side-panel left-panel ${panels.leftCollapsed() ? "is-collapsed" : ""}`}
          >
            <PanelHeader title="Primary Side Bar" />
          </aside>

          <PanelResizer
            target="left"
            value={panels.leftWidth}
            label="Resize primary side bar and view border"
            controls="primary-sidebar view"
            onPointerDown={(event) => panels.startResize("left", event)}
            onKeyDown={(event) => panels.handleKeyDown("left", event)}
          />

          <div
            class={`view-area ${panels.panelCollapsed() ? "is-panel-collapsed" : ""}`}
          >
            <section id="view" class="panel view-panel">
              <div class="panel-heading">
                <h1>View</h1>
              </div>
            </section>

            <PanelResizer
              target="bottom"
              value={panels.panelHeight}
              label="Resize panel top border"
              controls="view panel"
              onPointerDown={(event) => panels.startResize("bottom", event)}
              onKeyDown={(event) => panels.handleKeyDown("bottom", event)}
            />

            <section
              id="panel"
              class={`panel bottom-panel ${panels.panelCollapsed() ? "is-collapsed" : ""}`}
            >
              <PanelHeader title="Panel" />
            </section>
          </div>

          <PanelResizer
            target="right"
            value={panels.rightWidth}
            label="Resize view and secondary side bar border"
            controls="view secondary-sidebar"
            onPointerDown={(event) => panels.startResize("right", event)}
            onKeyDown={(event) => panels.handleKeyDown("right", event)}
          />

          <aside
            id="secondary-sidebar"
            class={`panel side-panel right-panel ${panels.rightCollapsed() ? "is-collapsed" : ""}`}
          >
            <PanelHeader title="Secondary Side Bar" />
          </aside>
        </div>
      </div>

      <StatusBar />
    </main>
  );
}

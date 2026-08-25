import { createSignal, onCleanup, onMount } from "solid-js";
import { api } from "../../api";
import { ViewActions, type ViewActionsProps } from "../panels/ViewActions";

const menuItems = ["File", "Edit", "Selection", "View", "Go", "Run"];

type MenuBarProps = ViewActionsProps;

export function MenuBar(props: MenuBarProps) {
  const [maximized, setMaximized] = createSignal(false);

  onMount(() => {
    // The main process owns the real window state; keep the icon synchronized.
    const removeListener = api.window.onMaximizedChange((value) =>
      setMaximized(value),
    );
    onCleanup(removeListener);
  });

  return (
    <header class="menu-bar">
      <span class="codicon codicon-code menu-logo" aria-hidden="true" />
      <nav aria-label="Menu Bar">
        <ul class="menu-items">
          {menuItems.map((item) => (
            <li>{item}</li>
          ))}
          <li aria-hidden="true">
            <span class="codicon codicon-ellipsis" />
          </li>
        </ul>
      </nav>
      <ViewActions {...props} />
      <div class="window-controls">
        <button
          class="window-control"
          type="button"
          aria-label="Minimize window"
          on:click={() => api.window.minimize()}
        >
          <span class="codicon codicon-chrome-minimize" aria-hidden="true" />
        </button>
        <button
          class="window-control"
          type="button"
          aria-label={maximized() ? "Restore window" : "Maximize window"}
          on:click={() => api.window.toggleMaximize()}
        >
          <span
            class={`codicon ${maximized() ? "codicon-chrome-restore" : "codicon-chrome-maximize"}`}
            aria-hidden="true"
          />
        </button>
        <button
          class="window-control window-control-close"
          type="button"
          aria-label="Close window"
          on:click={() => api.window.close()}
        >
          <span class="codicon codicon-chrome-close" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

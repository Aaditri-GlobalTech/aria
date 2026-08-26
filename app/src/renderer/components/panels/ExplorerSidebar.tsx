import { createEffect, createSignal, For, Show, untrack } from "solid-js";
import type { ExplorerEntry } from "../../../shared/types";
import { api } from "../../api";

type ExplorerSidebarProps = {
  cwd?: string;
};

type ExplorerRow = {
  entry: ExplorerEntry;
  depth: number;
};

export function ExplorerSidebar(props: ExplorerSidebarProps) {
  const [directories, setDirectories] = createSignal<
    Record<string, ExplorerEntry[]>
  >({});
  const [expanded, setExpanded] = createSignal(new Set([""]));
  const [selectedPath, setSelectedPath] = createSignal<string>();
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string>();

  // Load folders on demand so large workspaces do not require a full tree upfront.
  const loadDirectory = async (cwd: string, path: string) => {
    if (directories()[path]) return;

    setLoading(true);
    try {
      const entries = await api.workspace.readDirectory(cwd, path);
      if (props.cwd !== cwd) return;
      setDirectories((current) => ({ ...current, [path]: entries }));
    } catch (reason) {
      if (props.cwd === cwd) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    const cwd = props.cwd;
    setDirectories({});
    setExpanded(new Set([""]));
    setSelectedPath(undefined);
    setError(undefined);
    if (cwd) untrack(() => void loadDirectory(cwd, ""));
  });

  const refresh = () => {
    const cwd = props.cwd;
    if (!cwd) return;
    setDirectories({});
    setExpanded(new Set([""]));
    setError(undefined);
    void loadDirectory(cwd, "");
  };

  const toggleDirectory = (path: string) => {
    if (expanded().has(path)) {
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
      return;
    }

    setExpanded((current) => new Set(current).add(path));
    if (props.cwd) void loadDirectory(props.cwd, path);
  };

  // Flatten only expanded folders into the rows rendered by the tree.
  const visibleEntries = () => {
    const rows: ExplorerRow[] = [];
    const visit = (path: string, depth: number) => {
      for (const entry of directories()[path] ?? []) {
        rows.push({ entry, depth });
        if (entry.kind === "directory" && expanded().has(entry.path)) {
          visit(entry.path, depth + 1);
        }
      }
    };
    visit("", 0);
    return rows;
  };

  return (
    <div class="explorer-sidebar">
      <Show
        when={props.cwd}
        fallback={
          <p class="sidebar-empty">Open a workspace to browse files.</p>
        }
      >
        {(cwd) => (
          <>
            <div class="explorer-workspace">
              <span class="codicon codicon-folder-opened" aria-hidden="true" />
              <span class="explorer-workspace-name" title={cwd()}>
                {cwd().split(/[\\/]/).filter(Boolean).pop() ?? cwd()}
              </span>
              <button
                class="sidebar-action"
                type="button"
                aria-label="Refresh Explorer"
                title="Refresh Explorer"
                on:click={refresh}
              >
                <span class="codicon codicon-refresh" aria-hidden="true" />
              </button>
            </div>
            <div class="explorer-tree" role="tree" aria-label="Explorer">
              <Show
                when={!error()}
                fallback={<p class="sidebar-error">{error()}</p>}
              >
                <Show when={!loading() || visibleEntries().length > 0}>
                  <For each={visibleEntries()}>
                    {(row) => {
                      const directory = row.entry.kind === "directory";
                      const isExpanded = () => expanded().has(row.entry.path);
                      return (
                        <button
                          class={`explorer-entry ${selectedPath() === row.entry.path ? "is-selected" : ""}`}
                          type="button"
                          role="treeitem"
                          aria-selected={selectedPath() === row.entry.path}
                          aria-expanded={directory ? isExpanded() : undefined}
                          style={{ "padding-left": `${8 + row.depth * 16}px` }}
                          on:click={() => {
                            if (directory) toggleDirectory(row.entry.path);
                            else setSelectedPath(row.entry.path);
                          }}
                        >
                          <span
                            class={`codicon ${directory ? (isExpanded() ? "codicon-chevron-down" : "codicon-chevron-right") : "codicon-file"}`}
                            aria-hidden="true"
                          />
                          <span class="explorer-entry-name">
                            {row.entry.name}
                          </span>
                        </button>
                      );
                    }}
                  </For>
                </Show>
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

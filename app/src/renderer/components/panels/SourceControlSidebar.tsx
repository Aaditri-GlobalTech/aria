import { createEffect, createSignal, For, Show, untrack } from "solid-js";
import type { GitChange, GitStatus } from "../../../shared/types";
import { api } from "../../api";
import {
  DEFAULT_APP_KEYBINDINGS,
  formatKeybinding,
  matchesKey,
} from "../../keybindings";

type SourceControlSidebarProps = {
  cwd?: string;
};

function changeLabel(change: GitChange) {
  const code =
    change.indexStatus !== " " && change.indexStatus !== "?"
      ? change.indexStatus
      : change.worktreeStatus;
  return (
    {
      A: "Added",
      C: "Copied",
      D: "Deleted",
      M: "Modified",
      R: "Renamed",
      U: "Unmerged",
      "?": "Untracked",
    }[code] ?? "Changed"
  );
}

// Git's first porcelain column describes the index; the second is the worktree.
function isStaged(change: GitChange) {
  return change.indexStatus !== " " && change.indexStatus !== "?";
}

export function SourceControlSidebar(props: SourceControlSidebarProps) {
  const [status, setStatus] = createSignal<GitStatus>();
  const [message, setMessage] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string>();

  const loadStatus = async (cwd: string) => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await api.workspace.gitStatus(cwd);
      if (props.cwd !== cwd) return;
      setStatus(next);
    } catch (reason) {
      if (props.cwd === cwd) {
        setStatus(undefined);
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    const cwd = props.cwd;
    setStatus(undefined);
    setError(undefined);
    if (cwd) untrack(() => void loadStatus(cwd));
  });

  const refresh = () => {
    if (props.cwd) void loadStatus(props.cwd);
  };

  // Refresh after every mutation to keep the sidebar aligned with Git's state.
  const runAction = async (action: () => Promise<void>) => {
    setLoading(true);
    setError(undefined);
    try {
      await action();
      if (props.cwd) await loadStatus(props.cwd);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  const stage = (path: string) => {
    const cwd = props.cwd;
    if (!cwd) return;
    void runAction(() => api.workspace.gitStage(cwd, path));
  };

  const unstage = (path: string) => {
    const cwd = props.cwd;
    if (!cwd) return;
    void runAction(() => api.workspace.gitUnstage(cwd, path));
  };

  const commit = () => {
    const cwd = props.cwd;
    if (!cwd || !message().trim()) return;
    void runAction(async () => {
      await api.workspace.gitCommit(cwd, message());
      setMessage("");
    });
  };

  const stagedChanges = () =>
    status()?.changes.filter((change) => isStaged(change)) ?? [];
  const unstagedChanges = () =>
    status()?.changes.filter((change) => !isStaged(change)) ?? [];

  const changeList = (changes: GitChange[], staged: boolean) => (
    <For each={changes}>
      {(change) => (
        <div class="scm-change">
          <span class="scm-change-kind">{changeLabel(change)[0]}</span>
          <span class="scm-change-name" title={change.path}>
            {change.path}
          </span>
          <button
            class="sidebar-action scm-change-action"
            type="button"
            aria-label={
              staged ? `Unstage ${change.path}` : `Stage ${change.path}`
            }
            title={staged ? "Unstage Changes" : "Stage Changes"}
            on:click={() =>
              staged ? unstage(change.path) : stage(change.path)
            }
          >
            <span
              class={`codicon ${staged ? "codicon-remove" : "codicon-add"}`}
              aria-hidden="true"
            />
          </button>
        </div>
      )}
    </For>
  );

  return (
    <div class="scm-sidebar">
      <Show
        when={props.cwd}
        fallback={
          <p class="sidebar-empty">Open a workspace for source control.</p>
        }
      >
        <div class="scm-toolbar">
          <span class="codicon codicon-git-branch" aria-hidden="true" />
          <span class="scm-branch" title={status()?.root ?? props.cwd}>
            {status()?.branch ?? "Git"}
          </span>
          <button
            class="sidebar-action"
            type="button"
            aria-label="Refresh Source Control"
            title="Refresh Source Control"
            on:click={refresh}
          >
            <span class="codicon codicon-refresh" aria-hidden="true" />
          </button>
        </div>

        <Show when={error()}>
          <p class="sidebar-error">{error()}</p>
        </Show>
        <Show when={status()?.error}>
          <p class="sidebar-error">{status()?.error}</p>
        </Show>
        <Show when={status()?.root && !status()?.error}>
          <div class="scm-commit-box">
            <textarea
              value={message()}
              placeholder={`Message (${formatKeybinding(DEFAULT_APP_KEYBINDINGS.commit)} to commit)`}
              rows="2"
              disabled={loading()}
              on:input={(event) => setMessage(event.currentTarget.value)}
              on:keydown={(event) => {
                if (matchesKey(event, DEFAULT_APP_KEYBINDINGS.commit)) commit();
              }}
            />
            <button
              class="scm-commit-button"
              type="button"
              disabled={
                loading() || !message().trim() || stagedChanges().length === 0
              }
              on:click={commit}
            >
              Commit
            </button>
          </div>

          <section class="scm-group">
            <h2>
              Staged Changes <span>{stagedChanges().length}</span>
            </h2>
            <Show
              when={stagedChanges().length > 0}
              fallback={<p class="scm-empty">No staged changes</p>}
            >
              {changeList(stagedChanges(), true)}
            </Show>
          </section>
          <section class="scm-group">
            <h2>
              Changes <span>{unstagedChanges().length}</span>
            </h2>
            <Show
              when={unstagedChanges().length > 0}
              fallback={<p class="scm-empty">No changes</p>}
            >
              {changeList(unstagedChanges(), false)}
            </Show>
          </section>
        </Show>
      </Show>
    </div>
  );
}

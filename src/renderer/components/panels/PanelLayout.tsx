import { createSignal, onCleanup, onMount } from "solid-js";
import type {
  AgentCommand,
  AgentFeedbackResponse,
  AgentManagerEvent,
  AgentSession,
  AgentStreamingBehavior,
} from "../../../shared/agent";
import { useResizablePanels } from "../../hooks/useResizablePanels";
import { ActivityBar } from "../layout/ActivityBar";
import { MenuBar } from "../layout/MenuBar";
import { StatusBar } from "../layout/StatusBar";
import { AgentView } from "./AgentView";
import {
  applySessionEvent,
  createSessionClientState,
  type SessionClientState,
} from "./agent-session-state";
import { PanelHeader } from "./PanelHeader";
import { PanelResizer } from "./PanelResizer";
import { SessionSidebar } from "./SessionSidebar";

export function PanelLayout() {
  const panels = useResizablePanels();
  const [sessions, setSessions] = createSignal<AgentSession[]>([]);
  const [tabs, setTabs] = createSignal<string[]>([]);
  const [selectedId, setSelectedId] = createSignal<string>();
  const [states, setStates] = createSignal<Record<string, SessionClientState>>(
    {},
  );

  const selectedSession = () =>
    sessions().find((session) => session.id === selectedId());
  const selectedState = () => {
    const id = selectedId();
    return id ? states()[id] : undefined;
  };
  const tabSessions = () =>
    tabs()
      .map((id) => sessions().find((session) => session.id === id))
      .filter((session): session is AgentSession => session !== undefined);

  const reportError = (error: unknown) => {
    console.error(error);
  };

  const ensureState = (id: string) => {
    setStates((current) =>
      current[id] ? current : { ...current, [id]: createSessionClientState() },
    );
  };

  const updateState = (
    id: string,
    update: (state: SessionClientState) => SessionClientState,
  ) => {
    setStates((current) => {
      const state = current[id] ?? createSessionClientState();
      return { ...current, [id]: update(state) };
    });
  };

  const updateSession = (session: AgentSession) => {
    setSessions((current) => {
      const index = current.findIndex((entry) => entry.id === session.id);
      if (index === -1) return [...current, session];
      return current.map((entry, entryIndex) =>
        entryIndex === index
          ? { ...session, unread: entry.unread || session.unread }
          : entry,
      );
    });
  };

  const handleEvent = (event: AgentManagerEvent) => {
    if (event.type === "sessions") {
      setSessions((current) => {
        const unread = new Map(
          current.map((session) => [session.id, session.unread]),
        );
        return event.sessions.map((session) => ({
          ...session,
          unread: unread.get(session.id) ?? false,
        }));
      });
      return;
    }

    if (event.type === "session_update") {
      updateSession(event.session);
      ensureState(event.session.id);
      return;
    }

    if (event.type === "feedback_request") {
      setSessions((current) =>
        current.map((session) =>
          session.id === event.sessionId
            ? {
                ...session,
                waiting: event.request,
                status: "waiting",
                active: true,
              }
            : session,
        ),
      );
      ensureState(event.sessionId);
      return;
    }

    if (event.type === "session_event") {
      ensureState(event.sessionId);
      updateState(event.sessionId, (state) =>
        applySessionEvent(state, event.event),
      );
      if (event.sessionId !== selectedId()) {
        setSessions((current) =>
          current.map((session) =>
            session.id === event.sessionId
              ? { ...session, unread: true }
              : session,
          ),
        );
      }
    }
  };

  onMount(() => {
    const unsubscribe = window.electron.agent.onEvent(handleEvent);
    onCleanup(unsubscribe);
    void window.electron.agent
      .list()
      .then((next) => {
        setSessions(next);
        for (const session of next) ensureState(session.id);
      })
      .catch(reportError);
  });

  const selectSession = (id: string) => {
    ensureState(id);
    setSelectedId(id);
    setSessions((current) =>
      current.map((session) =>
        session.id === id ? { ...session, unread: false } : session,
      ),
    );
  };

  const openSession = (id: string) => {
    const session = sessions().find((entry) => entry.id === id);
    if (!session) return;

    ensureState(id);
    setTabs((current) => (current.includes(id) ? current : [...current, id]));
    selectSession(id);

    if (!session.active) {
      void window.electron.agent
        .open(id)
        .then(() => {
          void window.electron.agent
            .command(id, { type: "get_available_models" })
            .catch(reportError);
          void window.electron.agent
            .command(id, { type: "get_available_thinking_levels" })
            .catch(reportError);
        })
        .catch(reportError);
    }
  };

  const closeTab = (id: string) => {
    const current = tabs();
    const index = current.indexOf(id);
    const next = current.filter((tabId) => tabId !== id);
    setTabs(next);
    if (selectedId() !== id) return;

    const replacement = next[index] ?? next[index - 1];
    if (replacement) selectSession(replacement);
    else setSelectedId(undefined);
  };

  const createSession = async (cwd: string) => {
    try {
      const session = await window.electron.agent.create(cwd);
      updateSession(session);
      ensureState(session.id);
      openSession(session.id);
    } catch (error) {
      reportError(error);
    }
  };

  const newSession = () => {
    void createSession(selectedSession()?.cwd ?? sessions()[0]?.cwd ?? "");
  };

  const newSessionInWorkspace = () => {
    void window.electron.workspace
      .pick()
      .then((cwd) => {
        if (cwd) void createSession(cwd);
      })
      .catch(reportError);
  };

  const prompt = (
    message: string,
    streamingBehavior?: AgentStreamingBehavior,
  ) => {
    const id = selectedId();
    if (!id) return;
    updateState(id, (state) => ({
      ...state,
      draft: "",
      messages: [
        ...state.messages,
        { id: crypto.randomUUID(), role: "user", text: message },
      ],
    }));
    void window.electron.agent
      .prompt(id, message, streamingBehavior)
      .catch(reportError);
  };

  const command = (value: AgentCommand) => {
    const id = selectedId();
    if (!id) return;
    void window.electron.agent.command(id, value).catch(reportError);
  };

  const respond = (response: AgentFeedbackResponse) => {
    const id = selectedId();
    if (!id) return;
    void window.electron.agent.respond(id, response).catch(reportError);
  };

  const abort = () => {
    const id = selectedId();
    if (id) void window.electron.agent.abort(id).catch(reportError);
  };

  const waitingSessions = () =>
    sessions().filter((session) => session.status === "waiting");

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
            <AgentView
              tabs={tabSessions()}
              selectedSession={selectedSession()}
              state={selectedState()}
              onSelectTab={selectSession}
              onCloseTab={closeTab}
              onNewSession={newSession}
              onDraft={(value) => {
                const id = selectedId();
                if (id)
                  updateState(id, (state) => ({ ...state, draft: value }));
              }}
              onPrompt={prompt}
              onAbort={abort}
              onCommand={command}
              onRespond={respond}
            />

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
            class={`panel side-panel right-panel session-panel ${panels.rightCollapsed() ? "is-collapsed" : ""}`}
          >
            <SessionSidebar
              sessions={sessions()}
              openTabIds={tabs()}
              onOpen={openSession}
              onNew={newSession}
              onPickWorkspace={newSessionInWorkspace}
            />
          </aside>
        </div>
      </div>

      <StatusBar
        waitingSessions={waitingSessions()}
        onSelectSession={openSession}
      />
    </main>
  );
}

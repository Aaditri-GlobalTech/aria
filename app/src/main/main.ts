import { join } from "node:path";
import type { AgentManagerEvent, AgentSession } from "@aria/extension-agent";
import type { ExplorerEntry, GitStatus } from "@aria/extension-workspace";
import {
  createElectronHostClient,
  type ElectronHostClient,
} from "@aria/host/examples/electron";
import type { JsonValue, RuntimeEvent } from "@aria/protocol";
import { isJsonValue } from "@aria/protocol";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
} from "electron";

const directory = typeof __dirname === "undefined" ? process.cwd() : __dirname;

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let host: ElectronHostClient | undefined;
let isQuitting = false;
let quitAfterHostStop = false;
let quitPromise: Promise<void> | undefined;

/** Forward Agent manager events only while a renderer window is available. */
function sendManagerEvent(event: AgentManagerEvent) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("agent:event", event);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentManagerEvent(value: unknown): value is AgentManagerEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "sessions":
      return Array.isArray(value.sessions);
    case "session_update":
      return isRecord(value.session);
    case "session_event":
      return typeof value.sessionId === "string" && isRecord(value.event);
    case "feedback_request":
      return typeof value.sessionId === "string" && isRecord(value.request);
    default:
      return false;
  }
}

type ProcessWithResourcesPath = NodeJS.Process & {
  resourcesPath?: string;
};

function hostExtensionSources(): string[] {
  const configured = process.env.ARIA_HOST_EXTENSION_SOURCES;
  if (configured !== undefined) {
    return configured
      .split(process.platform === "win32" ? ";" : ":")
      .filter(Boolean);
  }

  const resourcesPath = (process as ProcessWithResourcesPath).resourcesPath;
  if (!resourcesPath) return [];
  return [
    join(resourcesPath, "extensions", "agent.cjs"),
    join(resourcesPath, "extensions", "workspace.cjs"),
  ];
}

function handleRuntimeEvent(event: RuntimeEvent) {
  if (
    event.type !== "extension_event" ||
    event.event.source !== "agent" ||
    event.event.type !== "agent.manager"
  ) {
    return;
  }
  if (isAgentManagerEvent(event.event.payload)) {
    sendManagerEvent(event.event.payload);
  }
}

function jsonPayload(value: unknown): JsonValue {
  if (!isJsonValue(value)) throw new Error("Payload must be a JSON value");
  return value;
}

function requireHost(): ElectronHostClient {
  if (!host) throw new Error("Extension host is not ready");
  return host;
}

/** Embedded PNG keeps the tray icon visible on Linux Electron builds. */
const trayIcon = nativeImage.createFromDataURL(
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAZklEQVR4nO3TyxEAEBADUJVoQ1eqUY/WKAAj2LE+yUxuyLsw1sekWXMMwIW0tQQQsAyohYA/AK3BUQgBwwB0AD13NwCNCEAi7wDQn4Lc6wJmh9F3CGgCpIZ7kHMBu0oAAQVAq+qADE+tTCWSUYUnAAAAAElFTkSuQmCC",
);

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
  } else {
    showMainWindow();
  }
}

/** Keep the process alive while the window is hidden and expose restore/quit actions. */
function createTray() {
  tray = new Tray(trayIcon);
  tray.setToolTip("Aria");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Aria", click: showMainWindow },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
  tray.on("click", toggleMainWindow);
}

/** Create the isolated renderer and choose dev-server or packaged assets. */
function createWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload:
        process.env.ELECTRON_PRELOAD_PATH ??
        join(directory, "../preload/preload.cjs"),
    },
  });
  mainWindow = window;
  // Closing the window hides it; only the tray's Quit action ends the process.
  window.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    window.hide();
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });

  const syncMaximizedState = () =>
    window.webContents.send("window:maximized", window.isMaximized());
  window.on("maximize", syncMaximizedState);
  window.on("unmaximize", syncMaximizedState);
  window.webContents.on("did-finish-load", syncMaximizedState);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(directory, "../index.html"));
  }
}

// Electron remains the adapter for the existing renderer-facing channels.
ipcMain.on("window:minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on("window:toggle-maximize", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
});

ipcMain.on("window:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle("agent:list", () =>
  requireHost().request<AgentSession[]>("agent.list"),
);

ipcMain.handle("agent:create", (_event, cwd: unknown) =>
  requireHost().request<AgentSession>("agent.create", jsonPayload({ cwd })),
);
ipcMain.handle("agent:open", (_event, id: unknown) =>
  requireHost().request<AgentSession>(
    "agent.open",
    jsonPayload({ sessionId: id }),
  ),
);
ipcMain.handle("agent:close", async (_event, id: unknown) => {
  await requireHost().request("agent.close", jsonPayload({ sessionId: id }));
});
ipcMain.handle("agent:prompt", async (_event, value: unknown) => {
  await requireHost().request("agent.prompt", jsonPayload(value));
});
ipcMain.handle("agent:abort", async (_event, id: unknown) => {
  await requireHost().request("agent.abort", jsonPayload({ sessionId: id }));
});
ipcMain.handle("agent:command", async (_event, value: unknown) => {
  await requireHost().request("agent.command", jsonPayload(value));
});
ipcMain.handle("agent:respond", async (_event, value: unknown) => {
  await requireHost().request("agent.respond", jsonPayload(value));
});

// Workspace picking and native window/tray lifecycle remain Electron-only.
ipcMain.handle("workspace:pick", async () => {
  const result = await dialog.showOpenDialog({
    title: "Open workspace",
    properties: ["openDirectory"],
  });
  return result.canceled ? undefined : result.filePaths[0];
});

ipcMain.handle("workspace:read-directory", (_event, value: unknown) =>
  requireHost().request<ExplorerEntry[]>(
    "workspace.readDirectory",
    jsonPayload(value),
  ),
);

ipcMain.handle("workspace:git-status", (_event, cwd: unknown) =>
  requireHost().request<GitStatus>("workspace.gitStatus", jsonPayload({ cwd })),
);

ipcMain.handle("workspace:git-stage", async (_event, value: unknown) => {
  await requireHost().request("workspace.gitStage", jsonPayload(value));
});

ipcMain.handle("workspace:git-unstage", async (_event, value: unknown) => {
  await requireHost().request("workspace.gitUnstage", jsonPayload(value));
});

ipcMain.handle("workspace:git-commit", async (_event, value: unknown) => {
  await requireHost().request("workspace.gitCommit", jsonPayload(value));
});

app.on("before-quit", (event) => {
  if (quitAfterHostStop) return;
  event.preventDefault();
  isQuitting = true;
  if (quitPromise) return;

  const currentHost = host;
  if (!currentHost) {
    quitAfterHostStop = true;
    app.quit();
    return;
  }

  quitPromise = currentHost
    .stop()
    .catch((error) => {
      console.error("Failed to shut down extension host:", error);
    })
    .finally(() => {
      quitAfterHostStop = true;
      app.quit();
    });
});

void app
  .whenReady()
  .then(async () => {
    if (isQuitting) return;
    host = createElectronHostClient(app, {
      onEvent: handleRuntimeEvent,
      hostSourcePath: process.env.ARIA_HOST_SOURCE_PATH,
      hostRuntime: process.env.ARIA_HOST_RUNTIME,
      hostCwd: process.env.ARIA_HOST_CWD,
      extensionSources: hostExtensionSources(),
    });
    try {
      await requireHost().start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      dialog.showErrorBox("Extension host failed to start", message);
      app.exit(1);
      return;
    }

    createTray();
    createWindow();
    app.on("activate", showMainWindow);
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Aria failed to start:", message);
    app.exit(1);
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

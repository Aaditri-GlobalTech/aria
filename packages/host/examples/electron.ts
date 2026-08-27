import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { isJsonValue } from "@aria/protocol";
import { HostClient, type HostClientApi, type HostClientOptions } from "./node";

/** Small Electron app surface needed to choose a per-launch socket path. */
export type ElectronAppLike = {
  getPath(name: "userData"): string;
};

/** Host client options supported by the Electron adapter. */
export type ElectronHostClientOptions = Omit<
  HostClientOptions,
  "localSocketPath" | "stdio" | "transport"
> & {
  localSocketPath?: string;
};

/** Host client returned by {@link createElectronHostClient}. */
export type ElectronHostClient = HostClient;

function defaultLocalSocketPath(electronApp: ElectronAppLike): string {
  const name = `aria-host-${process.pid}-${randomUUID()}`;
  return process.platform === "win32"
    ? `\\\\.\\pipe\\${name}`
    : join(electronApp.getPath("userData"), `${name}.sock`);
}

/** Create an Electron host client using a per-launch local socket or pipe. */
export function createElectronHostClient(
  electronApp: ElectronAppLike,
  options: ElectronHostClientOptions = {},
): ElectronHostClient {
  return new HostClient({
    ...options,
    localSocketPath:
      options.localSocketPath ?? defaultLocalSocketPath(electronApp),
  });
}

/** The small part of Electron's `ipcMain` used by this example. */
export type ElectronIpcMain = {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ): void;
};

/** Register the main-process bridge between an Electron renderer and Host. */
export function registerHostClient(
  ipcMain: ElectronIpcMain,
  host: HostClientApi,
): void {
  ipcMain.handle("host:ping", () => host.ping());
  ipcMain.handle("extension:list", () => host.extensions());
  ipcMain.handle(
    "capability:request",
    (_event, capability: unknown, payload: unknown): Promise<unknown> => {
      if (typeof capability !== "string" || !capability.trim()) {
        throw new Error("Capability must be a non-empty string");
      }
      if (payload === undefined) return host.request(capability, null);
      if (!isJsonValue(payload)) throw new Error("Payload must be JSON");
      return host.request(capability, payload);
    },
  );
}

import { isJsonValue } from "@aria/protocol";
import type { HostClientApi } from "./host-client";

/** The small part of Electron's ipcMain used by this example. */
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

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { JsonValue } from "@aria/protocol";
import {
  type ElectronIpcMain,
  registerHostClient,
} from "../examples/electron-client";
import type { HostClientApi } from "../examples/host-client";

type Handler = Parameters<ElectronIpcMain["handle"]>[1];

describe("Electron Host client example", () => {
  it("registers validated IPC calls against the Host client", async () => {
    const handlers = new Map<string, Handler>();
    const ipcMain: ElectronIpcMain = {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    };
    const calls: Array<{ capability: string; payload: JsonValue }> = [];
    const host: HostClientApi = {
      ping: async () => "pong",
      extensions: async () => [],
      request: async <T>(
        capability: string,
        payload: JsonValue,
      ): Promise<T> => {
        calls.push({ capability, payload });
        return { capability, payload } as T;
      },
    };

    registerHostClient(ipcMain, host);

    assert.equal(await handlers.get("host:ping")?.({}), "pong");
    assert.deepEqual(await handlers.get("extension:list")?.({}), []);
    const result = await handlers.get("capability:request")?.(
      {},
      "example.echo",
      {
        value: 7,
      },
    );
    assert.deepEqual(result, {
      capability: "example.echo",
      payload: { value: 7 },
    });
    assert.deepEqual(calls, [
      { capability: "example.echo", payload: { value: 7 } },
    ]);

    await assert.rejects(
      async () => handlers.get("capability:request")?.({}, "", null),
      /non-empty string/,
    );
    await assert.rejects(
      async () =>
        handlers.get("capability:request")?.({}, "example.echo", Symbol()),
      /Payload must be JSON/,
    );
  });
});

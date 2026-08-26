import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  createRuntimeEventNotification,
  JSON_RPC_ERROR_CODES,
  PROTOCOL_VERSION,
  parseHostRequestLine,
  parseJsonRpcLine,
  RUNTIME_EVENT_METHOD,
  serializeJsonRpcLine,
  serializeJsonRpcMessage,
  validateHostInitializeResult,
  validateRuntimeEventNotification,
} from "../src";

describe("host protocol", () => {
  it("parses generic capability requests and preserves opaque payloads", () => {
    const request = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "capability.request",
      params: {
        capability: "agent.list",
        payload: { cwd: "/workspace" },
      },
    };

    assert.deepEqual(parseHostRequestLine(JSON.stringify(request)), request);
    assert.deepEqual(parseJsonRpcLine(JSON.stringify(request)), request);
  });

  it("keeps transport-independent JSON-RPC encoding separate from line framing", () => {
    const message = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "host.ping",
    };

    assert.equal(serializeJsonRpcMessage(message), JSON.stringify(message));
    assert.equal(serializeJsonRpcLine(message), `${JSON.stringify(message)}\n`);
  });

  it("reports parse and parameter errors with JSON-RPC codes", () => {
    assert.throws(
      () => parseJsonRpcLine("not-json"),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === JSON_RPC_ERROR_CODES.PARSE_ERROR,
    );

    assert.throws(
      () =>
        parseHostRequestLine(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "bad-params",
            method: "capability.request",
            params: { capability: "", payload: null },
          }),
        ),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === JSON_RPC_ERROR_CODES.INVALID_PARAMS,
    );
  });

  it("creates and validates generic runtime event notifications", () => {
    const notification = createRuntimeEventNotification({
      type: "extension_started",
      extensionId: "agent",
    });

    assert.equal(notification.method, RUNTIME_EVENT_METHOD);
    assert.deepEqual(
      validateRuntimeEventNotification(
        JSON.parse(serializeJsonRpcLine(notification)),
      ),
      notification,
    );
  });

  it("validates the generic initialization result", () => {
    const result = {
      protocolVersion: PROTOCOL_VERSION,
      jsonRpcVersion: "2.0" as const,
      methods: ["initialize", "capability.request"],
      notifications: [RUNTIME_EVENT_METHOD],
      discovery: { candidates: [], registered: [], issues: [] },
      extensions: [],
    };

    assert.deepEqual(validateHostInitializeResult(result), result);
  });
});

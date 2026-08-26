import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  CORE_EVENT_METHOD,
  createCoreEventNotification,
  JSON_RPC_ERROR_CODES,
  PROTOCOL_VERSION,
  parseHostRequestLine,
  parseJsonRpcLine,
  serializeJsonRpcLine,
  validateCoreEventNotification,
  validateHostInitializeResult,
} from "../src";

describe("host protocol", () => {
  it("parses generic core requests and preserves opaque capability payloads", () => {
    const request = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "core.request",
      params: {
        capability: "agent.list",
        payload: { cwd: "/workspace" },
      },
    };

    assert.deepEqual(parseHostRequestLine(JSON.stringify(request)), request);
    assert.deepEqual(parseJsonRpcLine(JSON.stringify(request)), request);
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
            method: "core.request",
            params: { capability: "", payload: null },
          }),
        ),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === JSON_RPC_ERROR_CODES.INVALID_PARAMS,
    );
  });

  it("creates and validates generic core event notifications", () => {
    const notification = createCoreEventNotification({
      type: "extension_started",
      extensionId: "agent",
    });

    assert.equal(notification.method, CORE_EVENT_METHOD);
    assert.deepEqual(
      validateCoreEventNotification(
        JSON.parse(serializeJsonRpcLine(notification)),
      ),
      notification,
    );
  });

  it("validates the generic initialization result", () => {
    const result = {
      protocolVersion: PROTOCOL_VERSION,
      jsonRpcVersion: "2.0" as const,
      methods: ["initialize", "core.request"],
      notifications: [CORE_EVENT_METHOD],
      discovery: { candidates: [], registered: [], issues: [] },
      extensions: [],
    };

    assert.deepEqual(validateHostInitializeResult(result), result);
  });
});

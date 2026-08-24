import { describe, expect, it } from "vitest";
import { createRpcLineReader } from "../src/main/rpc";

describe("RPC line reader", () => {
  it("keeps strict LF framing and split UTF-8 data intact", () => {
    const lines: string[] = [];
    const reader = createRpcLineReader((line) => lines.push(line));
    const data = Buffer.from('{"message":"café"}\r\n{"type":"done"}');

    reader.push(data.subarray(0, 7));
    reader.push(data.subarray(7));
    reader.end();

    expect(lines).toEqual(['{"message":"café"}', '{"type":"done"}']);
  });
});

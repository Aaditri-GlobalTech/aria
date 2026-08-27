import { createInterface, type Interface } from "node:readline";
import type { PassThrough } from "node:stream";
import type { JsonRpcOutboundMessage } from "@aria/protocol";
import { parseJsonRpcOutboundLine } from "@aria/protocol";

export class MessageCollector {
  readonly messages: JsonRpcOutboundMessage[] = [];
  private readonly waiters: Array<(message: JsonRpcOutboundMessage) => void> =
    [];
  private readonly lines: Interface;

  constructor(input: PassThrough) {
    this.lines = createInterface({
      input,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    this.lines.on("line", (line) => {
      const message = parseJsonRpcOutboundLine(line);
      this.messages.push(message);
      this.waiters.shift()?.(message);
    });
  }

  next(): Promise<JsonRpcOutboundMessage> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async response(id: number): Promise<JsonRpcOutboundMessage> {
    while (true) {
      const message = await this.next();
      if ("id" in message && message.id === id) return message;
    }
  }

  close(): void {
    this.lines.close();
  }
}

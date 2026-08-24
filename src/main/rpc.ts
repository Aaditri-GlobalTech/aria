import { StringDecoder } from "node:string_decoder";

export function createRpcLineReader(onLine: (line: string) => void) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  const emitLines = () => {
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;

      let line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line) onLine(line);
    }
  };

  return {
    push(chunk: Buffer | string) {
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
      emitLines();
    },
    end() {
      buffer += decoder.end();
      if (buffer) {
        onLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
      }
    },
  };
}

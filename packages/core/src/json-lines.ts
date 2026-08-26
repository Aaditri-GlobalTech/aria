export function createJsonLineReader(onLine: (line: string) => void) {
  const decoder = new TextDecoder();
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
    push(chunk: Uint8Array | string) {
      buffer +=
        typeof chunk === "string"
          ? chunk
          : decoder.decode(chunk, { stream: true });
      emitLines();
    },
    end() {
      buffer += decoder.decode();
      if (buffer) {
        onLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
      }
    },
  };
}

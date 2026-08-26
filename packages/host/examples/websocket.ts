import { WebSocketTransport } from "../src/transports";
import { HostClient } from "./node";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("WebSocket connection failed"));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("WebSocket closed before it opened"));
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

const url = process.argv[2] ?? "ws://127.0.0.1:3000";
const socket = new WebSocket(url);

try {
  await waitForOpen(socket);
  const client = new HostClient({
    transport: new WebSocketTransport(socket),
    onEvent: (event) => console.error(`[runtime.event] ${event.type}`),
  });

  try {
    await client.start();
    const extensions = await client.extensions();
    console.log(
      `Extensions: ${extensions.map(({ id }) => id).join(", ") || "none"}`,
    );
  } finally {
    await client.stop();
  }
} catch (error) {
  console.error(`[websocket-client] ${errorMessage(error)}`);
  process.exitCode = 1;
}

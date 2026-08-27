import { connectLocalSocket } from "../src/transports";
import { HostClient } from "./node";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const socketPath = process.argv[2];

if (!socketPath) {
  console.error("Usage: bun run packages/host/examples/local.ts <socket-path>");
  process.exitCode = 1;
} else {
  try {
    const client = new HostClient({
      transport: await connectLocalSocket(socketPath),
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
    console.error(`[local-client] ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

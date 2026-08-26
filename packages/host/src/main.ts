import { rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { parseArgs } from "node:util";
import type { JsonRpcTransport } from "@aria/protocol";
import { ExtensionHost } from "./host";
import { LocalSocketTransport, StdioTransport } from "./transports";

type HostArguments = {
  "aria-directory"?: string;
  "extension-source"?: string[];
  "socket-path"?: string;
  stdio?: boolean;
};

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createHost(
  values: HostArguments,
  transport: JsonRpcTransport,
): ExtensionHost {
  return new ExtensionHost({
    ariaDirectory: values["aria-directory"],
    extensionSources: values["extension-source"] ?? [],
    transport,
    onError: (error) => process.stderr.write(`[aria-host] ${error.message}\n`),
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function removeSocketPath(socketPath: string): Promise<void> {
  if (process.platform !== "win32") {
    await rm(socketPath, { force: true });
  }
}

async function runStdioHost(values: HostArguments): Promise<void> {
  const host = createHost(
    values,
    new StdioTransport({ input: process.stdin, output: process.stdout }),
  );
  const stop = async () => {
    try {
      await host.stop();
    } catch (error) {
      process.stderr.write(`[aria-host] ${asError(error).message}\n`);
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  await host.start();
}

async function runLocalSocketHost(
  values: HostArguments,
  socketPath: string,
): Promise<void> {
  let server: Server | undefined;
  let activeHost: ExtensionHost | undefined;
  let hostStart: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  let startupError: Error | undefined;
  let listening = false;

  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      await hostStart?.catch(() => undefined);
      try {
        await activeHost?.stop();
      } catch (error) {
        startupError ??= asError(error);
      }
      if (server) await closeServer(server);
      await removeSocketPath(socketPath);
    })();
    return stopPromise;
  };

  server = createServer((socket) => {
    if (activeHost) {
      socket.destroy();
      return;
    }

    const host = createHost(values, new LocalSocketTransport(socket));
    activeHost = host;
    socket.once("close", () => void stop());
    hostStart = host.start();
    void hostStart.catch((error) => {
      startupError ??= asError(error);
      void stop();
    });
  });
  server.on("error", (error) => {
    if (!listening) return;
    startupError ??= asError(error);
    void stop();
  });

  const onSignal = () => void stop();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server?.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server?.removeListener("error", onError);
        listening = true;
        resolve();
      };
      server?.once("error", onError);
      server?.once("listening", onListening);
      server?.listen(socketPath);
    });
    await new Promise<void>((resolve) => server?.once("close", resolve));
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await stop();
  }

  if (startupError) throw startupError;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "aria-directory": { type: "string" },
      "extension-source": { type: "string", multiple: true },
      "socket-path": { type: "string" },
      stdio: { type: "boolean" },
    },
    strict: true,
  });
  const hostArguments = values as HostArguments;
  const socketPath = hostArguments["socket-path"];

  if (socketPath && hostArguments.stdio) {
    throw new Error("Choose either --socket-path or --stdio");
  }
  if (socketPath) {
    await runLocalSocketHost(hostArguments, socketPath);
    return;
  }
  if (hostArguments.stdio) {
    await runStdioHost(hostArguments);
    return;
  }
  throw new Error(
    "Host transport is required: pass --socket-path <path> or --stdio",
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`[aria-host] ${asError(error).message}\n`);
  process.exitCode = 1;
}

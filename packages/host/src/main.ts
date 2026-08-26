import { createHost } from "./host";

/** Parse repeatable sources without adding host-owned feature defaults. */
function extensionSources(args: readonly string[]): string[] {
  const sources: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument !== "--extension-source") {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const source = args[index + 1];
    if (!source || source === "--") {
      throw new Error("--extension-source requires a path");
    }
    sources.push(source);
    index += 1;
  }
  return sources;
}

async function main() {
  const host = createHost({
    extensionSources: extensionSources(process.argv.slice(2)),
    onError: (error) => process.stderr.write(`[aria-host] ${error.message}\n`),
  });

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await host.stop();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[aria-host] ${message}\n`);
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  await host.start();
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[aria-host] ${message}\n`);
  process.exitCode = 1;
}

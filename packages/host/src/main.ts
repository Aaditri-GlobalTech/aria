import { parseArgs } from "node:util";
import { ExtensionHost } from "./host";

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "aria-directory": { type: "string" },
      "extension-source": { type: "string", multiple: true },
    },
    strict: true,
  });
  const host = new ExtensionHost({
    ariaDirectory: values["aria-directory"],
    extensionSources: values["extension-source"] ?? [],
    onError: (error) => process.stderr.write(`[aria-host] ${error.message}\n`),
  });

  const stop = async () => {
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

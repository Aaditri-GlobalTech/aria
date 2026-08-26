import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Build the environment for a Pi child process.
 *
 * GUI launchers do not necessarily source the shell startup files that put
 * user-level npm bins on PATH, so add the common locations explicitly.
 */
export function piEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  const pathKey = platform === "win32" && env.Path ? "Path" : "PATH";
  const delimiter = platform === "win32" ? ";" : ":";
  const currentPath = env[pathKey] ?? env.PATH ?? "";
  const configuredPrefix = env.npm_config_prefix;
  const userBinPaths =
    platform === "win32"
      ? [
          join(env.APPDATA ?? join(home, "AppData", "Roaming"), "npm"),
          join(home, ".npm-global", "bin"),
        ]
      : [
          env.NVM_BIN,
          configuredPrefix ? join(configuredPrefix, "bin") : undefined,
          join(home, ".local", "npm-global", "bin"),
          join(home, ".npm-global", "bin"),
          join(home, ".npm-packages", "bin"),
          join(home, ".local", "bin"),
          join(home, ".volta", "bin"),
        ];

  // Put user-managed bins first, while retaining the desktop launcher's PATH.
  const pathEntries = [...userBinPaths, ...currentPath.split(delimiter)].filter(
    (entry): entry is string => Boolean(entry),
  );
  return {
    ...env,
    [pathKey]: [...new Set(pathEntries)].join(delimiter),
  };
}

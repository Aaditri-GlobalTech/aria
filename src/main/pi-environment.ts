import { homedir } from "node:os";
import { join } from "node:path";

export function piEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
) {
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

  const pathEntries = [...userBinPaths, ...currentPath.split(delimiter)].filter(
    (entry): entry is string => Boolean(entry),
  );
  return {
    ...env,
    [pathKey]: [...new Set(pathEntries)].join(delimiter),
  };
}

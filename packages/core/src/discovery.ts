import type { ExecutionMode, ExtensionDefinition } from "./types";

const moduleExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const executionModes = new Set<ExecutionMode>(["main", "worker", "child"]);
const conventionalEntries = [
  "index.cjs",
  "index.cts",
  "index.js",
  "index.jsx",
  "index.mjs",
  "index.mts",
  "index.ts",
  "index.tsx",
];

/** Load one discovered source for definition normalization. */
export type ModuleLoader = (path: string) => unknown | Promise<unknown>;

/** A discovery candidate that could not be loaded or validated. */
export type DiscoveryIssue = {
  /** Candidate path or definition index that failed. */
  source: string;
  /** Human-readable failure reason. */
  error: string;
};

/** One normalized extension definition and the source that exported it. */
export type DiscoveredExtension = {
  definition: ExtensionDefinition;
  source: string;
};

/** Definitions and issues collected during discovery. */
export type DiscoveryResult = {
  /** Absolute candidate paths considered by discovery. */
  candidates: string[];
  /** Definitions that passed shape validation. */
  definitions: DiscoveredExtension[];
  /** Candidates or definitions that were skipped. */
  issues: DiscoveryIssue[];
};

/** Optional hooks for customizing module loading and discovery observation. */
export type DiscoveryOptions = {
  /** Replaces Bun's default resolver/importer, mainly for tests. */
  moduleLoader?: ModuleLoader;
  /** Called once before each candidate is loaded. */
  onCandidate?: (source: string) => void;
};

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function expandHome(path: string) {
  const home = Bun.env.HOME ?? Bun.env.USERPROFILE ?? "";
  if (path === "~") return home;
  if (path.startsWith("~/")) return `${home}/${path.slice(2)}`;
  return path;
}

function absolutePath(path: string) {
  const expanded = expandHome(path);
  if (/^[A-Za-z]:[\\/]/.test(expanded)) return expanded.replaceAll("\\", "/");
  return Bun.fileURLToPath(
    new URL(expanded, Bun.pathToFileURL(`${process.cwd()}/`)),
  );
}

function joinPath(...parts: string[]) {
  return parts.join("/").replaceAll(/\/+/g, "/").replace(/\/$/, "");
}

function isModuleFile(path: string) {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  return moduleExtensions.has(extension);
}

async function statPath(path: string) {
  return Bun.file(path)
    .stat()
    .catch(() => undefined);
}

async function isFile(path: string) {
  return (await statPath(path))?.isFile() ?? false;
}

async function isPackageDirectory(path: string) {
  if (await isFile(joinPath(path, "package.json"))) return true;
  for (const entry of conventionalEntries) {
    if (await isFile(joinPath(path, entry))) return true;
  }
  return false;
}

async function candidatePaths(source: string) {
  const info = await statPath(source);
  if (!info) return [];
  if (info.isFile()) return isModuleFile(source) ? [source] : [];
  if (!info.isDirectory()) return [];

  if (await isPackageDirectory(source)) return [source];

  const candidates: string[] = [];
  const entries = new Bun.Glob("*").scan({
    cwd: source,
    absolute: true,
    dot: true,
    onlyFiles: false,
  });
  for await (const path of entries) {
    const entryInfo = await statPath(path);
    if (entryInfo?.isFile() && isModuleFile(path)) {
      candidates.push(path);
      continue;
    }
    if (entryInfo?.isDirectory() && (await isPackageDirectory(path))) {
      candidates.push(path);
    }
  }
  return candidates.sort();
}

function readStringList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(`${field} must be an array of strings`);
  }

  const values = value.map((item) => item.trim());
  if (values.some((item) => !item)) {
    throw new Error(`${field} must not contain empty values`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`${field} must not contain duplicates`);
  }
  return values;
}

function normalizeDefinition(value: unknown): ExtensionDefinition {
  const object = asObject(value);
  if (!object || typeof object.id !== "string" || !object.id.trim()) {
    throw new Error("Extension id is required");
  }
  if (
    object.execution !== undefined &&
    !executionModes.has(object.execution as ExecutionMode)
  ) {
    throw new Error("Extension execution mode is invalid");
  }
  if (typeof object.create !== "function") {
    throw new Error("Extension create function is required");
  }

  const dependencies = readStringList(
    object.dependencies,
    "Extension dependencies",
  );
  const capabilities = readStringList(
    object.capabilities,
    "Extension capabilities",
  );
  const execution = (object.execution as ExecutionMode | undefined) ?? "child";

  return {
    id: object.id.trim(),
    execution,
    dependencies,
    capabilities,
    create: object.create as ExtensionDefinition["create"],
  };
}

function unwrapModule(value: unknown) {
  const object = asObject(value);
  return object && "default" in object ? object.default : value;
}

/**
 * Normalize one module's default export into extension definitions.
 *
 * A module may export one definition or an array; invalid array entries are
 * reported individually so valid entries from the same module are retained.
 */
export function normalizeExtensionExport(
  value: unknown,
  source: string,
): { definitions: DiscoveredExtension[]; issues: DiscoveryIssue[] } {
  const exported = unwrapModule(value);
  const values = Array.isArray(exported) ? exported : [exported];
  if (values.length === 0) {
    return {
      definitions: [],
      issues: [{ source, error: "Extension export must not be empty" }],
    };
  }

  const definitions: DiscoveredExtension[] = [];
  const issues: DiscoveryIssue[] = [];
  for (const [index, item] of values.entries()) {
    const itemSource = values.length === 1 ? source : `${source}#${index}`;
    try {
      definitions.push({ definition: normalizeDefinition(item), source });
    } catch (error) {
      issues.push({ source: itemSource, error: errorMessage(error) });
    }
  }
  return { definitions, issues };
}

/** Resolve a discovered file or package using Bun's module resolver. */
export async function resolveModuleEntry(source: string): Promise<string> {
  const path = absolutePath(source);
  try {
    return Bun.resolveSync(path, process.cwd());
  } catch (error) {
    for (const entry of conventionalEntries) {
      const conventionalPath = joinPath(path, entry);
      if (await isFile(conventionalPath)) return conventionalPath;
    }
    throw error;
  }
}

async function defaultModuleLoader(path: string) {
  const entry = await resolveModuleEntry(path);
  return import(Bun.pathToFileURL(entry).href);
}

/**
 * Discover module/package sources and normalize their extension definitions.
 *
 * Sources may be files, package directories, or directories containing
 * immediate module/package entries. The returned paths are absolute and
 * duplicate candidates are loaded once.
 */
export async function discoverExtensions(
  sources: readonly string[],
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const moduleLoader = options.moduleLoader ?? defaultModuleLoader;
  const candidates = new Set<string>();
  const issues: DiscoveryIssue[] = [];

  for (const configuredSource of sources) {
    const source = absolutePath(configuredSource);
    let paths: string[];
    try {
      paths = await candidatePaths(source);
    } catch (error) {
      issues.push({ source, error: errorMessage(error) });
      continue;
    }

    for (const path of paths) candidates.add(path);
  }

  const definitions: DiscoveredExtension[] = [];
  const orderedCandidates = [...candidates].sort();
  for (const source of orderedCandidates) {
    options.onCandidate?.(source);
    try {
      const value = await moduleLoader(source);
      const normalized = normalizeExtensionExport(value, source);
      definitions.push(...normalized.definitions);
      issues.push(...normalized.issues);
    } catch (error) {
      issues.push({ source, error: errorMessage(error) });
    }
  }

  return { candidates: orderedCandidates, definitions, issues };
}

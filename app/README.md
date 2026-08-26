# Aria desktop app

The Electron client for Aria. It contains the Solid/Vite renderer, Electron main process, preload bridge, and native desktop features. It launches the reusable Bun extension host `@aria/host`, which embeds the extension runtime from `@aria/core`.

## Responsibilities

- Render the workspace UI with Solid and Vite.
- Own windows, custom controls, tray behavior, and native folder selection.
- Expose the narrow typed `window.aria` bridge to the renderer.

Agent, filesystem, Git, and persistence logic belong in extensions, not in Electron or the extension runtime. Development loads the Agent and Workspace extensions from the monorepo; packaged builds load their bundled resource modules.

## Chat rendering

Assistant messages preserve prose and render fenced code with Shiki syntax
highlighting. Fenced `mermaid` blocks render diagrams; invalid or unsupported
blocks fall back to raw text. Tool cards are collapsible, with `read` collapsed
by default and its `offset`/`limit` shown as a compact line range. The
transcript follows streamed output until the user scrolls away.

## Host configuration

The main process uses the Electron `HostClient` example, which connects the
host through a unique per-launch Unix socket or Windows named pipe. The host
process listens on that endpoint; the renderer still uses the same preload and
Electron IPC bridge. The development script
sets `ARIA_HOST_SOURCE_PATH`, `ARIA_HOST_RUNTIME`, `ARIA_HOST_CWD`, and
`ARIA_HOST_EXTENSION_SOURCES`. In a packaged app, `HostClient` resolves the
compiled host from `process.resourcesPath/host` and extension bundles from
`process.resourcesPath/extensions`. Set `ARIA_HOST_SOURCE_PATH` (and optionally
`ARIA_HOST_RUNTIME`) to use a source host, or set
`ARIA_HOST_EXTENSION_SOURCES` to override the extension paths.

`ARIA_HOST_EXTENSION_SOURCES` is a colon-separated list on Unix and a
semicolon-separated list on Windows. Each source may be a module file or an
extension package directory.

## Development

Run commands from the repository root when possible:

```sh
bun install --ignore-scripts
bun run prepare
bun run dev
```

The development script starts the Electron development environment.

App-local checks are also available:

```sh
bun run --cwd app test
bun run --cwd app typecheck
bun run --cwd app check
bun run --cwd app build
```

The app-local build creates Electron assets only. Run `bun run build:host`
first, or use the root `bun run build`, to compile the host and extension
resources.

## Packaging

```sh
bun run build
bun run release:linux
bun run release:windows
```

Release artifacts are ignored by Git.

For a packaged-host smoke test after building resources:

```sh
bun run check:host
```

## Related packages

- [`packages/core`](../packages/core/README.md)
- [`packages/host`](../packages/host/README.md)
- [`packages/protocol`](../packages/protocol/README.md)
- [`packages/extensions/agent`](../packages/extensions/agent/README.md)
- [`packages/extensions/workspace`](../packages/extensions/workspace/README.md)

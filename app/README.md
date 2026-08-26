# Aria desktop app

The Electron client for Aria. It contains the Solid/Vite renderer, Electron main process, preload bridge, native desktop features, and the client for the Bun host sidecar.

## Responsibilities

- Render the workspace UI with Solid and Vite.
- Own windows, custom controls, tray behavior, and native folder selection.
- Start and stop the Bun host process.
- Communicate with the host using JSON-RPC 2.0 over newline-delimited stdio.
- Expose the narrow typed `window.aria` bridge to the renderer.

Agent, filesystem, Git, and persistence logic belong in `packages/core`, not in Electron.

## Development

Run commands from the repository root when possible:

```sh
bun install --ignore-scripts
bun run prepare
bun run dev
```

The development script starts Vite, Electron, and the Bun host source entrypoint together.

App-local checks are also available:

```sh
bun run --cwd app test
bun run --cwd app typecheck
bun run --cwd app check
bun run --cwd app build
```

## Packaging

The root build compiles `packages/host` into the generated sidecar at:

```text
app/resources/backend/aria-backend
app/resources/backend/aria-backend.exe
```

Electron Builder copies that executable to `resources/backend` inside the packaged application.

```sh
bun run build
bun run release:linux
bun run release:windows
```

Generated sidecars and release artifacts are ignored by Git.

## Related packages

- [`packages/protocol`](../packages/protocol/README.md)
- [`packages/core`](../packages/core/README.md)
- [`packages/host`](../packages/host/README.md)

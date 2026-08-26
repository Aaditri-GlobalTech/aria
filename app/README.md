# Aria desktop app

The Electron client for Aria. It contains the Solid/Vite renderer, Electron main process, preload bridge, and native desktop features. It launches the reusable Bun `@aria/host`, which embeds `@aria/core`.

## Responsibilities

- Render the workspace UI with Solid and Vite.
- Own windows, custom controls, tray behavior, and native folder selection.
- Expose the narrow typed `window.aria` bridge to the renderer.

Agent, filesystem, Git, and persistence logic belong in extensions, not in Electron or Core.

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

## Packaging

```sh
bun run build
bun run release:linux
bun run release:windows
```

Release artifacts are ignored by Git.

## Related packages

- [`packages/core`](../packages/core/README.md)
- [`packages/host`](../packages/host/README.md)
- [`packages/protocol`](../packages/protocol/README.md)

# Aria desktop app

The Electron client for Aria. It contains the Solid/Vite renderer, Electron
main process, preload bridge, and native desktop features. It launches the
reusable Bun extension host `@aria/host`, which embeds `@aria/core`.

## Use the app

Install Pi separately and make sure its executable is on `PATH`:

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.2
```

From the repository root:

```sh
bun install --ignore-scripts
bun run prepare
bun run dev
```

Choose a workspace with the Explorer folder action, then use the session pane
to create or open a Pi session. Git is optional for Explorer and required for
Source Control.

## Responsibilities

- Render the workspace UI with Solid and Vite.
- Own windows, custom controls, tray behavior, and native folder selection.
- Expose the narrow typed `window.aria` bridge to the renderer.
- Start `@aria/host` and forward only Agent manager events to the renderer.

Agent, filesystem, Git, and persistence logic belong in extensions, not in
Electron or the extension runtime. Development loads the Agent and Workspace
extensions from the monorepo; packaged builds load compiled resource modules.

## Chat rendering

Assistant messages preserve prose and render fenced code with Highlight.js
syntax highlighting. Fenced `mermaid` blocks render diagrams with Mermaid's
strict security mode; invalid or unsupported blocks fall back to raw text.
Thinking is shown inline, user prompts are right-aligned, and tool cards are
collapsible.

`read` and `write` output use the file extension for language detection, while
`edit` output uses diff highlighting. These tool outputs show line numbers;
`read` starts at its requested offset. Errors remain unnumbered. The transcript
follows streamed output while the user is at the bottom and offers a jump-to-
latest control after the user scrolls away.

## Host configuration

The main process uses the Electron `HostClient` example and connects the host
through a unique per-launch Unix socket or Windows named pipe. The renderer
continues to use the preload and Electron IPC bridge.

| Variable | Purpose |
| --- | --- |
| `ARIA_HOST_SOURCE_PATH` | Run a source host entrypoint instead of the packaged executable. |
| `ARIA_HOST_RUNTIME` | Runtime command for the source host; defaults to `bun`. |
| `ARIA_HOST_CWD` | Working directory for the source host and relative paths. |
| `ARIA_HOST_EXTENSION_SOURCES` | Override extension sources, separated by `:` on Unix or `;` on Windows. |
| `ELECTRON_PRELOAD_PATH` | Override the bundled preload path, mainly for development. |

Each extension source may be a module file or an extension package directory.
When `ARIA_HOST_EXTENSION_SOURCES` is unset, packaged builds use
`process.resourcesPath/extensions/agent.cjs` and `workspace.cjs`. The app does
not scan the host's global extensions directory.

## Packaging

The app-local build creates Electron assets only. Compile the host and bundled
extensions first, or use the root build:

```sh
bun run build:host
bun run --cwd app build
```

The complete packaging commands are:

```sh
bun run build
bun run release:linux
bun run release:windows
```

For a packaged-host smoke test:

```sh
bun run check:host
```

## Development checks

```sh
bun run --cwd app test
bun run --cwd app typecheck
bun run --cwd app check
bun run check:browser-smoke
```

## Related packages

- [`packages/core`](../packages/core/README.md)
- [`packages/host`](../packages/host/README.md)
- [`packages/protocol`](../packages/protocol/README.md)
- [`packages/extensions/agent`](../packages/extensions/agent/README.md)
- [`packages/extensions/workspace`](../packages/extensions/workspace/README.md)

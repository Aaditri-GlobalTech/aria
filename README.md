# Aria

Electron workspace UI with streamed Pi sessions.

## Project metadata

- License: [MIT](LICENSE)
- Author: Kumar Rahul Anand
- Maintainer: Aaditri GlobalTech
- Homepage: [Aria](https://github.com/Aaditri-GlobalTech/aria#Aria)

## Architecture

Aria is a Bun workspace monorepo. The Electron client launches a reusable Bun extension host process, which embeds the generic extension runtime.

- `app/` — Electron shell, host client, Solid/Vite renderer, and preload bridge.
- `packages/core/` — generic extension runtime, lifecycle, routing, and execution boundaries.
- `packages/host/` — reusable Bun extension host process.
- `packages/protocol/` — generic JSON-RPC contract between the app and host.
- `packages/extensions/*` — Agent/Pi and Workspace feature extensions.

### Runtime flow

1. Electron starts `@aria/host` through the typed `HostClient`.
2. The host passes its explicit `extensionSources` to `@aria/core`.
3. The extension runtime discovers and validates extension definitions, then starts providers lazily.
4. `capability.request` carries opaque JSON payloads; the owning extension validates them.
5. Extension events return through the generic `runtime.event` notification.

Hosts have no built-in feature list. The desktop app supplies the Agent and
Workspace extensions in development and from `app/resources/extensions/` in
packaged builds.

See the package documentation:

- [`app/README.md`](app/README.md)
- [`packages/core/README.md`](packages/core/README.md)
- [`packages/host/README.md`](packages/host/README.md)
- [`packages/protocol/README.md`](packages/protocol/README.md)
- [`packages/extensions/agent/README.md`](packages/extensions/agent/README.md)
- [`packages/extensions/workspace/README.md`](packages/extensions/workspace/README.md)
- [`packages/host/examples/README.md`](packages/host/examples/README.md) — full client and embedding examples.

Before contributing, read [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Features

- Workspace-based Pi sessions with session tabs and streamed assistant output.
- Inline thinking, user prompts, tool calls, status updates, and extension feedback dialogs.
- Model and thinking-level selection, stop controls, and steer/follow-up prompts while a turn is running.
- VS Code-style activity views with an expandable Explorer and local Git Source Control for the active workspace.
- Resizable workbench panels, system-tray minimize/restore, and Linux AppImage/deb and Windows NSIS packaging.

### Keyboard defaults

- `Enter` submits a prompt; `Shift+Enter` inserts a newline.
- `Ctrl+Enter` commits a Source Control message.
- Arrow keys resize the focused panel.

### Transcript rendering

- Assistant prose is left-aligned; fenced code uses Highlight.js syntax highlighting and `mermaid` fences render diagrams.
- Thinking is inline italic text and user prompts are right-aligned dark bubbles.
- Bash and other generic tools render as `$` command blocks with output.
- Every tool card is collapsible; `read`, `edit`, and `write` render without `$` and show the workspace path.
- `read` shows its requested line range; `edit` displays Pi's line-numbered diff; `write` displays the content written.
- The transcript and tool output follow streamed content until the user scrolls away.

## Prerequisite

Install Pi separately:

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.2
```

Make sure `pi` is available on `PATH` for the packaged app. Git is optional for
the Explorer but required for Source Control; install Git and put it on `PATH`
if you want branch, status, staging, and commit actions.

## Use Aria

From the repository root, install dependencies and start the development app:

```sh
bun install --ignore-scripts
bun run prepare
bun run dev
```

Choose a workspace in Explorer, create a session, and send prompts to Pi. The
packaged app uses the same extension capabilities and host configuration as
development.

## Development

The development script passes these extension package directories to the Bun
host:

- `packages/extensions/agent`
- `packages/extensions/workspace`

Run the local checks with:

```sh
bun run check
```

For renderer or bundling changes, also run:

```sh
bun run check:browser-smoke
```

Build locally when validating packaging:

```sh
bun run build
```

This compiles the Bun host and bundles the built-in extensions into
`app/resources/host/` and `app/resources/extensions/` before building the
Electron app. Validate the generated host and extension resources with:

```sh
bun run build:host
bun run check:host
```

## Releases

The repository-level release command requires a clean tree, bumps `app/package.json`, runs the checks, promotes package changelogs, and creates the release commit and tag:

```sh
bun run release -- patch   # or minor / major / x.y.z
git push origin main --follow-tags
```

Pushing the tag builds Linux and Windows artifacts in GitHub Actions and attaches them to the GitHub release. The release command does not push automatically. Every pushed commit runs the CI build, while local commits run the validation check through Husky's pre-commit hook.

For a local artifact build on the matching host:

```sh
bun run release:linux    # app/release/*.AppImage and app/release/*.deb
bun run release:windows  # app/release/*Setup*.exe
```

# Aria

Electron workspace UI with streamed Pi sessions.

## Project metadata

- License: [MIT](LICENSE)
- Author: Kumar Rahul Anand
- Maintainer: Aaditri GlobalTech
- Homepage: [Aria](https://github.com/Aaditri-GlobalTech/aria#Aria)

## Architecture

Aria is a Bun workspace monorepo. The Electron client launches a reusable Bun host process, which embeds the generic Core extension runtime.

- `app/` — Electron shell, host client, Solid/Vite renderer, and preload bridge.
- `packages/core/` — generic extension runtime, lifecycle, routing, and execution boundaries.
- `packages/host/` — reusable Bun process host for Core.
- `packages/protocol/` — generic JSON-RPC contract between the app and host.

See the package documentation:

- [`app/README.md`](app/README.md)
- [`packages/core/README.md`](packages/core/README.md)
- [`packages/host/README.md`](packages/host/README.md)
- [`packages/protocol/README.md`](packages/protocol/README.md)

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

- Assistant messages are plain left-aligned text; thinking is inline italic text.
- User prompts are right-aligned dark bubbles.
- Bash and other generic tools render as `$` command blocks with output.
- `read`, `edit`, and `write` render without `$` and show the workspace path.
- `edit` displays Pi's line-numbered diff; `write` displays the content written.

## Prerequisite

Install Pi separately:

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.2
```

Then make sure `pi` is available on `PATH` for the packaged app.

Git is optional for the Explorer but required for Source Control. Install Git and make sure it is available on `PATH` if you want branch, status, staging, and commit actions.

## Development

```sh
bun install --ignore-scripts
bun run prepare
bun run dev
```

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

This compiles the Bun host into `app/resources/host/` before building the Electron app.

## Releases

Bump the version locally; this updates `app/package.json`, then creates the version commit and tag:

```sh
bun run release -- patch   # or minor / major
git push origin main --follow-tags
```

Pushing the tag builds Linux and Windows artifacts in GitHub Actions and attaches them to the GitHub release. Every pushed commit runs the CI build, while local commits run the validation check through Husky's pre-commit hook.

For a local artifact build on the matching host:

```sh
bun run release:linux    # app/release/*.AppImage and app/release/*.deb
bun run release:windows  # app/release/*Setup*.exe
```

# Aria

Electron workspace UI with streamed Pi sessions.

## Project metadata

- License: [MIT](LICENSE)
- Author: Kumar Rahul Anand
- Maintainer: Aaditri GlobalTech
- Homepage: [Aria](https://github.com/Aaditri-GlobalTech/aria#Aria)

## Architecture

Aria is a Bun workspace monorepo. The Electron client in `app/` launches the compiled Bun host sidecar and communicates with it using JSON-RPC 2.0 over newline-delimited stdio.

- `app/` — Electron shell, Solid/Vite renderer, preload bridge, and host client.
- `packages/protocol/` — shared renderer/host types and JSON-RPC contracts.
- `packages/core/` — Pi sessions, persistence, filesystem, and Git domain logic.
- `packages/host/` — Bun executable entrypoint and stdio RPC dispatcher.

See the package documentation:

- [`app/README.md`](app/README.md)
- [`packages/protocol/README.md`](packages/protocol/README.md)
- [`packages/core/README.md`](packages/core/README.md)
- [`packages/host/README.md`](packages/host/README.md)

## Features

- Workspace-based Pi sessions with session tabs and streamed assistant output.
- Inline thinking, user prompts, tool calls, status updates, and extension feedback dialogs.
- Model and thinking-level selection, stop controls, and steer/follow-up prompts while a turn is running.
- VS Code-style activity views with an expandable Explorer and local Git Source Control for the active workspace.
- Resizable workbench panels, system-tray minimize/restore, and Linux AppImage/deb and Windows NSIS packaging.

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
bun install
bun run dev
```

Run the local checks with:

```sh
bun run check
bun run typecheck
bun run test
bun run build
```

## Releases

Bump the version locally; this updates `app/package.json`, then creates the version commit and tag:

```sh
bun run release -- patch   # or minor / major
git push origin main --follow-tags
```

Pushing the tag builds Linux and Windows artifacts in GitHub Actions and attaches them to the GitHub release. Every pushed commit also runs the CI build, while local commits run the build through Husky's pre-commit hook.

For a local artifact build on the matching host:

```sh
bun run release:linux    # app/release/*.AppImage and app/release/*.deb
bun run release:windows  # app/release/*Setup*.exe
```

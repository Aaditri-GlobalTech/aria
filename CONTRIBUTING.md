# Contributing to Aria

## Before contributing

Aria is a Bun workspace monorepo containing an Electron client, a reusable Core runtime, and a generic Bun host. Read the root `README.md` and `AGENTS.md` before making changes.

Keep changes focused and understand the behavior and interactions of every change, including changes produced with AI assistance.

## Development setup

Use Bun 1.4.0 or a compatible version, then install dependencies without running lifecycle scripts:

```sh
bun install --ignore-scripts
bun run prepare
bun run dev
```

Running the desktop app also requires Pi to be installed separately and available on `PATH`. Git is required for Source Control features.

## Repository structure

- `app/` — Electron main process, host client, preload bridge, and Solid renderer.
- `packages/core/` — reusable, generic extension runtime.
- `packages/host/` — reusable Bun process host for Core.
- `packages/protocol/` — generic app-to-host wire contract.

Keep application capabilities in extensions rather than in Core or the Electron renderer.

## Validation

Run the root check before opening a pull request:

```sh
bun run check
```

This formats and lints with warnings treated as errors, typechecks, and runs the tests in that order. For renderer or bundling changes, also run:

```sh
bun run check:browser-smoke
```

Build and release commands are for packaging validation or release work, not routine changes.

## Issues

Use the structured issue forms. Bug reports should include concise reproduction steps, expected and actual behavior, environment details, and sanitized logs when relevant. Feature requests should describe the problem and a focused proposed solution. Do not include secrets or other sensitive data.

## Pull requests

- Explain the problem and the solution.
- List the validation commands you ran.
- Include screenshots or recordings for renderer and UI changes.
- Add an entry to the affected package's `CHANGELOG.md` under `Unreleased` when required by `AGENTS.md`.
- Keep dependency versions pinned and review any `bun.lock` changes.
- Do not include generated release artifacts, credentials, or unrelated formatting changes.

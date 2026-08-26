# Changelog

## [Unreleased]

### Breaking Changes

- Removed `createHost`; construct `CoreHost` directly.
- Renamed `CoreHost` and `CoreHostOptions` to `ExtensionHost` and `ExtensionHostOptions`; the embedded runtime is exposed as `runtime`.
- Renamed client examples to `cli.ts`, `node.ts`, and `electron.ts`.

### Added

- Added separate stdio and Electron client examples.
- Added reusable stdio and WebSocket transport adapters.
- Added standalone CLI and WebSocket client examples.

### Changed

- `ExtensionHost` now accepts a custom JSON-RPC transport while retaining stdio as the default.

- Host now owns the default `~/.aria` directory, global `extensions` directory,
  and `host.db` manual-lease recovery state.
- Core is used through `CoreRuntime.dispatch()` and no longer owns persistence.

## [0.1.4] - 2026-08-26
### Added

- Added a reusable Bun host for embedding the generic Core runtime.
- Added repeatable `--extension-source` arguments for feature configuration.

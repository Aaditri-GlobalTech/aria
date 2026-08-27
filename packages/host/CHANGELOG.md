# Changelog

## [Unreleased]

### Breaking Changes

- Removed the public `createHost` factory; construct `ExtensionHost` directly.
- Renamed `CoreHost` and `CoreHostOptions` to `ExtensionHost` and `ExtensionHostOptions`; the embedded runtime is exposed as `runtime`.
- Renamed client examples to `cli.ts`, `node.ts`, and `electron.ts`.
- `ExtensionHost` now requires an explicit `JsonRpcTransport`; use `StdioTransport` for stdio compatibility.

### Added

- Added separate stdio and Electron client examples.
- Added reusable stdio, local socket, and WebSocket transport adapters.
- Added standalone CLI, local socket, and WebSocket client examples.

### Changed

- `ExtensionHost` now accepts a custom JSON-RPC transport.
- Corrected host API, transport, and example documentation for the current implementation.
- The host executable, Node client, and Electron client now use a local socket or named pipe by default; `--stdio` remains explicit compatibility mode.
- Host now owns the default `~/.aria` directory, global `extensions` directory,
  and `host.db` manual-lease recovery state.
- The host uses `ExtensionRuntime.dispatch()` and owns manual-lease persistence.

## [0.1.4] - 2026-08-26
### Added

- Added a reusable Bun host for embedding the generic Core runtime.
- Added repeatable `--extension-source` arguments for feature configuration.

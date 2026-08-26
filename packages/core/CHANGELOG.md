# Changelog

## [Unreleased]

### Breaking Changes

- Replaced imperative lifecycle calls with the typed `CoreRuntime.dispatch()` command API.
- Removed the unused `CommandDispatcher`, `createCore`, `suspend`/`resume` hooks, and `discovery` failure phase.
- Removed Core's SQLite/manual-lease persistence and its persistence options; manual leases are now in-memory only.
- Removed the `persistence_failed` variant from the public `CoreEvent` union.
- Renamed the public Core runtime and command/event APIs to the Extension Runtime vocabulary (`ExtensionRuntime`, `RuntimeCommand`, and `RuntimeEvent`).

### Changed

- Replaced Node runtime adapters with Bun filesystem, module, process, worker, and stream APIs.
- Added TypeBox validation for Core commands and boundary messages.

### Added

- Added developer documentation for Core architecture and extension development.

## [0.1.4] - 2026-08-26
### Added

- Added the minimal event-driven extension runtime control plane.
- Added filesystem/package discovery, dependency validation, lifecycle leases, and main/worker/child execution boundaries.
- Added the execution-neutral extension SDK and child/worker handshake transport.
- Documented explicit extension sources, opaque capability payloads, and lazy dependency leases.

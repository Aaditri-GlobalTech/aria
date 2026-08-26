# Changelog

## [Unreleased]

### Breaking Changes

- Replaced imperative lifecycle calls with the typed `CoreRuntime.dispatch()` command API.
- Removed the unused `CommandDispatcher`, `createCore`, `suspend`/`resume` hooks, and `discovery` failure phase.
- Added `extension_manual_lease` and `persistence_failed` variants to the public `CoreEvent` union; exhaustive event consumers may need updating.

### Changed

- Replaced Node runtime adapters with Bun filesystem, module, process, worker, and stream APIs.
- Added TypeBox validation for Core commands and boundary messages.
- Added buffered SQLite persistence for selected Core events and manual lease recovery.

### Added

- Added the default `~/.aria/host.db` storage location and persistence options.
- Added developer documentation for Core architecture and extension development.

## [0.1.4] - 2026-08-26
### Added

- Added the minimal event-driven extension runtime control plane.
- Added filesystem/package discovery, dependency validation, lifecycle leases, and main/worker/child execution boundaries.
- Added the execution-neutral extension SDK and child/worker handshake transport.
- Documented explicit extension sources, opaque capability payloads, and lazy dependency leases.

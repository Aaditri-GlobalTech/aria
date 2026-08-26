# Changelog

## [Unreleased]

### Breaking Changes

- Removed `createHost`; construct `CoreHost` directly.

### Added

- Added separate stdio and Electron client examples.

### Changed

- Host now owns the default `~/.aria` directory, global `extensions` directory,
  and `host.db` manual-lease recovery state.
- Core is used through `CoreRuntime.dispatch()` and no longer owns persistence.

## [0.1.4] - 2026-08-26
### Added

- Added a reusable Bun host for embedding the generic Core runtime.
- Added repeatable `--extension-source` arguments for feature configuration.

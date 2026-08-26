# Changelog

## [Unreleased]

### Added

- Added the Electron-to-Bun `HostClient` using the generic JSON-RPC protocol over stdio.
- Added the typed `window.aria` renderer bridge.
- Configured Electron Builder to package the Bun Core host as an application resource.

### Changed

- Moved the desktop client, renderer, preload, tests, and build configuration into the `app` workspace.
- Centralized editor, commit, and panel-resizing keyboard defaults.

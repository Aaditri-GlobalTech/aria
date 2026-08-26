# Changelog

## [Unreleased]

### Changed

- Connected the Electron main process to the Bun host through a per-launch local socket or Windows named pipe instead of the default stdio path.

## [0.1.4] - 2026-08-26
### Added

- Added Mermaid diagram rendering and Shiki syntax highlighting for fenced code in chat messages.
- Added automatic bottom-following for streamed transcript and tool output.
- Added collapsible tool cards and compact `read` line ranges.
- Added the Electron-to-Bun `HostClient` using the generic JSON-RPC protocol over stdio.
- Added the typed `window.aria` renderer bridge.
- Added development and packaged extension source configuration.
- Configured Electron Builder to package the Bun Core host and built-in extension modules as application resources.

### Changed

- Routed Agent, Explorer, and Source Control requests through configured generic Core capabilities.
- Moved version bumping to the repository-level release command so tags match the app version.
- Documented host resource resolution and extension capability routing.
- Refined transcript presentation with reduced horizontal padding and hover-only scrollbars.
- Moved the desktop client, renderer, preload, tests, and build configuration into the `app` workspace.
- Centralized editor, commit, and panel-resizing keyboard defaults.

# Changelog

## [Unreleased]

### Added

- Added the Bun workspace layout with a standalone JSON-RPC host sidecar.
- Added dedicated package README and changelog documentation.
- Added activity-bar view switching with an expandable Explorer for the active workspace.
- Added local Git Source Control with branch/status display, staging, unstaging, refresh, and commits.
- Added system-tray minimize/restore behavior when the application window is closed.

### Changed

- Migrated backend logic into `packages/core` and the Bun executable entrypoint into `packages/host`.
- Refined the streamed transcript to match the workspace UI: plain assistant text, inline thinking, right-aligned user prompts, and individual tool blocks.
- Rendered tool paths consistently and kept `$` prompts for bash and generic tools while omitting them for `read`, `edit`, and `write`.
- Displayed Pi edit diffs and written file content directly in the transcript.

## [0.1.1] - 2026-08-24

### Added

- CI checks, Husky pre-commit builds, and tagged release automation.

### Changed

- Documented the Pi installation command for packaged launches.
- Made packaged Pi launches resolve user-installed Pi binaries reliably.

## [0.1.0] - 2026-08-24

### Added

- Multi-session Pi RPC integration with CWD-grouped session history.
- Session tabs with streamed assistant, thinking, and tool output.
- Steer and follow-up prompts while an agent is running.
- Feedback dialogs and status-bar notifications.
- Linux AppImage/deb and Windows NSIS release builds.

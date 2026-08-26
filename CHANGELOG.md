# Changelog

## [Unreleased]

### Added

- Added the Bun workspace layout with reusable Core and host packages.
- Added a generic JSON-RPC protocol for the Electron-to-Bun host boundary.
- Added dedicated package README and changelog documentation.
- Added structured bug-report and feature-request issue forms.
- Added scheduled Bun dependency auditing.

### Changed

- Replaced the feature-specific Core backend with a generic extension runtime and moved the Electron boundary to `packages/host`.
- Streamlined root validation to format, lint, typecheck, and test in sequence.
- Hardened CI and release workflows with pinned actions, least-privilege permissions, and frozen Bun installs.
- Added Bun-focused contribution and development guidance.

## [0.1.3] - 2026-08-25

### Added

- Added activity-bar view switching with an expandable Explorer for the active workspace.
- Added local Git Source Control with branch/status display, staging, unstaging, refresh, and commits.
- Added system-tray minimize/restore behavior when the application window is closed.

## [0.1.2] - 2026-08-24

### Changed

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

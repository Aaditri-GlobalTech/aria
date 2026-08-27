# Changelog

## [Unreleased]

### Added

- Added streamed tool progress rendering and paged session history loading to the desktop chat.

### Changed

- Reconciled project and package documentation with the current extension runtime, host transports, and Highlight.js chat rendering.
- Refined chat auto-follow and workspace session layout for responsive scrolling.

### Fixed

- Kept open Pi sessions alive after completed turns and marked accepted prompts working immediately, including steer and follow-up prompts.

## [0.1.4] - 2026-08-26
### Added

- Added the Bun workspace layout with reusable Core and host packages.
- Added a generic JSON-RPC protocol for the Electron-to-Bun host boundary.
- Added dedicated package README and changelog documentation.
- Added structured bug-report and feature-request issue forms.
- Added scheduled Bun dependency auditing.
- Added Agent/Pi and Workspace extension packages with generic Core capability wiring.
- Added packaged-host smoke coverage for bundled extension resources.
- Added Mermaid diagram rendering and Shiki syntax highlighting for fenced chat code.
- Added collapsible tool cards and automatic bottom-following for streamed transcript output.

### Changed

- Replaced the feature-specific Core backend with a generic extension runtime and moved the Electron boundary to `packages/host`.
- Moved Agent, filesystem, and Git behavior and feature types into configured extensions.
- Documented explicit extension source loading for development and packaged hosts.
- Streamlined root validation to format, lint, typecheck, and test in sequence.
- Hardened CI and release workflows with pinned actions, least-privilege permissions, and frozen Bun installs.
- Added Bun-focused contribution and development guidance.
- Refined transcript presentation with compact read ranges, reduced chat padding, and hover-only scrollbars.
- Updated CI and lint exclusions to use the generic packaged host paths.
- Added a repository-level release command that bumps the app version, runs checks, and creates release tags.

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

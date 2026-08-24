# Changelog

## [Unreleased]

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

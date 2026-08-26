# @aria/extension-agent Changelog

## [Unreleased]
### Added

- Added `agent.close` to release a session's Pi process.

### Changed

- Keep Pi RPC processes alive until their session is closed and settled.

## [0.1.4] - 2026-08-26
### Added

- Added the Agent/Pi extension package.
- Added `agent.*` capabilities for session lifecycle, prompts, commands, abort, and feedback.
- Added persisted-session discovery and Pi RPC process lifecycle management.
- Added `agent.manager` events for session state and Pi stream updates.

# Aria

Electron workspace UI with streamed Pi sessions.

## Features

- Workspace-based Pi sessions with session tabs and streamed assistant output.
- Inline thinking, user prompts, tool calls, status updates, and extension feedback dialogs.
- Model and thinking-level selection, stop controls, and steer/follow-up prompts while a turn is running.
- Resizable workbench panels with Linux AppImage/deb and Windows NSIS packaging.

### Transcript rendering

- Assistant messages are plain left-aligned text; thinking is inline italic text.
- User prompts are right-aligned dark bubbles.
- Bash and other generic tools render as `$` command blocks with output.
- `read`, `edit`, and `write` render without `$` and show the workspace path.
- `edit` displays Pi's line-numbered diff; `write` displays the content written.

## Prerequisite

Install Pi separately:

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.2
```

Then make sure `pi` is available on `PATH` for the packaged app.

## Development

```sh
npm ci
npm run dev
```

Run the local checks with:

```sh
npm run check
npm run typecheck
npm test
npm run build
```

## Releases

Bump the version locally; this updates `package.json` and `package-lock.json`, then creates the version commit and tag:

```sh
npm run release -- patch   # or minor / major
git push origin main --follow-tags
```

Pushing the tag builds Linux and Windows artifacts in GitHub Actions and attaches them to the GitHub release. Every pushed commit also runs the CI build, while local commits run the build through Husky's pre-commit hook.

For a local artifact build on the matching host:

```sh
npm run release:linux    # release/*.AppImage and release/*.deb
npm run release:windows  # release/*Setup*.exe
```

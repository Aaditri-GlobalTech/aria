# Aria

Electron workspace UI with streamed Pi sessions.

## Prerequisite

Install Pi separately:

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

Then make sure `pi` is available on `PATH` for the packaged app.

## Development

```sh
npm ci
npm run dev
```

## Releases

Build on the matching host:

```sh
npm run release:linux    # release/*.AppImage and release/*.deb
npm run release:windows  # release/*Setup*.exe
```

Pushing a `v*` tag builds Linux and Windows artifacts in GitHub Actions and attaches them to the GitHub release.

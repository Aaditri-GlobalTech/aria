# Aria

Electron workspace UI with streamed Pi sessions.

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

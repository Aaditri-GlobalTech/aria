<p align="center">
  <a href="https://aria.dev">
    <img alt="Aria logo" src="https://aria.dev/logo-auto.svg" width="128">
  </a>
</p>

> New issues and PRs from new contributors are auto-closed by default. Maintainers review auto-closed issues daily. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

# Aria Agent Harness Monorepo

This is the home of the Aria agent harness project, including the self-extensible coding agent.

* **[@aaditri-globaltech/aria-coding-agent](packages/coding-agent)**: Interactive coding agent CLI
* **[@aaditri-globaltech/aria-agent](packages/agent)**: Agent runtime with tool calling and state management
* **[@aaditri-globaltech/aria-ai](packages/ai)**: Unified multi-provider LLM API (OpenAI, Anthropic, Google, …)

To learn more about Aria:

* [Visit aria.dev](https://aria.dev), the project website with demos
* [Read the documentation](https://aria.dev/docs/latest), but you can also ask the agent to explain itself

## Share your OSS coding agent sessions

If you use Aria or other coding agents for open source work, please share your sessions.

Public OSS session data helps improve coding agents with real-world tasks, tool use, failures, and fixes instead of toy benchmarks.

For the full explanation, see [this post on X](https://x.com/badlogicgames/status/2037811643774652911).

To publish sessions, use [`Aaditri-GlobalTech/aria-share-hf`](https://github.com/Aaditri-GlobalTech/aria-share-hf). Read its README.md for setup instructions. All you need is a Hugging Face account, the Hugging Face CLI, and `aria-share-hf`.

You can also watch [this video](https://x.com/badlogicgames/status/2041151967695634619), where the original workflow for publishing coding-agent sessions is shown.

Published Aria work sessions are available here:

- [aaditri-globaltech/aria on Hugging Face](https://huggingface.co/datasets/aaditri-globaltech/aria)

## All Packages

| Package | Description |
|---------|-------------|
| **[@aaditri-globaltech/aria-ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@aaditri-globaltech/aria-agent](packages/agent)** | Agent runtime with tool calling and state management |
| **[@aaditri-globaltech/aria-coding-agent](packages/coding-agent)** | Interactive coding agent CLI |
| **[@aaditri-globaltech/aria-tui](packages/tui)** | Terminal UI library with differential rendering |

For Slack/chat automation and workflows see [Aaditri-GlobalTech/aria-chat](https://github.com/Aaditri-GlobalTech/aria-chat).

## Permissions & Containerization

Aria does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it.

If you need stronger boundaries, containerize or sandbox Aria. See [packages/coding-agent/docs/containerization.md](packages/coding-agent/docs/containerization.md) for three patterns:

- **OpenShell**: run the whole `aria` process in a policy-controlled sandbox.
- **Gondolin extension**: keep `aria` and provider auth on the host while routing built-in tools and `!` commands into a local Linux micro-VM.
- **Plain Docker**: run the whole `aria` process in a local container for simple isolation.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).

## Development

```bash
npm install --ignore-scripts  # Install all dependencies without running lifecycle scripts
npm run build        # Build all packages
npm run check        # Lint, format, and type check
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
./aria-test.sh       # Run Aria from sources (can be run from any directory)
```

## Supply-chain hardening

We treat npm dependency changes as reviewed code changes.

- Direct external dependencies are pinned to exact versions. Internal workspace packages remain version-ranged.
- `.npmrc` sets `save-exact=true` and `min-release-age=2` to avoid same-day dependency releases during npm resolution.
- `package-lock.json` is the dependency ground truth. Pre-commit blocks accidental lockfile commits unless `ARIA_ALLOW_LOCKFILE_CHANGE=1` is set.
- `npm run check` verifies pinned direct deps, native TypeScript import compatibility, and the generated coding-agent shrinkwrap.
- The published CLI package includes `packages/coding-agent/npm-shrinkwrap.json`, generated from the root lockfile, to pin transitive deps for npm users.
- Release smoke tests use `npm run release:local` to build, pack, and create isolated npm and Bun installs outside the repo before tagging a release.
- Local release installs, documented npm installs, and `aria update --self` use `--ignore-scripts` where supported.
- CI installs with `npm ci --ignore-scripts`, and a scheduled GitHub workflow runs `npm audit --omit=dev` plus `npm audit signatures --omit=dev`.
- Shrinkwrap generation has an explicit allowlist for dependency lifecycle scripts; new lifecycle-script deps fail checks until reviewed.

## Credits

Originally based on Pi by Mario Zechner. Now independently maintained and heavily extended as Aria.

## License

MIT

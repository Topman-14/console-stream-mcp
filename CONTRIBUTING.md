# Contributing

Thanks for your interest in improving mobius-mcp.

## Setup

```bash
npm install
npm run build
npm run test
```

This is an npm workspaces monorepo:

* `apps/mcp-server` — the MCP server
* `apps/browser-extension` — Chromium extension client
* `apps/npm-client` — `mobius-client` npm package
* `packages/capture-core` — shared event/message schema and runtime hook patching (console, errors, network)

For active development, `npm run watch` runs incremental watchers for the shared packages and the extension together (with automatic reload in Chrome) — see [README.md](./README.md#watch-mode) for details.

## Guidelines

* Keep the extension and npm client emitting an identical protocol — the server must not be able to distinguish event sources.
* Protocol changes must be additive/versioned; don't break existing consumers.
* No cloud services, telemetry, or external network calls.
* Open an issue before starting significant changes.

## Pull requests

* Keep diffs focused on a single change.
* Add/update tests for behavior changes.
* Run `npm run lint` and `npm run test` before submitting.

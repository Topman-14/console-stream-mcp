# mobius-mcp

MCP server that maintains a live, in-memory stream of browser runtime events and exposes them to AI agents as MCP tools.

Pair it with the Mobius browser extension (or the `mobius-client` npm package) to capture console logs, errors, and network requests from a running web app, then query them from an MCP client like Claude Code.

## Usage

```bash
npx mobius-mcp
```

Register it with your MCP client, e.g. for Claude Code:

```bash
claude mcp add mobius-mcp -- npx -y mobius-mcp
```

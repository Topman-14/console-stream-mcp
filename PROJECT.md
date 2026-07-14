# Project: mobius-mcp

## Overview

Build an open source MCP server called **mobius-mcp**.

Its purpose is to give AI coding agents (Claude Code, Codex CLI, Gemini CLI, etc.) live access to a web application's runtime so they can debug issues without requiring the developer to manually copy and paste console logs or browser errors, there should be an accompanying skill that lets the agents know when to use the mcp.

Everything should run locally. No cloud services, telemetry, or external APIs.

## Direction (living doc)

This doc describes the original scope — a log/event bridge — which is built (see "Stage A" in [ROADMAP.md](./ROADMAP.md)). The project's actual direction is broader: not just a bridge that reads browser state, but a **browser runtime service** the agent can command. Synchronous tools answer questions about existing state (Stage A); asynchronous tools, backed by a shared job system, initiate work that takes time (recordings, screenshots, profiling, debug sessions). Nothing is published yet, so none of this is versioned — ROADMAP.md tracks build stages, not releases. It supersedes this doc's "MCP Tools" and "Future Enhancements" sections below where they conflict.

One consequence: the "browser client implementations must be indistinguishable" principle below holds for *event ingestion* (both clients emit identical payloads), but not for *commands* — many later-stage capabilities (screenshots, DOM/performance profiling, `evaluate_js`) require Chrome DevTools Protocol access only the extension has. The protocol tracks this via a `capabilities` field so command tools fail clearly against a tab that can't support them, rather than hanging.

## High Level Architecture

The project consists of three parts:

1. **MCP Server (Node.js)**

   * Implements the Model Context Protocol.
   * Exposes tools that AI agents can call.
   * Maintains a live in-memory stream of browser events.
   * Acts as the central hub.

2. **Browser Client**
   Two implementations:

   * A Chromium browser extension.
   * An installable npm package that developers can import into their application.

   Both implementations should emit identical event payloads using the same protocol so the MCP server treats them identically.

3. **Shared Protocol Package**

   * Contains shared TypeScript types.
   * Defines the event schema.
   * Defines message formats.
   * Used by both browser clients and the MCP server.

## Repository Structure

```text
mobius-mcp/
├── apps/
│   ├── mcp-server/
│   ├── browser-extension/
│   └── npm-client/
│
├── packages/
│   ├── protocol/
│   └── shared-types/
│
└── examples/
```

## Browser Extension

The extension should capture browser runtime information without requiring changes to the application.

Initially support:

* console.log
* console.info
* console.warn
* console.error
* window.onerror
* unhandled promise rejections
* fetch requests
* XMLHttpRequest
* page URL
* timestamps

The extension should stream events over a WebSocket connection to the local MCP server.

## npm Client

Provide an installable package.

Example usage:

```ts
import { startMobiusStream } from "mobius-client";

startMobiusStream();
```

This package should capture the same events as the extension and send them using the exact same protocol.

The MCP server should not be able to distinguish whether events came from the extension or the npm package.

## Communication

Everything runs locally.

```
Web App
      │
Extension OR npm package
      │
WebSocket
      │
localhost
      │
mobius-mcp
      │
MCP
      │
Claude Code / Codex / Gemini CLI
```

No external servers should ever be involved.

## Protocol

Every browser event should be represented as a structured JSON object.

Example:

```json
{
  "type": "console.error",
  "timestamp": 1752230000,
  "url": "http://localhost:3000/dashboard",
  "message": "Cannot read properties of undefined",
  "stack": "...",
  "metadata": {}
}
```

The protocol should be versioned so new event types can be added without breaking compatibility.

## MCP Tools

Initially expose tools such as:

* get_recent_logs
* get_recent_errors
* get_network_requests
* clear_logs
* get_connected_tabs
* watch_console

The server should maintain a rolling in-memory history rather than storing logs permanently.

## Design Principles

* Local-first.
* Open source.
* Zero telemetry.
* Zero cloud dependencies.
* Lightweight.
* Fast startup.
* Framework agnostic.
* Browser client implementations must share the same protocol.

## Future Enhancements

Design the architecture so additional event sources can be added later without changing the protocol significantly.

Potential additions include:

* DOM snapshots
* screenshots on errors
* React component stack traces
* Redux or Zustand state
* router navigation events
* performance metrics
* memory usage
* source map support
* Next.js overlay errors
* Vite HMR errors
* cookies and localStorage inspection
* IndexedDB inspection

## Goal

The objective is to make AI coding agents significantly better at debugging web applications by giving them live visibility into browser runtime events instead of relying on developers to manually copy logs into the chat.

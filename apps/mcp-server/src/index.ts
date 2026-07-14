#!/usr/bin/env node
import { EventStore } from "./store.js";
import { ClientRegistry } from "./registry.js";
import { CommandDispatcher } from "./commandDispatcher.js";
import { JobManager } from "./jobs.js";
import { DebugSessionManager } from "./debugSession.js";
import { startWsServer } from "./wsServer.js";
import { createMcpServer, createFollowerMcpServer, connectStdio } from "./mcpServer.js";
import { ControlClient } from "./controlClient.js";

const port = Number(process.env.CONSOLE_STREAM_PORT) || 7331;

const store = new EventStore();
const registry = new ClientRegistry();
const dispatcher = new CommandDispatcher(registry);
const jobs = new JobManager();
const debugSessions = new DebugSessionManager(store, dispatcher);
registry.setOnPurge((clientId) => store.deleteBuffer(clientId));

const { server, toolDefs } = createMcpServer(store, registry, dispatcher, jobs, debugSessions);

// Only one mobius-mcp process per machine can bind the WS port — the "hub", talking
// directly to the browser. Every other process (e.g. a second Claude Code session's own
// spawned instance) loses that race and runs as a "follower" instead: it forwards MCP
// tool calls to the hub over a small control channel (see ControlMessage in the protocol
// package) rather than crashing or silently serving a registry no browser can ever reach.
let mcpServer = server;
try {
  await startWsServer(port, store, registry, dispatcher, toolDefs);
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
  console.error(`[mobius-mcp] port ${port} already in use by another mobius-mcp process — running in follower mode, forwarding tool calls to it`);
  const controlClient = new ControlClient(port);
  mcpServer = createFollowerMcpServer(toolDefs, (tool, args) => controlClient.invoke(tool, args));
}

await connectStdio(mcpServer);

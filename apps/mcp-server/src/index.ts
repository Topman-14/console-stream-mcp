#!/usr/bin/env node
import { EventStore } from "./services/store.js";
import { ClientRegistry } from "./services/registry.js";
import { CommandDispatcher } from "./services/commandDispatcher.js";
import { JobManager } from "./services/jobs.js";
import { DebugSessionManager } from "./services/debugSession.js";
import { EventPersistence } from "./services/persistence.js";
import { startWsServer } from "./transports/wsServer.js";
import { createMcpServer, createFollowerMcpServer, connectStdio } from "./transports/mcpServer.js";
import { ControlClient } from "./services/controlClient.js";
import { WS_PORT_DEFAULT } from "./data.js";

const port = Number(process.env.CONSOLE_STREAM_PORT) || WS_PORT_DEFAULT;

// Recover whatever survived a prior crash/restart before serving any tool calls
const persistence = new EventPersistence();
const hydrated = await persistence.loadAll();

const store = new EventStore(persistence, hydrated);
const registry = new ClientRegistry();
const dispatcher = new CommandDispatcher(registry);
const jobs = new JobManager();
const debugSessions = new DebugSessionManager(store, dispatcher);

registry.setOnPurge((clientId) => store.deleteBuffer(clientId));

const {
  server,
  toolDefs
} = createMcpServer(store, registry, dispatcher, jobs, debugSessions);

// Only one mobius-mcp process per machine can bind the WS port — the "hub" Every other process (e.g. a second Claude Code session's own spawned instance) loses that race and runs as a "follower"

let mcpServer = server;
try {
  await startWsServer(port, store, registry, dispatcher, toolDefs);
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
  console.error(`[mobius-mcp] port ${port} already in use by another mobius-mcp process — running in follower mode, forwarding tool calls to it`);
  persistence.close();
  const controlClient = new ControlClient(port);
  mcpServer = createFollowerMcpServer(toolDefs, (tool, args) => controlClient.invoke(tool, args));
}

await connectStdio(mcpServer);

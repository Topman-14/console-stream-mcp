#!/usr/bin/env node
import { EventStore } from "./store.js";
import { ClientRegistry } from "./registry.js";
import { CommandDispatcher } from "./commandDispatcher.js";
import { JobManager } from "./jobs.js";
import { DebugSessionManager } from "./debugSession.js";
import { startWsServer } from "./wsServer.js";
import { createMcpServer, connectStdio } from "./mcpServer.js";

const port = Number(process.env.CONSOLE_STREAM_PORT) || 7331;

const store = new EventStore();
const registry = new ClientRegistry();
const dispatcher = new CommandDispatcher(registry);
const jobs = new JobManager();
const debugSessions = new DebugSessionManager(store, dispatcher);
registry.setOnPurge((clientId) => store.deleteBuffer(clientId));

startWsServer(port, store, registry, dispatcher);

const mcpServer = createMcpServer(store, registry, dispatcher, jobs, debugSessions);
await connectStdio(mcpServer);

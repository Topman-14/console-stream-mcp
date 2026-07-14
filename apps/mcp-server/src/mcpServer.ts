import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { EventType } from "@mobius-mcp/protocol";
import type { EventStore } from "./store.js";
import type { ClientRegistry } from "./registry.js";
import type { CommandDispatcher } from "./commandDispatcher.js";
import type { JobManager } from "./jobs.js";
import { CONSOLE_TYPES, ERROR_TYPES, NETWORK_TYPES } from "./eventCategories.js";
import type { DebugSessionManager } from "./debugSession.js";
import { waitForConsoleError, waitForNavigation, waitForRequest } from "./waitFor.js";
import { toHar } from "./har.js";

function toolResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function toolError(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

export interface ToolDef {
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<any>;
}

/** Every call below goes through the same 4-arg server.tool(name, description, schema, handler)
 * signature, so recording them for the control channel (see ControlMessage in the protocol
 * package) is a one-line intercept rather than restructuring each tool definition. */
function withToolRecording(server: McpServer, defs: Map<string, ToolDef>): McpServer {
  const original = server.tool.bind(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).tool = (name: string, description: string, schema: unknown, handler: (args: unknown) => Promise<unknown>) => {
    defs.set(name, { description, schema, handler });
    return (original as (...args: unknown[]) => unknown)(name, description, schema, handler);
  };
  return server;
}

export function createMcpServer(
  store: EventStore,
  registry: ClientRegistry,
  dispatcher: CommandDispatcher,
  jobs: JobManager,
  debugSessions: DebugSessionManager,
): { server: McpServer; toolDefs: Map<string, ToolDef> } {
  const toolDefs = new Map<string, ToolDef>();
  const server = withToolRecording(new McpServer({ name: "mobius-mcp", version: "0.0.1" }), toolDefs);

  let activeTabId: string | undefined;

  /** Resolves which tab a tool call should target: explicit param wins, then the
   * session's active tab, then auto-select if exactly one tab is connected. */
  function resolveTabId(explicitTabId?: string): { clientId: string } | { error: ReturnType<typeof toolError> } {
    if (explicitTabId) return { clientId: explicitTabId };

    const connected = registry.list();
    if (connected.length === 0) {
      return { error: toolError("No tabs connected. Ask the user to click the mobius-mcp extension icon and enable capture on the tab they want debugged.") };
    }
    if (activeTabId && connected.some((c) => c.clientId === activeTabId)) {
      return { clientId: activeTabId };
    }
    if (connected.length === 1) {
      return { clientId: connected[0].clientId };
    }
    return {
      error: toolError(
        `Multiple tabs connected, specify tabId or call set_active_tab first. Candidates: ${JSON.stringify(connected, null, 2)}`,
      ),
    };
  }

  server.tool(
    "get_recent_logs",
    "Get the most recent console.log/info/warn events from a connected browser tab.",
    { tabId: z.string().optional(), limit: z.number().int().positive().max(500).default(50) },
    async ({ tabId, limit }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      return toolResult(store.getRecent(resolved.clientId, CONSOLE_TYPES, limit));
    },
  );

  server.tool(
    "get_recent_errors",
    "Get the most recent console.error, window.onerror, and unhandled promise rejection events from a connected browser tab.",
    { tabId: z.string().optional(), limit: z.number().int().positive().max(500).default(50) },
    async ({ tabId, limit }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      return toolResult(store.getRecent(resolved.clientId, ERROR_TYPES, limit));
    },
  );

  server.tool(
    "get_network_requests",
    "Get the most recent fetch/XHR network requests observed in a connected browser tab.",
    { tabId: z.string().optional(), limit: z.number().int().positive().max(500).default(50) },
    async ({ tabId, limit }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      return toolResult(store.getRecent(resolved.clientId, NETWORK_TYPES, limit));
    },
  );

  server.tool(
    "get_logs_since",
    "Poll for events with seq greater than the given cursor from a connected browser tab. Returns the new events and the latest cursor to pass next time.",
    { tabId: z.string().optional(), cursor: z.number().int().nonnegative().default(0), types: z.array(z.string()).optional() },
    async ({ tabId, cursor, types }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      return toolResult(store.getSince(resolved.clientId, cursor, { types: types as EventType[] | undefined }));
    },
  );

  server.tool("clear_logs", "Clear the in-memory event history for a connected tab.", { tabId: z.string().optional() }, async ({ tabId }) => {
    const resolved = resolveTabId(tabId);
    if ("error" in resolved) return resolved.error;
    store.clear(resolved.clientId);
    return toolResult({ cleared: true, tabId: resolved.clientId });
  });

  server.tool("get_connected_tabs", "List browser tabs/pages currently streaming events to this server.", {}, async () =>
    toolResult(registry.list().map((c) => ({ ...c, active: c.clientId === activeTabId }))),
  );

  server.tool(
    "get_capture_settings",
    "Get which event categories (console, errors, network, navigation, dom) a connected tab is actively capturing, plus its redaction settings. Check this before concluding an empty result from get_recent_logs/get_recent_errors/get_network_requests means nothing happened — the category may simply be turned off.",
    { tabId: z.string().optional() },
    async ({ tabId }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      const client = registry.get(resolved.clientId);
      if (!client) return toolError(`Tab ${resolved.clientId} is no longer connected.`);
      return toolResult({ tabId: resolved.clientId, captureSettings: client.captureSettings ?? null });
    },
  );

  server.tool(
    "set_active_tab",
    "Set the default tab used by other tools when tabId is omitted, for the rest of this session.",
    { tabId: z.string() },
    async ({ tabId }) => {
      if (!registry.list().some((c) => c.clientId === tabId)) {
        return toolError(`No connected tab with id ${tabId}. Call get_connected_tabs to see candidates.`);
      }
      activeTabId = tabId;
      return toolResult({ active: tabId });
    },
  );

  server.tool(
    "navigate_to",
    "Navigate a connected browser tab to a URL.",
    { tabId: z.string().optional(), url: z.string() },
    async ({ tabId, url }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      try {
        return toolResult(await dispatcher.sendCommand(resolved.clientId, "navigate_to", { url }));
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    "switch_tab",
    "Bring a connected browser tab to the foreground.",
    { tabId: z.string().optional() },
    async ({ tabId }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      try {
        return toolResult(await dispatcher.sendCommand(resolved.clientId, "switch_tab", {}));
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    "reload_tab",
    "Reload a connected browser tab.",
    { tabId: z.string().optional() },
    async ({ tabId }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      try {
        return toolResult(await dispatcher.sendCommand(resolved.clientId, "reload_tab", {}));
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    "list_tabs",
    "List all open browser tabs (not just ones with capture enabled), via a connected extension.",
    {},
    async () => {
      const extensionClient = registry.list().find((c) => c.capabilities.includes("cdp"));
      if (!extensionClient) {
        return toolError("No extension connected. list_tabs requires the mobius-mcp extension to be enabled on at least one tab.");
      }
      try {
        return toolResult(await dispatcher.sendCommand(extensionClient.clientId, "list_tabs", {}));
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool("get_job_status", "Check the status of a long-running job (recording, profiling, etc).", { jobId: z.string() }, async ({ jobId }) => {
    const job = jobs.getStatus(jobId);
    if (!job) return toolError(`No job with id ${jobId}`);
    return toolResult({ id: job.id, kind: job.kind, status: job.status, error: job.error });
  });

  server.tool("get_job_result", "Get the result of a completed job.", { jobId: z.string() }, async ({ jobId }) => {
    const job = jobs.getResult(jobId);
    if (!job) return toolError(`No job with id ${jobId}`);
    if (job.status === "running") return toolError(`Job ${jobId} is still running, check get_job_status first.`);
    if (job.status === "error") return toolError(job.error ?? "Job failed");
    return toolResult(job.result);
  });

  server.tool("cancel_job", "Cancel a running job. Best-effort — in-flight work may not stop immediately.", { jobId: z.string() }, async ({ jobId }) => {
    const cancelled = jobs.cancel(jobId);
    return toolResult({ cancelled });
  });

  function requireCdp(clientId: string): ReturnType<typeof toolError> | undefined {
    const client = registry.get(clientId);
    if (!client?.capabilities.includes("cdp")) {
      return toolError(`Tab ${clientId} doesn't support this (requires the browser extension, not the npm client).`);
    }
    return undefined;
  }

  server.tool(
    "take_screenshot",
    "Capture a screenshot of a connected tab's current viewport. Requires the browser extension. Shows Chrome's 'being debugged' indicator while attached.",
    { tabId: z.string().optional() },
    async ({ tabId }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      const cdpError = requireCdp(resolved.clientId);
      if (cdpError) return cdpError;
      try {
        return toolResult(await dispatcher.sendCommand(resolved.clientId, "take_screenshot", {}));
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    "capture_full_page",
    "Capture a screenshot of a connected tab's full scrollable page, not just the viewport. Requires the browser extension.",
    { tabId: z.string().optional() },
    async ({ tabId }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      const cdpError = requireCdp(resolved.clientId);
      if (cdpError) return cdpError;
      try {
        return toolResult(await dispatcher.sendCommand(resolved.clientId, "capture_full_page", {}));
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    "capture_element",
    "Capture a screenshot of one element matching a CSS selector. Requires the browser extension.",
    { tabId: z.string().optional(), selector: z.string() },
    async ({ tabId, selector }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      const cdpError = requireCdp(resolved.clientId);
      if (cdpError) return cdpError;
      try {
        return toolResult(await dispatcher.sendCommand(resolved.clientId, "capture_element", { selector }));
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    "capture_dom",
    "Get the tab's current DOM as HTML (document.documentElement.outerHTML). Requires the browser extension.",
    { tabId: z.string().optional() },
    async ({ tabId }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      const cdpError = requireCdp(resolved.clientId);
      if (cdpError) return cdpError;
      try {
        return toolResult(await dispatcher.sendCommand(resolved.clientId, "capture_dom", {}));
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    "capture_accessibility_tree",
    "Get the tab's full accessibility tree. Requires the browser extension.",
    { tabId: z.string().optional() },
    async ({ tabId }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      const cdpError = requireCdp(resolved.clientId);
      if (cdpError) return cdpError;
      try {
        return toolResult(await dispatcher.sendCommand(resolved.clientId, "capture_accessibility_tree", {}));
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    "evaluate_js",
    "Execute arbitrary JavaScript in a connected tab and return the result. Fully open, no read-only enforcement — this is the dev's own browser and app. Requires the browser extension.",
    { tabId: z.string().optional(), expression: z.string() },
    async ({ tabId, expression }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      const cdpError = requireCdp(resolved.clientId);
      if (cdpError) return cdpError;
      try {
        return toolResult(await dispatcher.sendCommand(resolved.clientId, "evaluate_js", { expression }));
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    "get_response_body",
    "Get the response body of a recent network request by URL, if it's still available. Requires the browser extension and only covers requests made since the tab connected.",
    { tabId: z.string().optional(), requestUrl: z.string() },
    async ({ tabId, requestUrl }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      const cdpError = requireCdp(resolved.clientId);
      if (cdpError) return cdpError;
      try {
        return toolResult(await dispatcher.sendCommand(resolved.clientId, "get_response_body", { requestUrl }));
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    "export_har",
    "Export this tab's captured network requests as a HAR 1.2 file. Response bodies are not included — use get_response_body per-request if needed.",
    { tabId: z.string().optional(), limit: z.number().int().positive().max(2000).default(500) },
    async ({ tabId, limit }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      return toolResult(toHar(store.getRecent(resolved.clientId, NETWORK_TYPES, limit)));
    },
  );

  server.tool(
    "start_cpu_profile",
    "Start a CPU profile on a connected tab for a fixed duration; returns a jobId immediately, poll get_job_status/get_job_result. Requires the browser extension.",
    { tabId: z.string().optional(), durationMs: z.number().int().positive().max(60_000).default(5000) },
    async ({ tabId, durationMs }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      const cdpError = requireCdp(resolved.clientId);
      if (cdpError) return cdpError;
      const job = jobs.startJob("cpu-profile", () => dispatcher.sendCommand(resolved.clientId, "start_cpu_profile", { durationMs }, durationMs + 5000));
      return toolResult({ jobId: job.id });
    },
  );

  server.tool(
    "start_memory_profile",
    "Start a memory (heap sampling) profile on a connected tab for a fixed duration; returns a jobId immediately, poll get_job_status/get_job_result. Requires the browser extension.",
    { tabId: z.string().optional(), durationMs: z.number().int().positive().max(60_000).default(5000) },
    async ({ tabId, durationMs }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      const cdpError = requireCdp(resolved.clientId);
      if (cdpError) return cdpError;
      const job = jobs.startJob("memory-profile", () => dispatcher.sendCommand(resolved.clientId, "start_memory_profile", { durationMs }, durationMs + 5000));
      return toolResult({ jobId: job.id });
    },
  );

  server.tool(
    "start_debug_session",
    "Start recording a time-ordered timeline of events (console, network, navigation, and optionally DOM mutations) for one tab. Does not survive a full-page navigation on that tab.",
    { tabId: z.string().optional(), capture: z.array(z.enum(["console", "network", "navigation", "dom"])).default(["console", "network", "navigation"]) },
    async ({ tabId, capture }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      try {
        const session = await debugSessions.start(resolved.clientId, capture);
        return toolResult({ sessionId: session.id });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool("end_debug_session", "Stop a debug session and return its time-ordered event timeline.", { sessionId: z.string() }, async ({ sessionId }) => {
    const result = await debugSessions.end(sessionId);
    if (!result) return toolError(`No active session with id ${sessionId}`);
    return toolResult(result);
  });

  server.tool(
    "wait_for_console_error",
    "Block until the next console.error/window.onerror/unhandledrejection on a tab, or timeout.",
    { tabId: z.string().optional(), timeoutMs: z.number().int().positive().max(60_000).default(10_000) },
    async ({ tabId, timeoutMs }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      const event = await waitForConsoleError(store, resolved.clientId, timeoutMs);
      return toolResult(event ?? { timedOut: true });
    },
  );

  server.tool(
    "wait_for_navigation",
    "Block until the next navigation event on a tab, or timeout. Only fires for rule-enabled tabs (see README).",
    { tabId: z.string().optional(), timeoutMs: z.number().int().positive().max(60_000).default(10_000) },
    async ({ tabId, timeoutMs }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      const event = await waitForNavigation(store, resolved.clientId, timeoutMs);
      return toolResult(event ?? { timedOut: true });
    },
  );

  server.tool(
    "wait_for_request",
    "Block until a network request whose URL contains urlPattern is observed on a tab, or timeout.",
    { tabId: z.string().optional(), urlPattern: z.string(), timeoutMs: z.number().int().positive().max(60_000).default(10_000) },
    async ({ tabId, urlPattern, timeoutMs }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      const event = await waitForRequest(store, resolved.clientId, urlPattern, timeoutMs);
      return toolResult(event ?? { timedOut: true });
    },
  );

  server.tool(
    "wait_for_element",
    "Block until a CSS selector appears in the tab's DOM, or timeout. Extension only.",
    { tabId: z.string().optional(), selector: z.string(), timeoutMs: z.number().int().positive().max(60_000).default(10_000) },
    async ({ tabId, selector, timeoutMs }) => {
      const resolved = resolveTabId(tabId);
      if ("error" in resolved) return resolved.error;
      try {
        const result = await dispatcher.sendCommand(resolved.clientId, "wait_for_element", { selector, timeoutMs }, timeoutMs + 2000);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  return { server, toolDefs };
}

/**
 * Built by a follower process (lost the port-bind race to an existing hub — see index.ts).
 * Reuses the hub's exact tool metadata (name/description/schema) so `tools/list` looks
 * identical to a real hub, but every handler forwards to the hub over `invoke` instead of
 * touching local state — a follower never has a real store/registry/dispatcher of its own.
 */
export function createFollowerMcpServer(toolDefs: Map<string, ToolDef>, invoke: (tool: string, args: unknown) => Promise<unknown>): McpServer {
  const server = new McpServer({ name: "mobius-mcp", version: "0.0.1" });
  for (const [name, def] of toolDefs) {
    const handler = async (args: unknown) => {
      try {
        return await invoke(name, args);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    };
    // def.schema is untyped (`any`) since it's harvested at runtime from an arbitrary tool
    // definition — the 4-arg (name, description, schema, handler) overload is still the
    // right one, TS just can't prove it through the erased type, so this bypasses the check.
    (server.tool as (...args: unknown[]) => unknown)(name, def.description, def.schema, handler);
  }
  return server;
}

export async function connectStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

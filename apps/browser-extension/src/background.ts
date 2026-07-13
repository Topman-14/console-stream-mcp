import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from "@console-stream-mcp/protocol";
import type { CapturedEvent } from "@console-stream-mcp/capture-core";
import { findMatchingRule, getRules } from "./rules.js";
import { getTabState, setTabState, clearTabState, getTabIdForClient, type TabState } from "./tabState.js";
import { sendCdp, detach, findRequestId } from "./cdp.js";

const PORT = 7331;

let ws: WebSocket | null = null;
let retryDelay = 500;
const queue: ClientMessage[] = [];

function send(message: ClientMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  } else {
    queue.push(message);
  }
}

function connect() {
  ws = new WebSocket(`ws://localhost:${PORT}`);

  ws.addEventListener("open", () => {
    retryDelay = 500;
    while (queue.length > 0) {
      ws!.send(JSON.stringify(queue.shift()!));
    }
  });

  ws.addEventListener("close", () => {
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 10_000);
  });

  ws.addEventListener("error", () => ws?.close());

  ws.addEventListener("message", async (evt) => {
    let message: ServerMessage;
    try {
      message = JSON.parse(evt.data as string);
    } catch {
      return;
    }
    if (message.kind !== "command") return;

    try {
      const result = await runCommand(message);
      send({ version: PROTOCOL_VERSION, kind: "ack", commandId: message.commandId, result });
    } catch (err) {
      send({ version: PROTOCOL_VERSION, kind: "ack", commandId: message.commandId, error: err instanceof Error ? err.message : String(err) });
    }
  });
}

async function runCommand(message: ServerMessage): Promise<unknown> {
  if (message.command === "list_tabs") {
    const tabs = await chrome.tabs.query({});
    return tabs.map((t) => ({ tabId: t.id, url: t.url, title: t.title, active: t.active }));
  }

  const tabId = await getTabIdForClient(message.clientId);
  if (tabId === undefined) {
    throw new Error(`No open tab for client ${message.clientId}`);
  }

  switch (message.command) {
    case "navigate_to": {
      const { url } = message.params as { url: string };
      await chrome.tabs.update(tabId, { url });
      return { navigated: true };
    }
    case "switch_tab": {
      await chrome.tabs.update(tabId, { active: true });
      const tab = await chrome.tabs.get(tabId);
      if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
      return { switched: true };
    }
    case "reload_tab": {
      await chrome.tabs.reload(tabId);
      return { reloaded: true };
    }
    case "start_dom_capture": {
      await chrome.tabs.sendMessage(tabId, { type: "console-stream-mcp/command", command: "start-dom" });
      return { started: true };
    }
    case "stop_dom_capture": {
      await chrome.tabs.sendMessage(tabId, { type: "console-stream-mcp/command", command: "stop-dom" });
      return { stopped: true };
    }
    case "wait_for_element": {
      const { selector, timeoutMs } = message.params as { selector: string; timeoutMs: number };
      return chrome.tabs.sendMessage(tabId, { type: "console-stream-mcp/wait-for-element", selector, timeoutMs });
    }

    // --- CDP-backed (chrome.debugger), Stage D ---
    case "take_screenshot": {
      const data = await sendCdp(tabId, "Page.captureScreenshot", { format: "png" });
      return { format: "png", dataBase64: (data as { data: string }).data };
    }
    case "capture_full_page": {
      const metrics = (await sendCdp(tabId, "Page.getLayoutMetrics")) as {
        cssContentSize: { width: number; height: number };
      };
      const { width, height } = metrics.cssContentSize;
      const data = await sendCdp(tabId, "Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height, scale: 1 },
      });
      return { format: "png", dataBase64: (data as { data: string }).data };
    }
    case "capture_element": {
      const { selector } = message.params as { selector: string };
      const { root } = (await sendCdp(tabId, "DOM.getDocument")) as { root: { nodeId: number } };
      const { nodeId } = (await sendCdp(tabId, "DOM.querySelector", { nodeId: root.nodeId, selector })) as { nodeId: number };
      if (!nodeId) throw new Error(`No element matching "${selector}"`);
      const { model } = (await sendCdp(tabId, "DOM.getBoxModel", { nodeId })) as { model: { content: number[] } };
      const [x1, y1, , , x2, , , y2] = model.content;
      const data = await sendCdp(tabId, "Page.captureScreenshot", {
        format: "png",
        clip: { x: x1, y: y1, width: x2 - x1, height: y2 - y1, scale: 1 },
      });
      return { format: "png", dataBase64: (data as { data: string }).data };
    }
    case "capture_dom": {
      const result = (await sendCdp(tabId, "Runtime.evaluate", {
        expression: "document.documentElement.outerHTML",
        returnByValue: true,
      })) as { result: { value: string } };
      return { html: result.result.value };
    }
    case "capture_accessibility_tree": {
      return sendCdp(tabId, "Accessibility.getFullAXTree");
    }
    case "evaluate_js": {
      const { expression } = message.params as { expression: string };
      const result = (await sendCdp(tabId, "Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })) as { result: { value?: unknown; description?: string }; exceptionDetails?: { text: string } };
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return { value: result.result.value ?? result.result.description };
    }
    case "start_cpu_profile": {
      const { durationMs } = message.params as { durationMs: number };
      await sendCdp(tabId, "Profiler.enable");
      await sendCdp(tabId, "Profiler.start");
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      return sendCdp(tabId, "Profiler.stop");
    }
    case "start_memory_profile": {
      const { durationMs } = message.params as { durationMs: number };
      await sendCdp(tabId, "HeapProfiler.enable");
      await sendCdp(tabId, "HeapProfiler.startSampling");
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      return sendCdp(tabId, "HeapProfiler.stopSampling");
    }
    case "get_response_body": {
      const { requestUrl } = message.params as { requestUrl: string };
      const requestId = findRequestId(tabId, requestUrl);
      if (!requestId) throw new Error(`No recent CDP-tracked request for ${requestUrl}. Response bodies are only available for requests made while the tab was capture-enabled.`);
      return sendCdp(tabId, "Network.getResponseBody", { requestId });
    }

    default:
      throw new Error(`Unknown command: ${message.command}`);
  }
}

connect();

async function enableTab(tabId: number, mode: TabState["mode"]): Promise<string | undefined> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) return undefined;

  const clientId = crypto.randomUUID();
  await setTabState(tabId, { clientId, mode });

  await chrome.scripting.executeScript({ target: { tabId }, files: ["iife/content-script.js"] });
  await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["iife/injected.js"] });

  send({
    version: PROTOCOL_VERSION,
    kind: "hello",
    client: { clientId, clientType: "extension", pageUrl: tab.url, title: tab.title, capabilities: ["cdp"] },
  });

  return clientId;
}

async function disableTab(tabId: number): Promise<void> {
  const state = await getTabState(tabId);
  if (!state) return;

  send({ version: PROTOCOL_VERSION, kind: "bye", clientId: state.clientId });
  await clearTabState(tabId);

  try {
    await chrome.tabs.sendMessage(tabId, { type: "console-stream-mcp/command", command: "stop" });
  } catch {
    // tab may already be closed/navigated away; nothing to clean up in-page
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "console-stream-mcp/event" && sender.tab?.id !== undefined) {
    const tabId = sender.tab.id;
    getTabState(tabId).then((state) => {
      if (!state) return;
      const event: CapturedEvent = { ...message.event, metadata: { ...message.event.metadata, tabId } };
      send({ version: PROTOCOL_VERSION, kind: "event", clientId: state.clientId, event });
    });
    return;
  }

  if (message?.type === "console-stream-mcp/get-state") {
    getTabState(message.tabId).then((state) => sendResponse({ state: state ?? null }));
    return true;
  }

  if (message?.type === "console-stream-mcp/toggle") {
    getTabState(message.tabId).then(async (state) => {
      if (state) {
        await disableTab(message.tabId);
        sendResponse({ state: null });
      } else {
        await enableTab(message.tabId, "manual");
        sendResponse({ state: await getTabState(message.tabId) });
      }
    });
    return true;
  }
});

const lastKnownUrl = new Map<number, string>();

// Injected scripts run per-document, so any prior state is gone the moment a tab
// navigates. Re-evaluate rule matches fresh on every top-level navigation; a
// manual toggle does not persist across navigation and must be re-clicked. A
// debug session likewise does not survive a navigation (its clientId is gone).
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const fromUrl = lastKnownUrl.get(details.tabId);
  lastKnownUrl.set(details.tabId, details.url);
  await clearTabState(details.tabId);

  const rules = await getRules();
  const rule = findMatchingRule(details.url, rules);
  if (!rule) return;

  const clientId = await enableTab(details.tabId, "rule");
  if (!clientId) return;

  send({
    version: PROTOCOL_VERSION,
    kind: "event",
    clientId,
    event: { type: "navigation", timestamp: Date.now(), url: details.url, fromUrl, toUrl: details.url },
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  disableTab(tabId);
  detach(tabId);
});

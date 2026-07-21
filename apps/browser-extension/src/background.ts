import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage, type CapturedEvent } from "@mobius-mcp/capture-core";
import { findMatchingRule, getRules, ruleToOrigin } from "./lib/rules.js";
import { hasOrigin } from "./lib/host-permissions.js";
import { getTabState, setTabState, setPaused, clearTabState, getTabIdForClient, getAllTabStates, type TabState } from "./lib/tab-state.js";
import { sendCdp, detach, findRequestId } from "./lib/cdp.js";
import {
  setConnectionStatus,
  recordEvent,
  startRecording,
  stopRecording,
  clearTabLiveState,
  clearAllTabLiveState,
  registerPort,
  registerAllPort,
  getAllLiveState,
  getPushState,
  getPushAllState,
  connectionStatus,
  lastEventAt,
} from "./lib/live-state.js";
import { mcpSettings, performanceSettings, generalSettings, debugSettings } from "./lib/settings.js";
import { captureOptionsSetting } from "./lib/capture-options.js";

let ws: WebSocket | null = null;
let retryDelay = 500;
let maxQueueSize = 500;
let verboseLogs = false;
let notificationsEnabled = false;
const queue: ClientMessage[] = [];

// chrome.notifications.create doesn't accept SVG data URIs for iconUrl (raster only) —
// using one previously failed silently on every call ("Unable to download all specified
// images"), so this points at a bundled PNG instead.
const NOTIFICATION_ICON = chrome.runtime.getURL("icons/icon-48.png");

function debugLog(...args: unknown[]) {
  if (verboseLogs) console.debug("[mobius-mcp]", ...args);
}

function send(message: ClientMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  } else {
    queue.push(message);
    if (queue.length > maxQueueSize) queue.splice(0, queue.length - maxQueueSize);
  }
}

async function connect() {
  const mcp = await mcpSettings.get();
  setConnectionStatus("connecting");
  ws = new WebSocket(`ws://localhost:${mcp.port}`);

  ws.addEventListener("open", () => {
    retryDelay = mcp.reconnectBaseDelayMs;
    setConnectionStatus("connected");
    console.log(`[mobius-mcp] connected to mcp server on ws://localhost:${mcp.port}`);
    while (queue.length > 0) {
      ws!.send(JSON.stringify(queue.shift()!));
    }
  });

  ws.addEventListener("close", () => {
    setConnectionStatus("disconnected");
    console.warn(`[mobius-mcp] disconnected from mcp server (ws://localhost:${mcp.port}), retrying in ${retryDelay}ms`);
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 10_000);
  });

  ws.addEventListener("error", (event) => {
    console.error(`[mobius-mcp] websocket error on ws://localhost:${mcp.port}`, event);
    ws?.close();
  });

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

async function screenshotTab(tabId: number): Promise<{ format: "png"; dataBase64: string }> {
  const data = await sendCdp(tabId, "Page.captureScreenshot", { format: "png" });
  return { format: "png", dataBase64: (data as { data: string }).data };
}

async function captureDomTab(tabId: number): Promise<{ html: string }> {
  const result = (await sendCdp(tabId, "Runtime.evaluate", {
    expression: "document.documentElement.outerHTML",
    returnByValue: true,
  })) as { result: { value: string } };
  return { html: result.result.value };
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
      await chrome.tabs.sendMessage(tabId, { type: "mobius-mcp/command", command: "start-dom" });
      return { started: true };
    }
    case "stop_dom_capture": {
      await chrome.tabs.sendMessage(tabId, { type: "mobius-mcp/command", command: "stop-dom" });
      return { stopped: true };
    }
    case "wait_for_element": {
      const { selector, timeoutMs } = message.params as { selector: string; timeoutMs: number };
      return chrome.tabs.sendMessage(tabId, { type: "mobius-mcp/wait-for-element", selector, timeoutMs });
    }

    // --- CDP-backed (chrome.debugger), Stage D ---
    case "take_screenshot":
      return screenshotTab(tabId);
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
    case "capture_dom":
      return captureDomTab(tabId);
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
    case "get_request_body": {
      const { requestUrl } = message.params as { requestUrl: string };
      const requestId = findRequestId(tabId, requestUrl);
      if (!requestId) throw new Error(`No recent CDP-tracked request for ${requestUrl}. Request bodies are only available for requests made while the tab was capture-enabled.`);
      return sendCdp(tabId, "Network.getRequestPostData", { requestId });
    }

    default:
      throw new Error(`Unknown command: ${message.command}`);
  }
}

let autoClearTimer: ReturnType<typeof setInterval> | undefined;

async function bootSettings() {
  const [performance, debug, general] = await Promise.all([performanceSettings.get(), debugSettings.get(), generalSettings.get()]);
  maxQueueSize = performance.bufferSize;
  verboseLogs = debug.verboseLogs;
  notificationsEnabled = general.notifications;

  clearInterval(autoClearTimer);
  autoClearTimer = setInterval(clearAllTabLiveState, performance.autoClearMinutes * 60_000);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.performanceSettings || changes.debugSettings || changes.generalSettings) settingsReady = bootSettings();
  if (changes.mcpSettings) {
    debugLog("mcp settings changed, reconnecting");
    retryDelay = 0;
    ws?.close();
  }
});

let settingsReady = bootSettings();
connect();
resumeCaptureAfterReload();

// tabState (chrome.storage.session) survives a background-service-worker reload/restart,
// but the WebSocket connection and every previously-injected content/injected script do
// not — a reload silently orphans every tab that was capturing (the popup/logs UI still
// claims they're "Capturing" since tabState says so, but nothing reaches the server
// anymore). Re-run enableTab for each one still open so capture resumes transparently.
async function resumeCaptureAfterReload(): Promise<void> {
  const states = await getAllTabStates();
  for (const [tabIdStr, state] of Object.entries(states)) {
    const tabId = Number(tabIdStr);
    try {
      await chrome.tabs.get(tabId);
    } catch {
      await clearTabState(tabId);
      await clearTabLiveState(tabId);
      continue;
    }
    await enableTab(tabId, state.mode);
    if (state.paused) await setPaused(tabId, true);
  }
}

async function enableTab(tabId: number, mode: TabState["mode"]): Promise<string | undefined> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) return undefined;

  const clientId = crypto.randomUUID();
  await setTabState(tabId, { clientId, mode });

  await chrome.scripting.executeScript({ target: { tabId }, files: ["src/content-script.js"], injectImmediately: true });
  await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["src/injected.js"], injectImmediately: true });

  const capture = await captureOptionsSetting.get();
  send({
    version: PROTOCOL_VERSION,
    kind: "hello",
    client: {
      clientId,
      clientType: "extension",
      pageUrl: tab.url,
      title: tab.title,
      capabilities: ["cdp"],
      captureSettings: { console: capture.console, errors: capture.errors, network: capture.network, navigation: true, dom: capture.dom },
    },
  });

  console.log(`[mobius-mcp] enabled tab ${tabId} (${mode}): ${tab.url}`);
  await startRecording(tabId);

  return clientId;
}

async function disableTab(tabId: number): Promise<void> {
  const state = await getTabState(tabId);
  if (!state) return;

  send({ version: PROTOCOL_VERSION, kind: "bye", clientId: state.clientId });
  await clearTabState(tabId);
  await stopRecording(tabId);

  try {
    await chrome.tabs.sendMessage(tabId, { type: "mobius-mcp/command", command: "stop" });
  } catch {
    // tab may already be closed/navigated away; nothing to clean up in-page
  }
}

async function runLocalCommand(tabId: number, command: string): Promise<unknown> {
  switch (command) {
    case "take_screenshot":
      return screenshotTab(tabId);
    case "capture_dom":
      return captureDomTab(tabId);
    default:
      throw new Error(`Unknown local command: ${command}`);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "mobius-mcp/event" && sender.tab?.id !== undefined) {
    const tabId = sender.tab.id;
    getTabState(tabId).then(async (state) => {
      if (!state || state.paused) return;
      const event: CapturedEvent = { ...message.event, metadata: { ...message.event.metadata, tabId } };
      send({ version: PROTOCOL_VERSION, kind: "event", clientId: state.clientId, event });
      const bucket = await recordEvent(tabId, event);
      // On a freshly-woken service worker, bootSettings()'s storage read can still be in
      // flight here — without this await, notificationsEnabled may read its stale initial
      // false and silently skip the very first error notification after every idle restart.
      await settingsReady;
      if (bucket === "errors" && notificationsEnabled) {
        // "notifications" is a required manifest permission (auto-granted at install, no
        // runtime prompt exists for it) — this can still read "denied" if the user turned
        // it off via chrome://settings/content/notifications, or the OS itself blocks
        // Chrome. There's nothing more actionable to do here beyond a clear log; the
        // options page surfaces the same check where the user can actually see it.
        chrome.notifications.getPermissionLevel((level) => {
          if (level !== "granted") {
            console.warn(
              "[mobius-mcp] error notifications are enabled in settings, but Chrome reports notification permission as",
              level,
              "— check chrome://settings/content/notifications and your OS notification settings for Chrome.",
            );
            return;
          }
          chrome.notifications.create(
            {
              type: "basic",
              iconUrl: NOTIFICATION_ICON,
              title: "mobius-mcp",
              message: "message" in event ? event.message : "reason" in event ? event.reason : "Runtime error captured",
            },
            () => {
              if (chrome.runtime.lastError) console.error("[mobius-mcp] notification failed:", chrome.runtime.lastError.message);
            },
          );
        });
      }
    });
    return;
  }

  if (message?.type === "mobius-mcp/get-state") {
    getTabState(message.tabId).then((state) => sendResponse({ state: state ?? null }));
    return true;
  }

  // Polling fallback for the popup/logs live-state ports: a long-lived port opened before
  // the MV3 service worker was suspended becomes a zombie once the worker restarts (its
  // in-memory ports/allPorts registries in live-state.ts are wiped). sendMessage always
  // wakes the worker fresh per call, so it self-heals regardless of port health.
  if (message?.type === "mobius-mcp/get-live-state" && typeof message.tabId === "number") {
    getPushState(message.tabId).then(sendResponse);
    return true;
  }

  if (message?.type === "mobius-mcp/get-all-live-state") {
    getPushAllState().then(sendResponse);
    return true;
  }

  if (message?.type === "mobius-mcp/toggle") {
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

  if (message?.type === "mobius-mcp/set-paused") {
    setPaused(message.tabId, message.paused).then((state) => sendResponse({ state: state ?? null }));
    return true;
  }

  if (message?.type === "mobius-mcp/clear") {
    clearTabLiveState(message.tabId).then(() => sendResponse({ cleared: true }));
    return true;
  }

  if (message?.type === "mobius-mcp/local-command") {
    runLocalCommand(message.tabId, message.command)
      .then((result) => sendResponse({ result }))
      .catch((err) => sendResponse({ error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  if (message?.type === "mobius-mcp/export-diagnostics") {
    getAllLiveState().then((tabs) => {
      const diagnostics = {
        exportedAt: new Date().toISOString(),
        connection: { status: connectionStatus, lastEventAt },
        queuedMessages: queue.length,
        tabs,
      };
      const url = "data:application/json," + encodeURIComponent(JSON.stringify(diagnostics, null, 2));
      chrome.downloads.download({ url, filename: `mobius-mcp-diagnostics-${Date.now()}.json` }, () => sendResponse({ downloaded: true }));
    });
    return true;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "mobius-mcp/logs") {
    console.log("[mobius-mcp] logs page connected");
    registerAllPort(port);
    port.onDisconnect.addListener(() => console.log("[mobius-mcp] logs page disconnected"));
    return;
  }

  if (port.name !== "mobius-mcp/popup") return;
  port.onMessage.addListener((message) => {
    if (message?.type === "subscribe" && typeof message.tabId === "number") {
      registerPort(port, message.tabId);
    }
  });
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

  // The previous document's clientId is about to be discarded below — tell the server
  // it's gone, or it lingers in get_connected_tabs forever (nothing else ever byes it).
  const previousState = await getTabState(details.tabId);
  if (previousState) send({ version: PROTOCOL_VERSION, kind: "bye", clientId: previousState.clientId });
  await clearTabState(details.tabId);

  const rules = await getRules();
  const rule = findMatchingRule(details.url, rules);
  if (!rule) return;

  // Rules are stored even if the user later revokes the site's permission (e.g. via
  // chrome://extensions), so re-check here instead of assuming a saved rule is still usable.
  if (!(await hasOrigin(ruleToOrigin(rule.pattern)))) {
    debugLog(`rule "${rule.pattern}" matched but host permission is missing, skipping auto-enable`);
    return;
  }

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

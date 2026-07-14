import { captureOptionsSetting, privacyOptionsSetting } from "./lib/capture-options.js";

const MESSAGE_SOURCE = "mobius-mcp";
const RELAYED_COMMANDS = new Set(["stop", "start-dom", "stop-dom"]);

window.addEventListener("message", (message) => {
  if (message.source !== window) return;
  const data = message.data;
  if (!data || data.source !== MESSAGE_SOURCE) return;

  if (data.type === "ready") {
    Promise.all([captureOptionsSetting.get(), privacyOptionsSetting.get()]).then(([capture, privacy]) => {
      window.postMessage(
        {
          source: MESSAGE_SOURCE,
          type: "init",
          options: {
            console: capture.console,
            errors: capture.errors,
            network: capture.network,
            dom: capture.dom,
            redaction: privacy,
          },
        },
        "*",
      );
    });
    return;
  }

  if (!data.event) return;
  chrome.runtime.sendMessage({ type: "mobius-mcp/event", event: data.event });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "mobius-mcp/command" || !RELAYED_COMMANDS.has(message.command)) return;
  window.postMessage({ source: MESSAGE_SOURCE, type: message.command }, "*");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "mobius-mcp/wait-for-element") return;

  const { selector, timeoutMs } = message as { selector: string; timeoutMs: number };
  if (document.querySelector(selector)) {
    sendResponse({ found: true });
    return;
  }

  const observer = new MutationObserver(() => {
    if (document.querySelector(selector)) {
      observer.disconnect();
      clearTimeout(timer);
      sendResponse({ found: true });
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });

  const timer = setTimeout(() => {
    observer.disconnect();
    sendResponse({ found: false });
  }, timeoutMs);

  return true;
});

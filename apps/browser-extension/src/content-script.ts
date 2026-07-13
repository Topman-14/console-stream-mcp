const MESSAGE_SOURCE = "console-stream-mcp";
const RELAYED_COMMANDS = new Set(["stop", "start-dom", "stop-dom"]);

window.addEventListener("message", (message) => {
  if (message.source !== window) return;
  const data = message.data;
  if (!data || data.source !== MESSAGE_SOURCE || !data.event) return;

  chrome.runtime.sendMessage({ type: "console-stream-mcp/event", event: data.event });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "console-stream-mcp/command" || !RELAYED_COMMANDS.has(message.command)) return;
  window.postMessage({ source: MESSAGE_SOURCE, type: message.command }, "*");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "console-stream-mcp/wait-for-element") return;

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

import { startCapture, patchDomMutations, type CapturedEvent } from "@console-stream-mcp/capture-core";

const MESSAGE_SOURCE = "console-stream-mcp";

const stopCapture = startCapture((event: CapturedEvent) => {
  window.postMessage({ source: MESSAGE_SOURCE, event }, "*");
});

let stopDom: (() => void) | null = null;

window.addEventListener("message", (message) => {
  if (message.source !== window) return;
  if (message.data?.source !== MESSAGE_SOURCE) return;

  if (message.data.type === "stop") {
    stopCapture();
    stopDom?.();
  } else if (message.data.type === "start-dom" && !stopDom) {
    stopDom = patchDomMutations((event) => window.postMessage({ source: MESSAGE_SOURCE, event }, "*"));
  } else if (message.data.type === "stop-dom") {
    stopDom?.();
    stopDom = null;
  }
});

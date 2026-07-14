import { startCapture, patchDomMutations, type CapturedEvent, type CaptureStartOptions } from "@mobius-mcp/capture-core";

const MESSAGE_SOURCE = "mobius-mcp";

let stopCapture: (() => void) | null = null;
let stopDom: (() => void) | null = null;

const emit = (event: CapturedEvent) => window.postMessage({ source: MESSAGE_SOURCE, event }, "*");

window.addEventListener("message", (message) => {
  if (message.source !== window) return;
  if (message.data?.source !== MESSAGE_SOURCE) return;

  if (message.data.type === "init" && !stopCapture) {
    const options: CaptureStartOptions & { dom?: boolean } = message.data.options ?? {};
    stopCapture = startCapture(emit, options);
    if (options.dom) stopDom = patchDomMutations(emit);
  } else if (message.data.type === "stop") {
    stopCapture?.();
    stopCapture = null;
    stopDom?.();
    stopDom = null;
  } else if (message.data.type === "start-dom" && !stopDom) {
    stopDom = patchDomMutations(emit);
  } else if (message.data.type === "stop-dom") {
    stopDom?.();
    stopDom = null;
  }
});

// content-script.ts (isolated world) owns chrome.storage access; ask it for
// captureOptions/privacyOptions before starting any hooks.
window.postMessage({ source: MESSAGE_SOURCE, type: "ready" }, "*");

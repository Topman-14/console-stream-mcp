import type { CapturedEvent } from "@console-stream-mcp/protocol";

export type { CapturedEvent };
export type Emit = (event: CapturedEvent) => void;

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const CONSOLE_METHODS = ["log", "info", "warn", "error"] as const;

export function patchConsole(emit: Emit): () => void {
  const original = CONSOLE_METHODS.map((method) => [method, console[method]] as const);

  for (const method of CONSOLE_METHODS) {
    const originalFn = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      emit({
        type: `console.${method}` as CapturedEvent["type"],
        timestamp: Date.now(),
        url: window.location.href,
        message: args.map(safeStringify).join(" "),
        args,
      } as CapturedEvent);
      originalFn(...args);
    };
  }

  return () => {
    for (const [method, fn] of original) {
      console[method] = fn;
    }
  };
}

export function patchGlobalErrors(emit: Emit): () => void {
  const onError = (event: ErrorEvent) => {
    emit({
      type: "window.onerror",
      timestamp: Date.now(),
      url: window.location.href,
      message: event.message,
      stack: event.error instanceof Error ? event.error.stack : undefined,
      source: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    emit({
      type: "unhandledrejection",
      timestamp: Date.now(),
      url: window.location.href,
      reason: safeStringify(event.reason),
      stack: event.reason instanceof Error ? event.reason.stack : undefined,
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}

export function patchNetwork(emit: Emit): () => void {
  const originalFetch = window.fetch;
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const start = Date.now();
    const requestUrl = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
    const method = (args[1]?.method ?? "GET").toUpperCase();
    try {
      const response = await originalFetch(...args);
      emit({
        type: "network.fetch",
        timestamp: Date.now(),
        url: window.location.href,
        method,
        requestUrl,
        status: response.status,
        durationMs: Date.now() - start,
      });
      return response;
    } catch (error) {
      emit({
        type: "network.fetch",
        timestamp: Date.now(),
        url: window.location.href,
        method,
        requestUrl,
        durationMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  const OriginalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = class extends OriginalXHR {
    private _method = "GET";
    private _url = "";
    private _start = 0;

    open(method: string, url: string | URL, ...rest: unknown[]) {
      this._method = method.toUpperCase();
      this._url = url.toString();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (super.open as any)(method, url, ...rest);
    }

    send(...args: unknown[]) {
      this._start = Date.now();
      this.addEventListener("loadend", () => {
        emit({
          type: "network.xhr",
          timestamp: Date.now(),
          url: window.location.href,
          method: this._method,
          requestUrl: this._url,
          status: this.status,
          durationMs: Date.now() - this._start,
        });
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (super.send as any)(...args);
    }
  };

  return () => {
    window.fetch = originalFetch;
    window.XMLHttpRequest = OriginalXHR;
  };
}

function shortSelector(el: Element): string {
  const id = el.id ? `#${el.id}` : "";
  const cls = el.classList.length > 0 ? `.${Array.from(el.classList).join(".")}` : "";
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

/** Not started by default — DOM mutation observers are noisy/expensive on a busy
 * page, so this is only wired up during an explicit debug session. */
export function patchDomMutations(emit: Emit): () => void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      emit({
        type: "dom.mutation",
        timestamp: Date.now(),
        url: window.location.href,
        mutationType: mutation.type,
        targetSelector: mutation.target instanceof Element ? shortSelector(mutation.target) : undefined,
        addedCount: mutation.addedNodes.length,
        removedCount: mutation.removedNodes.length,
      });
    }
  });

  observer.observe(document.documentElement, { childList: true, attributes: true, characterData: true, subtree: true });

  return () => observer.disconnect();
}

export function startCapture(emit: Emit): () => void {
  const unpatchConsole = patchConsole(emit);
  const unpatchErrors = patchGlobalErrors(emit);
  const unpatchNetwork = patchNetwork(emit);

  return () => {
    unpatchConsole();
    unpatchErrors();
    unpatchNetwork();
  };
}

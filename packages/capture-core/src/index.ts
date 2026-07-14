import type { CapturedEvent } from "@mobius-mcp/protocol";
import { redactText, redactHeaderValue, type RedactionOptions } from "./redact.js";

export type { CapturedEvent };
export type { RedactionOptions } from "./redact.js";
export type Emit = (event: CapturedEvent) => void;

const NO_REDACTION: RedactionOptions = {
  redactHeaders: false,
  redactCookies: false,
  redactLocalStorage: false,
  maskEmails: false,
  maskJwts: false,
};

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (value instanceof Error) return value.message;
  if (typeof value !== "object") return String(value);

  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(value, (_key, val) => {
      if (typeof val === "bigint") return val.toString();
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }
      return val;
    });
    if (json !== undefined) return json;
  } catch {
    // fall through — value has a getter that throws, or another non-serializable shape
  }

  try {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, val]) => `${key}: ${typeof val === "object" && val !== null ? "[object]" : String(val)}`);
    return `{ ${entries.join(", ")} }`;
  } catch {
    return Object.prototype.toString.call(value);
  }
}

const CONSOLE_METHODS = ["log", "info", "warn", "error"] as const;

export function patchConsole(emit: Emit, redaction: RedactionOptions = NO_REDACTION): () => void {
  const original = CONSOLE_METHODS.map((method) => [method, console[method]] as const);

  for (const method of CONSOLE_METHODS) {
    const originalFn = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      emit({
        type: `console.${method}` as CapturedEvent["type"],
        timestamp: Date.now(),
        url: window.location.href,
        message: redactText(args.map(safeStringify).join(" "), redaction),
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

export function patchGlobalErrors(emit: Emit, redaction: RedactionOptions = NO_REDACTION): () => void {
  const onError = (event: ErrorEvent) => {
    emit({
      type: "window.onerror",
      timestamp: Date.now(),
      url: window.location.href,
      message: redactText(event.message, redaction),
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
      reason: redactText(safeStringify(event.reason), redaction),
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

function extractFetchHeaders(init: RequestInit | undefined, redaction: RedactionOptions): Record<string, string> | undefined {
  if (!init?.headers) return undefined;
  const headers = new Headers(init.headers);
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    result[name] = redactHeaderValue(name, value, redaction);
  });
  return result;
}

export function patchNetwork(emit: Emit, redaction: RedactionOptions = NO_REDACTION): () => void {
  const originalFetch = window.fetch;
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const start = Date.now();
    const requestUrl = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
    const method = (args[1]?.method ?? "GET").toUpperCase();
    const requestHeaders = extractFetchHeaders(args[1], redaction);
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
        requestHeaders,
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
        requestHeaders,
      });
      throw error;
    }
  };

  const OriginalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = class extends OriginalXHR {
    private _method = "GET";
    private _url = "";
    private _start = 0;
    private _headers: Record<string, string> = {};

    open(method: string, url: string | URL, ...rest: unknown[]) {
      this._method = method.toUpperCase();
      this._url = url.toString();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (super.open as any)(method, url, ...rest);
    }

    setRequestHeader(name: string, value: string) {
      this._headers[name] = redactHeaderValue(name, value, redaction);
      return super.setRequestHeader(name, value);
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
          requestHeaders: Object.keys(this._headers).length > 0 ? this._headers : undefined,
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

export function patchNavigation(emit: Emit): () => void {
  let lastUrl = window.location.href;

  const report = () => {
    const toUrl = window.location.href;
    if (toUrl === lastUrl) return;
    const fromUrl = lastUrl;
    lastUrl = toUrl;
    emit({
      type: "navigation",
      timestamp: Date.now(),
      url: toUrl,
      fromUrl,
      toUrl,
    });
  };

  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = (...args: Parameters<History["pushState"]>) => {
    originalPushState(...args);
    report();
  };
  history.replaceState = (...args: Parameters<History["replaceState"]>) => {
    originalReplaceState(...args);
    report();
  };

  window.addEventListener("popstate", report);
  window.addEventListener("hashchange", report);

  return () => {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.removeEventListener("popstate", report);
    window.removeEventListener("hashchange", report);
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

export interface CaptureStartOptions {
  console?: boolean;
  errors?: boolean;
  network?: boolean;
  navigation?: boolean;
  redaction?: RedactionOptions;
}

export function startCapture(emit: Emit, options: CaptureStartOptions = {}): () => void {
  const { console: captureConsole = true, errors = true, network = true, navigation = true, redaction = NO_REDACTION } = options;

  const unpatchers: Array<() => void> = [];
  if (captureConsole) unpatchers.push(patchConsole(emit, redaction));
  if (errors) unpatchers.push(patchGlobalErrors(emit, redaction));
  if (network) unpatchers.push(patchNetwork(emit, redaction));
  if (navigation) unpatchers.push(patchNavigation(emit));

  return () => {
    for (const unpatch of unpatchers) unpatch();
  };
}

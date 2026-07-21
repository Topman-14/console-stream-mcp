import type { CapturedEvent } from "@mobius-mcp/protocol";
import { redactText, redactHeaderValue, redactBodyText, type RedactionOptions } from "./redact.js";

export type { CapturedEvent };
export type { RedactionOptions } from "./redact.js";
export type Emit = (event: CapturedEvent) => void;

const NO_REDACTION: RedactionOptions = {
  redactedHeaderNames: [],
  maskEmails: false,
  maskJwts: false,
  redactSensitiveBodyFields: false,
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

// --- network capture helpers -------------------------------------------------

/** Hard cap on captured request/response body size — keeps large payloads from
 * blowing up the in-memory store and MCP tool responses. The server applies its
 * own (smaller) truncation on top of this as a backstop. */
const MAX_BODY_CHARS = 20_000;

/** Content-types worth reading as text. Permissive when absent (undefined) since
 * plenty of local/dev APIs omit content-type on otherwise-JSON/text responses. */
const CAPTURABLE_CONTENT_TYPE_RE = /^(text\/|application\/(json|.*\+json|xml|x-www-form-urlencoded|graphql))/i;

function isCapturableContentType(mimeType: string | undefined): boolean {
  if (!mimeType) return true;
  return CAPTURABLE_CONTENT_TYPE_RE.test(mimeType);
}

function capBody(text: string): { body: string; truncated: boolean } {
  if (text.length <= MAX_BODY_CHARS) return { body: text, truncated: false };
  return { body: text.slice(0, MAX_BODY_CHARS), truncated: true };
}

interface BodyCapture {
  body?: string;
  truncated?: boolean;
  omittedReason?: string;
}

function extractHeaders(source: HeadersInit | Headers | undefined, redaction: RedactionOptions): Record<string, string> | undefined {
  if (!source) return undefined;
  const headers = source instanceof Headers ? source : new Headers(source);
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    result[name] = redactHeaderValue(name, value, redaction);
  });
  return Object.keys(result).length > 0 ? result : undefined;
}

function findHeaderValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

/** Synchronous extraction for the common `fetch(url, { body })`/`xhr.send(body)` shapes.
 * FormData/Blob/ArrayBuffer bodies are binary-unsafe (and FormData may contain files) so
 * they're deliberately not read — just flagged with a reason. */
function captureRequestBodyValue(raw: unknown): BodyCapture {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === "string") return capBody(raw);
  if (raw instanceof URLSearchParams) return capBody(raw.toString());
  if (raw instanceof FormData) return { omittedReason: "FormData bodies aren't captured (may contain files)" };
  if (raw instanceof Blob) return { omittedReason: "Blob/File request bodies aren't captured" };
  if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw as ArrayBufferView)) return { omittedReason: "binary request body" };
  return { omittedReason: "unsupported request body type" };
}

/** Opportunistic async read for a Request/Response's own body stream via `.clone()`,
 * which never disturbs the original the caller (or `originalFetch`) still needs to consume. */
async function readBodyText(source: { clone: () => { text: () => Promise<string> } }, contentType: string | undefined): Promise<BodyCapture> {
  if (!isCapturableContentType(contentType)) return { omittedReason: "non-text content-type" };
  try {
    const text = await source.clone().text();
    return capBody(text);
  } catch {
    return { omittedReason: "failed to read body" };
  }
}

export function patchNetwork(emit: Emit, redaction: RedactionOptions = NO_REDACTION): () => void {
  const originalFetch = window.fetch;
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const start = Date.now();
    const input = args[0];
    const init = args[1];
    const isRequestObject = input instanceof Request;

    const requestUrl = isRequestObject ? input.url : typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? (isRequestObject ? input.method : undefined) ?? "GET").toUpperCase();
    const requestHeaders = extractHeaders(init?.headers ?? (isRequestObject ? input.headers : undefined), redaction);
    const requestContentType = findHeaderValue(requestHeaders, "content-type");

    const syncRequestBody = captureRequestBodyValue(init?.body);
    // A Request built with its own body (no separate init.body) still needs a read —
    // clone it so we don't consume what originalFetch is about to send.
    const pendingRequestBodyRead =
      syncRequestBody.body === undefined && syncRequestBody.omittedReason === undefined && isRequestObject && input.body
        ? readBodyText(input, requestContentType)
        : undefined;

    const withRequestBody = (base: Record<string, unknown>, requestBody: BodyCapture) => ({
      ...base,
      requestBody: requestBody.body !== undefined ? redactBodyText(requestBody.body, requestContentType, redaction) : undefined,
      requestBodyTruncated: requestBody.truncated,
      requestBodyOmittedReason: requestBody.omittedReason,
    });

    try {
      const response = await originalFetch(...args);
      const responseHeaders = extractHeaders(response.headers, redaction);
      const mimeType = findHeaderValue(responseHeaders, "content-type");
      const durationMs = Date.now() - start;

      const finish = (requestBody: BodyCapture) => {
        const base = withRequestBody(
          {
            type: "network.fetch" as const,
            timestamp: Date.now(),
            url: window.location.href,
            method,
            requestUrl,
            status: response.status,
            statusText: response.statusText,
            durationMs,
            requestHeaders,
            responseHeaders,
            mimeType,
          },
          requestBody,
        );

        // Non-blocking: the response has already been returned to the caller below, this
        // just reads a clone of the body and emits a fuller follow-up event once it resolves.
        if (isCapturableContentType(mimeType)) {
          response
            .clone()
            .text()
            .then((text) => {
              const { body, truncated } = capBody(text);
              emit({ ...base, responseBody: redactBodyText(body, mimeType, redaction), responseBodyTruncated: truncated } as CapturedEvent);
            })
            .catch(() => emit({ ...base, responseBodyOmittedReason: "failed to read response body" } as CapturedEvent));
        } else {
          emit({ ...base, responseBodyOmittedReason: "non-text content-type" } as CapturedEvent);
        }
      };

      if (pendingRequestBodyRead) {
        pendingRequestBodyRead.then(finish).catch(() => finish(syncRequestBody));
      } else {
        finish(syncRequestBody);
      }

      return response;
    } catch (error) {
      const emitError = (requestBody: BodyCapture) => {
        emit(
          withRequestBody(
            {
              type: "network.fetch" as const,
              timestamp: Date.now(),
              url: window.location.href,
              method,
              requestUrl,
              durationMs: Date.now() - start,
              error: error instanceof Error ? error.message : String(error),
              requestHeaders,
            },
            requestBody,
          ) as CapturedEvent,
        );
      };
      if (pendingRequestBodyRead) pendingRequestBodyRead.then(emitError).catch(() => emitError(syncRequestBody));
      else emitError(syncRequestBody);
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
      const requestBody = captureRequestBodyValue(args[0]);
      const requestContentType = findHeaderValue(this._headers, "content-type");

      this.addEventListener("loadend", () => {
        let responseHeaders: Record<string, string> | undefined;
        try {
          responseHeaders = parseXhrHeaders(this.getAllResponseHeaders(), redaction);
        } catch {
          responseHeaders = undefined;
        }
        let mimeType: string | undefined;
        try {
          mimeType = this.getResponseHeader("content-type") ?? undefined;
        } catch {
          mimeType = undefined;
        }

        const base = {
          type: "network.xhr" as const,
          timestamp: Date.now(),
          url: window.location.href,
          method: this._method,
          requestUrl: this._url,
          status: this.status,
          statusText: this.statusText,
          durationMs: Date.now() - this._start,
          requestHeaders: Object.keys(this._headers).length > 0 ? this._headers : undefined,
          responseHeaders,
          mimeType,
          requestBody: requestBody.body !== undefined ? redactBodyText(requestBody.body, requestContentType, redaction) : undefined,
          requestBodyTruncated: requestBody.truncated,
          requestBodyOmittedReason: requestBody.omittedReason,
        };

        // responseText/response throw for "blob"/"arraybuffer"/"document" response types.
        const canReadResponseText = this.responseType === "" || this.responseType === "text" || this.responseType === "json";
        if (!canReadResponseText) {
          emit({ ...base, responseBodyOmittedReason: `responseType "${this.responseType}" not captured` });
          return;
        }
        if (!isCapturableContentType(mimeType)) {
          emit({ ...base, responseBodyOmittedReason: "non-text content-type" });
          return;
        }
        try {
          const raw = this.responseType === "json" ? JSON.stringify(this.response) : this.responseText;
          const { body, truncated } = capBody(raw ?? "");
          emit({ ...base, responseBody: redactBodyText(body, mimeType, redaction), responseBodyTruncated: truncated });
        } catch {
          emit({ ...base, responseBodyOmittedReason: "failed to read response body" });
        }
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

function parseXhrHeaders(raw: string, redaction: RedactionOptions): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (name) result[name] = redactHeaderValue(name, value, redaction);
  }
  return Object.keys(result).length > 0 ? result : undefined;
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

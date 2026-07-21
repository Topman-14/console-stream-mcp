import type { CaptureStartOptions, CapturedEvent, Emit, RedactionOptions, BodyCapture } from "./types.ts";
import { DEFAULT_REDACTION, CONSOLE_METHODS } from "./data.ts";
import { redactText, redactHeaderValue, redactBodyText } from "./utils/redact.ts";
import { safeStringify } from "./utils/stringify.ts";
import { extractHeaders, findHeaderValue, parseXhrHeaders } from "./utils/headers.ts";
import { capBody, isCapturableContentType, captureRequestBodyValue, readBodyText } from "./utils/body.ts";
import { shortSelector } from "./utils/dom.ts";

export function patchConsole(emit: Emit, redaction: RedactionOptions = DEFAULT_REDACTION): () => void {
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

export function patchGlobalErrors(emit: Emit, redaction: RedactionOptions = DEFAULT_REDACTION): () => void {
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

export function patchNetwork(emit: Emit, redaction: RedactionOptions = DEFAULT_REDACTION): () => void {
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

export function startCapture(emit: Emit, options: CaptureStartOptions = {}): () => void {
  const { console: captureConsole = true, errors = true, network = true, navigation = true, redaction = DEFAULT_REDACTION } = options;

  const unpatchers: Array<() => void> = [];
  if (captureConsole) unpatchers.push(patchConsole(emit, redaction));
  if (errors) unpatchers.push(patchGlobalErrors(emit, redaction));
  if (network) unpatchers.push(patchNetwork(emit, redaction));
  if (navigation) unpatchers.push(patchNavigation(emit));

  return () => {
    for (const unpatch of unpatchers) unpatch();
  };
}

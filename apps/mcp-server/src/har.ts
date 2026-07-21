import type { BrowserEvent } from "@mobius-mcp/protocol";

function toHarHeaders(headers: Record<string, string> | undefined): Array<{ name: string; value: string }> {
  return headers ? Object.entries(headers).map(([name, value]) => ({ name, value })) : [];
}

/** Bodies aren't included — captured request/response bodies (see NetworkEvent) can be
 * large and are already available per-event via get_network_requests/get_logs_since;
 * get_response_body remains the CDP fallback for cases those skipped. */
export function toHar(events: BrowserEvent[]) {
  const entries = events
    .filter((e) => e.type === "network.fetch" || e.type === "network.xhr")
    .map((e) => {
      const ev = e as Extract<BrowserEvent, { type: "network.fetch" | "network.xhr" }>;
      return {
        startedDateTime: new Date(ev.timestamp).toISOString(),
        time: ev.durationMs ?? 0,
        request: {
          method: ev.method,
          url: ev.requestUrl,
          headers: toHarHeaders(ev.requestHeaders),
          queryString: [],
          cookies: [],
          headersSize: -1,
          bodySize: -1,
        },
        response: {
          status: ev.status ?? 0,
          statusText: ev.statusText ?? "",
          headers: toHarHeaders(ev.responseHeaders),
          cookies: [],
          content: { size: -1, mimeType: ev.mimeType ?? "" },
          redirectURL: "",
          headersSize: -1,
          bodySize: -1,
        },
        cache: {},
        timings: { send: 0, wait: ev.durationMs ?? 0, receive: 0 },
      };
    });

  return {
    log: {
      version: "1.2",
      creator: { name: "mobius-mcp", version: "0.0.1" },
      entries,
    },
  };
}

import type { BrowserEvent } from "@mobius-mcp/protocol";

/** Bodies aren't included — they require a separate get_response_body call per
 * request while the tab is still open, since CDP only retains them briefly. */
export function toHar(events: BrowserEvent[]) {
  const entries = events
    .filter((e) => e.type === "network.fetch" || e.type === "network.xhr")
    .map((e) => {
      const ev = e as Extract<BrowserEvent, { type: "network.fetch" | "network.xhr" }>;
      return {
        startedDateTime: new Date(ev.timestamp).toISOString(),
        time: ev.durationMs ?? 0,
        request: { method: ev.method, url: ev.requestUrl, headers: [], queryString: [], cookies: [], headersSize: -1, bodySize: -1 },
        response: {
          status: ev.status ?? 0,
          statusText: "",
          headers: [],
          cookies: [],
          content: { size: -1, mimeType: "" },
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

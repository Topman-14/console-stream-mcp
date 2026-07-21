import type { BrowserEvent } from "@mobius-mcp/capture-core";
import type { CommandDispatcher } from "../services/commandDispatcher.js";
import { HAR_CREATOR_NAME, HAR_CREATOR_VERSION } from "../data.js";

type NetworkEvent = Extract<BrowserEvent, { type: "network.fetch" | "network.xhr" }>;

interface HarBody {
  text: string;
  base64Encoded?: boolean;
}

export interface HarBodyFetcher {
  fetchRequestBody(requestUrl: string): Promise<HarBody | undefined>;
  fetchResponseBody(requestUrl: string): Promise<HarBody | undefined>;
}

/** Built only for CDP-capable tabs (see requireCdp in utils/tools.ts) — lets toHar
 * recover a full body CDP still has live, for anything the inline capture truncated
 * or skipped entirely (binary, oversized, non-text content-type). */
export function createHarBodyFetcher(dispatcher: CommandDispatcher, clientId: string): HarBodyFetcher {
  return {
    async fetchRequestBody(requestUrl) {
      const result = (await dispatcher.sendCommand(clientId, "get_request_body", { requestUrl }).catch(() => undefined)) as
        | { postData?: string }
        | undefined;
      return result?.postData !== undefined ? { text: result.postData } : undefined;
    },
    async fetchResponseBody(requestUrl) {
      const result = (await dispatcher.sendCommand(clientId, "get_response_body", { requestUrl }).catch(() => undefined)) as
        | { body?: string; base64Encoded?: boolean }
        | undefined;
      return result?.body !== undefined ? { text: result.body, base64Encoded: result.base64Encoded } : undefined;
    },
  };
}

function toHarHeaders(headers: Record<string, string> | undefined): Array<{ name: string; value: string }> {
  return headers ? Object.entries(headers).map(([name, value]) => ({ name, value })) : [];
}

function findHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
  return headers && Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1];
}

/** A body needs re-fetching if capture-core cut it short, or skipped it outright for
 * a reason CDP can still see past (binary/oversized/non-text — get_response_body and
 * get_request_body don't care about content-type). */
function needsFullBody(body: string | undefined, truncated: boolean | undefined, omittedReason: string | undefined): boolean {
  return truncated === true || (body === undefined && omittedReason !== undefined);
}

async function resolveRequestBody(ev: NetworkEvent, fetcher: HarBodyFetcher | undefined): Promise<HarBody | undefined> {
  if (fetcher && needsFullBody(ev.requestBody, ev.requestBodyTruncated, ev.requestBodyOmittedReason)) {
    const fetched = await fetcher.fetchRequestBody(ev.requestUrl);
    if (fetched) return fetched;
  }
  return ev.requestBody !== undefined ? { text: ev.requestBody } : undefined;
}

async function resolveResponseBody(ev: NetworkEvent, fetcher: HarBodyFetcher | undefined): Promise<HarBody | undefined> {
  if (fetcher && needsFullBody(ev.responseBody, ev.responseBodyTruncated, ev.responseBodyOmittedReason)) {
    const fetched = await fetcher.fetchResponseBody(ev.requestUrl);
    if (fetched) return fetched;
  }
  return ev.responseBody !== undefined ? { text: ev.responseBody } : undefined;
}

function byteSize(body: HarBody | undefined): number {
  if (!body) return -1;
  return body.base64Encoded ? Buffer.from(body.text, "base64").length : Buffer.byteLength(body.text, "utf8");
}

/** fetcher is omitted for non-CDP tabs (npm-client) — the export then contains
 * whatever capture-core already captured inline, same as before. */
export async function toHar(events: BrowserEvent[], fetcher?: HarBodyFetcher) {
  const networkEvents = events.filter((e): e is NetworkEvent => e.type === "network.fetch" || e.type === "network.xhr");

  const entries = await Promise.all(
    networkEvents.map(async (ev) => {
      const [requestBody, responseBody] = await Promise.all([resolveRequestBody(ev, fetcher), resolveResponseBody(ev, fetcher)]);

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
          bodySize: byteSize(requestBody),
          postData: requestBody ? { mimeType: findHeader(ev.requestHeaders, "content-type") ?? "application/octet-stream", text: requestBody.text } : undefined,
        },
        response: {
          status: ev.status ?? 0,
          statusText: ev.statusText ?? "",
          headers: toHarHeaders(ev.responseHeaders),
          cookies: [],
          content: {
            size: byteSize(responseBody),
            mimeType: ev.mimeType ?? "",
            text: responseBody?.text,
            encoding: responseBody?.base64Encoded ? "base64" : undefined,
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: byteSize(responseBody),
        },
        cache: {},
        timings: { send: 0, wait: ev.durationMs ?? 0, receive: 0 },
      };
    }),
  );

  return {
    log: {
      version: "1.2",
      creator: { name: HAR_CREATOR_NAME, version: HAR_CREATOR_VERSION },
      entries,
    },
  };
}

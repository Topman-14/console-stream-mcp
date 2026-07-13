const attached = new Set<number>();
// Best-effort requestId lookup for get_response_body, populated from Network domain
// events while attached. Keyed per tab, most-recent request per URL wins.
const recentRequestIds = new Map<number, Map<string, string>>();

export async function ensureAttached(tabId: number): Promise<void> {
  if (attached.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, "1.3");
  attached.add(tabId);
  await chrome.debugger.sendCommand({ tabId }, "Network.enable");
}

export async function sendCdp(tabId: number, method: string, params: object = {}): Promise<unknown> {
  await ensureAttached(tabId);
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

export function detach(tabId: number): void {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  recentRequestIds.delete(tabId);
  chrome.debugger.detach({ tabId }).catch(() => {});
}

export function findRequestId(tabId: number, requestUrl: string): string | undefined {
  return recentRequestIds.get(tabId)?.get(requestUrl);
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method !== "Network.responseReceived" || source.tabId === undefined) return;
  const p = params as { requestId: string; response: { url: string } };
  let byUrl = recentRequestIds.get(source.tabId);
  if (!byUrl) {
    byUrl = new Map();
    recentRequestIds.set(source.tabId, byUrl);
  }
  byUrl.set(p.response.url, p.requestId);
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== undefined) {
    attached.delete(source.tabId);
    recentRequestIds.delete(source.tabId);
  }
});

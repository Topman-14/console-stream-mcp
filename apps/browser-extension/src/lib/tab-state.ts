export interface TabState {
  clientId: string;
  mode: "manual" | "rule";
  paused?: boolean;
}

function key(tabId: number): string {
  return `tabState:${tabId}`;
}

function reverseKey(clientId: string): string {
  return `clientTab:${clientId}`;
}

export async function getTabState(tabId: number): Promise<TabState | undefined> {
  const result = await chrome.storage.session.get(key(tabId));
  return result[key(tabId)];
}

export async function setTabState(tabId: number, state: TabState): Promise<void> {
  await chrome.storage.session.set({ [key(tabId)]: state, [reverseKey(state.clientId)]: tabId });
}

export async function setPaused(tabId: number, paused: boolean): Promise<TabState | undefined> {
  const state = await getTabState(tabId);
  if (!state) return undefined;
  const next = { ...state, paused };
  await setTabState(tabId, next);
  return next;
}

export async function clearTabState(tabId: number): Promise<void> {
  const state = await getTabState(tabId);
  const toRemove = [key(tabId)];
  if (state) toRemove.push(reverseKey(state.clientId));
  await chrome.storage.session.remove(toRemove);
}

export async function getTabIdForClient(clientId: string): Promise<number | undefined> {
  const result = await chrome.storage.session.get(reverseKey(clientId));
  return result[reverseKey(clientId)];
}

export async function getAllTabStates(): Promise<Record<number, TabState>> {
  const all = await chrome.storage.session.get(null);
  const result: Record<number, TabState> = {};
  for (const [k, value] of Object.entries(all)) {
    if (!k.startsWith("tabState:")) continue;
    result[Number(k.slice("tabState:".length))] = value as TabState;
  }
  return result;
}

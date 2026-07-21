import { Terminal, WarningCircle, Globe, Pulse } from "@phosphor-icons/react";
import type { ConnectionStatus, EventCounters } from "../../hooks/use-popup-port.js";
import type { CaptureOptions } from "../../lib/capture-options.js";

export const WS_URL = "ws://localhost:7331";
export const REPO_URL = "https://github.com/Topman-14/mobius-mcp";
export const REPORT_BUG_URL = `${REPO_URL}/issues/new?template=bug_report.yml`;

export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Connected",
  connecting: "Connecting",
  disconnected: "Disconnected",
};

export const STATUS_DOT: Record<ConnectionStatus, string> = {
  connected: "bg-success",
  connecting: "bg-warning animate-pulse",
  disconnected: "bg-muted-foreground",
};

// settingsKey is the CaptureOptions field that governs whether this category is being
// captured — used to show "Paused" instead of a stale count when the user's turned it off.
// "runtime" has no dedicated toggle of its own (it buckets both dom.mutation and always-on
// navigation events), so "dom" is the closest real signal; navigation still counts even with
// DOM capture off.
export const COUNTER_ITEMS: Array<{ key: keyof EventCounters; label: string; icon: typeof Terminal; tone: string; settingsKey: keyof CaptureOptions }> = [
  { key: "console", label: "Console", icon: Terminal, tone: "text-console", settingsKey: "console" },
  { key: "errors", label: "Errors", icon: WarningCircle, tone: "text-destructive", settingsKey: "errors" },
  { key: "network", label: "Network", icon: Globe, tone: "text-network", settingsKey: "network" },
  { key: "runtime", label: "Runtime", icon: Pulse, tone: "text-runtime", settingsKey: "dom" },
];

export const KIND_DOT: Record<keyof EventCounters, string> = {
  console: "bg-console",
  errors: "bg-destructive",
  network: "bg-network",
  runtime: "bg-runtime",
};

export const KIND_TEXT: Record<keyof EventCounters, string> = {
  console: "text-console",
  errors: "text-destructive",
  network: "text-network",
  runtime: "text-runtime",
};

export const KIND_LABEL: Record<keyof EventCounters, string> = {
  console: "console",
  errors: "error",
  network: "network",
  runtime: "runtime",
};

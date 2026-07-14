import { Terminal, WarningCircle, Globe, Pulse } from "@phosphor-icons/react";
import type { ConnectionStatus, EventCounters } from "../../hooks/use-popup-port.js";

export const WS_URL = "ws://localhost:7331";
export const REPO_URL = "https://github.com/Topman-14/console-stream-mcp";

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

export const COUNTER_ITEMS: Array<{ key: keyof EventCounters; label: string; icon: typeof Terminal; tone: string }> = [
  { key: "console", label: "Console", icon: Terminal, tone: "text-console" },
  { key: "errors", label: "Errors", icon: WarningCircle, tone: "text-destructive" },
  { key: "network", label: "Network", icon: Globe, tone: "text-network" },
  { key: "runtime", label: "Runtime", icon: Pulse, tone: "text-runtime" },
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

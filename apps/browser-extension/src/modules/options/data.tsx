import { Desktop, Moon, Sun } from "@phosphor-icons/react";
import { Badge } from "../../components/ui/badge.js";
import type { ThemeSetting } from "../../hooks/use-theme.js";
import type { CaptureOptions, PrivacyOptions } from "../../lib/capture-options.js";

export const REPO_URL = "https://github.com/Topman-14/mobius-mcp";

export const COMING_SOON = (
  <Badge variant="outline" className="font-normal">
    Coming soon
  </Badge>
);

export const THEME_OPTIONS: Array<{ value: ThemeSetting; label: string; icon: typeof Sun }> = [
  { value: "system", label: "System", icon: Desktop },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export const CAPTURE_ROWS: Array<{ key: keyof CaptureOptions; label: string; description: string }> = [
  { key: "console", label: "Console", description: "console.log / info / warn / error" },
  { key: "network", label: "Network", description: "fetch and XMLHttpRequest calls" },
  { key: "errors", label: "Runtime errors", description: "window.onerror and unhandled rejections" },
  { key: "dom", label: "DOM mutations", description: "Can be noisy on busy pages; turn off if the feed gets flooded" },
];

export const PRIVACY_ROWS: Array<{ key: Exclude<keyof PrivacyOptions, "redactedHeaderNames">; label: string; description: string }> = [
  { key: "maskEmails", label: "Mask email addresses", description: "In console messages, errors, and captured text" },
  { key: "maskJwts", label: "Mask JWTs", description: "Any three-segment token pattern in captured text" },
  { key: "redactSensitiveBodyFields", label: "Redact sensitive body fields", description: "Masks password/token/secret/apiKey-like JSON fields in captured request/response bodies" },
];

// Not implemented yet — see ROADMAP.md "Beyond this plan" for tracking. Commented out
// instead of deleted so whoever builds these can find the intended copy.
// export const EXPERIMENTAL_ROWS: Array<{ label: string; description: string }> = [
//   { label: "React integration", description: "Detect component tree updates via React DevTools hook" },
//   { label: "Redux integration", description: "Capture dispatched actions and state diffs" },
//   { label: "Zustand integration", description: "Capture store updates" },
//   { label: "TanStack Query integration", description: "Capture query and mutation lifecycle events" },
//   { label: "Accessibility tree capture", description: "Snapshot the accessibility tree alongside DOM captures" },
// ];

export const ABOUT_LINKS = [
  { label: "GitHub repository", url: REPO_URL },
  { label: "Documentation", url: `${REPO_URL}#readme` },
  { label: "Report an issue", url: `${REPO_URL}/issues/new` },
  { label: "Built with 🤍 by Tope", url: "https://findtope.dev" },
];

export const QUICK_PATTERNS = ["localhost:*", "*.vercel.app", "*.ngrok.io", "127.0.0.1:*"];

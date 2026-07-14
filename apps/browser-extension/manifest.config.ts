import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Mobius",
  version: "0.0.1",
  description:
    "Streams browser console/network events to a local mobius-mcp server for AI coding agents. Click the icon to enable capture on a tab.",
  permissions: ["scripting", "activeTab", "storage", "tabs", "webNavigation", "debugger", "notifications", "downloads"],
  host_permissions: ["<all_urls>"],
  icons: {
    16: "icons/icon-16.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
  action: {
    default_popup: "popup.html",
    default_icon: {
      16: "icons/icon-16.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
  },
  options_page: "options.html",
  web_accessible_resources: [
    {
      resources: ["src/content-script.js", "src/injected.js"],
      matches: ["<all_urls>"],
    },
  ],
});

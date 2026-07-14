import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config.js";

// content-script.ts and injected.ts are built separately (see scripts/build-content-scripts.mjs):
// they're injected via chrome.scripting.executeScript as classic scripts, so they must be
// self-contained IIFE bundles with no import statements, which Vite's shared-chunk code-splitting
// can't guarantee for files that also share modules with the popup/options entries.
export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    rollupOptions: {
      // logs.html isn't referenced by any manifest field (unlike popup.html/options.html), so it
      // needs to be listed explicitly for Vite to include it as a build entry.
      input: {
        logs: path.resolve(__dirname, "logs.html"),
      },
    },
  },
});

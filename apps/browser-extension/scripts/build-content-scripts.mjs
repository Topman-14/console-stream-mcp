import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

await Promise.all([
  build({
    entryPoints: [path.join(root, "src/content-script.ts")],
    outfile: path.join(root, "dist/src/content-script.js"),
    bundle: true,
    format: "iife",
    target: "chrome110",
  }),
  build({
    entryPoints: [path.join(root, "injected.ts")],
    outfile: path.join(root, "dist/src/injected.js"),
    bundle: true,
    format: "iife",
    target: "chrome110",
  }),
]);

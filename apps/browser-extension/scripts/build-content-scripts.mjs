import { context } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const watch = process.argv.includes("--watch");

const configs = [
  {
    entryPoints: [path.join(root, "src/content-script.ts")],
    outfile: path.join(root, "dist/src/content-script.js"),
    bundle: true,
    format: "iife",
    target: "chrome110",
  },
  {
    entryPoints: [path.join(root, "injected.ts")],
    outfile: path.join(root, "dist/src/injected.js"),
    bundle: true,
    format: "iife",
    target: "chrome110",
  },
];

const contexts = await Promise.all(configs.map((config) => context(config)));

if (watch) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("[build-content-scripts] watching for changes...");
} else {
  await Promise.all(contexts.map((ctx) => ctx.rebuild()));
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
}

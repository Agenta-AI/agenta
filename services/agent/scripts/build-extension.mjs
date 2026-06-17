/**
 * Bundle the Agenta Pi extension into one self-contained file so its OpenTelemetry deps
 * resolve wherever Pi loads it (host, docker sidecar, Daytona snapshot). Pi only accepts
 * `.ts`/`.js` extension files, so we emit `.js` (ESM) with a default export.
 *
 * Run: pnpm run build:extension  ->  dist/extensions/agenta.js
 */
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [join(root, "src/extensions/agenta.ts")],
  outfile: join(root, "dist/extensions/agenta.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Pi provides the ExtensionAPI at load time; never bundle the harness SDK.
  external: ["@earendil-works/pi-coding-agent"],
  banner: {
    // protobufjs and some deps expect CommonJS globals under ESM; shim them.
    js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);",
  },
  logLevel: "info",
});

process.stderr.write("[build-extension] wrote dist/extensions/agenta.js\n");

/**
 * Bundle the Agenta Pi extension into one self-contained file so its OpenTelemetry deps
 * resolve wherever Pi loads it (host, docker sidecar, Daytona snapshot). Pi only accepts
 * `.ts`/`.js` extension files, so we emit `.js` (ESM) with a default export.
 *
 * Run: pnpm run build:extension  ->  dist/extensions/agenta.js
 */
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(root, "dist/extensions/agenta.js");

await build({
  entryPoints: [join(root, "src/extensions/agenta.ts")],
  outfile,
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

// Bundle-safety gate: the extension runs INSIDE the sandbox and must only pull in the
// bundle-safe relay modules (relay-client.ts, relay-protocol.ts). If a server-side
// relay symbol shows up in the bundle, someone imported runner-side code (relay.ts /
// relay-watch.ts, or a sandbox host's deleteFsEntry surface) into the extension graph.
const FORBIDDEN_SERVER_SYMBOLS = [
  "daytonaRelayActivitySource",
  "startToolRelay",
  "deleteFsEntry",
];
const bundle = await readFile(outfile, "utf-8");
const leaked = FORBIDDEN_SERVER_SYMBOLS.filter((symbol) =>
  bundle.includes(symbol),
);
if (leaked.length > 0) {
  process.stderr.write(
    `[build-extension] FATAL: server-side relay symbols leaked into the sandbox bundle: ${leaked.join(", ")}\n` +
      "[build-extension] the extension may import only tools/relay-client.ts and tools/relay-protocol.ts; never tools/relay.ts or tools/relay-watch.ts\n",
  );
  process.exit(1);
}

process.stderr.write("[build-extension] wrote dist/extensions/agenta.js\n");

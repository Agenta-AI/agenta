/**
 * Bundle the Agenta in-sandbox harness assets into self-contained files so their deps resolve
 * wherever they are loaded (host, docker sidecar, Daytona snapshot):
 *
 *   dist/extensions/agenta.js    the Pi extension (tracing + tools). Pi loads it on every run;
 *                                Pi only accepts `.ts`/`.js` extension files, so ESM `.js` with
 *                                a default export.
 *   dist/tools/tool-mcp-stdio.js the in-sandbox stdio MCP shim: the Daytona tool advertiser
 *                                for an MCP-client harness (Claude), which has no bundled
 *                                extension. The harness's ACP adapter launches it as
 *                                `node tool-mcp-stdio.js` inside the sandbox.
 *
 * Run: pnpm run build:extension
 */
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Bundle-safety gate: both bundles run INSIDE the sandbox and must only pull in the
// bundle-safe relay modules (relay-client.ts, relay-protocol.ts). If a server-side
// relay symbol shows up in a bundle, someone imported runner-side code (relay.ts /
// relay-watch.ts, or a sandbox host's deleteFsEntry surface) into its import graph.
const FORBIDDEN_SERVER_SYMBOLS = [
  "daytonaRelayActivitySource",
  "startToolRelay",
  "deleteFsEntry",
];

async function assertBundleSafe(outfile) {
  const bundle = await readFile(outfile, "utf-8");
  const leaked = FORBIDDEN_SERVER_SYMBOLS.filter((symbol) =>
    bundle.includes(symbol),
  );
  if (leaked.length > 0) {
    process.stderr.write(
      `[build-extension] FATAL: server-side relay symbols leaked into the sandbox bundle ${outfile}: ${leaked.join(", ")}\n` +
        "[build-extension] sandbox bundles may import only tools/relay-client.ts and tools/relay-protocol.ts; never tools/relay.ts or tools/relay-watch.ts\n",
    );
    process.exit(1);
  }
}

// The Pi extension.
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
await assertBundleSafe(join(root, "dist/extensions/agenta.js"));
process.stderr.write("[build-extension] wrote dist/extensions/agenta.js\n");

// The in-sandbox stdio MCP shim.
await build({
  entryPoints: [join(root, "src/tools/tool-mcp-stdio.ts")],
  outfile: join(root, "dist/tools/tool-mcp-stdio.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // No harness SDK dep; only node builtins plus the bundle-safe relay client/protocol.
  logLevel: "info",
});
await assertBundleSafe(join(root, "dist/tools/tool-mcp-stdio.js"));
process.stderr.write("[build-extension] wrote dist/tools/tool-mcp-stdio.js\n");

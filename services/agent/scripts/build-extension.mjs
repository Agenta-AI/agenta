/**
 * Bundle the Agenta in-sandbox harness assets into self-contained files so their deps resolve
 * wherever they are loaded (host, docker sidecar, Daytona snapshot):
 *
 *   dist/extensions/agenta.js     the Pi extension (tracing + tools). Pi loads it on every run;
 *                                 Pi only accepts `.ts`/`.js` extension files, so ESM `.js` with
 *                                 a default export.
 *   dist/tools/relay-mcp-stdio.js the in-sandbox stdio MCP relay shim (F-042): the Daytona tool
 *                                 advertiser for a non-Pi harness (Claude), which has no bundled
 *                                 extension. The harness launches it as `node relay-mcp-stdio.js`.
 *
 * Run: pnpm run build:extension
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

await build({
  entryPoints: [join(root, "src/tools/relay-mcp-stdio.ts")],
  outfile: join(root, "dist/tools/relay-mcp-stdio.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // No harness SDK dep; only sibling tools/* modules, which bundle in.
  logLevel: "info",
});

process.stderr.write("[build-extension] wrote dist/tools/relay-mcp-stdio.js\n");

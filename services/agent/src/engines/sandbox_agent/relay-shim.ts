/**
 * In-sandbox stdio MCP relay shim asset (F-042).
 *
 * The non-Pi harness (Claude) on Daytona has no bundled extension to advertise gateway/callback
 * tools, and the runner loopback HTTP MCP server is unreachable from inside the sandbox. So the
 * runner uploads a tiny standalone stdio MCP server — `tools/relay-mcp-stdio.ts`, esbuild-bundled
 * to `dist/tools/relay-mcp-stdio.js` like the Pi extension — into the sandbox and advertises it as
 * an ACP stdio MCP server the in-sandbox harness launches. This module owns the bundle location +
 * the upload; `mcp.ts` stays pure (it only builds the session entry, it does not touch files).
 *
 * FAIL LOUD (A7 / F-032): on the Daytona + non-Pi + has-executable-tools path the engine REQUIRES
 * this shim — without it the tools silently never surface (exactly the F-042 bug). So a missing
 * bundle or a failed upload THROWS (with a named message), and the engine catch turns it into
 * `{ ok: false, error }` rather than proceeding with an empty tool channel.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "./daemon.ts";

type Log = (message: string) => void;

/**
 * The bundled shim path. Built by `pnpm run build:extension` alongside the Pi extension. Resolved
 * lazily (a function, not a module-level const) so `SANDBOX_AGENT_RELAY_MCP_BUNDLE` is honored at
 * call time — the runner sets it after module load, and tests point it at a fixture.
 */
export function relayMcpBundlePath(): string {
  return (
    process.env.SANDBOX_AGENT_RELAY_MCP_BUNDLE ??
    join(PKG_ROOT, "dist", "tools", "relay-mcp-stdio.js")
  );
}

/** Thrown when the shim cannot be delivered on a path that REQUIRES it (Daytona non-Pi + tools). */
export const RELAY_SHIM_UNAVAILABLE_MESSAGE =
  "the in-sandbox tool relay shim could not be delivered to the Daytona sandbox, so the run's " +
  "gateway/callback tools cannot be advertised to the harness; run build:extension and retry, or " +
  "run on the local sandbox / the Pi harness.";

/**
 * Upload the bundled stdio MCP relay shim into a Daytona sandbox and return the in-sandbox path.
 * Throws `RELAY_SHIM_UNAVAILABLE_MESSAGE` when the bundle is missing or the upload fails — the
 * caller only invokes this on the path that REQUIRES the shim, so a failure must fail the run
 * loudly rather than silently drop the tools. Carries no secret (only the script itself).
 */
export async function uploadRelayShimToSandbox(
  sandbox: any,
  destDir: string,
  log: Log = () => {},
): Promise<string> {
  const bundle = relayMcpBundlePath();
  if (!existsSync(bundle)) {
    log(`relay MCP shim bundle missing at ${bundle} (run build:extension)`);
    throw new Error(RELAY_SHIM_UNAVAILABLE_MESSAGE);
  }
  const destPath = `${destDir}/relay-mcp-stdio.js`;
  try {
    await sandbox.mkdirFs({ path: destDir });
    await sandbox.writeFsFile(
      { path: destPath },
      readFileSync(bundle, "utf-8"),
    );
    return destPath;
  } catch (err) {
    log(`relay MCP shim upload failed: ${(err as Error).message}`);
    throw new Error(RELAY_SHIM_UNAVAILABLE_MESSAGE);
  }
}

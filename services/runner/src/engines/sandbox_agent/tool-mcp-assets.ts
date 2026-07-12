/**
 * In-sandbox stdio MCP shim assets (mirrors `pi-assets.ts` for the Pi extension).
 *
 * An MCP-client harness (Claude) on Daytona has no bundled extension to advertise
 * gateway/callback tools, and the runner-loopback HTTP MCP server is unreachable from inside
 * the sandbox. So the runner uploads two files into the sandbox and advertises them as an ACP
 * stdio MCP entry the in-sandbox harness launches (`engines/sandbox_agent/mcp.ts`
 * `buildInternalToolMcpEntry`):
 *
 *   <destDir>/tool-mcp-stdio.js   the esbuild bundle of `tools/tool-mcp-stdio.ts`
 *   <destDir>/tool-mcp-specs.json the run's AdvertisedToolSpec array (public fields only)
 *
 * The specs ride a FILE, not env: the env is copied through four exec layers and tool JSON
 * Schemas are unbounded. This module owns the bundle location and the upload; `mcp.ts` stays
 * pure (it builds the session entry, it does not touch files).
 *
 * FAIL LOUD: the caller only invokes this on the path that REQUIRES the shim (Daytona +
 * non-Pi + executable tools) — without it the tools silently never surface (the F-042 /
 * silent-tool-drop bug). So a missing bundle or a failed upload THROWS the named message and
 * the engine turns it into `{ok: false, error}` rather than proceeding with an empty tool
 * channel.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AdvertisedToolSpec } from "../../tools/public-spec.ts";
import { PKG_ROOT } from "./daemon.ts";
import type { SandboxFilePort } from "./sandbox-ports.ts";

type Log = (message: string) => void;

const bundleContentsByPath = new Map<string, string>();

function toolMcpBundleContents(path: string): string {
  const cached = bundleContentsByPath.get(path);
  if (cached !== undefined) return cached;
  const contents = readFileSync(path, "utf-8");
  bundleContentsByPath.set(path, contents);
  return contents;
}

/**
 * The bundled shim path. Built by `pnpm run build:extension` alongside the Pi extension.
 * Resolved lazily (a function, not a module-level const) so `SANDBOX_AGENT_RELAY_MCP_BUNDLE`
 * is honored at call time — tests point it at a fixture. The override selects code, so it is
 * trusted deployment configuration, never run or request configuration.
 */
export function toolMcpBundlePath(): string {
  return (
    process.env.SANDBOX_AGENT_RELAY_MCP_BUNDLE ??
    join(PKG_ROOT, "dist", "tools", "tool-mcp-stdio.js")
  );
}

/** Thrown when the shim cannot be delivered on a path that REQUIRES it (Daytona non-Pi + tools). */
export const TOOL_MCP_UNAVAILABLE_MESSAGE =
  "the in-sandbox tool MCP shim could not be delivered to the Daytona sandbox, so the run's " +
  "gateway/callback tools cannot be advertised to the harness; run build:extension and retry, " +
  "or run on the local sandbox / the Pi harness.";

/** The uploaded in-sandbox paths the session MCP entry advertises. */
export interface ToolMcpAssets {
  bundlePath: string;
  specsPath: string;
}

/**
 * Upload the shim bundle plus the run's public-specs file into a Daytona sandbox and return
 * the in-sandbox paths. Throws `TOOL_MCP_UNAVAILABLE_MESSAGE` when the bundle is missing or
 * the upload fails — a failure must fail the run loudly rather than silently drop the tools.
 *
 * Always writes, never skip-if-exists: a reused (warm) sandbox may hold a stale bundle from
 * before a runner deploy, and the specs are per-run. Carries no secret (the bundle is code and
 * the specs are the public advertisement shape).
 */
export async function uploadToolMcpAssets(
  sandbox: SandboxFilePort,
  destDir: string,
  specs: AdvertisedToolSpec[],
  log: Log = () => {},
): Promise<ToolMcpAssets> {
  const bundle = toolMcpBundlePath();
  if (!existsSync(bundle)) {
    log(`tool MCP shim bundle missing at ${bundle} (run build:extension)`);
    throw new Error(TOOL_MCP_UNAVAILABLE_MESSAGE);
  }
  const bundlePath = `${destDir}/tool-mcp-stdio.js`;
  const specsPath = `${destDir}/tool-mcp-specs.json`;
  try {
    await sandbox.mkdirFs({ path: destDir });
    const bundleContents = toolMcpBundleContents(bundle);
    await Promise.all([
      sandbox.writeFsFile({ path: bundlePath }, bundleContents),
      sandbox.writeFsFile({ path: specsPath }, JSON.stringify(specs)),
    ]);
    return { bundlePath, specsPath };
  } catch (err) {
    log(`tool MCP shim upload failed: ${(err as Error).message}`);
    throw new Error(TOOL_MCP_UNAVAILABLE_MESSAGE);
  }
}

/**
 * WP-8 tool delivery over rivet/ACP.
 *
 * The Pi engine (engines/pi.ts) injected resolved runnable tools (WP-7) as in-process Pi
 * customTools. Over ACP the harness only accepts tools through MCP, so the same
 * resolved specs are exposed as an MCP server whose tool bodies POST back to Agenta's
 * /tools/call (the provider key and connection auth stay server-side, exactly as in
 * the Pi path). `buildToolMcpServers` returns the ACP `mcpServers` entry to attach to
 * the session.
 *
 * Delivery: a stdio MCP bridge (mcp-server.ts) launched by the daemon. The specs and
 * callback are passed to it as env, so nothing tool-specific is written to the
 * agent-visible filesystem.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ResolvedToolSpec, ToolCallbackContext } from "../protocol.ts";

export type { ResolvedToolSpec, ToolCallbackContext } from "../protocol.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
// services/agent/src/tools/mcp-bridge.ts -> services/agent/node_modules/.bin/tsx
const TSX_BIN = join(HERE, "..", "..", "node_modules", ".bin", "tsx");
const SERVER = join(HERE, "mcp-server.ts");

/** Resolve how to launch the bridge: an explicit override, else the local tsx bin. */
function bridgeLauncher(): { command: string; args: string[] } {
  const override = process.env.AGENTA_TOOL_BRIDGE_COMMAND;
  if (override) return { command: override, args: [SERVER] };
  if (existsSync(TSX_BIN)) return { command: TSX_BIN, args: [SERVER] };
  // Fall back to npx tsx (resolves from PATH wherever the daemon runs).
  return { command: "npx", args: ["-y", "tsx", SERVER] };
}

/** ACP McpServerStdio entry: env is a list of {name, value}. */
interface EnvVariable {
  name: string;
  value: string;
}

export interface McpServerStdio {
  name: string;
  command: string;
  args: string[];
  env: EnvVariable[];
}

/**
 * Build the ACP `mcpServers` list that exposes the resolved tools to the harness.
 *
 * Attachment is decided per tool kind, not on the callback endpoint alone (see protocol.ts
 * `ResolvedToolSpec.kind`; absent kind means `callback` for back-compat):
 *  - `client` tools are browser-fulfilled and not advertised by this server (mcp-server.ts
 *    filters them from tools/list), so they never justify attaching the bridge on their own.
 *  - "Executable here" = non-client (`code` and `callback`). With zero executable specs we
 *    return [] (the no-tools path stays untouched).
 *  - `code` tools run locally in mcp-server.ts (runCodeTool) and need NO callback endpoint, so
 *    we attach `agenta-tools` whenever there is at least one executable spec.
 *  - Only `callback` tools require `callback.endpoint`. If callback tools are present but the
 *    endpoint is missing, we do NOT drop the whole server (that would silently lose the `code`
 *    tools too): we still attach it and warn, naming the callback tools whose `tools/call` will
 *    fail. The endpoint/auth env entries are pushed only when the endpoint actually exists.
 */
export function buildToolMcpServers(
  specs: ResolvedToolSpec[],
  callback: ToolCallbackContext | undefined,
): McpServerStdio[] {
  if (!specs || specs.length === 0) return [];

  // Absent kind defaults to `callback` (back-compat); `client` is the only non-executable kind.
  const executable = specs.filter((s) => (s.kind ?? "callback") !== "client");
  if (executable.length === 0) return [];

  // The callback subset is the only thing that needs the endpoint to function.
  const callbackSpecs = executable.filter((s) => (s.kind ?? "callback") === "callback");
  const hasEndpoint = Boolean(callback?.endpoint);

  if (callbackSpecs.length > 0 && !hasEndpoint) {
    const names = callbackSpecs.map((s) => s.name).join(", ");
    process.stderr.write(
      `[tool-bridge] missing toolCallback endpoint: ${callbackSpecs.length} callback tool(s) ` +
        `will fail (${names}); still attaching server for the other tool(s)\n`,
    );
  }

  // Pass every executable spec; mcp-server.ts dispatches per kind (code runs locally, callback
  // routes to the endpoint).
  const env: EnvVariable[] = [
    { name: "AGENTA_TOOL_SPECS", value: JSON.stringify(executable) },
  ];
  // Only carry the callback env when there is an endpoint to call back to.
  if (hasEndpoint) {
    env.push({ name: "AGENTA_TOOL_CALLBACK_ENDPOINT", value: callback!.endpoint });
    if (callback!.authorization) {
      env.push({ name: "AGENTA_TOOL_CALLBACK_AUTH", value: callback!.authorization });
    }
  }

  const { command, args } = bridgeLauncher();
  return [{ name: "agenta-tools", command, args, env }];
}

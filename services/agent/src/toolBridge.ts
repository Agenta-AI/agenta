/**
 * WP-8 tool delivery over rivet/ACP.
 *
 * The Pi backend (runPi.ts) injected resolved runnable tools (WP-7) as in-process Pi
 * customTools. Over ACP the harness only accepts tools through MCP, so the same
 * resolved specs are exposed as an MCP server whose tool bodies POST back to Agenta's
 * /tools/call (the provider key and connection auth stay server-side, exactly as in
 * the Pi path). `buildToolMcpServers` returns the ACP `mcpServers` entry to attach to
 * the session.
 *
 * Delivery: a stdio MCP bridge (toolBridgeServer.ts) launched by the daemon. The specs
 * and callback are passed to it as env, so nothing tool-specific is written to the
 * agent-visible filesystem.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ResolvedToolSpec, ToolCallbackContext } from "./protocol.ts";

export type { ResolvedToolSpec, ToolCallbackContext } from "./protocol.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
// services/agent/src/toolBridge.ts -> services/agent/node_modules/.bin/tsx
const TSX_BIN = join(HERE, "..", "node_modules", ".bin", "tsx");
const SERVER = join(HERE, "toolBridgeServer.ts");

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
 * Empty when there are no tools or no callback (the no-tools path stays untouched).
 */
export function buildToolMcpServers(
  specs: ResolvedToolSpec[],
  callback: ToolCallbackContext | undefined,
): McpServerStdio[] {
  if (!specs || specs.length === 0) return [];
  if (!callback?.endpoint) {
    process.stderr.write(
      `[tool-bridge] skipping ${specs.length} tool(s): missing toolCallback endpoint\n`,
    );
    return [];
  }

  const env: EnvVariable[] = [
    { name: "AGENTA_TOOL_SPECS", value: JSON.stringify(specs) },
    { name: "AGENTA_TOOL_CALLBACK_ENDPOINT", value: callback.endpoint },
  ];
  if (callback.authorization) {
    env.push({ name: "AGENTA_TOOL_CALLBACK_AUTH", value: callback.authorization });
  }

  const { command, args } = bridgeLauncher();
  return [{ name: "agenta-tools", command, args, env }];
}

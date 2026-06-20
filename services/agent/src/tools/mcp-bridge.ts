/**
 * WP-8 tool delivery over rivet/ACP.
 *
 * The Pi engine (engines/pi.ts) injected resolved runnable tools (WP-7) as in-process Pi
 * customTools. Over ACP the harness only accepts tools through MCP, so the same
 * resolved specs are exposed as an MCP server whose tool bodies relay back to the runner.
 * The runner keeps private specs/auth in memory and performs the actual execution.
 * `buildToolMcpServers` returns the ACP `mcpServers` entry to attach to the session.
 *
 * Delivery: a stdio MCP bridge (mcp-server.ts) launched by the daemon. Its env carries
 * only public tool metadata and the relay directory. It never receives scoped env, code,
 * callback auth, or callback endpoints.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ResolvedToolSpec, ToolCallbackContext } from "../protocol.ts";
import { executableToolSpecs, publicToolSpecs } from "./public-spec.ts";

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
 *  - The bridge does not execute tools itself. It sends a request file to `relayDir`, and
 *    the runner executes the private resolved spec in memory. That keeps scoped env, code,
 *    callback auth, and callback endpoints out of child-process env.
 */
export function buildToolMcpServers(
  specs: ResolvedToolSpec[],
  _callbackOrRelayDir?: ToolCallbackContext | string,
  relayDir?: string,
): McpServerStdio[] {
  if (!specs || specs.length === 0) return [];

  // Absent kind defaults to `callback` (back-compat); `client` is the only non-executable kind.
  const executable = executableToolSpecs(specs);
  if (executable.length === 0) return [];

  const resolvedRelayDir =
    typeof _callbackOrRelayDir === "string" ? _callbackOrRelayDir : relayDir;
  if (!resolvedRelayDir) {
    const names = executable.map((s) => s.name).join(", ");
    process.stderr.write(
      `[tool-bridge] missing tool relay directory: ${executable.length} tool(s) ` +
        `will fail (${names})\n`,
    );
  }

  const env: EnvVariable[] = [
    { name: "AGENTA_TOOL_PUBLIC_SPECS", value: JSON.stringify(publicToolSpecs(executable)) },
  ];
  if (resolvedRelayDir) env.push({ name: "AGENTA_TOOL_RELAY_DIR", value: resolvedRelayDir });

  const { command, args } = bridgeLauncher();
  return [{ name: "agenta-tools", command, args, env }];
}

/**
 * Stdio MCP bridge — DISABLED in the sidecar.
 *
 * This module used to expose resolved runnable tools (WP-7) to non-Pi harnesses (e.g. Claude)
 * by launching a stdio MCP child process (mcp-server.ts) on the runner host. That process runs
 * OUTSIDE the sandbox boundary, so a network-blocked sandbox does not confine it — the same
 * runner-host execution bypass that had code execution removed. Until the security issues are
 * fixed, the stdio MCP implementation is disabled the same way: the interface/types remain, but
 * any attempt to deliver a stdio MCP server throws a single named-constant message
 * (`MCP_UNSUPPORTED_MESSAGE`), mirroring `tools/code.ts` (`CODE_TOOL_UNSUPPORTED_MESSAGE`).
 *
 * The run plan (`engines/sandbox_agent/run-plan.ts`) refuses any run carrying a stdio MCP
 * server up front, so this throw is a defense-in-depth backstop, not the primary gate.
 */
import type { ResolvedToolSpec, ToolCallbackContext } from "../protocol.ts";

export type { ResolvedToolSpec, ToolCallbackContext } from "../protocol.ts";

export const MCP_UNSUPPORTED_MESSAGE =
  "MCP servers are not supported by the sidecar.";

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
 * Disabled: building a tool MCP bridge would launch an unconfined stdio child process on the
 * runner host. Throws `MCP_UNSUPPORTED_MESSAGE` whenever there is something to deliver; an
 * empty/all-`client` spec list is a no-op (returns []) so the no-tools path is untouched.
 */
export function buildToolMcpServers(
  specs: ResolvedToolSpec[],
  _callbackOrRelayDir?: ToolCallbackContext | string,
  _relayDir?: string,
): McpServerStdio[] {
  if (!specs || specs.length === 0) return [];
  // `client` tools are browser-fulfilled and never go through the bridge; only an executable
  // (`code`/`callback`) spec would have launched the stdio child, which is what we now refuse.
  const executable = specs.filter((s) => s.kind !== "client");
  if (executable.length === 0) return [];
  throw new Error(MCP_UNSUPPORTED_MESSAGE);
}

import type {
  HarnessCapabilities,
  McpServerConfig,
  ResolvedToolSpec,
  ToolCallbackContext,
} from "../../protocol.ts";
import {
  buildToolMcpServers,
  MCP_UNSUPPORTED_MESSAGE,
  type McpServerStdio,
} from "../../tools/mcp-bridge.ts";

type Log = (message: string) => void;

/**
 * Convert user-declared MCP servers into ACP stdio entries — DISABLED in the sidecar.
 *
 * A stdio MCP server launches an arbitrary process on the runner host, outside the sandbox
 * boundary, so the implementation is disabled until its security is fixed (parity with the
 * removed code execution; see `tools/mcp-bridge.ts`). The wire shape (`McpServerConfig`) is
 * kept, but any stdio server throws `MCP_UNSUPPORTED_MESSAGE` rather than being delivered.
 * Remote (`http`) servers were never delivered over ACP and are still skipped (logged), so a
 * request carrying only remote servers stays a no-op.
 */
export function toAcpMcpServers(
  servers: McpServerConfig[] | undefined,
  log: Log = () => {},
): McpServerStdio[] {
  for (const s of servers ?? []) {
    if ((s.transport ?? "stdio") !== "stdio" || !s.command) {
      log(
        `skipping non-stdio MCP server '${s?.name ?? "?"}' (remote transport deferred)`,
      );
      continue;
    }
    throw new Error(MCP_UNSUPPORTED_MESSAGE);
  }
  return [];
}

export interface BuildSessionMcpServersInput {
  isPi: boolean;
  capabilities: HarnessCapabilities;
  harness: string;
  toolSpecs: ResolvedToolSpec[];
  userMcpServers?: McpServerConfig[];
  toolCallback?: ToolCallbackContext;
  relayDir: string;
  log?: Log;
}

/** Build the ACP MCP server list for this session, gated by harness capabilities. */
export function buildSessionMcpServers({
  isPi,
  capabilities,
  harness,
  toolSpecs,
  userMcpServers,
  toolCallback,
  relayDir,
  log = () => {},
}: BuildSessionMcpServersInput): McpServerStdio[] {
  const userMcpCount = userMcpServers?.length ?? 0;
  if (isPi || !capabilities.mcpTools) {
    if (!isPi && (toolSpecs.length > 0 || userMcpCount > 0)) {
      log(
        `harness '${harness}' lacks MCP support; ${toolSpecs.length} tool(s) and ` +
          `${userMcpCount} user MCP server(s) not delivered`,
      );
    }
    return [];
  }

  return [
    ...buildToolMcpServers(toolSpecs, toolCallback, relayDir),
    ...toAcpMcpServers(userMcpServers, log),
  ];
}

import type {
  HarnessCapabilities,
  McpServerConfig,
  ResolvedToolSpec,
  ToolCallbackContext,
} from "../../protocol.ts";
import { buildToolMcpServers, type McpServerStdio } from "../../tools/mcp-bridge.ts";

type Log = (message: string) => void;

/**
 * Convert user-declared MCP servers (already resolved server-side, secrets injected into
 * `env`) into ACP stdio entries. Only `stdio` is delivered over ACP today.
 */
export function toAcpMcpServers(
  servers: McpServerConfig[] | undefined,
  log: Log = () => {},
): McpServerStdio[] {
  const out: McpServerStdio[] = [];
  for (const s of servers ?? []) {
    if ((s.transport ?? "stdio") !== "stdio" || !s.command) {
      log(`skipping non-stdio MCP server '${s?.name ?? "?"}' (remote transport deferred)`);
      continue;
    }
    if (s.tools && s.tools.length > 0) {
      log(`MCP server '${s.name}': per-server tool allowlist not enforced over ACP (v1)`);
    }
    out.push({
      name: s.name,
      command: s.command,
      args: s.args ?? [],
      env: Object.entries(s.env ?? {}).map(([name, value]) => ({ name, value: String(value) })),
    });
  }
  return out;
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

import type {
  HarnessCapabilities,
  McpServerConfig,
  ResolvedToolSpec,
} from "../../protocol.ts";
import {
  buildToolMcpServers,
  USER_MCP_UNSUPPORTED_MESSAGE,
  type McpServerStdio,
} from "../../tools/mcp-bridge.ts";

type Log = (message: string) => void;

/**
 * An ACP HTTP-MCP server entry (`@agentclientprotocol/sdk` `McpServer` `type: "http"` variant):
 * a remote `url` plus request `headers`. Unlike stdio, no process launches on the runner host —
 * the harness opens the connection and the auth token rides in a header — so this is the safe
 * transport that stdio is not. The local shape mirrors the ACP type so a session's `mcpServers`
 * stays structurally typed without importing the generated SDK schema here.
 */
export interface McpServerHttp {
  type: "http";
  name: string;
  url: string;
  /** ACP `HttpHeader[]`: each `{name, value}`. The secret value never appears in logs. */
  headers: Array<{ name: string; value: string }>;
}

/** One delivered MCP server: a (disabled) stdio entry or an enabled HTTP entry. */
export type McpServerEntry = McpServerStdio | McpServerHttp;

/**
 * Convert USER-declared MCP servers into ACP entries. (This is the USER MCP capability layer —
 * distinct from the INTERNAL gateway-tool channel below; see `buildSessionMcpServers`.)
 *
 * - HTTP (`transport: "http"` + `url`) is ENABLED. A remote server has no child process on the
 *   runner host: the harness connects to the URL and the named secret rides in a request header,
 *   so it does not bypass the sandbox boundary the way a stdio child does. The resolved secret
 *   arrives on the `/run` wire in the server's `env` map (the SDK resolver merges named secrets
 *   into `env` regardless of transport, and the wire has no separate `headers` field), so each
 *   `env` entry is emitted as an HTTP header (`Authorization: <token>`, etc.). The author names
 *   the header via the secret-map key, exactly as a stdio server names its env var.
 * - STDIO (`transport: "stdio"` + `command`) is DISABLED. A stdio MCP server launches an
 *   arbitrary process on the runner host, outside the sandbox boundary, so the implementation is
 *   disabled (parity with the removed code execution) until its security is fixed. The wire shape
 *   (`McpServerConfig`) is kept, but a stdio server throws `USER_MCP_UNSUPPORTED_MESSAGE` rather
 *   than being delivered.
 * - A server that is neither a valid http (no `url`) nor a valid stdio (no `command`) is skipped
 *   with a log — it was never deliverable.
 */
export function toAcpMcpServers(
  servers: McpServerConfig[] | undefined,
  log: Log = () => {},
): McpServerEntry[] {
  const out: McpServerEntry[] = [];
  for (const s of servers ?? []) {
    const transport = s.transport ?? "stdio";

    if (transport === "http") {
      if (!s.url) {
        log(`skipping http MCP server '${s?.name ?? "?"}' (no url)`);
        continue;
      }
      out.push({
        type: "http",
        name: s.name,
        url: s.url,
        headers: Object.entries(s.env ?? {}).map(([name, value]) => ({
          name,
          value,
        })),
      });
      continue;
    }

    // stdio: a command-less server was never launched, so it stays a skipped no-op; a real
    // stdio server is disabled and fails loud.
    if (!s.command) {
      log(`skipping stdio MCP server '${s?.name ?? "?"}' (no command)`);
      continue;
    }
    throw new Error(USER_MCP_UNSUPPORTED_MESSAGE);
  }
  return out;
}

export interface BuildSessionMcpServersInput {
  isPi: boolean;
  capabilities: HarnessCapabilities;
  harness: string;
  toolSpecs: ResolvedToolSpec[];
  userMcpServers?: McpServerConfig[];
  relayDir: string;
  log?: Log;
}

/** The session MCP list plus a closer for any internal server started for it. */
export interface SessionMcpServers {
  servers: McpServerEntry[];
  /** Stop the internal gateway-tool server (no-op when none started). Run in the engine `finally`. */
  close: () => Promise<void>;
}

/**
 * Build the ACP MCP server list for this session, gated by harness capabilities.
 *
 * TWO INDEPENDENT LAYERS — do not merge their gates (the #4831 regression this fixed conflated
 * them into one switch; project gateway-tool-mcp):
 *  1. INTERNAL gateway-tool channel (`buildToolMcpServers`): the runner-synthesized loopback HTTP
 *     MCP server that delivers the run's resolved gateway/callback tools to the harness. Carries
 *     only public metadata; execution relays server-side. RESTORED.
 *  2. USER MCP capability (`toAcpMcpServers`): the user's own declared servers — stdio DISABLED,
 *     http delivered (#4834). UNCHANGED.
 *
 * Returns a `close()` the caller MUST run when the session ends, to release the internal server's
 * loopback port.
 */
export async function buildSessionMcpServers({
  isPi,
  capabilities,
  harness,
  toolSpecs,
  userMcpServers,
  relayDir,
  log = () => {},
}: BuildSessionMcpServersInput): Promise<SessionMcpServers> {
  const userMcpCount = userMcpServers?.length ?? 0;
  if (isPi || !capabilities.mcpTools) {
    if (!isPi && (toolSpecs.length > 0 || userMcpCount > 0)) {
      log(
        `harness '${harness}' lacks MCP support; ${toolSpecs.length} tool(s) and ` +
          `${userMcpCount} user MCP server(s) not delivered`,
      );
    }
    return { servers: [], close: async () => {} };
  }

  // Layer 1: INTERNAL gateway-tool channel (do not merge with the user gate below).
  const internal = await buildToolMcpServers(toolSpecs, relayDir, log);
  // Layer 2: USER MCP capability (stdio disabled, http delivered; do not merge with Layer 1).
  const user = toAcpMcpServers(userMcpServers, log);

  return {
    servers: [...internal.servers, ...user],
    close: internal.close,
  };
}

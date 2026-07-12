/**
 * Tool MCP bridge — the INTERNAL gateway-tool delivery channel for non-Pi harnesses.
 *
 * Harnesses that accept tools over MCP only (Claude Code) cannot receive Agenta gateway/callback
 * tools the way Pi does (Pi loads them through the bundled extension). So the runner advertises
 * the run's resolved tools to the harness as an internal MCP server. Each tool call relays back
 * to the runner, where the private spec / callback auth are applied server-side — the sandbox and
 * harness never see a credential.
 *
 * Transport: an internal loopback HTTP MCP endpoint the runner serves (`tool-mcp-http.ts`). This
 * REPLACES the pre-#4831 stdio bridge, which spawned a child process on the runner host outside
 * the sandbox boundary — the same execution hole PR #4831 closed for USER stdio MCP servers. The
 * loopback HTTP endpoint launches no process; it is served by the already-running runner. This
 * is why restoring delivery here does NOT reopen #4831's hole (see project gateway-tool-mcp).
 *
 * IMPORTANT — this is NOT the user MCP capability:
 *  - USER stdio MCP servers stay DISABLED (`engines/sandbox_agent/mcp.ts` `toAcpMcpServers` +
 *    `run-plan.ts` `hasStdioMcpServer`, fail with `USER_MCP_UNSUPPORTED_MESSAGE`).
 *  - USER http MCP servers are delivered unchanged (#4834).
 *  - THIS internal channel is synthesized by the runner from `customTools`; the user never
 *    declares it. The two layers toggle independently — do not merge their gates.
 */
import type { ResolvedToolSpec } from "../protocol.ts";
import type { McpServerHttp } from "../engines/sandbox_agent/mcp.ts";
import type { ClientToolRelay } from "./client-tool-relay.ts";
import { startInternalToolMcpServer } from "./tool-mcp-http.ts";

export type { ResolvedToolSpec, ToolCallbackContext } from "../protocol.ts";

/**
 * USER-facing MCP refusal. Means ONLY "user-declared MCP servers are not supported" — used by
 * the user stdio gate (`run-plan.ts` `hasStdioMcpServer`) and the user stdio branch
 * (`toAcpMcpServers`). The INTERNAL gateway-tool channel below must NEVER borrow this constant:
 * conflating the two is exactly the #4831 regression this project fixed.
 */
export const USER_MCP_UNSUPPORTED_MESSAGE =
  "MCPs are not supported by the sidecar.";

/**
 * Pi-family refusal for ANY user-declared MCP server (stdio AND http). The Pi runtime delivers
 * tools through the bundled Agenta extension, not over ACP MCP (`buildSessionMcpServers` returns
 * `[]` for Pi), so a user MCP server attached to a Pi run would be DROPPED — silently, with no
 * log and an HTTP 200. That is exactly the silent-drop F-032 forbids. The `run-plan.ts` gate
 * refuses it up front (the way the stdio-MCP and code-tool gates do) so the failure is loud
 * instead of a "successful" empty run. Http MCP is a Claude-only capability (#4834); pick a
 * non-Pi harness to use one.
 */
export const PI_USER_MCP_UNSUPPORTED_MESSAGE =
  "User MCPs are not supported on the Pi harness (Pi delivers tools through its bundled " +
  "extension, not MCP). Use a non-Pi harness (e.g. claude) for a user MCP server, or remove " +
  "mcpServers.";

// The ACP `McpServerStdio` shape lives in `engines/sandbox_agent/mcp.ts` (ACP entry
// materialization), produced only by the internal in-sandbox shim constructor there. This
// module is the LOCAL HTTP channel and deliberately exports no stdio entry type.

type Log = (message: string) => void;

/** Result of building the internal channel: the server entries plus a closer for the run end. */
export interface ToolMcpServersResult {
  servers: McpServerHttp[];
  /** Stop the internal server (no-op when none was started). Call in the engine `finally`. */
  close: () => Promise<void>;
}

const NO_OP_CLOSE = async (): Promise<void> => {};

/** Options for the internal channel: the client-tool relay and the engine pause/teardown signal. */
export interface BuildToolMcpServersOptions {
  /** When set (local Claude), `client` tools are advertised and paused in `tools/call`. */
  clientToolRelay?: ClientToolRelay;
  /** Engine abort signal; destroys an in-flight `tools/call` on pause/teardown. */
  signal?: AbortSignal;
  log?: Log;
}

/**
 * Build the INTERNAL tool MCP channel: start a loopback HTTP MCP server advertising the run's
 * tools and return a `type: "http"` server entry pointing at it. An empty spec list is a no-op
 * (`{ servers: [], close }`). `client` tools are included ONLY when a `clientToolRelay` is wired
 * (local Claude), where the server's `tools/call` pauses them; without one they are dropped here
 * (no pause path), so an all-`client` list with no relay stays a no-op as before.
 *
 * The returned `close()` MUST be called when the run ends (the engine does this in its `finally`)
 * to release the bound port. The channel carries no secret: the HTTP entry has empty `headers`,
 * the server holds only public specs + the relay dir, and it is bound to loopback.
 */
export async function buildToolMcpServers(
  specs: ResolvedToolSpec[],
  relayDir: string,
  options: BuildToolMcpServersOptions = {},
): Promise<ToolMcpServersResult> {
  const { clientToolRelay, signal, log = () => {} } = options;
  if (!specs || specs.length === 0) return { servers: [], close: NO_OP_CLOSE };
  // Without a relay, a `client` tool has no pause path over this channel, so drop it and deliver
  // only executable (`code`/`callback`) specs. With a relay (local Claude), keep client tools —
  // the server advertises them and pauses the call.
  const deliverable = clientToolRelay
    ? specs
    : specs.filter((s) => (s.kind ?? "callback") !== "client");
  if (deliverable.length === 0) return { servers: [], close: NO_OP_CLOSE };

  const server = await startInternalToolMcpServer(deliverable, relayDir, {
    clientToolRelay,
    signal,
    log,
  });
  return {
    servers: [
      {
        type: "http",
        // The harness keys MCP servers by name; "agenta-tools" matches the pre-#4831 name.
        name: "agenta-tools",
        url: server.url,
        // No credential on the wire: the channel is unauthenticated on loopback and carries
        // only public metadata. Every credentialed action happens server-side via the relay.
        headers: [],
      },
    ],
    close: server.close,
  };
}

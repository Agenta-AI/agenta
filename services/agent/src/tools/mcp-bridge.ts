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
import { startInternalToolMcpServer } from "./tool-mcp-http.ts";

export type { ResolvedToolSpec, ToolCallbackContext } from "../protocol.ts";

/**
 * USER-facing MCP refusal. Means ONLY "user-declared MCP servers are not supported" — used by
 * the user stdio gate (`run-plan.ts` `hasStdioMcpServer`) and the user stdio branch
 * (`toAcpMcpServers`). The INTERNAL gateway-tool channel below must NEVER borrow this constant:
 * conflating the two is exactly the #4831 regression this project fixed.
 */
export const USER_MCP_UNSUPPORTED_MESSAGE =
  "MCP servers are not supported by the sidecar.";

/** ACP McpServerStdio entry: env is a list of {name, value}. Kept for the disabled user path. */
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

type Log = (message: string) => void;

/** Result of building the internal channel: the server entries plus a closer for the run end. */
export interface ToolMcpServersResult {
  servers: McpServerHttp[];
  /** Stop the internal server (no-op when none was started). Call in the engine `finally`. */
  close: () => Promise<void>;
}

const NO_OP_CLOSE = async (): Promise<void> => {};

/**
 * Build the INTERNAL gateway-tool MCP channel: start a loopback HTTP MCP server advertising the
 * run's executable tools and return a `type: "http"` server entry pointing at it. An empty /
 * all-`client` spec list is a no-op (`{ servers: [], close }`), so the no-tools path is untouched.
 *
 * The returned `close()` MUST be called when the run ends (the engine does this in its `finally`)
 * to release the bound port. The channel carries no secret: the HTTP entry has empty `headers`,
 * the server holds only public specs + the relay dir, and it is bound to loopback.
 */
export async function buildToolMcpServers(
  specs: ResolvedToolSpec[],
  relayDir: string,
  log: Log = () => {},
): Promise<ToolMcpServersResult> {
  if (!specs || specs.length === 0) return { servers: [], close: NO_OP_CLOSE };
  // `client` tools are browser-fulfilled and never go through this channel; only an executable
  // (`code`/`callback`) spec needs delivering to the harness.
  const executable = specs.filter((s) => (s.kind ?? "callback") !== "client");
  if (executable.length === 0) return { servers: [], close: NO_OP_CLOSE };

  const server = await startInternalToolMcpServer(executable, relayDir, log);
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

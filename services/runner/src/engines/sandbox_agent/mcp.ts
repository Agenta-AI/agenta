import type {
  HarnessCapabilities,
  McpServerConfig,
  ResolvedToolSpec,
} from "../../protocol.ts";
import {
  buildToolMcpServers,
  USER_MCP_UNSUPPORTED_MESSAGE,
} from "../../tools/mcp-bridge.ts";
import type { ClientToolRelay } from "../../tools/client-tool-relay.ts";
import { executableToolSpecs } from "../../tools/public-spec.ts";
// The shim's env contract, from the dependency-free names module — never from the shim's
// bundle entrypoint (`tool-mcp-stdio.ts`), which server code must not import.
import {
  PUBLIC_SPECS_FILE_ENV,
  RELAY_DIR_ENV,
} from "../../tools/tool-mcp-env.ts";
import {
  insecureEgressAllowed,
  isBlockedIpLiteral,
  resolveAndCheckHost,
} from "../../tools/ssrf-guard.ts";
import type { ToolMcpAssets } from "./tool-mcp-assets.ts";

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

/** ACP env entry for a stdio MCP server: a list of `{name, value}`. */
interface EnvVariable {
  name: string;
  value: string;
}

/**
 * An ACP stdio MCP server entry (`McpServerStdio`): NO `type` field — the Claude ACP adapter
 * maps a TYPELESS `{name, command, args, env}` entry to a Claude SDK `{type: "stdio", ...}`
 * MCP server. This shape lives here (not in `tools/mcp-bridge.ts`, which is the local HTTP
 * channel) because ACP entry materialization is this module's job. It is produced ONLY by
 * `buildInternalToolMcpEntry` below — user-declared stdio MCP servers stay disabled and never
 * materialize into it (`toAcpMcpServers` is deliberately incapable of returning stdio).
 */
export interface McpServerStdio {
  name: string;
  command: string;
  args: string[];
  env: EnvVariable[];
}

/** One delivered MCP server: the internal stdio shim entry or an HTTP entry. */
export type McpServerEntry = McpServerStdio | McpServerHttp;

/**
 * The internal gateway-tool channel's server name, on every transport (loopback HTTP and the
 * in-sandbox stdio shim). A stable identity: the Python Claude adapter renders per-tool
 * permission rules as `mcp__agenta-tools__<tool>` (`claude_settings.py`), so renaming it would
 * silently stop every rendered allow/deny rule from matching.
 */
export const INTERNAL_TOOL_MCP_SERVER_NAME = "agenta-tools";

/** Refusal for a USER-declared MCP server that claims the internal channel's reserved name. */
export const RESERVED_MCP_SERVER_NAME_MESSAGE =
  `MCP server name '${INTERNAL_TOOL_MCP_SERVER_NAME}' is reserved for Agenta's internal ` +
  "gateway-tool channel (permission rules are rendered against it); rename the MCP server.";

/**
 * Refuse any USER-declared MCP server that claims the internal channel's reserved name, on
 * every transport: the Python Claude adapter renders permission rules against `agenta-tools`,
 * so a user server with that name would collide with the internal channel and inherit/steal
 * its rendered rules. Called from the run-plan gate (declaration time) and again at session
 * materialization (`buildSessionMcpServers`) as defense in depth.
 */
export function assertNoReservedUserMcpName(
  servers: Array<{ name?: string }> | undefined,
): void {
  for (const server of servers ?? []) {
    if (server?.name === INTERNAL_TOOL_MCP_SERVER_NAME) {
      throw new Error(RESERVED_MCP_SERVER_NAME_MESSAGE);
    }
  }
}

/**
 * Build the INTERNAL gateway-tool channel as an ACP stdio MCP entry: the Daytona-side
 * equivalent of the loopback HTTP channel, for an MCP-client harness that runs IN the sandbox.
 * The harness's ACP adapter launches the uploaded shim (`node tool-mcp-stdio.js`) inside the
 * sandbox; the shim serves the uploaded public-specs file over `tools/list` and writes a relay
 * request file on `tools/call`, which the runner-side relay loop executes server-side.
 *
 * DEDICATED constructor, structurally separate from any user MCP entry (plan security
 * section): `command`, `args`, and `env` are built entirely from runner constants and
 * uploaded-asset paths — no user-supplied `command`, `args`, `env`, or `transport` field can
 * flow into it. The env carries ONLY the specs-file path and the relay dir (plus the verbatim
 * relay response-watch flag when the operator set it on the runner, mirroring
 * `buildPiExtensionEnv`); no credential exists anywhere in this shape.
 */
export function buildInternalToolMcpEntry(
  assets: ToolMcpAssets,
  relayDir: string,
): McpServerStdio {
  const env: EnvVariable[] = [
    { name: PUBLIC_SPECS_FILE_ENV, value: assets.specsPath },
    { name: RELAY_DIR_ENV, value: relayDir },
  ];
  // Hop-1 response-watch kill switch: the in-sandbox writer defaults it to true, so it is
  // only forwarded — verbatim — when the operator set it on the runner.
  const responseWatch =
    process.env.AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED;
  if (responseWatch !== undefined) {
    env.push({
      name: "AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED",
      value: responseWatch,
    });
  }
  return {
    // NO `type` field: the adapter maps a typeless entry to stdio (see McpServerStdio).
    name: INTERNAL_TOOL_MCP_SERVER_NAME,
    command: "node",
    args: [assets.bundlePath],
    env,
  };
}

/**
 * SSRF guard for a user HTTP MCP `url`. The runner emits the run's Agenta-resolved named secrets
 * as request headers to this author-supplied URL, so an attacker-controlled config could point it
 * at an internal/metadata endpoint and exfiltrate a credential (a classic server-side request
 * forgery). Reuses the shared resolve-and-range-block guard (`tools/ssrf-guard.ts`), mirrored with
 * the webhook validator's block list — DNS-resolved, not literal-only:
 *
 *  - require `https` (the secret rides in a header; `http` would send it in clear text). Opt out
 *    for a known-safe non-https endpoint by listing its host in `AGENTA_AGENT_MCPS_HOST_ALLOWLIST`.
 *  - reject loopback, link-local (incl. the `169.254.169.254` cloud metadata host), private, and
 *    IPv4-mapped/compat IPv6 addresses, resolving hostnames via DNS, unless the host is in
 *    `AGENTA_AGENT_MCPS_HOST_ALLOWLIST` (comma-separated).
 *
 * Returns an error message string when the URL is rejected, or `undefined` when it is allowed.
 */
function mcpHostAllowlist(): Set<string> {
  return new Set(
    (process.env.AGENTA_AGENT_MCPS_HOST_ALLOWLIST ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function validateUserMcpUrl(
  rawUrl: string,
): Promise<string | undefined> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return `http MCP server url is not a valid URL: ${rawUrl}`;
  }
  if (insecureEgressAllowed()) return undefined;
  const allowlist = mcpHostAllowlist();
  const host = parsed.hostname.toLowerCase();
  const allowed = allowlist.has(host);
  if (parsed.protocol !== "https:" && !allowed) {
    return `http MCP server url must use https (got ${parsed.protocol.replace(":", "")}): ${rawUrl}`;
  }
  if (allowed) return undefined;

  if (host === "localhost" || host.endsWith(".localhost")) {
    return `http MCP server url targets an internal/metadata host (${host}); not allowed: ${rawUrl}`;
  }
  if (isBlockedIpLiteral(host)) {
    return `http MCP server url targets an internal/metadata host (${host}); not allowed: ${rawUrl}`;
  }
  const { error } = await resolveAndCheckHost(host);
  if (error) {
    // Distinguish a resolution failure (config error) from an SSRF block, so a plain ENOTFOUND
    // doesn't read as a security rejection to operators.
    if (/could not be resolved/.test(error)) {
      return `http MCP server url host could not be resolved (${host}): ${rawUrl}`;
    }
    return `http MCP server url targets an internal/metadata host (${host}); not allowed: ${rawUrl}`;
  }
  return undefined;
}

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
 * - An http `url` that fails the SSRF guard (`validateUserMcpUrl`: non-https, or an
 *   internal/metadata host) throws, so a credentialed request is never sent to an internal sink.
 */
export async function toAcpMcpServers(
  servers: McpServerConfig[] | undefined,
  log: Log = () => {},
): Promise<McpServerEntry[]> {
  const out: McpServerEntry[] = [];
  for (const s of servers ?? []) {
    const transport = s.transport ?? "stdio";

    if (transport === "http") {
      if (!s.url) {
        log(`skipping http MCP server '${s?.name ?? "?"}' (no url)`);
        continue;
      }
      // SSRF guard: the resolved named secret rides as a header on this author-supplied URL, so
      // reject a non-https / internal / metadata target before any credential is attached.
      const urlError = await validateUserMcpUrl(s.url);
      if (urlError) throw new Error(urlError);
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
  /**
   * True when the run executes in a REMOTE Daytona sandbox (the harness runs IN the sandbox,
   * not on the runner host). Selects the internal gateway-tool channel's transport: the
   * loopback (`127.0.0.1`) HTTP MCP URL resolves to the SANDBOX's loopback there, not the
   * runner's, so advertising it would hand the in-sandbox harness an unreachable URL. On
   * Daytona the channel is the uploaded in-sandbox stdio MCP shim instead (`internalToolMcp`
   * below), whose calls ride the file relay the runner already polls on Daytona — see
   * `engines/sandbox_agent.ts`.
   */
  isDaytona: boolean;
  toolSpecs: ResolvedToolSpec[];
  userMcpServers?: McpServerConfig[];
  relayDir: string;
  /**
   * The uploaded in-sandbox stdio MCP shim assets (`uploadToolMcpAssets`), set ONLY on the
   * Daytona + non-Pi + executable-tools path. When set, the internal gateway-tool channel is
   * advertised as the typeless stdio entry (`buildInternalToolMcpEntry`) the in-sandbox
   * harness launches. `undefined` everywhere else: local uses the loopback HTTP channel and
   * Pi uses its bundled extension, neither of which needs this.
   */
  internalToolMcp?: ToolMcpAssets;
  /**
   * The shared client-tool relay. When set (local Claude), the internal channel advertises
   * `client` tools and pauses a `tools/call` for one. Omit for Pi (which uses the file relay);
   * on Daytona the channel is skipped entirely.
   */
  clientToolRelay?: ClientToolRelay;
  /** Engine pause/teardown abort signal, threaded to the internal MCP server. */
  signal?: AbortSignal;
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
 *  1. INTERNAL gateway-tool channel: the runner-synthesized advertisement of the run's resolved
 *     gateway/callback tools. Carries only public metadata; execution relays server-side. Two
 *     transports by where the harness runs: LOCAL keeps the loopback HTTP MCP server
 *     (`buildToolMcpServers`); on DAYTONA the harness runs IN the sandbox (where `127.0.0.1`
 *     is the sandbox's loopback, not the runner's), so the channel is the uploaded in-sandbox
 *     stdio MCP shim instead (`buildInternalToolMcpEntry`, fed by `uploadToolMcpAssets` — its
 *     `tools/call` writes relay request files the runner-side loop executes). Daytona WITHOUT
 *     uploaded shim assets means no delivery path; `run-plan.ts` refuses undeliverable
 *     combinations (non-Daytona remotes, client tools on Daytona) before a session is ever
 *     built, and the log below states honestly whether an advertisement happened — it must
 *     never claim a delivery that isn't happening (the F1 false log).
 *  2. USER MCP capability (`toAcpMcpServers`): the user's own declared servers — stdio DISABLED,
 *     http delivered (#4834). UNCHANGED on every sandbox: a user http MCP is a REMOTE url the
 *     harness dials directly (not a runner loopback), so it stays reachable from a Daytona sandbox.
 *
 * Returns a `close()` the caller MUST run when the session ends, to release the internal server's
 * loopback port (a no-op on Daytona, where no internal server starts).
 */
export async function buildSessionMcpServers({
  isPi,
  capabilities,
  harness,
  isDaytona,
  toolSpecs,
  userMcpServers,
  relayDir,
  internalToolMcp,
  clientToolRelay,
  signal,
  log = () => {},
}: BuildSessionMcpServersInput): Promise<SessionMcpServers> {
  // Reserved-name defense at materialization: the run-plan gate already refused the name at
  // declaration time, and this repeat keeps a direct engine caller from bypassing it.
  assertNoReservedUserMcpName(userMcpServers);
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

  // Layer 1: INTERNAL gateway-tool channel (do not merge with the user gate below). Transport
  // depends on where the harness runs:
  //  - LOCAL: a runner loopback (`127.0.0.1`) HTTP MCP server the harness dials from the host.
  //  - DAYTONA: the loopback is unreachable from the in-sandbox harness (its `127.0.0.1` is
  //    the sandbox's), so when the engine uploaded the shim assets the channel is advertised
  //    as the internal TYPELESS stdio entry instead — the in-sandbox harness launches the
  //    uploaded `tool-mcp-stdio.js`, which writes relay request files the runner-side relay
  //    loop executes (the loop already polls the sandbox FS; see `engines/sandbox_agent.ts`).
  //    Only executable specs ride this channel (client tools have no pause path through the
  //    shim; `run-plan.ts` refuses them on this path). Without uploaded assets there is no
  //    delivery path and the honest no-channel log below fires.
  let internal: SessionMcpServers;
  if (!isDaytona) {
    internal = await buildToolMcpServers(toolSpecs, relayDir, {
      clientToolRelay,
      signal,
      log,
    });
  } else if (internalToolMcp && executableToolSpecs(toolSpecs).length > 0) {
    internal = {
      servers: [buildInternalToolMcpEntry(internalToolMcp, relayDir)],
      close: async () => {},
    };
  } else {
    internal = { servers: [], close: async () => {} };
  }
  if (isDaytona && toolSpecs.length > 0) {
    log(
      internal.servers.length > 0
        ? `daytona: ${executableToolSpecs(toolSpecs).length} gateway tool(s) advertised via ` +
            `the in-sandbox stdio MCP shim (the loopback MCP URL is unreachable from the sandbox)`
        : `daytona: ${toolSpecs.length} tool(s) NOT advertised (no in-sandbox tool MCP assets ` +
            `for this harness — run-plan should have refused this run)`,
    );
  }
  // Layer 2: USER MCP capability (stdio disabled, http delivered; do not merge with Layer 1).
  // A user http MCP is a remote url the harness dials directly, so it is delivered on Daytona too.
  const user = await toAcpMcpServers(userMcpServers, log);

  return {
    servers: [...internal.servers, ...user],
    close: internal.close,
  };
}

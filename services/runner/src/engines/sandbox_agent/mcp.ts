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
import type { ClientToolRelay } from "../../tools/client-tool-relay.ts";
import {
  insecureEgressAllowed,
  isBlockedIpLiteral,
  resolveAndCheckHost,
} from "../../tools/ssrf-guard.ts";

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
  if (parsed.protocol !== "https:") {
    return `http MCP server url must use https (got ${parsed.protocol.replace(":", "")}): ${rawUrl}`;
  }
  if (insecureEgressAllowed()) return undefined;
  const allowlist = mcpHostAllowlist();
  const host = parsed.hostname.toLowerCase();
  const allowed = allowlist.has(host);
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

export async function validateUserMcpServers(
  servers: McpServerConfig[] | undefined,
): Promise<void> {
  for (const server of servers ?? []) {
    const transport = server.transport ?? "stdio";
    if (transport === "stdio") {
      if (server.headers || (server.credentials?.length ?? 0) > 0) {
        throw new Error("stdio MCP server cannot carry HTTP headers");
      }
      continue;
    }
    if (!server.url) throw new Error("http MCP server requires url");
    if (Object.keys(server.environment ?? {}).length > 0) {
      throw new Error("http MCP server cannot carry process environment");
    }
    const names = new Set<string>();
    for (const [name, value] of Object.entries(server.headers ?? {})) {
      if (!name.trim() || !value) {
        throw new Error("HTTP MCP headers require non-empty names and values");
      }
      names.add(name.toLowerCase());
    }
    for (const credential of server.credentials ?? []) {
      const name = credential?.binding?.name;
      if (
        credential?.binding?.kind !== "header" ||
        !name?.trim() ||
        !credential.value ||
        credential.usage !== "opaque_http"
      ) {
        throw new Error(
          "HTTP MCP credential binding, value, or usage is invalid",
        );
      }
      const normalized = name.toLowerCase();
      if (names.has(normalized)) {
        throw new Error(`duplicate HTTP MCP header binding '${name}'`);
      }
      names.add(normalized);
    }
    const urlError = await validateUserMcpUrl(server.url);
    if (urlError) throw new Error(urlError);
  }
}

/**
 * Convert USER-declared MCP servers into ACP entries. (This is the USER MCP capability layer —
 * distinct from the INTERNAL gateway-tool channel below; see `buildSessionMcpServers`.)
 *
 * - HTTP (`transport: "http"` + `url`) is enabled. Public headers and typed secret header
 *   credentials stay separate until this final local ACP materialization boundary.
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
      await validateUserMcpServers([s]);
      out.push({
        type: "http",
        name: s.name,
        url: s.url,
        headers: [
          ...Object.entries(s.headers ?? {}).map(([name, value]) => ({
            name,
            value,
          })),
          ...(s.credentials ?? []).map((credential) => ({
            name: credential.binding.name,
            value: credential.value,
          })),
        ],
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
   * not on the runner host). Gates the internal gateway-tool channel: the channel's loopback
   * (`127.0.0.1`) HTTP MCP URL resolves to the SANDBOX's loopback there, not the runner's, so
   * advertising it would hand the in-sandbox harness an unreachable URL. On Daytona the channel
   * is skipped and gateway tools are delivered through the file relay instead (the relay loop
   * already polls the sandbox filesystem on Daytona — see `engines/sandbox_agent.ts`). See the
   * Daytona guard in `buildSessionMcpServers`.
   */
  isDaytona: boolean;
  toolSpecs: ResolvedToolSpec[];
  userMcpServers?: McpServerConfig[];
  relayDir: string;
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
 *  1. INTERNAL gateway-tool channel (`buildToolMcpServers`): the runner-synthesized loopback HTTP
 *     MCP server that delivers the run's resolved gateway/callback tools to the harness. Carries
 *     only public metadata; execution relays server-side. RESTORED — but advertised over a
 *     loopback (`127.0.0.1`) URL, so it is LOCAL-ONLY. On Daytona the harness runs IN the sandbox,
 *     where `127.0.0.1` is the sandbox's loopback, not the runner's, so the channel is SKIPPED.
 *     For a non-Pi harness this means NO delivery path exists (F1, audit finding): the file relay
 *     has a sandbox-side writer only inside Pi's bundled extension
 *     (`extensions/agenta.ts` `registerTools`), which no other harness loads — a claim this
 *     function used to log unconditionally, which was FALSE for non-Pi harnesses. `run-plan.ts`
 *     (`REMOTE_TOOLS_UNSUPPORTED_MESSAGE`) now refuses that combination before a session is ever
 *     built, so this function should never see non-Pi + Daytona + tools. The log below stays
 *     Pi-only anyway, as a defense against a future gate bypass: it must never again claim a
 *     delivery that isn't happening.
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
  clientToolRelay,
  signal,
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

  // Layer 1: INTERNAL gateway-tool channel (do not merge with the user gate below). LOCAL ONLY:
  // its advertised URL is a runner loopback (`127.0.0.1`), unreachable from a remote Daytona
  // sandbox where the harness runs. On Daytona, skip the loopback HTTP advertisement.
  const internal = isDaytona
    ? { servers: [], close: async () => {} }
    : await buildToolMcpServers(toolSpecs, relayDir, {
        clientToolRelay,
        signal,
        log,
      });
  // Only Pi has a sandbox-side file-relay writer (its bundled extension), and Pi never reaches
  // this point (the `isPi` early-return above), so no harness that gets here has ANY delivery
  // path on Daytona. `run-plan.ts` (`REMOTE_TOOLS_UNSUPPORTED_MESSAGE`) refuses that combination
  // before a session is built; if it ever reaches here anyway, log the honest fact — the
  // advertisement was skipped — and never claim a file-relay delivery that isn't happening
  // (the F1 false log).
  if (isDaytona && toolSpecs.length > 0) {
    log(
      `daytona: skipped the loopback tool-MCP advertisement for ${toolSpecs.length} tool(s) ` +
        `(runner loopback unreachable from the sandbox; no delivery path for this harness — ` +
        `run-plan should have refused this run)`,
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

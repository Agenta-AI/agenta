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
 * SSRF guard for a user HTTP MCP `url`. The runner emits the run's Agenta-resolved named secrets
 * as request headers to this author-supplied URL, so an attacker-controlled config could point it
 * at an internal/metadata endpoint and exfiltrate a credential (a classic server-side request
 * forgery). The capability is flag-gated (`AGENTA_AGENT_MCPS_ENABLED`, off by default) and
 * config-trust, so a scheme + host guard is enough rather than full DNS-resolution pinning:
 *
 *  - require `https` (the secret rides in a header; `http` would send it in clear text). Opt out
 *    for a known-safe non-https endpoint by listing its host in `AGENTA_AGENT_MCPS_HOST_ALLOWLIST`.
 *  - reject loopback, link-local (incl. the `169.254.169.254` cloud metadata host), and private
 *    address literals unless the host is in `AGENTA_AGENT_MCPS_HOST_ALLOWLIST` (comma-separated).
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

/** True for a hostname/IP literal that must not receive a credentialed request (SSRF sinks). */
function isInternalHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  // IPv6 loopback / unspecified (URL host keeps the brackets, e.g. "[::1]").
  if (h === "[::1]" || h === "[::]" || h === "::1" || h === "::") return true;
  // Link-local IPv6 (fe80::/10) and unique-local IPv6 (fc00::/7) literals.
  if (/^\[?f[cde]/.test(h)) return true;
  // IPv4 dotted-quad literals: loopback, link-local (incl. 169.254.169.254 metadata), private.
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 10) return true; // private
    if (a === 0) return true; // "this host"
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
  }
  return false;
}

export function validateUserMcpUrl(rawUrl: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return `http MCP server url is not a valid URL: ${rawUrl}`;
  }
  const allowlist = mcpHostAllowlist();
  const host = parsed.hostname.toLowerCase();
  const allowed = allowlist.has(host);
  if (parsed.protocol !== "https:" && !allowed) {
    return `http MCP server url must use https (got ${parsed.protocol.replace(":", "")}): ${rawUrl}`;
  }
  if (isInternalHost(host) && !allowed) {
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
      // SSRF guard: the resolved named secret rides as a header on this author-supplied URL, so
      // reject a non-https / internal / metadata target before any credential is attached.
      const urlError = validateUserMcpUrl(s.url);
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
   * not on the runner host). Gates the internal gateway-tool channel: the channel's loopback
   * (`127.0.0.1`) HTTP MCP URL resolves to the SANDBOX's loopback there, not the runner's, so
   * advertising it would hand the in-sandbox harness an unreachable URL. On Daytona/E2B the
   * channel is skipped and gateway tools are delivered through the file relay instead (the relay
   * loop already polls the sandbox filesystem — see `engines/sandbox_agent.ts`). See the
   * Daytona guard in `buildSessionMcpServers`.
   */
  isDaytona: boolean;
  isE2b?: boolean;
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
 *     only public metadata; execution relays server-side. RESTORED — but advertised over a
 *     loopback (`127.0.0.1`) URL, so it is LOCAL-ONLY. On Daytona the harness runs IN the sandbox,
 *     where `127.0.0.1` is the sandbox's loopback, not the runner's, so the channel is SKIPPED and
 *     the tools reach the harness through the file relay instead (the relay loop already works on
 *     Daytona; gateway-tool-mcp open question 3). This honors the #4844 decision: HTTP advertisement
 *     for local, file relay for Daytona.
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
  isE2b = false,
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

  // Layer 1: INTERNAL gateway-tool channel (do not merge with the user gate below). LOCAL ONLY:
  // its advertised URL is a runner loopback (`127.0.0.1`), unreachable from a remote Daytona
  // sandbox where the harness runs. On Daytona, skip the loopback HTTP advertisement and let the
  // file relay deliver the tools (the relay loop polls the sandbox filesystem; see the Daytona
  // tool relay in `engines/sandbox_agent.ts`).
  const isRemote = isDaytona || isE2b;
  const internal = isRemote
    ? { servers: [], close: async () => {} }
    : await buildToolMcpServers(toolSpecs, relayDir, log);
  if (isRemote && toolSpecs.length > 0) {
    log(
      `${isDaytona ? "daytona" : "e2b"}: ${toolSpecs.length} gateway tool(s) delivered via the file relay, not a ` +
        `loopback MCP URL (unreachable from the sandbox)`,
    );
  }
  // Layer 2: USER MCP capability (stdio disabled, http delivered; do not merge with Layer 1).
  // A user http MCP is a remote url the harness dials directly, so it is delivered on Daytona too.
  const user = toAcpMcpServers(userMcpServers, log);

  return {
    servers: [...internal.servers, ...user],
    close: internal.close,
  };
}

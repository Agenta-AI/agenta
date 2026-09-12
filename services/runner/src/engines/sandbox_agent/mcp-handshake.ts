/**
 * Preflight the MCP `initialize` handshake for every user/gateway MCP server on a run.
 *
 * WHY A RUNNER-SIDE PROBE RATHER THAN READING THE HARNESS. The three harnesses report a failed
 * MCP connection three incompatible ways, and one of them does not report it at all. The Claude
 * ACP adapter emits no MCP status frame of any kind, so a server whose handshake fails is
 * indistinguishable from a server that was never configured: the turn completes, the transcript
 * is empty, and the only trace is an HTTP status nobody sees. Codex emits a synthetic failed
 * `mcp_startup.*` tool call, which the runner suppresses as transcript noise. Pi performs its own
 * handshake inside the extension. Probing once, here, is the only way the same failure becomes
 * the same notice on all three.
 *
 * WHAT THIS PROBE DOES NOT PROVE. It runs from the runner's network vantage, which is the
 * sandbox's only on a local run. On a remote sandbox the harness dials the same URL from
 * somewhere else, so a `connected` outcome here is evidence and not a guarantee. The reverse —
 * a refusal the gateway itself returns, which is the case this exists for — holds either way.
 *
 * The probe runs only when the run actually carries MCP servers, so the common case costs
 * nothing.
 */

/** Why a server's handshake did not succeed. Stable string codes, never display strings. */
export type McpHandshakeReasonCode =
  /** The request never got an answer: DNS, TLS, connection refused, or the probe timeout. */
  | "handshake_unreachable"
  /** The server answered the handshake with a non-2xx status. */
  | "handshake_http_error"
  /** The server answered 2xx with a JSON-RPC error instead of an `initialize` result. */
  | "handshake_rejected"
  /** The server answered 2xx with a body that is not a readable JSON-RPC response. */
  | "handshake_invalid_response"
  /** The harness itself reported the server as failed at startup. */
  | "harness_startup_failed";

export interface McpHandshakeFailure {
  serverName: string;
  reasonCode: McpHandshakeReasonCode;
  /** The handshake's HTTP status, when the server answered at all. */
  status?: number;
  /** The user-facing sentence, built by `mcpHandshakeFailureMessage`. */
  message: string;
}

interface ProbeInput {
  name: string;
  connection: {
    type: "http";
    url: string;
    headers?: Record<string, string>;
    credentials?: Array<{
      binding: { kind: "header"; name: string };
      value: string;
      usage: "opaque_http";
    }>;
  };
}

type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

/** The protocol version the probe negotiates. Matches the Pi extension's client. */
const MCP_PROTOCOL_VERSION = "2026-07-28";

/** How long one server's handshake may take before it counts as unreachable. */
export const MCP_HANDSHAKE_PROBE_TIMEOUT_MS = 10_000;

/**
 * The one sentence a failed server shows the operator.
 *
 * `<code>` is the HTTP status when the server answered and the reason code when it did not, so
 * the sentence always names something the operator can look up.
 */
export function mcpHandshakeFailureMessage(
  serverName: string,
  reasonCode: McpHandshakeReasonCode,
  status?: number,
): string {
  return `MCP server ${serverName} failed to connect: ${status ?? reasonCode}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read a Streamable HTTP MCP answer, which may arrive as plain JSON or as a single SSE event.
 * Mirrors `readJsonResponse` in `extensions/pi-mcp.ts`; kept separate because that module is
 * bundled into the Pi extension and must not import runner internals.
 */
function readJsonRpc(raw: string): Record<string, unknown> | undefined {
  const text = raw.trim();
  // Any `data:` line means SSE, not just a first one: a conforming event may lead with `event:`
  // or an id, and reading only the first line would call a healthy server unreadable.
  const dataLines = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  const json = dataLines.length > 0 ? dataLines.join("\n") : text;
  try {
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function handshakeHeaders(server: ProbeInput): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    ...(server.connection.headers ?? {}),
  };
  for (const credential of server.connection.credentials ?? []) {
    if (credential.binding.kind === "header" && credential.value) {
      headers[credential.binding.name] = credential.value;
    }
  }
  return headers;
}

/**
 * Probe one server. Never throws: every outcome is either `undefined` (connected) or a failure
 * record, because a probe that threw would turn a non-fatal notice back into a dead run.
 */
export async function probeMcpServerHandshake(
  server: ProbeInput,
  options: {
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<McpHandshakeFailure | undefined> {
  const fetchImpl =
    options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = options.timeoutMs ?? MCP_HANDSHAKE_PROBE_TIMEOUT_MS;
  const controller = new AbortController();
  const abortOuter = (): void => controller.abort();
  options.signal?.addEventListener("abort", abortOuter, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const fail = (
    reasonCode: McpHandshakeReasonCode,
    status?: number,
  ): McpHandshakeFailure => ({
    serverName: server.name,
    reasonCode,
    ...(status !== undefined ? { status } : {}),
    message: mcpHandshakeFailureMessage(server.name, reasonCode, status),
  });

  try {
    const response = await fetchImpl(server.connection.url, {
      method: "POST",
      headers: handshakeHeaders(server),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "agenta-runner", version: "1" },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return fail("handshake_http_error", response.status);
    const payload = readJsonRpc(await response.text());
    if (!payload) return fail("handshake_invalid_response", response.status);
    if (payload.error !== undefined) {
      return fail("handshake_rejected", response.status);
    }
    // Release the session the handshake opened, so a probe on every cold turn does not
    // accumulate sessions on a well-behaved server. Best effort: a server that does not
    // implement session deletion is not a failure.
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) {
      try {
        await fetchImpl(server.connection.url, {
          method: "DELETE",
          headers: {
            ...handshakeHeaders(server),
            "mcp-session-id": sessionId,
          },
          signal: controller.signal,
        });
      } catch {
        // Deliberately ignored: the handshake already answered the question this probe asks.
      }
    }
    return undefined;
  } catch {
    return fail("handshake_unreachable");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortOuter);
  }
}

/**
 * Probe every server on the run, concurrently, and log each failure at warn with the server name
 * and the status. Returns the failures in the order the servers were declared.
 */
export async function probeMcpServerHandshakes(
  servers: ProbeInput[] | undefined,
  options: {
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
    timeoutMs?: number;
    log?: (message: string) => void;
  } = {},
): Promise<McpHandshakeFailure[]> {
  if (!servers?.length) return [];
  const log = options.log ?? ((): void => {});
  const outcomes = await Promise.all(
    servers.map((server) =>
      probeMcpServerHandshake(server, {
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.timeoutMs !== undefined
          ? { timeoutMs: options.timeoutMs }
          : {}),
      }),
    ),
  );
  const failures = outcomes.filter(
    (outcome): outcome is McpHandshakeFailure => outcome !== undefined,
  );
  for (const failure of failures) {
    log(
      `[mcp] warn: server '${failure.serverName}' failed its handshake: ` +
        `status=${failure.status ?? "none"} reason=${failure.reasonCode}`,
    );
  }
  return failures;
}

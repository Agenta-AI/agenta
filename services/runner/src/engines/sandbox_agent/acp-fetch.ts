import { Agent, fetch as undiciFetch } from "undici";

/**
 * HITL parks the ACP HTTP connection open for human-timescale delays: when a tool call needs
 * approval, the runner holds the in-flight `prompt` request while it waits for the human to
 * click Approve/Deny, then resumes the same parked turn. Node's global `fetch` (undici) ships
 * a DEFAULT `headersTimeout` (~5 min) and `bodyTimeout`; once it fires undici calls
 * `failReadable()` and the ACP stream dies with `UND_ERR_HEADERS_TIMEOUT`, killing both the
 * parked turn and the resume turn. A plain chat completes in seconds so it never trips this.
 *
 * The fix is to drive the ACP HTTP client through an undici dispatcher whose timeouts are
 * disabled (0) or set to a long park window, instead of the default. We scope it to the ACP
 * fetch the `sandbox-agent` SDK uses rather than touching the global dispatcher, so unrelated
 * HTTP keeps its safe defaults.
 */

/** Disabled by default (0 = no timeout). Override with a millisecond value if a bound is wanted. */
function envTimeoutMs(name: string): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Build the long-timeout undici dispatcher used for ACP HTTP. `headersTimeout` is the one that
 * reaps a parked turn (no response headers arrive while the human deliberates); `bodyTimeout`
 * guards the streamed body. Both default to disabled so a park held for any human-timescale
 * delay is never reaped. `keepAliveTimeout`/`keepAliveMaxTimeout` are raised so the connection
 * is not pooled-closed mid-park either.
 */
export function createAcpDispatcher(): Agent {
  const headersTimeout = envTimeoutMs("SANDBOX_AGENT_ACP_HEADERS_TIMEOUT_MS");
  const bodyTimeout = envTimeoutMs("SANDBOX_AGENT_ACP_BODY_TIMEOUT_MS");
  return new Agent({
    headersTimeout,
    bodyTimeout,
    keepAliveTimeout: 600_000,
    keepAliveMaxTimeout: 600_000,
  });
}

/**
 * A `fetch` for the ACP HTTP client backed by {@link createAcpDispatcher}. We use undici's own
 * `fetch` so the `dispatcher` option is honored regardless of how the global dispatcher is set.
 * The `sandbox-agent` SDK accepts a custom `fetch`; we hand it this one on every path.
 */
export function createAcpFetch(dispatcher: Agent = createAcpDispatcher()): typeof fetch {
  return ((input: any, init?: any) =>
    undiciFetch(input, { ...init, dispatcher })) as unknown as typeof fetch;
}

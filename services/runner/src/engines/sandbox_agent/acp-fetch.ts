import { Agent, fetch as undiciFetch } from "undici";

/**
 * HITL pauses keep the ACP HTTP connection open for human-timescale delays: when a tool call needs
 * approval, the runner holds the in-flight `prompt` request while it waits for the human to
 * click Approve/Deny, then resumes the same paused turn. Node's global `fetch` (undici) ships
 * a DEFAULT `headersTimeout` (~5 min) and `bodyTimeout`; once it fires undici calls
 * `failReadable()` and the ACP stream dies with `UND_ERR_HEADERS_TIMEOUT`, killing both the
 * paused turn and the resume turn. A plain chat completes in seconds so it never trips this.
 *
 * The fix is to drive the ACP HTTP client through an undici dispatcher whose timeouts are wide
 * (wider than the total run deadline in `run-limits.ts`, so a pause is never the one that trips
 * this) or fully disabled (0), instead of undici's short default. We scope it to the ACP fetch the
 * `sandbox-agent` SDK uses rather than touching the global dispatcher, so unrelated HTTP keeps its
 * safe defaults. This is the low-level backstop UNDER the total deadline: the total deadline is
 * what normally ends a wedged run; this only matters if the harness's own connection hangs in a
 * way our abort signal can't reach.
 */

/** `0` disables the timeout outright; otherwise the millisecond value (default or override). */
function envTimeoutMs(name: string, defaultMs: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultMs;
}

/** Wider than the total run deadline default so an ordinary run/pause never trips this first. */
const DEFAULT_ACP_HEADERS_TIMEOUT_MS = 60 * 60_000; // 60 min
const DEFAULT_ACP_BODY_TIMEOUT_MS = 60 * 60_000; // 60 min

/**
 * Build the long-timeout undici dispatcher used for ACP HTTP. `headersTimeout` is the one that
 * reaps a paused turn (no response headers arrive while the human deliberates); `bodyTimeout`
 * guards the streamed body. Both default wide (not disabled) so they still backstop a truly
 * stuck connection, without reaping a human-timescale pause. `keepAliveTimeout`/
 * `keepAliveMaxTimeout` are raised so the connection is not pooled-closed mid-pause either.
 */
export function createAcpDispatcher(): Agent {
  const headersTimeout = envTimeoutMs(
    "SANDBOX_AGENT_ACP_HEADERS_TIMEOUT_MS",
    DEFAULT_ACP_HEADERS_TIMEOUT_MS,
  );
  const bodyTimeout = envTimeoutMs(
    "SANDBOX_AGENT_ACP_BODY_TIMEOUT_MS",
    DEFAULT_ACP_BODY_TIMEOUT_MS,
  );
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
export function createAcpFetch(
  dispatcher: Agent = createAcpDispatcher(),
): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    undiciFetch(
      input as unknown as Parameters<typeof undiciFetch>[0],
      { ...init, dispatcher } as unknown as Parameters<typeof undiciFetch>[1],
    )) as unknown as typeof fetch;
}

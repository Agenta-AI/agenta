/**
 * Runner-side credential refresh.
 *
 * The runner authenticates session calls AS the invoke caller, using the ephemeral Secret
 * token it received (≈15-min TTL). A session-owned turn can outlive that, so the watchdog
 * periodically re-checks to mint a fresh-expiry token: `/access/permissions/check` always
 * re-mints a Secret and returns it under `credentials`, so it doubles as a refresh.
 */

function log(msg: string): void {
  process.stderr.write(`[sessions/auth] ${msg}\n`);
}

/**
 * Exchange a still-valid credential for a fresh one via `/access/permissions/check`.
 * Returns the new `Authorization` value, or null on failure (caller keeps the old one).
 */
export async function refreshCredential(
  apiBase: string,
  authorization: string,
): Promise<string | null> {
  try {
    const url = `${apiBase}/access/permissions/check?action=run_service&resource_type=service`;
    const res = await fetch(url, { headers: { authorization } });
    if (!res.ok) {
      log(`refresh HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { credentials?: string };
    return body.credentials ?? null;
  } catch (err) {
    log(
      `refresh failed: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
    return null;
  }
}

export const DEFAULT_PLATFORM_CREDENTIAL_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export interface PlatformCredentialLease {
  credential: () => string;
  release: () => void;
}

/**
 * Keep one Agenta platform credential fresh for the lifetime of a runner-owned operation.
 *
 * The lease is deliberately target-agnostic: callers create it only after classifying the
 * destination as Agenta ingest. External collector credentials must never enter this exchange.
 * Refresh is proactive, bounded to one in-flight request, and fail-open: a failed refresh keeps
 * the last credential so tracing or session cleanup never changes agent-result semantics.
 */
export function startPlatformCredentialLease(
  baseUrl: string,
  authorization: string,
  options: {
    intervalMs?: number;
    refresh?: typeof refreshCredential;
  } = {},
): PlatformCredentialLease {
  let credential = authorization;
  let released = false;
  let refreshInFlight = false;
  const refresh = options.refresh ?? refreshCredential;
  const intervalMs =
    options.intervalMs ?? DEFAULT_PLATFORM_CREDENTIAL_REFRESH_INTERVAL_MS;

  if (!credential) {
    return { credential: () => credential, release: () => {} };
  }

  const interval = setInterval(() => {
    if (released || refreshInFlight) return;
    refreshInFlight = true;
    void refresh(baseUrl, credential)
      .then((fresh) => {
        if (!released && fresh) credential = fresh;
      })
      .catch((err) => {
        log(
          `refresh failed: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
        );
      })
      .finally(() => {
        refreshInFlight = false;
      });
  }, intervalMs);
  interval.unref?.();

  return {
    credential: () => credential,
    release: () => {
      released = true;
      clearInterval(interval);
    },
  };
}

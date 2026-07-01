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
    log(`refresh failed: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`);
    return null;
  }
}

/**
 * Read side of the session record log: fetch a session's durable records so the runner can
 * reconstruct prior conversation server-side (see `reconstruct.ts`). Mirrors `persist.ts`'s
 * ingest client — same apiBase + run-credential auth, project scope resolved server-side.
 */

import { apiBase } from "../apiBase.ts";
import type { SessionRecordRow } from "./reconstruct.ts";

function log(msg: string): void {
  process.stderr.write(`[sessions/records-query] ${msg}\n`);
}

/** Bound the reconstruction fetch: it sits on the turn's critical path (the prompt waits on it),
 * so a stalled query must fail fast to the inbound-history fallback rather than hang on Undici's
 * long request-level timeout. Env-overridable for ops tuning. */
function queryTimeoutMs(): number {
  const n = Number(process.env.AGENTA_SESSIONS_RECORDS_QUERY_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5000;
}

/**
 * Fetch a session's durable record log, ordered for reconstruction (the endpoint returns records
 * by ingest time, then per-turn `record_index`). Returns `null` on failure so the caller can fall
 * back to the inbound history rather than run with an empty context.
 */
export async function fetchSessionRecords(
  sessionId: string,
  auth: () => string,
): Promise<SessionRecordRow[] | null> {
  const url = `${apiBase()}/sessions/records/query`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: auth(),
      },
      body: JSON.stringify({ session_id: sessionId }),
      signal: AbortSignal.timeout(queryTimeoutMs()),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { records?: SessionRecordRow[] };
    return Array.isArray(body?.records) ? body.records : [];
  } catch (err) {
    const detail = String(
      err instanceof Error ? err.message : err,
    ).slice(0, 120);
    log(`query FAILED session=${sessionId}: ${detail}`);
    return null;
  }
}

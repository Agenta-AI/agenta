/**
 * Runner-side alive-lock ownership + heartbeat.
 *
 * When a run is session-owned (request carries `sessionId` + `runId`), the runner
 * acquires the `alive` Redis lock and self-refreshes it for the run's lifetime so the
 * coordination plane sees the run as live independent of any client connection.
 *
 * Port of the PoC sidecar's `run-lock.js` `startRefresher` pattern, adapted to use
 * the HTTP API instead of direct Redis (the API is the single Redis writer).
 *
 * Key contract constants mirror `sessions/contract.ts` (same file); do not duplicate them.
 */

import { HEARTBEAT_INTERVAL_SECONDS } from "./contract.ts";

const REFRESH_INTERVAL_MS = HEARTBEAT_INTERVAL_SECONDS * 1000;

/** Where the Agenta API lives. Required for admin heartbeat calls. */
function apiBase(): string {
  return process.env.AGENTA_API_URL ?? "http://localhost:8000";
}

/** Admin auth header for internal runner → API calls. */
function adminAuth(): string {
  return process.env.AGENTA_AUTH_KEY
    ? `Access ${process.env.AGENTA_AUTH_KEY}`
    : (process.env.AGENTA_ADMIN_AUTH ?? "");
}

function log(msg: string): void {
  process.stderr.write(`[sessions/alive] ${msg}\n`);
}

/**
 * Send one heartbeat to keep the `alive` lock and the `session_streams` row live.
 * The heartbeat also carries the `replica_id` (the `run_id`) so the API can verify
 * the owner and refresh the `owner` Redis key.
 */
async function sendHeartbeat(
  sessionId: string,
  runId: string,
  projectId: string,
): Promise<void> {
  try {
    const url = `${apiBase()}/admin/sessions/streams/heartbeat`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: adminAuth(),
      },
      body: JSON.stringify({
        project_id: projectId,
        session_id: sessionId,
        replica_id: runId,
        sandbox_live: true,
      }),
    });
    if (!res.ok) {
      log(`heartbeat HTTP ${res.status} session=${sessionId} run=${runId}`);
    }
  } catch (err) {
    log(
      `heartbeat failed session=${sessionId} run=${runId}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
  }
}

/**
 * Start the alive-lock watchdog for a session-owned run.
 *
 * The lock was acquired by the API (in `_start_run`) before the run started — the
 * runner inherits ownership via `runId`. This watchdog heartbeats the API on the
 * contract interval, keeping the lock's TTL refreshed and the stream row `running`.
 *
 * Returns a `release()` function the caller MUST await in the run's `finally` so the
 * heartbeat stops and the session row is marked `ended`.
 */
export function startAliveWatchdog(
  sessionId: string,
  runId: string,
  projectId: string,
): { release: () => Promise<void> } {
  // Send an immediate heartbeat to confirm the run started, then schedule regular ones.
  void sendHeartbeat(sessionId, runId, projectId);

  const interval = setInterval(() => {
    void sendHeartbeat(sessionId, runId, projectId);
  }, REFRESH_INTERVAL_MS);

  // Allow the Node process to exit even if the interval is still running.
  if ((interval as unknown as { unref?: () => void }).unref) {
    (interval as unknown as { unref: () => void }).unref();
  }

  return {
    async release() {
      clearInterval(interval);
      // Mark the stream row ended.
      try {
        const url = `${apiBase()}/admin/sessions/streams/heartbeat`;
        await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: adminAuth(),
          },
          body: JSON.stringify({
            project_id: projectId,
            session_id: sessionId,
            replica_id: runId,
            sandbox_live: false,
            status: { code: "ended" },
          }),
        });
      } catch {
        // Best-effort: the orphan sweep will catch a missed ended transition.
      }
    },
  };
}

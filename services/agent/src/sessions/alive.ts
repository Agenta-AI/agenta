/**
 * Runner-side alive-lock ownership + heartbeat.
 *
 * When a run is session-owned (request carries `sessionId` + `turnId`), the runner
 * acquires the `alive` Redis lock and self-refreshes it for the turn's lifetime so the
 * coordination plane sees the session as live independent of any client connection.
 *
 * Two distinct ids ride the heartbeat (multi-container correctness):
 *  - `replica_id` — this runner CONTAINER's stable id (minted once per process). Drives the
 *    `owner:session:<id>` affinity key so control signals route to the box running the turn.
 *  - `turn_id`    — the current TURN's id (one per execution). Proves alive-lock ownership.
 *
 * Port of the PoC sidecar's `run-lock.js` `startRefresher` pattern, adapted to use
 * the HTTP API instead of direct Redis (the API is the single Redis writer).
 *
 * Key contract constants mirror `sessions/contract.ts`; do not duplicate them.
 */

import { randomUUID } from "node:crypto";

import { HEARTBEAT_INTERVAL_SECONDS } from "./contract.ts";

const REFRESH_INTERVAL_MS = HEARTBEAT_INTERVAL_SECONDS * 1000;

/**
 * This runner container's stable id, minted once per process. An orchestrator can inject a
 * meaningful id (pod/container name) via `AGENTA_AGENT_RUNNER_REPLICA_ID`; otherwise a random
 * uuid per process. Distinct from any turn id — many turns share one replica_id, and with 2+
 * containers each holds its own, so affinity routing can find the box running a session.
 */
const REPLICA_ID =
  process.env.AGENTA_AGENT_RUNNER_REPLICA_ID?.trim() || randomUUID();

/** Where the Agenta API lives. Required for admin heartbeat calls. */
function apiBase(): string {
  return process.env.AGENTA_API_URL ?? "http://localhost:8000";
}

/** Admin auth header for internal runner → API calls. */
function adminAuth(): string {
  return process.env.AGENTA_AUTH_KEY
    ? `Access ${process.env.AGENTA_AUTH_KEY}`
    : process.env.AGENTA_ADMIN_AUTH ?? "";
}

function log(msg: string): void {
  process.stderr.write(`[sessions/alive] ${msg}\n`);
}

/**
 * Send one heartbeat to keep the `alive` lock and the `session_streams` row live. Carries the
 * container `replica_id` (refreshes `owner` affinity) and the `turn_id` (proves alive ownership).
 */
async function sendHeartbeat(
  sessionId: string,
  turnId: string,
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
        replica_id: REPLICA_ID,
        turn_id: turnId,
        is_running: true,
      }),
    });
    if (!res.ok) {
      log(`heartbeat HTTP ${res.status} session=${sessionId} turn=${turnId}`);
    }
  } catch (err) {
    log(
      `heartbeat failed session=${sessionId} turn=${turnId}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
  }
}

/**
 * Start the alive-lock watchdog for a session-owned turn.
 *
 * The lock was acquired by the API (in `_start_turn`) before the turn started — the runner
 * inherits ownership via `turnId`. This watchdog heartbeats the API on the contract interval,
 * keeping the lock's TTL refreshed and the stream row `running`.
 *
 * Returns a `release()` function the caller MUST await in the run's `finally` so the
 * heartbeat stops and the session row is marked `ended`.
 */
export function startAliveWatchdog(
  sessionId: string,
  turnId: string,
  projectId: string,
): { release: () => Promise<void> } {
  // Send an immediate heartbeat to confirm the turn started, then schedule regular ones.
  void sendHeartbeat(sessionId, turnId, projectId);

  const interval = setInterval(() => {
    void sendHeartbeat(sessionId, turnId, projectId);
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
            replica_id: REPLICA_ID,
            turn_id: turnId,
            is_running: false,
            status: { code: "ended" },
          }),
        });
      } catch {
        // Best-effort: the orphan sweep will catch a missed ended transition.
      }
    },
  };
}

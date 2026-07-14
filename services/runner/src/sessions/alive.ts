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
 * Uses the HTTP API instead of direct Redis (the API is the single Redis writer).
 *
 * Key contract constants mirror `sessions/contract.ts`; do not duplicate them.
 */

import { apiBase } from "../apiBase.ts";
import { randomUUID } from "node:crypto";

import { HEARTBEAT_INTERVAL_SECONDS } from "./contract.ts";

const REFRESH_INTERVAL_MS = HEARTBEAT_INTERVAL_SECONDS * 1000;

/**
 * This runner container's stable id, minted once per process. An orchestrator can inject a
 * meaningful id (pod/container name) via `AGENTA_RUNNER_REPLICA_ID`; otherwise a random
 * uuid per process. Distinct from any turn id — many turns share one replica_id, and with 2+
 * containers each holds its own, so affinity routing can find the box running a session.
 */
export const REPLICA_ID =
  process.env.AGENTA_RUNNER_REPLICA_ID?.trim() || randomUUID();

import { refreshCredential } from "./auth.ts";


/** Refresh the run credential every Nth heartbeat (well inside the ~15-min token TTL). */
const REFRESH_EVERY_N_HEARTBEATS = Math.max(
  1,
  Math.floor((5 * 60) / HEARTBEAT_INTERVAL_SECONDS),
);

function log(msg: string): void {
  process.stderr.write(`[sessions/alive] ${msg}\n`);
}

/**
 * Send one heartbeat to keep the `alive` lock and the `session_streams` row live. Carries the
 * container `replica_id` (refreshes `owner` affinity) and the `turn_id` (proves alive ownership).
 * Authenticates AS the invoke caller (the run credential) — project scope is resolved server-side
 * from that credential, so no `project_id` rides the request.
 */
async function sendHeartbeat(
  sessionId: string,
  turnId: string,
  authorization: string,
  isRunning = true,
): Promise<void> {
  try {
    const url = `${apiBase()}/sessions/streams/heartbeat`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization,
      },
      body: JSON.stringify({
        session_id: sessionId,
        replica_id: REPLICA_ID,
        turn_id: turnId,
        is_running: isRunning,
      }),
    });
    if (!res.ok) {
      log(`heartbeat HTTP ${res.status} session=${sessionId} turn=${turnId}`);
    } else {
      log(
        `heartbeat OK session=${sessionId} turn=${turnId} running=${isRunning}`,
      );
    }
  } catch (err) {
    log(
      `heartbeat failed session=${sessionId} turn=${turnId}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
  }
}

/**
 * Claim (or read) this session's owner affinity before serving it, and return the ACTUAL owner
 * replica id (single-runner-local guard). Sends one heartbeat with no `turn_id` — the API
 * claims the `owner` key without stealing from a live different owner and reports the winner in
 * `replica_id`, but establishes no alive/running lock (that needs a turn_id). Returns
 * `{replicaId, ownerReplicaId}`; `ownerReplicaId` is undefined only when the call itself fails
 * (network/HTTP error) — a fail-open, matching "never worse than today" (no silent WRONG-host
 * start, but a transient API blip does not block a legitimate owner).
 */
export async function claimSessionOwnership(
  sessionId: string,
  authorization: string,
): Promise<{ replicaId: string; ownerReplicaId: string | undefined }> {
  try {
    const url = `${apiBase()}/sessions/streams/heartbeat`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization },
      body: JSON.stringify({
        session_id: sessionId,
        replica_id: REPLICA_ID,
        is_running: true,
      }),
    });
    if (!res.ok) {
      log(`ownership claim HTTP ${res.status} session=${sessionId}`);
      return { replicaId: REPLICA_ID, ownerReplicaId: undefined };
    }
    const body = (await res.json()) as { replica_id?: unknown };
    const owner =
      typeof body.replica_id === "string" ? body.replica_id : undefined;
    return { replicaId: REPLICA_ID, ownerReplicaId: owner };
  } catch (err) {
    log(
      `ownership claim failed session=${sessionId}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
    return { replicaId: REPLICA_ID, ownerReplicaId: undefined };
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
  authorization: string,
): { release: () => Promise<void>; credential: () => string } {
  // The run credential is an ephemeral Secret (~15-min TTL). Hold it mutably and refresh it
  // every Nth heartbeat (re-/check mints a fresh-expiry token) so a long turn never 401s.
  let credential = authorization;
  let beats = 0;

  void sendHeartbeat(sessionId, turnId, credential);

  const interval = setInterval(() => {
    void (async () => {
      beats += 1;
      if (beats % REFRESH_EVERY_N_HEARTBEATS === 0) {
        const fresh = await refreshCredential(apiBase(), credential);
        if (fresh) credential = fresh;
      }
      void sendHeartbeat(sessionId, turnId, credential);
    })();
  }, REFRESH_INTERVAL_MS);

  // Allow the Node process to exit even if the interval is still running.
  if ((interval as unknown as { unref?: () => void }).unref) {
    (interval as unknown as { unref: () => void }).unref();
  }

  return {
    async release() {
      clearInterval(interval);
      // Mark the stream row ended (best-effort; the orphan sweep catches a miss).
      await sendHeartbeat(sessionId, turnId, credential, false);
    },
    credential: () => credential,
  };
}

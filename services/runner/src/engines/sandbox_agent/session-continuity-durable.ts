/**
 * Durable mirror of `session-continuity.ts`'s in-memory store, so continuity survives a
 * runner restart. Reads the `session_states` row back into the in-memory store at session
 * setup, and writes the just-completed turn's record forward after
 * `SessionContinuityStore.record()`. Any failure (row absent, API unreachable) is best-effort:
 * it degrades to cold text replay, never a hard error.
 *
 * The API row's `data` is replaced wholesale, not per-key-patched server-side, so
 * `syncHarnessSessionDurable` does a read-modify-write: GET the current row, splice in this
 * harness's fresh entry, PUT the whole `data` object back.
 */
import { apiBase } from "../../apiBase.ts";
import type { SessionContinuityStore } from "./session-continuity.ts";

function defaultLog(msg: string): void {
  process.stderr.write(`[session-continuity/durable] ${msg}\n`);
}

interface WireHarnessSessionRecord {
  agent_session_id?: string;
  turn_index?: number;
}

interface SessionStateDataWire {
  latest_agent_session_id?: string;
  harness_sessions?: Record<string, WireHarnessSessionRecord>;
  latest_turn_index?: number;
}

interface SessionStateWire {
  data?: SessionStateDataWire | null;
}

export interface DurableContinuityDeps {
  apiBase?: string;
  authorization: string;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

/**
 * Read the durable row back into `store` for ONE harness, so a resume after a runner restart
 * (the in-memory map is empty) still sees a prior turn's eligibility exactly as if the process
 * had stayed up. Best-effort: any failure (row absent, API unreachable, storage disabled)
 * leaves `store` untouched — the caller then behaves exactly as it does today with an empty
 * store (cold replay), never throwing for a missing durable record.
 */
export async function hydrateHarnessSessionFromDurable(
  sessionId: string,
  harness: string,
  store: SessionContinuityStore,
  deps: DurableContinuityDeps,
): Promise<void> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const base = deps.apiBase ?? apiBase();
  try {
    const res = await doFetch(
      `${base}/sessions/states/?session_id=${encodeURIComponent(sessionId)}`,
      {
        method: "GET",
        headers: { authorization: deps.authorization },
      },
    );
    if (!res.ok) {
      log(`hydrate HTTP ${res.status} session=${sessionId} — starting cold`);
      return;
    }
    const body = (await res.json()) as {
      session_state?: SessionStateWire | null;
    };
    const data = body.session_state?.data;

    // Restore the cross-harness latest-turn counter FIRST, independent of whether THIS harness
    // has a record: it may exceed this harness's own turn (another harness ran the later turn),
    // and understating it would make `isHarnessLoadEligible` wrongly pass a stale harness after
    // a restart.
    if (data?.latest_turn_index !== undefined) {
      store.restoreLatestTurn(sessionId, data.latest_turn_index);
    }

    const record = data?.harness_sessions?.[harness];
    if (!record?.agent_session_id || record.turn_index === undefined) {
      return;
    }
    // Only seed the store when it has NOTHING for this (session, harness) yet — a live
    // in-process record (this restart never happened) is always fresher than the durable
    // mirror and must not be clobbered by a stale read.
    if (store.get(sessionId, harness)) return;
    store.record(
      sessionId,
      harness,
      record.agent_session_id,
      record.turn_index,
    );
    log(
      `hydrated session=${sessionId} harness=${harness} turn=${record.turn_index}`,
    );
  } catch (err) {
    log(
      `hydrate failed session=${sessionId} harness=${harness}: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`,
    );
  }
}

/**
 * Write this harness's just-completed-turn record forward to the durable row (read-modify-write
 * on `harness_sessions`, full-PUT semantics — see module doc). Call AFTER
 * `SessionContinuityStore.record()` so the value persisted matches the in-memory one exactly.
 * Best-effort and fire-and-forget from the caller's perspective: a failure here only means the
 * NEXT restart cold-replays this harness turn, never a broken current turn.
 */
export async function syncHarnessSessionDurable(
  sessionId: string,
  harness: string,
  agentSessionId: string,
  turnIndex: number,
  deps: DurableContinuityDeps,
): Promise<void> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const base = deps.apiBase ?? apiBase();
  try {
    const getRes = await doFetch(
      `${base}/sessions/states/?session_id=${encodeURIComponent(sessionId)}`,
      { method: "GET", headers: { authorization: deps.authorization } },
    );
    const existingData: SessionStateDataWire = getRes.ok
      ? (((await getRes.json()) as { session_state?: SessionStateWire | null })
          .session_state?.data ?? {})
      : {};
    const existing = existingData.harness_sessions ?? {};

    const merged: Record<string, WireHarnessSessionRecord> = {
      ...existing,
      [harness]: {
        agent_session_id: agentSessionId,
        turn_index: turnIndex,
      },
    };

    // Never regress the cross-harness counter: another harness may already have persisted a
    // higher latest turn. Take the max so the durable `latest_turn_index` is monotonic.
    const latestTurnIndex = Math.max(
      existingData.latest_turn_index ?? -1,
      turnIndex,
    );

    const res = await doFetch(
      `${base}/sessions/states/?session_id=${encodeURIComponent(sessionId)}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: deps.authorization,
        },
        body: JSON.stringify({
          data: {
            ...existingData,
            latest_agent_session_id: agentSessionId,
            latest_turn_index: latestTurnIndex,
            harness_sessions: merged,
          },
        }),
      },
    );
    log(
      `sync ${res.ok ? "OK" : `HTTP ${res.status}`} session=${sessionId} harness=${harness} turn=${turnIndex}`,
    );
  } catch (err) {
    log(
      `sync failed session=${sessionId} harness=${harness}: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`,
    );
  }
}

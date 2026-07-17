/**
 * Durable mirror of `session-continuity.ts`'s in-memory store, so continuity survives a
 * runner restart. Reads the session's LATEST `session_turns` row back into the in-memory
 * store at session setup, and appends a fresh turn row after
 * `SessionContinuityStore.record()`.
 *
 * `appendSessionTurn` is a plain INSERT (`POST /sessions/turns/`) — no read-modify-write, no
 * race. It replaces the old `syncHarnessSessionDurable`, which GET-then-PUT the whole
 * `session_states.data` blob.
 */
import { apiBase } from "../../apiBase.ts";
import type { SessionContinuityStore } from "./session-continuity.ts";

function defaultLog(msg: string): void {
  process.stderr.write(`[session-continuity/durable] ${msg}\n`);
}

/** A platform entity reference (the API `Reference` shape). */
export type TurnReference = { id?: string; slug?: string; version?: string };

export interface WireSessionTurn {
  harness_kind?: string;
  agent_session_id?: string;
  sandbox_id?: string;
  turn_index?: number;
}

export interface DurableContinuityDeps {
  apiBase?: string;
  authorization: string;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

/** The fields the turn-append write carries, beyond the (session, harness, turnIndex) key. */
export interface SessionTurnAppend {
  streamId: string;
  agentSessionId?: string;
  sandboxId?: string;
  references?: TurnReference[];
  traceId?: string;
  spanId?: string;
  startTime?: string;
  endTime?: string;
}

/**
 * Fetch the LATEST turn for a session, optionally scoped to one harness. The `/latest` endpoint
 * orders by `turn_index` (not insertion `id`), so a late/out-of-order write can't win the resume
 * read. Returns undefined on any failure (row absent, API unreachable) — every caller treats this
 * as best-effort, degrading to cold replay.
 */
export async function fetchLatestSessionTurn(
  sessionId: string,
  harness: string | undefined,
  deps: DurableContinuityDeps,
): Promise<WireSessionTurn | undefined> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const base = deps.apiBase ?? apiBase();
  try {
    const res = await doFetch(`${base}/sessions/turns/latest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: deps.authorization,
      },
      body: JSON.stringify({
        session_id: sessionId,
        ...(harness ? { harness_kind: harness } : {}),
      }),
    });
    if (!res.ok) {
      log(
        `latest-turn HTTP ${res.status} session=${sessionId} harness=${harness ?? "-"}`,
      );
      return undefined;
    }
    const body = (await res.json()) as { turn?: WireSessionTurn };
    return body.turn;
  } catch (err) {
    log(
      `latest-turn failed session=${sessionId} harness=${harness ?? "-"}: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`,
    );
    return undefined;
  }
}

/**
 * Read the durable turn log back into `store` for ONE harness, so a resume after a runner
 * restart (the in-memory map is empty) still sees a prior turn's eligibility exactly as if the
 * process had stayed up. Best-effort: any failure (no turns yet, API unreachable) leaves
 * `store` untouched — the caller then behaves exactly as it does today with an empty store
 * (cold replay), never throwing for a missing durable record.
 */
export async function hydrateHarnessSessionFromDurable(
  sessionId: string,
  harness: string,
  store: SessionContinuityStore,
  deps: DurableContinuityDeps,
): Promise<void> {
  const log = deps.log ?? defaultLog;

  // Restore the cross-harness latest-turn counter FIRST, independent of whether THIS harness
  // authored it: another harness may have run the later turn, and understating the counter
  // would make `isHarnessLoadEligible` wrongly pass a stale harness after a restart.
  const latestOverall = await fetchLatestSessionTurn(
    sessionId,
    undefined,
    deps,
  );
  if (latestOverall?.turn_index !== undefined) {
    store.restoreLatestTurn(sessionId, latestOverall.turn_index);
  }

  // Only seed the store when it has NOTHING for this (session, harness) yet — a live
  // in-process record (this restart never happened) is always fresher than the durable
  // mirror and must not be clobbered by a stale read.
  if (store.get(sessionId, harness)) return;

  const latestForHarness =
    latestOverall?.harness_kind === harness
      ? latestOverall
      : await fetchLatestSessionTurn(sessionId, harness, deps);
  if (
    !latestForHarness?.agent_session_id ||
    latestForHarness.turn_index === undefined
  ) {
    return;
  }
  store.record(
    sessionId,
    harness,
    latestForHarness.agent_session_id,
    latestForHarness.turn_index,
  );
  log(
    `hydrated session=${sessionId} harness=${harness} turn=${latestForHarness.turn_index}`,
  );
}

/**
 * Append this harness's just-completed-turn as a new `session_turns` row (a plain INSERT —
 * no read, no merge, no race). Call AFTER `SessionContinuityStore.record()` so the persisted
 * turn_index matches the in-memory one exactly. Best-effort and fire-and-forget from the
 * caller's perspective: a failure here only means the NEXT restart cold-replays this harness
 * turn, never a broken current turn.
 */
export async function appendSessionTurn(
  sessionId: string,
  harness: string,
  turnIndex: number,
  turn: SessionTurnAppend,
  deps: DurableContinuityDeps,
): Promise<void> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const base = deps.apiBase ?? apiBase();
  try {
    const res = await doFetch(`${base}/sessions/turns/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: deps.authorization,
      },
      body: JSON.stringify({
        session_id: sessionId,
        stream_id: turn.streamId,
        turn_index: turnIndex,
        harness_kind: harness,
        ...(turn.agentSessionId
          ? { agent_session_id: turn.agentSessionId }
          : {}),
        ...(turn.sandboxId ? { sandbox_id: turn.sandboxId } : {}),
        ...(turn.references?.length ? { references: turn.references } : {}),
        ...(turn.traceId ? { trace_id: turn.traceId } : {}),
        ...(turn.spanId ? { span_id: turn.spanId } : {}),
        ...(turn.startTime ? { start_time: turn.startTime } : {}),
        ...(turn.endTime ? { end_time: turn.endTime } : {}),
      }),
    });
    log(
      `append ${res.ok ? "OK" : `HTTP ${res.status}`} session=${sessionId} harness=${harness} turn=${turnIndex}`,
    );
  } catch (err) {
    log(
      `append failed session=${sessionId} harness=${harness}: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`,
    );
  }
}

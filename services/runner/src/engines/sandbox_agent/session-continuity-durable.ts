/**
 * Durable mirror of `session-continuity.ts`'s in-memory store, so continuity survives a
 * runner restart. Reads the session's LATEST `session_turns` row back into the in-memory
 * store at session setup, inserts a ledger row when a turn starts, and completes that row when
 * the turn finishes.
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
  end_time?: string;
}

interface SessionTurnsQueryResponseWire {
  count?: number;
  turns?: WireSessionTurn[];
}

export interface DurableContinuityDeps {
  apiBase?: string;
  authorization: string;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

/** The fields the turn-start write carries, beyond the (session, harness, turnIndex) key. */
export interface SessionTurnAppend {
  streamId: string;
  agentSessionId?: string;
  sandboxId?: string;
  references?: TurnReference[];
  traceId?: string;
  spanId?: string;
  startTime?: string;
}

export interface SessionTurnCompletion {
  agentSessionId?: string;
  endTime: string;
}

export type CompleteSessionTurnFn = (
  sessionId: string,
  turnIndex: number,
  turn: SessionTurnCompletion,
  deps: DurableContinuityDeps,
) => Promise<void>;

export interface AppendSessionTurnFn {
  (
    sessionId: string,
    harness: string,
    turnIndex: number,
    turn: SessionTurnAppend,
    deps: DurableContinuityDeps,
  ): Promise<void>;
  complete?: CompleteSessionTurnFn;
}

/**
 * Fetch the LATEST turn for a session, optionally scoped to one harness. Ordered by
 * `turn_index DESC, id DESC` via `windowing: {limit: 1, order: "descending"}`. Returns undefined
 * on any failure (row absent, API unreachable) — every caller treats this as best-effort,
 * degrading to cold replay.
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
    const res = await doFetch(`${base}/sessions/turns/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: deps.authorization,
      },
      body: JSON.stringify({
        query: {
          session_id: sessionId,
          ...(harness ? { harness_kind: harness } : {}),
        },
        windowing: { limit: 1, order: "descending" },
      }),
    });
    if (!res.ok) {
      log(
        `latest-turn HTTP ${res.status} session=${sessionId} harness=${harness ?? "-"}`,
      );
      return undefined;
    }
    const body = (await res.json()) as SessionTurnsQueryResponseWire;
    return body.turns?.[0];
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
  // Row existence proves only that a turn started. Native continuation is trustworthy only after
  // `end_time` is set.
  if (
    !latestForHarness?.agent_session_id ||
    latestForHarness.turn_index === undefined ||
    !latestForHarness.end_time
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

/** Complete a started row once; retries leave the first completion unchanged. */
export async function completeSessionTurn(
  sessionId: string,
  turnIndex: number,
  turn: SessionTurnCompletion,
  deps: DurableContinuityDeps,
): Promise<void> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const base = deps.apiBase ?? apiBase();
  try {
    const res = await doFetch(`${base}/sessions/turns/complete`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: deps.authorization,
      },
      body: JSON.stringify({
        session_id: sessionId,
        turn_index: turnIndex,
        ...(turn.agentSessionId
          ? { agent_session_id: turn.agentSessionId }
          : {}),
        end_time: turn.endTime,
      }),
    });
    log(
      `complete ${res.ok ? "OK" : `HTTP ${res.status}`} session=${sessionId} turn=${turnIndex}`,
    );
  } catch (err) {
    log(
      `complete failed session=${sessionId} turn=${turnIndex}: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`,
    );
  }
}

/** Start one ledger row per conversation turn; approval resumes reuse it through the benign 409. */
export const appendSessionTurn: AppendSessionTurnFn = async function appendSessionTurn(
  sessionId,
  harness,
  turnIndex,
  turn,
  deps,
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
      }),
    });
    if (res.status === 409) return;
    log(
      `append ${res.ok ? "OK" : `HTTP ${res.status}`} session=${sessionId} harness=${harness} turn=${turnIndex}`,
    );
  } catch (err) {
    log(
      `append failed session=${sessionId} harness=${harness}: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`,
    );
  }
};

appendSessionTurn.complete = completeSessionTurn;

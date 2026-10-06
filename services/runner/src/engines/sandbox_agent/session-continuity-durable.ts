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
import { fetchControlPlane } from "../../sessions/control-plane-fetch.ts";
import { apiBase } from "../../apiBase.ts";
import type { ReferenceKey } from "../../sessions/interactions.ts";
import type { SessionContinuityStore } from "./session-continuity.ts";

function defaultLog(msg: string): void {
  process.stderr.write(`[session-continuity/durable] ${msg}\n`);
}

/**
 * A platform entity reference (the API `Reference` shape), plus which workflow entity it names.
 * `key` is optional on the type because rows written before it existed carry none.
 */
export type TurnReference = {
  id?: string;
  slug?: string;
  version?: string;
  key?: ReferenceKey;
};

export interface WireSessionTurn {
  turn_id?: string;
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
  /** The turn's own cancel (a user Stop): it ends a ledger write the turn is waiting on. */
  signal?: AbortSignal;
}

/** The fields the turn-start write carries, beyond the (session, harness, turnIndex) key. */
export interface SessionTurnAppend {
  streamId: string;
  turnId?: string;
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

/** A latest-turn read that tells "no row" (`turn` undefined) apart from "could not read". */
export type LatestSessionTurnRead =
  | { ok: true; turn: WireSessionTurn | undefined }
  | { ok: false; error: string };

/**
 * The turn-start write found its `turn_index` already on the ledger (HTTP 409). Only the caller
 * knows whether that is the expected duplicate of an approval resume or another runner's turn.
 */
export class SessionTurnIndexTaken extends Error {
  constructor(
    readonly sessionId: string,
    readonly turnIndex: number,
  ) {
    super(`session ${sessionId} already has a turn at index ${turnIndex}`);
    this.name = "SessionTurnIndexTaken";
  }
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
  const read = await readLatestSessionTurn(sessionId, harness, deps);
  return read.ok ? read.turn : undefined;
}

/** `fetchLatestSessionTurn` for a caller that must fail closed when the log cannot be read. */
export async function readLatestSessionTurn(
  sessionId: string,
  harness: string | undefined,
  deps: DurableContinuityDeps,
): Promise<LatestSessionTurnRead> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const base = deps.apiBase ?? apiBase();
  try {
    const res = await fetchControlPlane(
      (signal) =>
        doFetch(`${base}/sessions/turns/query`, {
          method: "POST",
          signal,
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
        }),
    );
    if (!res.ok) {
      log(
        `latest-turn HTTP ${res.status} session=${sessionId} harness=${harness ?? "-"}`,
      );
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as SessionTurnsQueryResponseWire;
    return { ok: true, turn: body.turns?.[0] };
  } catch (err) {
    const detail = String(err instanceof Error ? err.message : err).slice(
      0,
      160,
    );
    log(
      `latest-turn failed session=${sessionId} harness=${harness ?? "-"}: ${detail}`,
    );
    return { ok: false, error: detail };
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

/**
 * A ledger write is a single attempt the turn awaits, so it gets the control-plane budget and the
 * turn's cancel: an API that accepts the connection and then stalls must not hold the turn, and a
 * Stop must not wait on it. Not retried: a repeated turn-start would answer its own 409.
 */
function postLedgerWrite(
  path: string,
  body: Record<string, unknown>,
  deps: DurableContinuityDeps,
): Promise<Response> {
  const doFetch = deps.fetchImpl ?? fetch;
  const base = deps.apiBase ?? apiBase();
  return fetchControlPlane(
    (signal) =>
      doFetch(`${base}${path}`, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          authorization: deps.authorization,
        },
        body: JSON.stringify(body),
      }),
    { maxAttempts: 1, signal: deps.signal },
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
  try {
    const res = await postLedgerWrite(
      "/sessions/turns/complete",
      {
        session_id: sessionId,
        turn_index: turnIndex,
        ...(turn.agentSessionId
          ? { agent_session_id: turn.agentSessionId }
          : {}),
        end_time: turn.endTime,
      },
      deps,
    );
    log(
      `complete ${res.ok ? "OK" : `HTTP ${res.status}`} session=${sessionId} turn=${turnIndex}`,
    );
  } catch (err) {
    log(
      `complete failed session=${sessionId} turn=${turnIndex}: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`,
    );
  }
}

/**
 * Start one ledger row per conversation turn. A 409 throws `SessionTurnIndexTaken`, unlogged:
 * an approval resume reuses its paused turn's row that way, and the caller tells it apart from
 * another runner's turn. Every other failure is logged and swallowed.
 */
export const appendSessionTurn: AppendSessionTurnFn = async function appendSessionTurn(
  sessionId,
  harness,
  turnIndex,
  turn,
  deps,
): Promise<void> {
  const log = deps.log ?? defaultLog;
  let res: Response;
  try {
    res = await postLedgerWrite(
      "/sessions/turns/",
      {
        session_id: sessionId,
        stream_id: turn.streamId,
        ...(turn.turnId ? { turn_id: turn.turnId } : {}),
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
      },
      deps,
    );
  } catch (err) {
    // A Stop aborts with a frozen marker object, and Node's fetch then rejects with its own failure
    // to attach a stack to it, which names nothing about the Stop.
    const detail = deps.signal?.aborted
      ? "the turn was cancelled"
      : String(err instanceof Error ? err.message : err).slice(0, 160);
    log(`append failed session=${sessionId} harness=${harness}: ${detail}`);
    return;
  }
  if (res.status === 409) throw new SessionTurnIndexTaken(sessionId, turnIndex);
  log(
    `append ${res.ok ? "OK" : `HTTP ${res.status}`} session=${sessionId} harness=${harness} turn=${turnIndex}`,
  );
};

appendSessionTurn.complete = completeSessionTurn;

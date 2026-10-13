/**
 * Producer-driven record persistence.
 *
 * The runner posts every agent event to the API's record-ingest endpoint
 * independently of any client connection. This is the "producer-driven" model:
 * persistence is decoupled from whether anyone is listening to the live stream.
 *
 * Port of the PoC sidecar's `persistChain` / `persistEvent` / `drainPersist` pattern
 * from `server.js`, adapted to POST to the `POST /sessions/records/ingest` endpoint,
 * authenticated AS the invoke caller (the run credential).
 *
 * Design invariants:
 *  - Events for a given session persist in produced order (per-session promise chain).
 *  - The run is never blocked on persistence mid-stream (chain is fire-and-forget).
 *  - The run DOES drain before teardown so the last event is not lost to the race.
 *  - A transient failure (5xx, 429, no answer) is retried with capped backoff for a time
 *    budget that outlasts a database restart. A record that still does not land, or that fails
 *    with a non-transient error, is lost: it is COUNTED (see `takePersistFailures`) and the
 *    session is marked incomplete, so the turn-end drain reports it and no turn rebuilds model
 *    context from a log with a hole in it.
 *  - `record_source` marks who authored the record: "agent" for engine-emitted events,
 *    "user" for the inbound user turn persisted at run start.
 */

import { randomUUID } from "node:crypto";
import { apiBase } from "../apiBase.ts";
import { envInt, envTimerMs } from "../env.ts";
import type { AgentEvent } from "../protocol.ts";
import type { Redactor } from "../redaction.ts";
import { stableRecordId } from "./record-id.ts";
import { LiveFramePublisher } from "./live-frames.ts";
import { fetchControlPlane } from "./control-plane-fetch.ts";

const INGEST_RETRY_BASE_MS = 100;
// Ceiling on one wait between attempts. Without it the doubling backoff would leave a long gap
// after the api comes back, and every record queued behind this one would wait through it.
const INGEST_RETRY_MAX_BACKOFF_MS = 5_000;
// Per-request ceiling on one ingest POST. Without it a single stalled request (a hung API, a
// half-open socket) blocks the whole per-session persist chain — and behind it the turn-end
// drain — for as long as the socket stays open. Bounded here so a stalled write becomes a
// retryable failure like any other transient error, not an unbounded wait.
const INGEST_REQUEST_TIMEOUT_MS = 30_000;

function ingestRequestTimeoutMs(): number {
  return envInt("AGENTA_RECORDS_INGEST_TIMEOUT_MS", INGEST_REQUEST_TIMEOUT_MS, {
    min: 1_000,
    max: 120_000,
    log,
  });
}

// How long one record keeps retrying before it is lost. Sized to outlast a database restart
// (a Cloud SQL failover takes about a minute). The turn stays open while it retries, and the
// records behind it in the chain wait, so the ceiling keeps "retry harder" from becoming a turn
// that never ends.
const INGEST_RETRY_BUDGET_MS = 180_000;
const INGEST_RETRY_BUDGET_MAX_MS = 600_000;

/** Time one record may spend retrying; env-overridable for ops tuning (and fast tests). 0 means one attempt. */
function ingestRetryBudgetMs(): number {
  return envInt("AGENTA_RECORDS_INGEST_RETRY_BUDGET_MS", INGEST_RETRY_BUDGET_MS, {
    min: 0,
    max: INGEST_RETRY_BUDGET_MAX_MS,
    log,
  });
}

function log(msg: string): void {
  process.stderr.write(`[sessions/persist] ${msg}\n`);
}

/**
 * One drop, on a fixed tag a log-based alert matches. ERROR level, like the trace-export
 * failures in `tracing/export-diagnostics.ts`.
 */
function logDrop(fields: {
  outcome: "lost";
  sessionId: string;
  records: number;
  reason: string;
  recordIndex?: number;
  recordType?: string;
  turnId?: string;
  attempts?: number;
}): void {
  console.error(
    "[sessions/persist] RECORD_DROPPED",
    JSON.stringify({ ...fields, reason: fields.reason.slice(0, 160) }),
  );
}

/** The ingest request body, built once so every attempt is the same request. */
interface IngestRecord {
  session_id: string;
  record_id: string;
  record_index: number;
  timestamp: string;
  record_source: string;
  record_type: string;
  attributes: AgentEvent;
  turn_id?: string;
  span_id?: string;
}

type IngestOutcome =
  | { ok: true }
  | { ok: false; transient: boolean; attempts: number; error: string };

/** Map session_id → tail of the per-session persist chain. */
const persistChains = new Map<string, Promise<void>>();

/** Map session_id → count of records lost for good this turn. Read + cleared at the turn-end drain via `takePersistFailures`. */
const persistFailures = new Map<string, number>();

/**
 * The api sets `sequence` on arrival, so only an outage is worth waiting out: a 5xx, a 429, a
 * 408, or a request that never got an answer. Any other 4xx answers the same way next time.
 */
function transientStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

/**
 * Send one record, retrying transient failures until the time budget runs out. Authenticates AS
 * the invoke caller (the run credential); project scope is resolved server-side, so none is sent.
 * The record id and timestamp are fixed in `record`, so a retry after an ambiguous timeout
 * upserts the same row. `budgetMs` 0 means one attempt.
 */
async function sendRecord(
  record: IngestRecord,
  auth: () => string,
  budgetMs: number,
): Promise<IngestOutcome> {
  const url = `${apiBase()}/sessions/records/ingest`;
  const timeoutMs = ingestRequestTimeoutMs();
  const deadline = Date.now() + budgetMs;
  const body = JSON.stringify(record);
  for (let attempt = 1; ; attempt++) {
    let error: string;
    let transient: boolean;
    try {
      const res = await fetch(url, {
        method: "POST",
        // Fail a stalled request instead of hanging the persist chain. The budget decides only
        // whether another attempt starts, so one record waits at most budget + one timeout.
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "content-type": "application/json",
          authorization: auth(),
        },
        body,
      });
      // We need only the status. Release the response body on both success and retry.
      await res.body?.cancel();
      if (res.ok) {
        log(
          `ingest OK session=${record.session_id} idx=${record.record_index} type=${record.record_type}`,
        );
        return { ok: true };
      }
      // Prefixed so a runner-side 401 is distinguishable from a provider refusal; see
      // `RUNNER_INTERNAL_401` in engines/sandbox_agent/errors.ts.
      error = `session records persist failed: HTTP ${res.status}`;
      transient = transientStatus(res.status);
    } catch (err) {
      // No answer at all: a network error or a timeout.
      error = `session records persist failed: ${err instanceof Error ? err.message : String(err)}`;
      transient = true;
    }
    if (!transient) return { ok: false, transient, attempts: attempt, error };
    const wait = Math.min(
      INGEST_RETRY_MAX_BACKOFF_MS,
      INGEST_RETRY_BASE_MS * 2 ** (attempt - 1),
    );
    if (Date.now() + wait >= deadline)
      return { ok: false, transient, attempts: attempt, error };
    await new Promise((r) => setTimeout(r, wait));
  }
}

/** Count records lost for good, for the turn-end report. */
function countLost(sessionId: string, records: number): void {
  persistFailures.set(sessionId, (persistFailures.get(sessionId) ?? 0) + records);
}

/**
 * Persist one record. Runs inside the session's chain. A record that does not land is lost:
 * the session is marked incomplete at once, and every later record of the session gets one
 * attempt only. The log already has a hole, so waiting a full budget for each of them would only
 * hold the turn open (a long outage times the number of records).
 */
async function persistRecord(
  record: IngestRecord,
  auth: () => string,
): Promise<void> {
  const sessionId = record.session_id;
  const budgetMs = recordsIncomplete(sessionId) ? 0 : ingestRetryBudgetMs();
  const outcome = await sendRecord(record, auth, budgetMs);
  if (outcome.ok) return;
  noteRecordsIncomplete(sessionId);
  countLost(sessionId, 1);
  logDrop({
    outcome: "lost",
    sessionId,
    records: 1,
    reason: outcome.error,
    recordIndex: record.record_index,
    recordType: record.record_type,
    turnId: record.turn_id,
    attempts: outcome.attempts,
  });
}

/**
 * Enqueue one event for durable persistence. Returns immediately; the write is
 * serialized behind any prior writes for the same session (order guarantee).
 * Does NOT block the caller.
 */
export function persistEvent(
  sessionId: string,
  auth: () => string,
  event: AgentEvent & { message_id?: string },
  eventIndex: number,
  sender: string = "agent",
  recordId?: string,
  redactor?: Redactor,
  turnId?: string,
  spanId?: string,
): void {
  // Redact at the sink: the durable copy is scrubbed; the live/in-memory event the harness
  // and the client stream still hold is untouched.
  const durable = redactor ? redactor.redactJson(event, "records") : event;
  // Built once, before any attempt: a timeout can happen after the API accepted the row, and a
  // re-send on a later turn must be the same row too.
  const record: IngestRecord = {
    session_id: sessionId,
    record_id: recordId ?? randomUUID(),
    record_index: eventIndex,
    timestamp: new Date().toISOString(),
    record_source: sender,
    record_type: durable.type,
    attributes: durable,
    // Tags the record for turn-grouping; span_id bridges to observability when
    // the run has one in scope (both forward-fill only, absent is expected).
    ...(turnId ? { turn_id: turnId } : {}),
    ...(spanId ? { span_id: spanId } : {}),
  };
  const tail = (persistChains.get(sessionId) ?? Promise.resolve()).then(() =>
    persistRecord(record, auth),
  );
  persistChains.set(sessionId, tail);
}

/**
 * Wait for all queued persists for a session to land, then prune the chain entry.
 * Call this in the run's `finally` BEFORE tearing down the sandbox so the last
 * event is not lost to the teardown race.
 */
export async function drainPersist(sessionId: string): Promise<void> {
  const tail = persistChains.get(sessionId);
  if (!tail) return;
  await tail;
  // Only prune if no new events were enqueued while we were draining.
  if (persistChains.get(sessionId) === tail) {
    persistChains.delete(sessionId);
  }
}

/**
 * Read and clear the count of records lost for a session.
 * Call at the turn-end drain to learn whether the session's durable history has a hole — a
 * zero count means every record landed.
 */
export function takePersistFailures(sessionId: string): number {
  const n = persistFailures.get(sessionId) ?? 0;
  persistFailures.delete(sessionId);
  return n;
}

/**
 * Sessions whose record log this process saw lose a record for good. The durable flag the api
 * keeps is what every runner reads; this set covers the case where reporting that flag failed too.
 */
const incompleteSessions = new Set<string>();

/** Sessions in `incompleteSessions` whose report the api has not acknowledged yet. */
const unreportedIncomplete = new Set<string>();

/** Bound the report at the turn-end drain: the turn's result waits on it. */
const INCOMPLETE_REPORT_BUDGET_MS = 5_000;
const INCOMPLETE_REPORT_ATTEMPTS = 3;

/**
 * Mark a session's record log as incomplete, permanently for this process. Once a record is
 * lost the log no longer represents the conversation, so it must never be used to rebuild
 * model context: the turn would silently run with a hole in its history. Read by the
 * reconstruction seam, which fails the turn instead of reconstructing.
 */
export function noteRecordsIncomplete(sessionId: string): void {
  incompleteSessions.add(sessionId);
}

/**
 * `noteRecordsIncomplete`, plus the same fact reported to the api, which keeps it with the
 * record log so a turn on another runner refuses too. Called at the turn-end drain. Best
 * effort: a failed report is logged and kept, and the session's next turn on this process
 * reports it again (`reportPendingRecordsIncomplete`). Until it lands, only this process knows.
 */
export async function reportRecordsIncomplete(
  sessionId: string,
  turnId: string | undefined,
  auth: () => string,
): Promise<void> {
  noteRecordsIncomplete(sessionId);
  unreportedIncomplete.add(sessionId);
  try {
    const res = await fetchControlPlane(
      (signal) =>
        fetch(`${apiBase()}/sessions/records/incomplete`, {
          method: "POST",
          signal,
          headers: {
            "content-type": "application/json",
            authorization: auth(),
          },
          body: JSON.stringify({
            session_id: sessionId,
            ...(turnId ? { turn_id: turnId } : {}),
          }),
        }),
      // The api sets the flag only once, so a repeat is harmless.
      {
        retryFailures: true,
        maxAttempts: INCOMPLETE_REPORT_ATTEMPTS,
        budgetMs: INCOMPLETE_REPORT_BUDGET_MS,
      },
    );
    await res.body?.cancel().catch(() => {});
    if (res.ok) unreportedIncomplete.delete(sessionId);
    else log(`incomplete report HTTP ${res.status} session=${sessionId}`);
  } catch (err) {
    log(
      `incomplete report FAILED session=${sessionId}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
  }
}

/**
 * Report again a loss whose earlier report did not reach the api (it usually fails in the same
 * outage that lost the record). Call at the start of the session's next turn on this process,
 * with that turn's credential. Without it, a turn on another runner would never learn of the hole.
 */
export async function reportPendingRecordsIncomplete(
  sessionId: string,
  turnId: string | undefined,
  auth: () => string,
): Promise<void> {
  if (!unreportedIncomplete.has(sessionId)) return;
  await reportRecordsIncomplete(sessionId, turnId, auth);
}

/** Whether this session has lost a record for good on this process. */
export function recordsIncomplete(sessionId: string): boolean {
  return incompleteSessions.has(sessionId);
}

/**
 * A tool call streams as many `tool_call` events with a growing partial-args snapshot for
 * one id. Idle window after which an open, un-closed tool call is flushed as-is — the
 * substitute for a close signal the harness may never send (a call that streams then
 * stalls without a `tool_result`).
 */
const OPEN_TOOL_TTL_MS = envTimerMs("AGENTA_RECORD_TOOL_TTL_MS", 3_000, {
  log,
});

/**
 * Build an emitter that persists every event via the ingest chain AND calls the
 * original emitter (for live streaming). Returns a stateful counter so record_index
 * increments per turn (the in-session ordering key; the DB tiebreaks with ingest time).
 *
 * Coalescing keeps one durable record per streamed family, while the live stream gets
 * every raw event unchanged:
 *  - message_start/delta/end and thought_* accumulate text, persisted once on *_end.
 *  - tool_call snapshots for one id accumulate (latest args win) into a single open slot,
 *    persisted once when a non-continuation event arrives, the TTL fires, or the turn
 *    drains. The record carries a turn-scoped stable uuid5 id so retries upsert within
 *    one execution without overwriting the same tool call from another execution.
 */
export function buildPersistingEmitter(
  sessionId: string,
  auth: () => string,
  liveEmit?: (event: AgentEvent) => void,
  redactor?: Redactor,
  turnId?: string,
  spanId?: string,
): {
  emit: (event: AgentEvent) => void;
  /** Persist an out-of-band record (e.g. the inbound user turn) through the same
   * ordered chain and index counter, without touching the live stream. */
  persist: (event: AgentEvent, sender: string) => void;
  flush: () => Promise<void>;
} {
  let eventIndex = 0;
  const liveFrames = turnId
    ? new LiveFramePublisher({ sessionId, executionId: turnId, auth })
    : null;
  // Coalescing state: accumulate delta families into a single durable event.
  const coalescedMessages = new Map<string, { id: string; text: string }>();

  // At most one open tool call at a time: its index is claimed when the call first
  // appears (so it sorts ahead of whatever flushes it), args are overwritten in place
  // while snapshots for the same id keep arriving, and it is persisted exactly once.
  let openTool: {
    id: string;
    index: number;
    event: AgentEvent;
    timer: NodeJS.Timeout;
  } | null = null;

  const flushOpenTool = (): void => {
    if (!openTool) return;
    const { id, index, event, timer } = openTool;
    clearTimeout(timer);
    openTool = null;
    persistEvent(
      sessionId,
      auth,
      event,
      index,
      "agent",
      stableRecordId(sessionId, id, "tool_call", turnId),
      redactor,
      turnId,
      spanId,
    );
  };

  const emit = (event: AgentEvent): void => {
    // Always forward to the live stream (if any).
    liveEmit?.(event);
    liveFrames?.emit(event);

    // Transient data describes the current live turn. It must not become transcript history.
    if (event.type === "data" && event.transient) return;

    // Accumulate tool_call snapshots for one id; flush on any non-continuation below.
    if (event.type === "tool_call" && event.id) {
      if (openTool && openTool.id === event.id) {
        // Continuation: latest args win, push the idle deadline out.
        openTool.event = event;
        clearTimeout(openTool.timer);
        openTool.timer = setTimeout(flushOpenTool, OPEN_TOOL_TTL_MS);
        return;
      }
      // A different call: flush the previous open slot, then open this one.
      flushOpenTool();
      openTool = {
        id: event.id,
        index: eventIndex++,
        event,
        timer: setTimeout(flushOpenTool, OPEN_TOOL_TTL_MS),
      };
      return;
    }
    // Any other event is a "different step": close the open tool call before it, so the
    // tool_call record lands (with its earlier index) ahead of this event.
    flushOpenTool();

    // Coalesce delta families: accumulate text; persist only on *_end.
    if (event.type === "message_start") {
      coalescedMessages.set(event.id, { id: event.id, text: "" });
      return; // don't persist the start marker
    }
    if (event.type === "message_delta") {
      const acc = coalescedMessages.get(event.id);
      if (acc) {
        acc.text += event.delta;
        return; // don't persist individual deltas
      }
    }
    if (event.type === "message_end") {
      const acc = coalescedMessages.get(event.id);
      if (acc) {
        coalescedMessages.delete(event.id);
        // Persist the coalesced message in place of the end marker.
        persistEvent(
          sessionId,
          auth,
          { type: "message", text: acc.text, message_id: acc.id },
          eventIndex++,
          "agent",
          undefined,
          redactor,
          turnId,
          spanId,
        );
        return;
      }
    }
    // Similarly coalesce thought deltas.
    if (event.type === "thought_start") {
      coalescedMessages.set(`thought:${event.id}`, { id: event.id, text: "" });
      return;
    }
    if (event.type === "thought_delta") {
      const acc = coalescedMessages.get(`thought:${event.id}`);
      if (acc) {
        acc.text += event.delta;
        return;
      }
    }
    if (event.type === "thought_end") {
      const acc = coalescedMessages.get(`thought:${event.id}`);
      if (acc) {
        coalescedMessages.delete(`thought:${event.id}`);
        persistEvent(
          sessionId,
          auth,
          { type: "thought", text: acc.text, message_id: acc.id },
          eventIndex++,
          "agent",
          undefined,
          redactor,
          turnId,
          spanId,
        );
        return;
      }
    }

    // Related tool and interaction events share correlation ids but need distinct, retry-stable
    // rows, so the record type remains part of the stable id.
    if (
      (event.type === "tool_result" ||
        event.type === "interaction_request" ||
        event.type === "interaction_response") &&
      event.id
    ) {
      persistEvent(
        sessionId,
        auth,
        event,
        eventIndex++,
        "agent",
        stableRecordId(sessionId, event.id, event.type, turnId),
        redactor,
        turnId,
        spanId,
      );
      return;
    }

    // All other events persist as-is.
    persistEvent(
      sessionId,
      auth,
      event,
      eventIndex++,
      "agent",
      undefined,
      redactor,
      turnId,
      spanId,
    );
  };

  const persist = (event: AgentEvent, sender: string): void => {
    // Out-of-band records (the inbound user turn) still respect open-tool ordering.
    flushOpenTool();
    persistEvent(
      sessionId,
      auth,
      event,
      eventIndex++,
      sender,
      undefined,
      redactor,
      turnId,
      spanId,
    );
  };

  const flush = async (): Promise<void> => {
    // A paused call ends the turn with its slot still open — persist it before draining.
    flushOpenTool();
    // An interrupted producer may never send an end marker. Preserve its accepted prefix,
    // then release the buffers even when the same emitter is flushed again.
    for (const [key, acc] of coalescedMessages) {
      persistEvent(
        sessionId, auth,
        { type: key.startsWith("thought:") ? "thought" : "message", text: acc.text, message_id: acc.id },
        eventIndex++, "agent", undefined, redactor, turnId, spanId,
      );
    }
    coalescedMessages.clear();
    await drainPersist(sessionId);
    // The drop count is deliberately NOT consumed here. The turn's caller (server.ts's `finally`)
    // reads it exactly once, after this drain, via `takePersistFailures` to decide whether to mark
    // the session's record log incomplete. Consuming (and clearing) it here would leave that caller
    // reading zero, so the session with a hole in its log would never be marked — the reconstruction
    // guard would then trust an incomplete log. So the single read stays with the caller.
    await liveFrames?.whenIdle();
    liveFrames?.reportDrops();
  };

  return { emit, persist, flush };
}

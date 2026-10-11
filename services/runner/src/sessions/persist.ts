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
 *    budget that outlasts a database restart. A record that still does not land is PARKED in
 *    memory with every later record of its session, and re-sent before the session's next turn
 *    (`resendParkedRecords`). Only a record lost for good (a non-transient failure, a failed
 *    re-send, the memory bound) is COUNTED (see `takePersistFailures`), so the turn-end drain
 *    reports the session incomplete only when its history really has a hole.
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

// How long one record keeps retrying before it is parked. Sized to outlast a database restart
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

// Bounds on the records held in memory for a later re-send. Past either bound the records are
// lost and the session is reported incomplete, as before this store existed.
const MAX_PARKED_RECORDS_PER_SESSION = 1_000;
const MAX_PARKED_SESSIONS = 100;

function log(msg: string): void {
  process.stderr.write(`[sessions/persist] ${msg}\n`);
}

/**
 * One drop, on a fixed tag a log-based alert matches. ERROR level, like the trace-export
 * failures in `tracing/export-diagnostics.ts`. `outcome` says whether the records are held for a
 * re-send (`parked`) or gone (`lost`).
 */
function logDrop(fields: {
  outcome: "parked" | "lost";
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

/** The ingest request body, kept whole so a re-send is the same request. */
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
 * Map session_id → records that did not land, oldest first. Once a session has one, every later
 * record of that session is parked behind it unsent, because the api orders the log by arrival:
 * a record that landed first would sort ahead of the one it followed. Re-sent at the start of the
 * session's next turn on this process (`resendParkedRecords`).
 */
const parkedRecords = new Map<string, IngestRecord[]>();

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
 * upserts the same row.
 */
async function sendRecord(
  record: IngestRecord,
  auth: () => string,
): Promise<IngestOutcome> {
  const url = `${apiBase()}/sessions/records/ingest`;
  const timeoutMs = ingestRequestTimeoutMs();
  const deadline = Date.now() + ingestRetryBudgetMs();
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
 * Hold a record for a re-send. Past the memory bound the session's held records are lost
 * instead: they are released, counted, and the session is marked incomplete on this process.
 */
function park(record: IngestRecord): void {
  const sessionId = record.session_id;
  const held = parkedRecords.get(sessionId);
  if (held && held.length < MAX_PARKED_RECORDS_PER_SESSION) {
    held.push(record);
    return;
  }
  if (!held && parkedRecords.size < MAX_PARKED_SESSIONS) {
    parkedRecords.set(sessionId, [record]);
    return;
  }
  const lost = (held?.length ?? 0) + 1;
  parkedRecords.delete(sessionId);
  noteRecordsIncomplete(sessionId);
  countLost(sessionId, lost);
  logDrop({
    outcome: "lost",
    sessionId,
    records: lost,
    reason: held
      ? `more than ${MAX_PARKED_RECORDS_PER_SESSION} records held for this session`
      : `records held for more than ${MAX_PARKED_SESSIONS} sessions`,
    turnId: record.turn_id,
  });
}

/** Persist one record, or park it when it cannot land now. Runs inside the session's chain. */
async function persistRecord(
  record: IngestRecord,
  auth: () => string,
): Promise<void> {
  const sessionId = record.session_id;
  // A record that would land ahead of a parked one sorts in the wrong place. Hold it too.
  if (parkedRecords.has(sessionId)) {
    park(record);
    log(
      `PARKED session=${sessionId} idx=${record.record_index} type=${record.record_type} behind an earlier drop`,
    );
    return;
  }
  // Already incomplete on this process: the log has a hole, so order no longer matters.
  const outcome = await sendRecord(record, auth);
  if (outcome.ok) return;
  if (outcome.transient && !recordsIncomplete(sessionId)) {
    park(record);
    logDrop({
      outcome: "parked",
      sessionId,
      records: 1,
      reason: outcome.error,
      recordIndex: record.record_index,
      recordType: record.record_type,
      turnId: record.turn_id,
      attempts: outcome.attempts,
    });
    return;
  }
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
 * Read and clear the count of records lost for good (not parked) for a session.
 * Call at the turn-end drain to learn whether the session's durable history has a hole — a
 * zero count means every record either landed or is held for a re-send.
 */
export function takePersistFailures(sessionId: string): number {
  const n = persistFailures.get(sessionId) ?? 0;
  persistFailures.delete(sessionId);
  return n;
}

/** How many of this session's records are held for a re-send. */
export function parkedRecordCount(sessionId: string): number {
  return parkedRecords.get(sessionId)?.length ?? 0;
}

export type ParkedResendOutcome =
  | { ok: true; resent: number }
  | { ok: false; lost: number; error: string };

/**
 * Re-send the session's parked records, oldest first, through the session's chain. Call at the
 * start of the session's next turn, before that turn persists anything, with that turn's
 * credential (the turn that parked them may hold a stale one).
 *
 * All land: the session is whole again. One fails: it and the records behind it are lost, the
 * session is marked incomplete on this process, and the caller reports it and refuses the turn.
 */
export async function resendParkedRecords(
  sessionId: string,
  auth: () => string,
): Promise<ParkedResendOutcome> {
  // Checked inside the chain: a record of an earlier turn may still be retrying, and it parks
  // only when its budget runs out.
  const run = (persistChains.get(sessionId) ?? Promise.resolve()).then(
    async (): Promise<ParkedResendOutcome> => {
      const held = parkedRecords.get(sessionId);
      if (!held) return { ok: true, resent: 0 };
      for (let i = 0; i < held.length; i++) {
        const outcome = await sendRecord(held[i], auth);
        if (outcome.ok) continue;
        const lost = held.length - i;
        parkedRecords.delete(sessionId);
        noteRecordsIncomplete(sessionId);
        logDrop({
          outcome: "lost",
          sessionId,
          records: lost,
          reason: `re-send failed: ${outcome.error}`,
          recordIndex: held[i].record_index,
          recordType: held[i].record_type,
          turnId: held[i].turn_id,
          attempts: outcome.attempts,
        });
        return { ok: false, lost, error: outcome.error };
      }
      parkedRecords.delete(sessionId);
      log(`RECOVERED session=${sessionId} records=${held.length}`);
      return { ok: true, resent: held.length };
    },
  );
  const tail = run.then(() => {});
  persistChains.set(sessionId, tail);
  return run;
}

/**
 * Sessions whose record log this process saw lose a record for good. The durable flag the api
 * keeps is what every runner reads; this set covers the case where reporting that flag failed too.
 */
const incompleteSessions = new Set<string>();

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
 * record log so a turn on another runner refuses too. Called only for records lost for good,
 * never for parked ones: the api has no way to clear the flag, so a parked record that later
 * lands must not have set it. Best effort: a failed report is logged, and only this process
 * then knows.
 */
export async function reportRecordsIncomplete(
  sessionId: string,
  turnId: string | undefined,
  auth: () => string,
): Promise<void> {
  noteRecordsIncomplete(sessionId);
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
    if (!res.ok)
      log(`incomplete report HTTP ${res.status} session=${sessionId}`);
  } catch (err) {
    log(
      `incomplete report FAILED session=${sessionId}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
  }
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

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
 *  - A persist failure is logged and swallowed; the SDK's in-memory replay store is the
 *    backstop. By default (durable mode, on unless `AGENTA_RECORDS_DURABLE=false`) the retry
 *    is strong (more attempts, exponential backoff) and a drop is COUNTED per session (see
 *    `takePersistFailures`), so the turn-end drain can tell whether the durable history is
 *    complete enough to reconstruct model context from. With the flag set to "false", three
 *    retries with linear backoff before the event is dropped, uncounted (legacy path).
 *  - `record_source` marks who authored the record: "agent" for engine-emitted events,
 *    "user" for the inbound user turn persisted at run start.
 */

import { apiBase } from "../apiBase.ts";
import { randomUUID } from "node:crypto";
import { envInt } from "../env.ts";
import type { AgentEvent } from "../protocol.ts";
import type { Redactor } from "../redaction.ts";
import { stableRecordId, stableRecordIdForIndex } from "./record-id.ts";

const INGEST_MAX_RETRIES = 3;
const INGEST_RETRY_BASE_MS = 100;
// Durable mode (Phase 1, flag-gated): more attempts with exponential backoff before a drop.
// 6 attempts ≈ 100+200+400+800+1600ms of backoff (~3.1s) — bounded per event so a real outage
// can't hang the turn-end drain indefinitely.
const DURABLE_INGEST_MAX_RETRIES = 6;
// Ceiling on the override: the backoff doubles per attempt, so each extra attempt doubles the
// worst-case drain wait. 12 attempts ≈ 3.4 min of backoff — the point past which "retry harder"
// stops being a tuning knob and becomes a hung turn.
const DURABLE_INGEST_MAX_RETRIES_CAP = 12;

/** Durable-records upgrades (stronger retry + drop counting) are ON unless the flag is the
 * literal "false"; read at call time so the flag can be toggled per test. Absent AND empty both
 * mean on — the compose files pass the var through as `${AGENTA_RECORDS_DURABLE:-}`, which sets
 * an empty string when unset. "false" → the fire-and-forget legacy path, unchanged. */
function durableRecordsEnabled(): boolean {
  return (
    String(process.env.AGENTA_RECORDS_DURABLE ?? "")
      .trim()
      .toLowerCase() !== "false"
  );
}

/** Attempts before a durable-mode drop; env-overridable for ops tuning (and fast tests). */
function durableMaxRetries(): number {
  return envInt(
    "AGENTA_RECORDS_INGEST_MAX_RETRIES",
    DURABLE_INGEST_MAX_RETRIES,
    {
      min: 1,
      max: DURABLE_INGEST_MAX_RETRIES_CAP,
      log,
    },
  );
}

function log(msg: string): void {
  process.stderr.write(`[sessions/persist] ${msg}\n`);
}

/** Map session_id → tail of the per-session persist chain. */
const persistChains = new Map<string, Promise<void>>();

/** Map session_id → count of records that exhausted retries (dropped). Only ever populated in
 * durable mode; read + cleared at the turn-end drain via `takePersistFailures`. */
const persistFailures = new Map<string, number>();

/** Send one event to the ingest endpoint with bounded retry. Authenticates AS the invoke
 * caller (the run credential); project scope is resolved server-side, so none is sent. */
async function postEvent(
  sessionId: string,
  auth: () => string,
  event: AgentEvent,
  eventIndex: number,
  sender: string,
  recordId?: string,
  turnId?: string,
  spanId?: string,
  timestamp: string = new Date().toISOString(),
  producerId?: string,
): Promise<void> {
  const url = `${apiBase()}/sessions/records/ingest`;
  const durable = durableRecordsEnabled();
  const maxRetries = durable ? durableMaxRetries() : INGEST_MAX_RETRIES;
  const body = JSON.stringify({
    session_id: sessionId,
    ...(recordId ? { record_id: recordId } : {}),
    ...(producerId ? { producer_id: producerId } : {}),
    record_index: eventIndex,
    timestamp,
    record_source: sender,
    record_type: event.type,
    attributes: event,
    ...(turnId ? { turn_id: turnId } : {}),
    ...(spanId ? { span_id: spanId } : {}),
  });
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: auth(),
        },
        body,
      });
      // Prefixed so a runner-side 401 is distinguishable from a provider refusal; see
      // `RUNNER_INTERNAL_401` in engines/sandbox_agent/errors.ts.
      if (!res.ok)
        throw new Error(`session records persist failed: HTTP ${res.status}`);
      log(
        `ingest OK session=${sessionId} idx=${eventIndex} type=${event.type}`,
      );
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        // Durable: exponential (100·2^n, capped by the attempt count). Legacy: linear.
        const backoff = durable
          ? INGEST_RETRY_BASE_MS * 2 ** (attempt - 1)
          : INGEST_RETRY_BASE_MS * attempt;
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  // Exhausted retries → the record is lost. In durable mode, count it so the turn-end drain
  // knows the session's history is incomplete (a reconstruction/​fallback signal for later).
  if (durable) {
    persistFailures.set(sessionId, (persistFailures.get(sessionId) ?? 0) + 1);
  }
  log(
    `DROPPED session=${sessionId} idx=${eventIndex} type=${event.type} after ${maxRetries} retries: ${String(lastErr instanceof Error ? lastErr.message : lastErr).slice(0, 120)}`,
  );
}

/**
 * Enqueue one event for durable persistence. Returns immediately; the write is
 * serialized behind any prior writes for the same session (order guarantee).
 * Does NOT block the caller.
 */
export function persistEvent(
  sessionId: string,
  auth: () => string,
  event: AgentEvent,
  eventIndex: number,
  sender: string = "agent",
  recordId?: string,
  redactor?: Redactor,
  turnId?: string,
  spanId?: string,
  timestamp?: string,
  producerId?: string,
): void {
  // Redact at the sink: the durable copy is scrubbed; the live/in-memory event the harness
  // and the client stream still hold is untouched.
  const durable = redactor ? redactor.redactJson(event, "records") : event;
  const tail = (persistChains.get(sessionId) ?? Promise.resolve()).then(() =>
    postEvent(
      sessionId,
      auth,
      durable,
      eventIndex,
      sender,
      recordId,
      turnId,
      spanId,
      timestamp,
      producerId,
    ),
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
 * Read and clear the count of records that were dropped (exhausted retries) for a session.
 * Only ever non-zero when `AGENTA_RECORDS_DURABLE=true`. Call at the turn-end drain to learn
 * whether the session's durable history is complete — a zero count means the record log fully
 * captured the turn and is safe to reconstruct model context from.
 */
export function takePersistFailures(sessionId: string): number {
  const n = persistFailures.get(sessionId) ?? 0;
  persistFailures.delete(sessionId);
  return n;
}

/** Sessions whose record log is known to have lost at least one record. */
const incompleteSessions = new Set<string>();

/**
 * Mark a session's record log as incomplete, permanently for this process. Once a record is
 * dropped the log no longer represents the conversation, so it must never be used to rebuild
 * model context: the turn would silently run with a hole in its history. Set at the turn-end
 * drain; read by the reconstruction seam, which fails the turn instead of reconstructing.
 */
export function noteRecordsIncomplete(sessionId: string): void {
  incompleteSessions.add(sessionId);
}

/** Whether this session has lost a record and can no longer be reconstructed from. */
export function recordsIncomplete(sessionId: string): boolean {
  return incompleteSessions.has(sessionId);
}

/**
 * Build an emitter that persists every event via the ingest chain AND calls the
 * original emitter (for live streaming). Returns a stateful counter so record_index
 * increments per turn (the in-session ordering key; the DB tiebreaks with ingest time).
 *
 * Coalescing keeps one durable record per streamed family, while the live stream gets
 * every raw event unchanged:
 *  - message_start/delta/end and thought_* accumulate text, persisted once on *_end.
 *  - tool_call/tool_result snapshots keep one open slot per tool id. A type transition for that
 *    id, the next non-tool event, or the turn-end flush is its complete checkpoint.
 *  - Every emitted record keeps its legacy record_id behavior and adds a retry-stable producer_id.
 *    An older API ignores the additive field; immutable-history mode can consume it.
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
  const recordScope = turnId ?? randomUUID();
  // Coalescing state: accumulate delta families into a single durable event.
  const coalescedMessages = new Map<string, { id: string; text: string }>();

  type PendingToolRecord = {
    index: number;
    event: AgentEvent;
    timestamp: string;
  };
  const pendingTools = new Map<string, PendingToolRecord>();

  const enqueue = (
    event: AgentEvent,
    index: number,
    sender: string = "agent",
    recordId?: string,
    timestamp: string = new Date().toISOString(),
    producerId: string = stableRecordIdForIndex(
      sessionId,
      index,
      recordScope,
    ),
  ): void => {
    persistEvent(
      sessionId,
      auth,
      event,
      index,
      sender,
      recordId,
      redactor,
      turnId,
      spanId,
      timestamp,
      producerId,
    );
  };

  const flushPendingTool = (toolId: string): void => {
    const pending = pendingTools.get(toolId);
    if (!pending) return;
    pendingTools.delete(toolId);
    enqueue(
      pending.event,
      pending.index,
      "agent",
      stableRecordId(
        sessionId,
        toolId,
        pending.event.type,
        recordScope,
      ),
      pending.timestamp,
    );
  };

  const stageTool = (event: AgentEvent & { id?: string }): boolean => {
    if (
      !event.id ||
      (event.type !== "tool_call" && event.type !== "tool_result")
    ) {
      return false;
    }
    const pending = pendingTools.get(event.id);
    if (pending) {
      if (pending.event.type === event.type) {
        pending.event = event;
        return true;
      }
      flushPendingTool(event.id);
    }
    pendingTools.set(event.id, {
      index: eventIndex++,
      event,
      timestamp: new Date().toISOString(),
    });
    return true;
  };

  const flushPendingTools = (): void => {
    for (const [toolId] of [...pendingTools.entries()].sort(
      ([, a], [, b]) => a.index - b.index,
    )) {
      flushPendingTool(toolId);
    }
  };

  const emit = (event: AgentEvent): void => {
    // Always forward to the live stream (if any).
    liveEmit?.(event);

    // Transient data describes the current live turn. It must not become transcript history.
    if (event.type === "data" && event.transient) return;

    if (stageTool(event)) return;

    // Advancing beyond tool traffic is a complete checkpoint for every open tool id.
    flushPendingTools();

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
        enqueue(
          { type: "message", text: acc.text },
          eventIndex++,
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
        enqueue(
          { type: "thought", text: acc.text },
          eventIndex++,
        );
        return;
      }
    }

    // Related tool and interaction events share correlation ids but need distinct, retry-stable
    // rows, so the record type remains part of the stable id.
    if (
      (event.type === "interaction_request" ||
        event.type === "interaction_response") &&
      event.id
    ) {
      enqueue(
        event,
        eventIndex++,
        "agent",
        stableRecordId(sessionId, event.id, event.type, recordScope),
      );
      return;
    }

    // All other events persist as-is.
    enqueue(event, eventIndex++);
  };

  const persist = (event: AgentEvent, sender: string): void => {
    flushPendingTools();
    enqueue(event, eventIndex++, sender);
  };

  const flush = async (): Promise<void> => {
    flushPendingTools();
    await drainPersist(sessionId);
    // Consume the drop signal at the turn-end drain: records that exhausted retries mean the durable
    // log is incomplete, so next turn's reconstruction may be missing context. Reading here also
    // clears the per-session counter so it can't accumulate unread. (Only ever non-zero in durable
    // mode.)
    const dropped = takePersistFailures(sessionId);
    if (dropped > 0) {
      log(
        `WARN session=${sessionId} durable log incomplete: ${dropped} record(s) dropped this turn; reconstruction may lack context`,
      );
    }
  };

  return { emit, persist, flush };
}

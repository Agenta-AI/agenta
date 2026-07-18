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
 *    backstop. Three retries with linear backoff before the event is dropped.
 *  - `record_source` marks who authored the record: "agent" for engine-emitted events,
 *    "user" for the inbound user turn persisted at run start.
 */

import { apiBase } from "../apiBase.ts";
import type { AgentEvent } from "../protocol.ts";
import type { Redactor } from "../redaction.ts";
import { stableRecordId } from "./record-id.ts";

const INGEST_MAX_RETRIES = 3;
const INGEST_RETRY_BASE_MS = 100;

function log(msg: string): void {
  process.stderr.write(`[sessions/persist] ${msg}\n`);
}

/** Map session_id → tail of the per-session persist chain. */
const persistChains = new Map<string, Promise<void>>();

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
): Promise<void> {
  const url = `${apiBase()}/sessions/records/ingest`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= INGEST_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: auth(),
        },
        body: JSON.stringify({
          session_id: sessionId,
          // Present only for tool-family records (stable uuid5); the backend mints a
          // uuid4 when omitted. A re-sent id upserts the same row.
          ...(recordId ? { record_id: recordId } : {}),
          record_index: eventIndex,
          timestamp: new Date().toISOString(),
          record_source: sender,
          record_type: event.type,
          attributes: event,
          // Tags the record for turn-grouping; span_id bridges to observability when
          // the run has one in scope (both forward-fill only, absent is expected).
          ...(turnId ? { turn_id: turnId } : {}),
          ...(spanId ? { span_id: spanId } : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      log(
        `ingest OK session=${sessionId} idx=${eventIndex} type=${event.type}`,
      );
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, INGEST_RETRY_BASE_MS * attempt));
    }
  }
  log(
    `DROPPED session=${sessionId} idx=${eventIndex} type=${event.type} after ${INGEST_MAX_RETRIES} retries: ${String(lastErr instanceof Error ? lastErr.message : lastErr).slice(0, 120)}`,
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
 * A tool call streams as many `tool_call` events with a growing partial-args snapshot for
 * one id. Idle window after which an open, un-closed tool call is flushed as-is — the
 * substitute for a close signal the harness may never send (a call that streams then
 * stalls without a `tool_result`).
 */
const OPEN_TOOL_TTL_MS = Number(process.env.AGENTA_RECORD_TOOL_TTL_MS ?? 3000);

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
 *    drains. The record carries a stable uuid5 id so a re-sent snapshot (or a resume)
 *    upserts the same row rather than appending.
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
      stableRecordId(sessionId, id, "tool_call"),
      redactor,
      turnId,
      spanId,
    );
  };

  const emit = (event: AgentEvent): void => {
    // Always forward to the live stream (if any).
    liveEmit?.(event);

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
          { type: "message", text: acc.text },
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
          { type: "thought", text: acc.text },
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

    // A tool_result / interaction_request carries the same tool-call id as its tool_call;
    // give it its own stable id (keyed on the record type) so it lands on a distinct row.
    if (
      (event.type === "tool_result" || event.type === "interaction_request") &&
      event.id
    ) {
      persistEvent(
        sessionId,
        auth,
        event,
        eventIndex++,
        "agent",
        stableRecordId(sessionId, event.id, event.type),
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

  const flush = (): Promise<void> => {
    // A paused call ends the turn with its slot still open — persist it before draining.
    flushOpenTool();
    return drainPersist(sessionId);
  };

  return { emit, persist, flush };
}

/**
 * Producer-driven transcript persistence.
 *
 * The runner posts every agent event to the API's transcript-ingest endpoint
 * independently of any client connection. This is the "producer-driven" model:
 * persistence is decoupled from whether anyone is listening to the live stream.
 *
 * Port of the PoC sidecar's `persistChain` / `persistEvent` / `drainPersist` pattern
 * from `server.js`, adapted to POST to the `POST /sessions/transcripts/ingest` endpoint,
 * authenticated AS the invoke caller (the run credential).
 *
 * Design invariants:
 *  - Events for a given session persist in produced order (per-session promise chain).
 *  - The run is never blocked on persistence mid-stream (chain is fire-and-forget).
 *  - The run DOES drain before teardown so the last event is not lost to the race.
 *  - A persist failure is logged and swallowed; the SDK's in-memory replay store is the
 *    backstop. Three retries with linear backoff before the event is dropped.
 */

import type { AgentEvent } from "../protocol.ts";

const INGEST_MAX_RETRIES = 3;
const INGEST_RETRY_BASE_MS = 100;

function apiBase(): string {
  return process.env.AGENTA_API_URL ?? "http://localhost:8000";
}

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
): Promise<void> {
  const url = `${apiBase()}/sessions/transcripts/ingest`;
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
          event_index: eventIndex,
          sender,
          session_update: event.type,
          payload: event,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      log(`ingest OK session=${sessionId} idx=${eventIndex} type=${event.type}`);
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
  sender: string = "runner",
): void {
  const tail = (persistChains.get(sessionId) ?? Promise.resolve()).then(() =>
    postEvent(sessionId, auth, event, eventIndex, sender),
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
 * Build an emitter that persists every event via the ingest chain AND calls the
 * original emitter (for live streaming). Returns a stateful counter so event_index
 * increments monotonically per session.
 *
 * The `stripReplay` filter coalesces the delta family (message_start / message_delta
 * / message_end) into a single `message` event for storage; the raw deltas are
 * forwarded to the live emitter unchanged. This mirrors the PoC's coalescing logic.
 */
export function buildPersistingEmitter(
  sessionId: string,
  auth: () => string,
  liveEmit?: (event: AgentEvent) => void,
): {
  emit: (event: AgentEvent) => void;
  flush: () => Promise<void>;
} {
  let eventIndex = 0;
  // Coalescing state: accumulate delta families into a single durable event.
  const coalescedMessages = new Map<
    string,
    { id: string; text: string }
  >();

  const emit = (event: AgentEvent): void => {
    // Always forward to the live stream (if any).
    liveEmit?.(event);

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
        );
        return;
      }
    }

    // All other events persist as-is.
    persistEvent(sessionId, auth, event, eventIndex++);
  };

  const flush = (): Promise<void> => drainPersist(sessionId);

  return { emit, flush };
}

// A sandbox-agent SessionPersistDriver backed by the FastAPI/Postgres store.
//
// WHY THIS EXISTS: the sidecar opens a FRESH SandboxAgent.connect()/start() on every /run.
// The SDK's default persist is in-memory, so across calls it has no record of a session and
// resumeOrCreateSession always CREATES a brand-new agent session — the coding agent starts
// each turn with no memory of the conversation (only the durable cwd carries over). Plugging
// in a durable persist driver lets the SDK actually RESUME the prior agent session and replay
// the transcript as context.
//
// The record (local-id -> agentSessionId, sessionInit, modes, ...) is small metadata that
// rides alongside the transcript; it lives in a session_state row. The EVENTS for replay are
// the transcript FastAPI already writes from the NDJSON stream — so insertEvent is a no-op
// here (we never double-write), and listEvents just reads that transcript back.
const API_URL = process.env.API_URL || "http://fastapi:8000";

async function api(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`persist ${method} ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

export function makePersist() {
  return {
    async getSession(id) {
      const { record } = await api("GET", `/sessions/${id}/state`);
      return record ?? undefined; // SDK expects undefined (not null) when absent
    },

    async updateSession(record) {
      await api("PUT", `/sessions/${record.id}/state`, record);
    },

    // The SDK only enumerates sessions for surfaces we don't use; an empty page is fine.
    async listSessions() {
      return { items: [] };
    },

    // Events come from the transcript FastAPI already persists. Map our rows onto SessionEvent
    // (the replay builder only reads createdAt/sender/payload; the rest is filled for shape).
    async listEvents({ sessionId }) {
      const { events } = await api("GET", `/sessions/${sessionId}/transcript`);
      const items = events.map((e) => ({
        id: `${sessionId}:${e.seq}`,
        eventIndex: e.event_index ?? e.seq,
        sessionId,
        createdAt: Date.parse(e.created_at) || 0,
        connectionId: "",
        sender: e.sender,
        payload: e.payload,
      }));
      return { items }; // no pagination: the SDK slices to replayMaxEvents itself
    },

    // FastAPI already inserts every event as it streams off the wire — don't double-write.
    async insertEvent() {},
  };
}

/**
 * Unit tests for the durable mirror (`engines/sandbox_agent/session-continuity-durable.ts`).
 *
 * Exercised through injected fetch/deps -- no real HTTP. Covers: hydrate seeds an empty store
 * from the durable row and never clobbers a live in-process record; both hydrate and sync are
 * best-effort (a 503/throw never propagates out of a run).
 *
 * Run: pnpm exec vitest run tests/unit/session-continuity-durable.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  hydrateHarnessSessionFromDurable,
  syncHarnessSessionDurable,
} from "../../src/engines/sandbox_agent/session-continuity-durable.ts";
import {
  SessionContinuityStore,
  isHarnessLoadEligible,
} from "../../src/engines/sandbox_agent/session-continuity.ts";

const SILENT = () => {};

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function errResponse(status: number): Response {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

describe("hydrateHarnessSessionFromDurable", () => {
  it("seeds an empty store from the durable row", async () => {
    const store = new SessionContinuityStore();
    await hydrateHarnessSessionFromDurable("sess-1", "claude", store, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () =>
        okResponse({
          session_state: {
            data: {
              harness_sessions: {
                claude: { agent_session_id: "agent-restored", turn_index: 2 },
              },
            },
          },
        })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.deepEqual(store.get("sess-1", "claude"), {
      agentSessionId: "agent-restored",
      turnIndex: 2,
    });
    assert.equal(store.latestTurn("sess-1"), 2);
  });

  it("never clobbers a live in-process record with a stale durable read", async () => {
    const store = new SessionContinuityStore();
    store.record("sess-1", "claude", "agent-live", 5);
    await hydrateHarnessSessionFromDurable("sess-1", "claude", store, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () =>
        okResponse({
          session_state: {
            data: {
              harness_sessions: {
                claude: { agent_session_id: "agent-OLD", turn_index: 0 },
              },
            },
          },
        })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.deepEqual(
      store.get("sess-1", "claude"),
      { agentSessionId: "agent-live", turnIndex: 5 },
      "the fresher in-process record must survive; the durable read never overwrites it",
    );
  });

  it("degrades to cold (store untouched) on a non-2xx response, no throw", async () => {
    const store = new SessionContinuityStore();
    await assert.doesNotReject(() =>
      hydrateHarnessSessionFromDurable("sess-1", "claude", store, {
        apiBase: "http://api:8000",
        authorization: "ApiKey abc",
        fetchImpl: (async () => errResponse(503)) as unknown as typeof fetch,
        log: SILENT,
      }),
    );
    assert.equal(store.get("sess-1", "claude"), undefined);
    assert.equal(store.size(), 0);
  });

  it("degrades to cold (store untouched) when fetch throws, no throw out", async () => {
    const store = new SessionContinuityStore();
    await assert.doesNotReject(() =>
      hydrateHarnessSessionFromDurable("sess-1", "claude", store, {
        apiBase: "http://api:8000",
        authorization: "ApiKey abc",
        fetchImpl: (async () => {
          throw new Error("ECONNREFUSED");
        }) as unknown as typeof fetch,
        log: SILENT,
      }),
    );
    assert.equal(store.get("sess-1", "claude"), undefined);
  });

  it("does nothing when the row has no record for this harness", async () => {
    const store = new SessionContinuityStore();
    await hydrateHarnessSessionFromDurable("sess-1", "claude", store, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () =>
        okResponse({ session_state: { data: { harness_sessions: {} } } })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(store.get("sess-1", "claude"), undefined);
  });

  it("does nothing when session_state is null (no row yet)", async () => {
    const store = new SessionContinuityStore();
    await hydrateHarnessSessionFromDurable("sess-1", "claude", store, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () => okResponse({ session_state: null })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(store.get("sess-1", "claude"), undefined);
  });

  it("restores the cross-harness latest_turn_index, keeping a stale harness INELIGIBLE after restart", async () => {
    // Durable state: claude ran turns 0-1, pi ran turn 2 (the latest). A fresh runner (empty
    // store) returns to claude. Without restoring latest_turn_index, hydrate would set latest=1
    // (claude's own turn) and wrongly report claude eligible — the double-switch bug on restart.
    const store = new SessionContinuityStore();
    const durableRow = {
      session_state: {
        data: {
          latest_turn_index: 2,
          harness_sessions: {
            claude: { agent_session_id: "agent-claude", turn_index: 1 },
            pi: { agent_session_id: "agent-pi", turn_index: 2 },
          },
        },
      },
    };
    const fetchRow = (async () => okResponse(durableRow)) as unknown as typeof fetch;
    await hydrateHarnessSessionFromDurable("sess-1", "claude", store, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: fetchRow,
      log: SILENT,
    });
    assert.equal(store.latestTurn("sess-1"), 2, "latest must reflect pi's turn 2, not claude's 1");
    assert.equal(
      isHarnessLoadEligible("sess-1", "claude", store),
      false,
      "claude is stale (turn 1 < latest 2) — must NOT be load-eligible on the restart path",
    );
    // A harness that DID author the latest turn stays eligible after hydrate.
    await hydrateHarnessSessionFromDurable("sess-1", "pi", store, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: fetchRow,
      log: SILENT,
    });
    assert.equal(isHarnessLoadEligible("sess-1", "pi", store), true);
  });

  it("restores latest_turn_index even for a harness with no record of its own", async () => {
    const store = new SessionContinuityStore();
    await hydrateHarnessSessionFromDurable("sess-1", "codex", store, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () =>
        okResponse({
          session_state: {
            data: {
              latest_turn_index: 4,
              harness_sessions: {
                claude: { agent_session_id: "agent-claude", turn_index: 4 },
              },
            },
          },
        })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(store.get("sess-1", "codex"), undefined, "codex has no record of its own");
    assert.equal(store.latestTurn("sess-1"), 4, "but the conversation counter is still restored");
  });
});

describe("syncHarnessSessionDurable", () => {
  it("PUTs a read-modify-write merge that preserves other harnesses' entries", async () => {
    const calls: Array<{ method: string; body?: unknown }> = [];
    await syncHarnessSessionDurable("sess-1", "claude", "agent-new", 3, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "GET") {
          calls.push({ method });
          return okResponse({
            session_state: {
              data: {
                harness_sessions: {
                  pi: { agent_session_id: "agent-pi", turn_index: 1 },
                },
              },
            },
          });
        }
        calls.push({ method, body: JSON.parse(init!.body as string) });
        return okResponse({});
      }) as unknown as typeof fetch,
      log: SILENT,
    });

    const put = calls.find((c) => c.method === "PUT")!;
    const data = (put.body as Record<string, unknown>)["data"] as Record<string, unknown>;
    assert.equal(data["latest_agent_session_id"], "agent-new");
    assert.equal(data["latest_turn_index"], 3);
    const harnessSessions = data["harness_sessions"] as Record<string, unknown>;
    assert.deepEqual(harnessSessions["claude"], {
      agent_session_id: "agent-new",
      turn_index: 3,
    });
    assert.deepEqual(harnessSessions["pi"], {
      agent_session_id: "agent-pi",
      turn_index: 1,
    });
  });

  it("never regresses latest_turn_index below the durable row's existing value", async () => {
    // This harness completes turn 2, but the durable row already recorded latest_turn_index=5
    // (another harness ran a later turn). The PUT must keep 5, not overwrite it down to 2.
    let putBody: Record<string, unknown> | undefined;
    await syncHarnessSessionDurable("sess-1", "claude", "agent-new", 2, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") {
          return okResponse({
            session_state: {
              data: {
                latest_turn_index: 5,
                harness_sessions: {
                  pi: { agent_session_id: "agent-pi", turn_index: 5 },
                },
              },
            },
          });
        }
        putBody = JSON.parse(init!.body as string);
        return okResponse({});
      }) as unknown as typeof fetch,
      log: SILENT,
    });
    const putData = putBody!["data"] as Record<string, unknown>;
    assert.equal(putData["latest_turn_index"], 5, "must not regress the counter below 5");
    assert.equal(
      (putData["harness_sessions"] as Record<string, unknown>)["claude"] !== undefined,
      true,
      "claude's own turn-2 record is still written",
    );
  });

  it("advances latest_turn_index when this turn is the highest", async () => {
    let putBody: Record<string, unknown> | undefined;
    await syncHarnessSessionDurable("sess-1", "claude", "agent-new", 6, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") {
          return okResponse({
            session_state: { data: { latest_turn_index: 5, harness_sessions: {} } },
          });
        }
        putBody = JSON.parse(init!.body as string);
        return okResponse({});
      }) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal((putBody!["data"] as Record<string, unknown>)["latest_turn_index"], 6);
  });

  it("never throws when the GET fails (falls back to an empty merge base)", async () => {
    await assert.doesNotReject(() =>
      syncHarnessSessionDurable("sess-1", "claude", "agent-new", 0, {
        apiBase: "http://api:8000",
        authorization: "ApiKey abc",
        fetchImpl: (async (_url: string, init?: RequestInit) => {
          if ((init?.method ?? "GET") === "GET") return errResponse(503);
          return okResponse({});
        }) as unknown as typeof fetch,
        log: SILENT,
      }),
    );
  });

  it("never throws when the whole call chain throws (network error)", async () => {
    await assert.doesNotReject(() =>
      syncHarnessSessionDurable("sess-1", "claude", "agent-new", 0, {
        apiBase: "http://api:8000",
        authorization: "ApiKey abc",
        fetchImpl: (async () => {
          throw new Error("ECONNREFUSED");
        }) as unknown as typeof fetch,
        log: SILENT,
      }),
    );
  });

  it("never throws when the PUT itself returns a non-2xx (503)", async () => {
    await assert.doesNotReject(() =>
      syncHarnessSessionDurable("sess-1", "claude", "agent-new", 0, {
        apiBase: "http://api:8000",
        authorization: "ApiKey abc",
        fetchImpl: (async (_url: string, init?: RequestInit) => {
          if ((init?.method ?? "GET") === "GET") return errResponse(404);
          return errResponse(503);
        }) as unknown as typeof fetch,
        log: SILENT,
      }),
    );
  });
});

/**
 * Unit tests for the durable turn log (`engines/sandbox_agent/session-continuity-durable.ts`).
 *
 * Exercised through injected fetch/deps -- no real HTTP. Covers: hydrate seeds an empty store
 * from the latest turn and never clobbers a live in-process record; append is a plain POST (no
 * GET, no read-modify-write); both are best-effort (a 503/throw never propagates out of a run).
 *
 * Run: pnpm exec vitest run tests/unit/session-continuity-durable.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  appendSessionTurn,
  completeSessionTurn,
  fetchLatestSessionTurn,
  hydrateHarnessSessionFromDurable,
} from "../../src/engines/sandbox_agent/session-continuity-durable.ts";
import {
  SessionContinuityStore,
  isHarnessLoadEligible,
} from "../../src/engines/sandbox_agent/session-continuity.ts";

const SILENT = () => {};

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function errResponse(status: number): Response {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

describe("fetchLatestSessionTurn", () => {
  it("POSTs a query scoped to session (+harness when given), windowed to the latest one", async () => {
    let body: Record<string, unknown> | undefined;
    let url: string | undefined;
    await fetchLatestSessionTurn("sess-1", "claude", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async (u: string, init?: RequestInit) => {
        url = u;
        body = JSON.parse(init!.body as string);
        return okResponse({ count: 0, turns: [] });
      }) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(url, "http://api:8000/sessions/turns/query");
    assert.deepEqual(body, {
      query: { session_id: "sess-1", harness_kind: "claude" },
      windowing: { limit: 1, order: "descending" },
    });
  });

  it("omits harness from the query when not given", async () => {
    let body: Record<string, unknown> | undefined;
    await fetchLatestSessionTurn("sess-1", undefined, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async (_u: string, init?: RequestInit) => {
        body = JSON.parse(init!.body as string);
        return okResponse({ turns: [] });
      }) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.deepEqual(body!["query"], { session_id: "sess-1" });
  });

  it("returns the first (latest) turn from the response", async () => {
    const turn = await fetchLatestSessionTurn("sess-1", "claude", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () =>
        okResponse({
          count: 1,
          turns: [
            {
              harness_kind: "claude",
              agent_session_id: "agent-1",
              sandbox_id: "sbx-1",
              turn_index: 3,
            },
          ],
        })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.deepEqual(turn, {
      harness_kind: "claude",
      agent_session_id: "agent-1",
      sandbox_id: "sbx-1",
      turn_index: 3,
    });
  });

  it("returns undefined on a non-2xx response, no throw", async () => {
    const turn = await fetchLatestSessionTurn("sess-1", "claude", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () => errResponse(503)) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(turn, undefined);
  });

  it("returns undefined when fetch throws, no throw out", async () => {
    const turn = await fetchLatestSessionTurn("sess-1", "claude", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(turn, undefined);
  });
});

describe("hydrateHarnessSessionFromDurable", () => {
  it("seeds an empty store from the latest turn for this harness", async () => {
    const store = new SessionContinuityStore();
    await hydrateHarnessSessionFromDurable("sess-1", "claude", store, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () =>
        okResponse({
          turns: [
            {
              harness_kind: "claude",
              agent_session_id: "agent-restored",
              turn_index: 2,
              end_time: "2026-07-21T10:00:00.000Z",
            },
          ],
        })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.deepEqual(store.get("sess-1", "claude"), {
      agentSessionId: "agent-restored",
      turnIndex: 2,
    });
    assert.equal(store.latestTurn("sess-1"), 2);
  });

  it("does not use a start-only row for native continuity", async () => {
    const store = new SessionContinuityStore();
    await hydrateHarnessSessionFromDurable("sess-1", "claude", store, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () =>
        okResponse({
          turns: [
            {
              harness_kind: "claude",
              agent_session_id: "agent-partial",
              turn_index: 3,
            },
          ],
        })) as unknown as typeof fetch,
      log: SILENT,
    });

    assert.equal(store.get("sess-1", "claude"), undefined);
    assert.equal(store.latestTurn("sess-1"), 3);
    assert.equal(isHarnessLoadEligible("sess-1", "claude", store), false);
  });

  it("never clobbers a live in-process record with a stale durable read", async () => {
    const store = new SessionContinuityStore();
    store.record("sess-1", "claude", "agent-live", 5);
    await hydrateHarnessSessionFromDurable("sess-1", "claude", store, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () =>
        okResponse({
          turns: [
            {
              harness_kind: "claude",
              agent_session_id: "agent-OLD",
              turn_index: 0,
              end_time: "2026-07-21T10:00:00.000Z",
            },
          ],
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

  it("does nothing when there are no turns yet", async () => {
    const store = new SessionContinuityStore();
    await hydrateHarnessSessionFromDurable("sess-1", "claude", store, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () =>
        okResponse({ turns: [] })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(store.get("sess-1", "claude"), undefined);
  });

  it("restores the cross-harness latest_turn_index, keeping a stale harness INELIGIBLE after restart", async () => {
    // Durable state: claude ran turns 0-1, pi ran turn 2 (the latest). A fresh runner (empty
    // store) returns to claude. Without restoring the cross-harness counter, hydrate would set
    // latest=1 (claude's own turn) and wrongly report claude eligible — the double-switch bug.
    const store = new SessionContinuityStore();
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string) as {
        query: { harness_kind?: string };
      };
      if (body.query.harness_kind === "claude") {
        return okResponse({
          turns: [
            {
              harness_kind: "claude",
              agent_session_id: "agent-claude",
              turn_index: 1,
              end_time: "2026-07-21T10:00:00.000Z",
            },
          ],
        });
      }
      if (body.query.harness_kind === "pi") {
        return okResponse({
          turns: [
            { harness_kind: "pi", agent_session_id: "agent-pi", turn_index: 2, end_time: "2026-07-21T10:00:00.000Z" },
          ],
        });
      }
      // overall latest (no harness filter): pi's turn 2 wins.
      return okResponse({
        turns: [{ harness_kind: "pi", agent_session_id: "agent-pi", turn_index: 2, end_time: "2026-07-21T10:00:00.000Z" }],
      });
    }) as unknown as typeof fetch;

    await hydrateHarnessSessionFromDurable("sess-1", "claude", store, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl,
      log: SILENT,
    });
    assert.equal(
      store.latestTurn("sess-1"),
      2,
      "latest must reflect pi's turn 2, not claude's 1",
    );
    assert.equal(
      isHarnessLoadEligible("sess-1", "claude", store),
      false,
      "claude is stale (turn 1 < latest 2) — must NOT be load-eligible on the restart path",
    );
    // A harness that DID author the latest turn stays eligible after hydrate.
    await hydrateHarnessSessionFromDurable("sess-1", "pi", store, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl,
      log: SILENT,
    });
    assert.equal(isHarnessLoadEligible("sess-1", "pi", store), true);
  });

  it("restores latest_turn_index even for a harness with no record of its own", async () => {
    const store = new SessionContinuityStore();
    await hydrateHarnessSessionFromDurable("sess-1", "codex", store, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init!.body as string) as {
          query: { harness_kind?: string };
        };
        if (body.query.harness_kind === "codex") {
          return okResponse({ turns: [] });
        }
        return okResponse({
          turns: [
            {
              harness_kind: "claude",
              agent_session_id: "agent-claude",
              turn_index: 4,
              end_time: "2026-07-21T10:00:00.000Z",
            },
          ],
        });
      }) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(
      store.get("sess-1", "codex"),
      undefined,
      "codex has no record of its own",
    );
    assert.equal(
      store.latestTurn("sess-1"),
      4,
      "but the conversation counter is still restored",
    );
  });
});

describe("appendSessionTurn", () => {
  it("POSTs a plain create — no GET, one call only", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    await appendSessionTurn(
      "sess-1",
      "claude",
      3,
      { streamId: "stream-1", agentSessionId: "agent-new" },
      {
        apiBase: "http://api:8000",
        authorization: "ApiKey abc",
        fetchImpl: (async (url: string, init?: RequestInit) => {
          calls.push({
            method: init?.method ?? "GET",
            url,
            body: init?.body ? JSON.parse(init.body as string) : undefined,
          });
          return okResponse({ turn: {} });
        }) as unknown as typeof fetch,
        log: SILENT,
      },
    );
    assert.equal(
      calls.length,
      1,
      "append must be a single POST, no read-modify-write",
    );
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].url, "http://api:8000/sessions/turns/");
    assert.deepEqual(calls[0].body, {
      session_id: "sess-1",
      stream_id: "stream-1",
      turn_index: 3,
      harness_kind: "claude",
      agent_session_id: "agent-new",
    });
  });

  it("carries sandbox, references, trace ids, and start_time when given", async () => {
    let body: Record<string, unknown> | undefined;
    await appendSessionTurn(
      "sess-1",
      "claude",
      1,
      {
        streamId: "stream-1",
        agentSessionId: "agent-1",
        sandboxId: "sbx-1",
        references: [{ id: "wf-1" }, { id: "rev-1", version: "v1" }],
        traceId: "trace-abc",
        spanId: "a1b2c3d4e5f6a7b8",
        startTime: "2026-07-21T10:00:00.000Z",
      },
      {
        apiBase: "http://api:8000",
        authorization: "ApiKey abc",
        fetchImpl: (async (_url: string, init?: RequestInit) => {
          body = JSON.parse(init!.body as string);
          return okResponse({ turn: {} });
        }) as unknown as typeof fetch,
        log: SILENT,
      },
    );
    assert.equal(body!["sandbox_id"], "sbx-1");
    assert.deepEqual(body!["references"], [
      { id: "wf-1" },
      { id: "rev-1", version: "v1" },
    ]);
    assert.equal(body!["trace_id"], "trace-abc");
    assert.equal(body!["span_id"], "a1b2c3d4e5f6a7b8");
    assert.equal(body!["start_time"], "2026-07-21T10:00:00.000Z");
  });

  it("treats a resume execution's duplicate-start 409 as benign", async () => {
    const logs: string[] = [];
    await assert.doesNotReject(() =>
      appendSessionTurn(
        "sess-1",
        "claude",
        0,
        { streamId: "stream-1" },
        {
          apiBase: "http://api:8000",
          authorization: "ApiKey abc",
          fetchImpl: (async () => errResponse(409)) as unknown as typeof fetch,
          log: (message) => logs.push(message),
        },
      ),
    );
    assert.deepEqual(logs, []);
  });

  it("never throws when the POST fails (503)", async () => {
    await assert.doesNotReject(() =>
      appendSessionTurn(
        "sess-1",
        "claude",
        0,
        { streamId: "stream-1" },
        {
          apiBase: "http://api:8000",
          authorization: "ApiKey abc",
          fetchImpl: (async () => errResponse(503)) as unknown as typeof fetch,
          log: SILENT,
        },
      ),
    );
  });

  it("never throws when fetch itself throws (network error)", async () => {
    await assert.doesNotReject(() =>
      appendSessionTurn(
        "sess-1",
        "claude",
        0,
        { streamId: "stream-1" },
        {
          apiBase: "http://api:8000",
          authorization: "ApiKey abc",
          fetchImpl: (async () => {
            throw new Error("ECONNREFUSED");
          }) as unknown as typeof fetch,
          log: SILENT,
        },
      ),
    );
  });
});

describe("completeSessionTurn", () => {
  it("a paused-then-completed turn keeps one row and fills its completion fields", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const deps = {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async (url: string, init?: RequestInit) => {
        const body = JSON.parse(init!.body as string) as Record<string, unknown>;
        calls.push({ url, body });
        const key = `${body["session_id"]}:${body["turn_index"]}`;
        if (url.endsWith("/sessions/turns/")) {
          if (rows.has(key)) return errResponse(409);
          rows.set(key, { ...body });
          return okResponse({ turn: rows.get(key) });
        }

        const row = rows.get(key);
        if (!row) return errResponse(404);
        if (!row["end_time"]) {
          row["end_time"] = body["end_time"];
          if (body["agent_session_id"]) {
            row["agent_session_id"] = body["agent_session_id"];
          }
        }
        return okResponse({ turn: row });
      }) as unknown as typeof fetch,
      log: SILENT,
    };

    await appendSessionTurn(
      "sess-1",
      "claude",
      0,
      {
        streamId: "stream-1",
        traceId: "trace-1",
        spanId: "a1b2c3d4e5f6a7b8",
        startTime: "2026-07-21T10:00:00.000Z",
      },
      deps,
    );
    await appendSessionTurn(
      "sess-1",
      "claude",
      0,
      {
        streamId: "stream-1",
        agentSessionId: "agent-1",
        startTime: "2026-07-21T10:01:00.000Z",
      },
      deps,
    );
    await completeSessionTurn(
      "sess-1",
      0,
      {
        agentSessionId: "agent-1",
        endTime: "2026-07-21T10:02:00.000Z",
      },
      deps,
    );

    assert.equal(rows.size, 1);
    assert.deepEqual(rows.get("sess-1:0"), {
      session_id: "sess-1",
      stream_id: "stream-1",
      turn_index: 0,
      harness_kind: "claude",
      trace_id: "trace-1",
      span_id: "a1b2c3d4e5f6a7b8",
      start_time: "2026-07-21T10:00:00.000Z",
      agent_session_id: "agent-1",
      end_time: "2026-07-21T10:02:00.000Z",
    });
    assert.equal(calls[2].url, "http://api:8000/sessions/turns/complete");
    assert.deepEqual(calls[2].body, {
      session_id: "sess-1",
      turn_index: 0,
      agent_session_id: "agent-1",
      end_time: "2026-07-21T10:02:00.000Z",
    });
  });
});

describe("two turns append cleanly (no RMW race)", () => {
  it("appending turn N+1 does not read or depend on turn N's row", async () => {
    // The defining behavioral change: unlike the old GET-then-PUT, two sequential appends never
    // issue a GET, so there is nothing for a concurrent writer to race.
    const posts: Array<Record<string, unknown>> = [];
    const deps = {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        assert.equal(
          init?.method,
          "POST",
          "every call must be a POST, never a GET",
        );
        posts.push(JSON.parse(init!.body as string));
        return okResponse({ turn: {} });
      }) as unknown as typeof fetch,
      log: SILENT,
    };
    await appendSessionTurn(
      "sess-1",
      "claude",
      0,
      { streamId: "stream-1", agentSessionId: "agent-a" },
      deps,
    );
    await appendSessionTurn(
      "sess-1",
      "claude",
      1,
      { streamId: "stream-1", agentSessionId: "agent-b" },
      deps,
    );
    assert.equal(posts.length, 2);
    assert.equal(posts[0]["turn_index"], 0);
    assert.equal(posts[1]["turn_index"], 1);
    assert.equal(posts[1]["agent_session_id"], "agent-b");
  });
});

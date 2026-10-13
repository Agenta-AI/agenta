/**
 * Unit tests for producer-driven record persistence (sessions/persist.ts).
 *
 * Verifies:
 *  - events are POSTed to the ingest endpoint in order
 *  - delta families (message_start/message_delta/message_end) are coalesced into
 *    a single `message` event (stripReplay)
 *  - drainPersist waits for all pending POSTs
 *  - transient failures retry for a time budget; a record that still fails is lost and counted
 *  - the live emitter is always called, even for delta events
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

const postedBodies: unknown[] = [];
let fetchFailCount = 0;

vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(init.body as string) : undefined;
  if (fetchFailCount > 0) {
    fetchFailCount--;
    return new Response("error", { status: 500 });
  }
  postedBodies.push(body);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});

const {
  buildPersistingEmitter,
  drainPersist,
  recordsIncomplete,
  reportRecordsIncomplete,
  takePersistFailures,
} = await import("../../src/sessions/persist.ts");

beforeEach(() => {
  postedBodies.length = 0;
  fetchFailCount = 0;
  vi.unstubAllEnvs();
});

describe("buildPersistingEmitter", () => {
  it("retries an accepted-but-timed-out record with the same id and timestamp", async () => {
    const attempts: any[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      attempts.push(JSON.parse(init!.body as string));
      assert.ok(init!.signal instanceof AbortSignal);
      if (attempts.length === 1) throw new DOMException("Timed out after acceptance", "TimeoutError");
      return new Response("{}", { status: 200 });
    });
    try {
      const emitter = buildPersistingEmitter("retry-timeout", () => "test");
      emitter.persist({ type: "message", text: "hello" }, "user");
      await emitter.flush();
      assert.equal(attempts.length, 2);
      assert.match(attempts[0].record_id, /^[0-9a-f-]{36}$/);
      assert.deepEqual(attempts[0], attempts[1]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("flushes and releases unfinished text and thought prefixes exactly once", async () => {
    const emitter = buildPersistingEmitter("unfinished-prefix", () => "test");
    emitter.emit({ type: "message_start", id: "m" });
    emitter.emit({ type: "message_delta", id: "m", delta: "remember this" });
    emitter.emit({ type: "thought_start", id: "t" });
    emitter.emit({ type: "thought_delta", id: "t", delta: "partial thought" });
    await emitter.flush();
    await emitter.flush();
    const rows = postedBodies as any[];
    assert.deepEqual(rows.map((row) => row.attributes.text), ["remember this", "partial thought"]);
    assert.notEqual(rows[0].record_id, rows[1].record_id);
  });
  it("persists a plain message event and forwards to the live emitter", async () => {
    const live: unknown[] = [];
    const { emit, flush } = buildPersistingEmitter(
      "sess-1",
      () => "Secret t",
      (e) => live.push(e),
    );

    emit({ type: "message", text: "hello" });
    await flush();

    assert.equal(live.length, 1);
    assert.deepEqual(live[0], { type: "message", text: "hello" });
    assert.equal(postedBodies.length, 1);
    const body = postedBodies[0] as Record<string, unknown>;
    assert.equal(body["record_type"], "message");
    assert.equal(body["record_index"], 0);
    assert.equal(body["record_source"], "agent");
  });

  it("forwards transient status data without persisting it", async () => {
    const live: unknown[] = [];
    const { emit, flush } = buildPersistingEmitter(
      "sess-status",
      () => "Secret t",
      (event) => live.push(event),
    );
    const status = {
      type: "data" as const,
      name: "agent-status",
      data: { phase: "environment_starting" },
      transient: true,
    };

    emit(status);
    await flush();

    assert.deepEqual(live, [status]);
    assert.equal(postedBodies.length, 0);
  });

  it("persist() records an out-of-band user turn through the same index counter", async () => {
    const live: unknown[] = [];
    const { emit, persist, flush } = buildPersistingEmitter(
      "sess-user",
      () => "Secret t",
      (e) => live.push(e),
    );

    persist(
      {
        type: "message",
        text: "what time is it?",
        attachments: [
          {
            attachmentId: "019a52c2-14c0-7c14-b874-2f5798f9cd21",
            filename: "clock.png",
          },
        ],
      },
      "user",
    );
    emit({ type: "message", text: "it is noon" });
    emit({ type: "done" });
    await flush();

    // The user record never hits the live stream.
    assert.equal(live.length, 2);
    assert.equal(postedBodies.length, 3);
    const bodies = postedBodies as Array<Record<string, unknown>>;
    assert.deepEqual(
      bodies.map((b) => [b["record_index"], b["record_source"]]),
      [
        [0, "user"],
        [1, "agent"],
        [2, "agent"],
      ],
    );
    const userPayload = bodies[0]["attributes"] as Record<string, unknown>;
    assert.equal(userPayload["text"], "what time is it?");
    assert.deepEqual(userPayload["attachments"], [
      {
        attachmentId: "019a52c2-14c0-7c14-b874-2f5798f9cd21",
        filename: "clock.png",
      },
    ]);
  });

  it("coalesces message_start/delta/end into a single persisted message", async () => {
    const live: unknown[] = [];
    const { emit, flush } = buildPersistingEmitter(
      "sess-2",
      () => "Secret t",
      (e) => live.push(e),
    );

    emit({ type: "message_start", id: "m1" });
    emit({ type: "message_delta", id: "m1", delta: "hel" });
    emit({ type: "message_delta", id: "m1", delta: "lo" });
    emit({ type: "message_end", id: "m1" });
    await flush();

    // Live emitter sees all four events.
    assert.equal(live.length, 4);
    // Persist sees only one coalesced message.
    assert.equal(postedBodies.length, 1);
    const body = postedBodies[0] as Record<string, unknown>;
    const payload = body["attributes"] as Record<string, unknown>;
    assert.equal(payload["type"], "message");
    assert.equal(payload["text"], "hello");
  });

  it("persists done and tool events as-is", async () => {
    const { emit, flush } = buildPersistingEmitter("sess-3", () => "Secret t");

    emit({ type: "tool_call", name: "search", input: { q: "test" } });
    emit({ type: "done", stopReason: "end_turn" });
    await flush();

    assert.equal(postedBodies.length, 2);
    const types = (postedBodies as Array<Record<string, unknown>>).map(
      (b) => (b["attributes"] as Record<string, unknown>)["type"],
    );
    assert.deepEqual(types, ["tool_call", "done"]);
  });

  it("scopes stable tool ids by execution while re-persisting reuses the row", async () => {
    const first = buildPersistingEmitter(
      "sess-shared-tool",
      () => "Secret t",
      undefined,
      undefined,
      "turn-a",
    );
    first.emit({ type: "tool_result", id: "call-shared", output: "ok" });
    first.emit({ type: "tool_result", id: "call-shared", output: "ok" });
    await first.flush();

    const second = buildPersistingEmitter(
      "sess-shared-tool",
      () => "Secret t",
      undefined,
      undefined,
      "turn-b",
    );
    second.emit({ type: "tool_result", id: "call-shared", output: "ok" });
    await second.flush();

    const bodies = postedBodies as Array<Record<string, unknown>>;
    assert.equal(bodies.length, 3);
    assert.equal(bodies[0]["record_id"], bodies[1]["record_id"]);
    assert.notEqual(bodies[0]["record_id"], bodies[2]["record_id"]);
    assert.deepEqual(
      bodies.map((body) => body["turn_id"]),
      ["turn-a", "turn-a", "turn-b"],
    );
  });

  it("gives interaction responses a retry-stable id distinct from the request", async () => {
    const { emit, flush } = buildPersistingEmitter(
      "sess-interaction",
      () => "Secret t",
    );

    emit({
      type: "interaction_request",
      id: "approval-1",
      kind: "user_approval",
    });
    emit({
      type: "interaction_response",
      id: "approval-1",
      kind: "user_approval",
      payload: { toolCallId: "tool-1", approved: true },
    });
    emit({
      type: "interaction_response",
      id: "approval-1",
      kind: "user_approval",
      payload: { toolCallId: "tool-1", approved: true },
    });
    await flush();

    const bodies = postedBodies as Array<Record<string, unknown>>;
    assert.ok(typeof bodies[0]["record_id"] === "string");
    assert.ok(typeof bodies[1]["record_id"] === "string");
    assert.notEqual(bodies[0]["record_id"], bodies[1]["record_id"]);
    assert.equal(bodies[1]["record_id"], bodies[2]["record_id"]);
  });

  it("record_index increments monotonically across events", async () => {
    const { emit, flush } = buildPersistingEmitter("sess-4", () => "Secret t");

    emit({ type: "message", text: "a" });
    emit({ type: "message", text: "b" });
    emit({ type: "done" });
    await flush();

    const indices = (postedBodies as Array<Record<string, unknown>>).map(
      (b) => b["record_index"],
    );
    assert.deepEqual(indices, [0, 1, 2]);
  });

  it("coalesces tool_call snapshots for one id into a single record with final args", async () => {
    const live: unknown[] = [];
    const { emit, flush } = buildPersistingEmitter(
      "sess-tc",
      () => "Secret t",
      (e) => live.push(e),
    );

    // A tool call streams a growing partial-args snapshot for one id.
    emit({ type: "tool_call", id: "call_1", name: "bash", input: {} });
    emit({
      type: "tool_call",
      id: "call_1",
      name: "bash",
      input: { command: "fi" },
    });
    emit({
      type: "tool_call",
      id: "call_1",
      name: "bash",
      input: { command: "find ." },
    });
    // A different step closes the open call.
    emit({ type: "tool_result", id: "call_1", output: "ok" });
    emit({ type: "done" });
    await flush();

    // Live stream sees every raw snapshot.
    assert.equal(live.length, 5);
    // Storage sees one tool_call (final args) + one tool_result + done.
    const bodies = postedBodies as Array<Record<string, unknown>>;
    const types = bodies.map(
      (b) => (b["attributes"] as Record<string, unknown>)["type"],
    );
    assert.deepEqual(types, ["tool_call", "tool_result", "done"]);
    const call = bodies[0]["attributes"] as Record<string, unknown>;
    assert.deepEqual(call["input"], { command: "find ." });
    // tool_call is stamped with a stable id and keeps the earlier index (ahead of result).
    assert.ok(typeof bodies[0]["record_id"] === "string");
    assert.equal(bodies[0]["record_index"], 0);
    assert.equal(bodies[1]["record_index"], 1);
    // tool_call and its tool_result get distinct stable ids (keyed on the record type).
    assert.notEqual(bodies[0]["record_id"], bodies[1]["record_id"]);
  });

  it("a different tool id flushes the previous open call", async () => {
    const { emit, flush } = buildPersistingEmitter(
      "sess-tc2",
      () => "Secret t",
    );

    emit({
      type: "tool_call",
      id: "call_a",
      name: "read",
      input: { path: "/x" },
    });
    emit({
      type: "tool_call",
      id: "call_b",
      name: "read",
      input: { path: "/y" },
    });
    await flush();

    const bodies = postedBodies as Array<Record<string, unknown>>;
    const inputs = bodies.map(
      (b) => (b["attributes"] as Record<string, unknown>)["input"],
    );
    assert.deepEqual(inputs, [{ path: "/x" }, { path: "/y" }]);
    assert.deepEqual(
      bodies.map((b) => b["record_index"]),
      [0, 1],
    );
  });

  it("flushes an open (paused) tool_call on drain", async () => {
    const { emit, flush } = buildPersistingEmitter(
      "sess-tc3",
      () => "Secret t",
    );

    // A paused call ends the turn with its slot still open.
    emit({
      type: "tool_call",
      id: "call_p",
      name: "bash",
      input: { command: "ls" },
    });
    await flush();

    const bodies = postedBodies as Array<Record<string, unknown>>;
    assert.equal(bodies.length, 1);
    assert.equal(
      (bodies[0]["attributes"] as Record<string, unknown>)["type"],
      "tool_call",
    );
  });

  it("flushes an open tool_call when the idle TTL fires", async () => {
    vi.useFakeTimers();
    try {
      const { emit, flush } = buildPersistingEmitter(
        "sess-tc4",
        () => "Secret t",
      );

      emit({
        type: "tool_call",
        id: "call_ttl",
        name: "bash",
        input: { command: "x" },
      });
      // Nothing follows; only the TTL can close it.
      assert.equal(postedBodies.length, 0);
      await vi.advanceTimersByTimeAsync(3000);
      assert.equal(postedBodies.length, 1);
      assert.equal(
        (
          (postedBodies[0] as Record<string, unknown>)["attributes"] as Record<
            string,
            unknown
          >
        )["type"],
        "tool_call",
      );
      await flush();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("buildPersistingEmitter turn/span tagging", () => {
  it("stamps turn_id and span_id on every posted record when both are supplied", async () => {
    // A real 16-hex OTel span id (the runContext.trace.span_id shape), NOT a UUID — the API
    // types this field as a 16-hex string, so anything else 422s (FINDING-record-ingest-422).
    const spanId = "a1b2c3d4e5f6a7b8";
    const { emit, persist, flush } = buildPersistingEmitter(
      "sess-turn",
      () => "Secret t",
      undefined,
      undefined,
      "turn-abc",
      spanId,
    );

    persist({ type: "message", text: "hi" }, "user");
    emit({ type: "message", text: "hello" });
    emit({ type: "done" });
    await flush();

    const bodies = postedBodies as Array<Record<string, unknown>>;
    assert.equal(bodies.length, 3);
    for (const body of bodies) {
      assert.equal(body["turn_id"], "turn-abc");
      assert.equal(body["span_id"], spanId);
    }
  });

  it("omits turn_id/span_id from the body when neither is supplied", async () => {
    const { emit, flush } = buildPersistingEmitter(
      "sess-noturn",
      () => "Secret t",
    );

    emit({ type: "message", text: "hello" });
    await flush();

    const body = postedBodies[0] as Record<string, unknown>;
    assert.equal("turn_id" in body, false);
    assert.equal("span_id" in body, false);
  });

  it("stamps turn_id on coalesced and tool-call records too", async () => {
    const { emit, flush } = buildPersistingEmitter(
      "sess-turn-tc",
      () => "Secret t",
      undefined,
      undefined,
      "turn-tc",
    );

    emit({ type: "message_start", id: "m1" });
    emit({ type: "message_delta", id: "m1", delta: "hi" });
    emit({ type: "message_end", id: "m1" });
    emit({
      type: "tool_call",
      id: "call_1",
      name: "bash",
      input: { command: "ls" },
    });
    emit({ type: "tool_result", id: "call_1", output: "ok" });
    await flush();

    const liveBatches = postedBodies.filter(Array.isArray);
    assert.equal(liveBatches.length, 1);
    for (const frame of liveBatches[0]) {
      assert.equal(frame.execution_id, "turn-tc");
    }
    const bodies = (postedBodies as Array<Record<string, unknown>>).filter(
      (body) => "record_type" in body,
    );
    assert.equal(bodies.length, 3);
    assert.equal(
      (bodies[0]["attributes"] as Record<string, unknown>)["message_id"],
      "m1",
    );
    for (const body of bodies) {
      assert.equal(body["turn_id"], "turn-tc");
      assert.equal("span_id" in body, false);
    }
  });
});

describe("buildPersistingEmitter API contract", () => {
  // The API's SessionRecordIngestRequest types span_id as a 16-hex OTel span id. A stub that
  // returns 200 for ANY body (like the other tests here) hid the real bug: the field used to
  // be typed as UUID and every ingest 422'd. This stub enforces the real contract, so a
  // regression to a non-span-shaped span_id fails here instead of silently dropping records.
  const OTEL_SPAN_ID = /^[0-9a-fA-F]{16}$/;

  it("emits a span_id the API contract accepts (16-hex OTel span id, not a UUID)", async () => {
    const accepted: Array<Record<string, unknown>> = [];
    const rejected: Array<Record<string, unknown>> = [];
    const contractFetch = (async (_url: string, init?: RequestInit) => {
      const body = init?.body
        ? (JSON.parse(init.body as string) as Record<string, unknown>)
        : {};
      if (
        body.span_id !== undefined &&
        !OTEL_SPAN_ID.test(String(body.span_id))
      ) {
        rejected.push(body);
        return new Response(JSON.stringify({ detail: "uuid_parsing" }), {
          status: 422,
        });
      }
      accepted.push(body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const prior = globalThis.fetch;
    globalThis.fetch = contractFetch;
    try {
      const spanId = "a1b2c3d4e5f6a7b8"; // the runContext.trace.span_id shape
      const { emit, persist, flush } = buildPersistingEmitter(
        "sess-contract",
        () => "Secret t",
        undefined,
        undefined,
        "turn-1",
        spanId,
      );
      persist({ type: "message", text: "hi" }, "user");
      emit({ type: "message", text: "hello" });
      emit({ type: "done" });
      await flush();

      // Every record cleared the contract-validating stub; nothing 422'd or dropped.
      assert.equal(rejected.length, 0);
      assert.equal(accepted.length, 3);
      for (const body of accepted)
        assert.match(String(body.span_id), OTEL_SPAN_ID);
    } finally {
      globalThis.fetch = prior;
    }
  });

  it("the contract stub has teeth: a non-span-shaped span_id would 422", () => {
    // Guards the test above: the old mock returned 200 for any body, so a UUID (or any
    // arbitrary string) sailed through. The real contract rejects both.
    assert.equal(OTEL_SPAN_ID.test("a1b2c3d4e5f6a7b8"), true);
    assert.equal(OTEL_SPAN_ID.test("span-def"), false);
    assert.equal(OTEL_SPAN_ID.test("f".repeat(32)), false); // a UUID (32 hex) is not a span id
  });
});

describe("durable records", () => {
  /** A fetch that answers each ingest from `answer`, recording the bodies that landed. */
  function stubIngest(answer: (body: any, attempt: number) => Response | Error) {
    const landed: any[] = [];
    const auths: string[] = [];
    let attempt = 0;
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse(init!.body as string);
        auths.push(new Headers(init!.headers).get("authorization") ?? "");
        const out = answer(body, ++attempt);
        if (out instanceof Error) throw out;
        if (out.ok) landed.push(body);
        return out;
      });
    return { landed, auths, restore: () => spy.mockRestore(), attempts: () => attempt };
  }

  it("retries a transient failure until it lands (no drop)", async () => {
    vi.stubEnv("AGENTA_RECORDS_INGEST_RETRY_BUDGET_MS", "5000");
    const ingest = stubIngest((_b, n) =>
      n === 1 ? new Response("", { status: 503 })
        : n === 2 ? new Response("", { status: 429 })
        : n === 3 ? new TypeError("fetch failed")
        : new Response("{}", { status: 200 }),
    );
    try {
      const { emit, flush } = buildPersistingEmitter("sess-recover", () => "t");
      emit({ type: "message", text: "x" });
      await flush();
      assert.equal(ingest.attempts(), 4);
      assert.equal(ingest.landed.length, 1);
      assert.equal(takePersistFailures("sess-recover"), 0);
      assert.equal(recordsIncomplete("sess-recover"), false);
    } finally {
      ingest.restore();
    }
  });

  it("does not retry a non-transient 4xx: the record is lost, counted and marked", async () => {
    vi.stubEnv("AGENTA_RECORDS_INGEST_RETRY_BUDGET_MS", "5000");
    const ingest = stubIngest((body) =>
      body.record_type === "message"
        ? new Response("", { status: 422 })
        : new Response("{}", { status: 200 }),
    );
    try {
      const { emit } = buildPersistingEmitter("sess-422", () => "t");
      emit({ type: "message", text: "x" });
      emit({ type: "done" });
      await drainPersist("sess-422");
      // One attempt for the 422, then the next record still goes out (one attempt: it lands).
      assert.equal(ingest.attempts(), 2);
      assert.deepEqual(ingest.landed.map((b) => b.record_type), ["done"]);
      assert.equal(takePersistFailures("sess-422"), 1);
      assert.equal(recordsIncomplete("sess-422"), true);
    } finally {
      ingest.restore();
    }
  });

  it("loses a record when the budget runs out; later records get one attempt each", async () => {
    vi.stubEnv("AGENTA_RECORDS_INGEST_RETRY_BUDGET_MS", "250");
    const errors: string[] = [];
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation((...args) => void errors.push(args.join(" ")));
    const bodies: any[] = [];
    const ingest = stubIngest((body) => {
      bodies.push(body);
      return new Response("", { status: 500 });
    });
    try {
      const { emit, flush } = buildPersistingEmitter("sess-budget", () => "t", undefined, undefined, "turn-1");
      emit({ type: "message", text: "a" });
      emit({ type: "message", text: "b" });
      emit({ type: "done" });
      await flush();
      const first = bodies.filter((b) => b.attributes.text === "a");
      assert.ok(first.length >= 2, `the first record retried: ${first.length}`);
      // Every retry is the same row: same record id and timestamp.
      assert.ok(first.every((b) => JSON.stringify(b) === JSON.stringify(first[0])));
      // The log already has a hole, so the records behind it do not wait out a full budget.
      assert.equal(bodies.filter((b) => b.attributes.text === "b").length, 1);
      assert.equal(bodies.filter((b) => b.record_type === "done").length, 1);
      assert.equal(takePersistFailures("sess-budget"), 3);
      assert.equal(recordsIncomplete("sess-budget"), true);
      // One alertable line, at ERROR, per lost record.
      const drops = errors.filter((line) => line.includes("[sessions/persist] RECORD_DROPPED"));
      assert.equal(drops.length, 3);
      assert.ok(drops.every((line) => /"outcome":"lost"/.test(line)));
    } finally {
      ingest.restore();
      errorSpy.mockRestore();
    }
  });

  it("the turn-end flush leaves the loss count for the caller (does not consume it)", async () => {
    vi.stubEnv("AGENTA_RECORDS_INGEST_RETRY_BUDGET_MS", "0");
    const ingest = stubIngest(() => new Response("", { status: 403 }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { emit, flush } = buildPersistingEmitter("sess-flush", () => "t");
      emit({ type: "message", text: "x" });
      await flush();
      // flush drains but MUST NOT consume the count. The turn's caller (server.ts's finally)
      // reads it once, after the drain, to decide whether to report the session's record log
      // incomplete. If flush consumed it here, that caller would read zero.
      assert.equal(takePersistFailures("sess-flush"), 1);
      assert.equal(takePersistFailures("sess-flush"), 0);
    } finally {
      ingest.restore();
      errorSpy.mockRestore();
    }
  });
});

describe("reportRecordsIncomplete", () => {
  it("posts the session and turn to the api and marks the session here", async () => {
    const calls: Array<{ url: string; body: unknown; auth: string | null }> = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        calls.push({
          url: String(url),
          body: JSON.parse(init!.body as string),
          auth: new Headers(init!.headers).get("authorization"),
        });
        return new Response("{}", { status: 200 });
      });
    try {
      await reportRecordsIncomplete("sess-report", "turn-9", () => "ApiKey t");
    } finally {
      fetchSpy.mockRestore();
    }
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/sessions\/records\/incomplete$/);
    assert.deepEqual(calls[0].body, {
      session_id: "sess-report",
      turn_id: "turn-9",
    });
    assert.equal(calls[0].auth, "ApiKey t");
    assert.equal(recordsIncomplete("sess-report"), true);
  });

  it("a failed report is swallowed and the local mark still holds", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        throw new Error("ECONNREFUSED");
      });
    try {
      await assert.doesNotReject(() =>
        reportRecordsIncomplete("sess-report-down", "turn-1", () => "t"),
      );
    } finally {
      fetchSpy.mockRestore();
    }
    assert.equal(recordsIncomplete("sess-report-down"), true);
  });
});

describe("drainPersist", () => {
  it("resolves immediately when no events are pending", async () => {
    await assert.doesNotReject(() => drainPersist("no-session"));
  });

  it("waits for all queued events before resolving", async () => {
    const { emit, flush } = buildPersistingEmitter(
      "sess-drain",
      () => "Secret t",
    );
    emit({ type: "message", text: "x" });
    emit({ type: "done" });
    await flush(); // same as drainPersist internally
    assert.equal(postedBodies.length, 2);
  });
});

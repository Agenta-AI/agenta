/**
 * Characterization tests for stable `record_id` semantics (spike D).
 *
 * These tests pin what the runner PRODUCES today and what the durable store then HOLDS,
 * under the two candidate storage policies:
 *
 *   - "upsert"      — today: `ON CONFLICT (project_id, record_id) DO UPDATE`, which
 *                     overwrites record_type, record_source, timestamp, attributes,
 *                     turn_id and span_id, and keeps record_index and created_at
 *                     (`api/oss/src/dbs/postgres/sessions/records/dao.py:123-136`).
 *   - "insert-only" — the immutable-history proposal: `ON CONFLICT DO NOTHING`.
 *
 * Every test states, in a comment, what must change when inserts become immutable.
 * A test that fails after that change is the signal, not a nuisance.
 *
 * See `docs/design/session-control-and-live-events/spike-d-stable-record-ids.md`.
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

interface IngestBody {
  session_id: string;
  record_id?: string;
  record_index: number;
  timestamp: string;
  record_source: string;
  record_type: string;
  attributes: Record<string, unknown>;
  turn_id?: string;
}

const postedBodies: IngestBody[] = [];

// Two milliseconds per POST so consecutive records get distinct `timestamp` values, the
// way a real HTTP round trip does. The store simulator below reads that ordering key, so
// an upsert that moves a row's timestamp forward is visible as a re-sort.
vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
  await new Promise((r) => setTimeout(r, 2));
  postedBodies.push(JSON.parse(init?.body as string) as IngestBody);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});

const { buildPersistingEmitter } = await import("../../src/sessions/persist.ts");
const { reconstructMessages } = await import("../../src/sessions/reconstruct.ts");
import type { SessionRecordRow } from "../../src/sessions/reconstruct.ts";

type StorePolicy = "upsert" | "insert-only";

/**
 * Apply one ingest batch to a simulated `records` table and return the rows in the order
 * `get_records` returns them (`ORDER BY timestamp, created_at, record_index`).
 *
 * A body with no `record_id` gets a fresh uuid4 server-side
 * (`api/oss/src/dbs/postgres/sessions/records/mappings.py:20`), so it can never conflict.
 */
function applyStore(
  bodies: readonly IngestBody[],
  policy: StorePolicy,
): SessionRecordRow[] {
  interface Row {
    seq: number;
    recordIndex: number;
    body: IngestBody;
  }
  const rows: Row[] = [];
  const byId = new Map<string, Row>();
  let minted = 0;

  for (const body of bodies) {
    const key = body.record_id ?? `minted-uuid4-${minted++}`;
    const existing = byId.get(key);
    if (!existing) {
      const row: Row = {
        seq: rows.length,
        recordIndex: body.record_index,
        body: { ...body },
      };
      rows.push(row);
      byId.set(key, row);
      continue;
    }
    // ON CONFLICT DO NOTHING: the first write wins, forever.
    if (policy === "insert-only") continue;
    // ON CONFLICT DO UPDATE: the payload columns take the new value; record_index and
    // created_at keep the first write's value.
    existing.body = { ...body, record_index: existing.recordIndex };
  }

  return [...rows]
    .sort((a, b) =>
      a.body.timestamp === b.body.timestamp
        ? a.seq - b.seq
        : a.body.timestamp < b.body.timestamp
          ? -1
          : 1,
    )
    .map((row) => ({
      record_source: row.body.record_source,
      record_type: row.body.record_type,
      attributes: row.body.attributes,
      turn_id: row.body.turn_id ?? null,
      record_index: row.body.record_index,
    }));
}

/** The `attributes.input` of every stored `tool_call` row, in read order. */
function toolCallInputs(rows: SessionRecordRow[]): unknown[] {
  return rows
    .filter((row) => row.record_type === "tool_call")
    .map((row) => (row.attributes as Record<string, unknown>).input);
}

/** The `attributes.id` of every stored row of one type, in read order. */
function idsOfType(rows: SessionRecordRow[], type: string): unknown[] {
  return rows
    .filter((row) => row.record_type === type)
    .map((row) => (row.attributes as Record<string, unknown>).id);
}

beforeEach(() => {
  postedBodies.length = 0;
});

describe("stable record_id: exact delivery retry", () => {
  it("re-emitting one interaction_response inside a turn is an idempotent no-op", async () => {
    // Shape: `resolveInteractionToken` re-emits the same answer for an already-resolved
    // token, same id and same payload (`run-turn.ts:736-751`).
    const { emit, flush } = buildPersistingEmitter(
      "sess-retry",
      () => "Secret t",
      undefined,
      undefined,
      "turn-1",
    );
    const answer = {
      type: "interaction_response" as const,
      id: "approval-1",
      kind: "user_approval" as const,
      payload: { toolCallId: "tool-1", approved: true },
    };
    emit({ type: "interaction_request", id: "approval-1", kind: "user_approval" });
    emit(answer);
    emit(answer);
    await flush();

    assert.equal(postedBodies.length, 3);
    // The two answers carry one id; the request carries a different one (record type is
    // part of the uuid5 key).
    assert.equal(postedBodies[1].record_id, postedBodies[2].record_id);
    assert.notEqual(postedBodies[0].record_id, postedBodies[1].record_id);

    // Both policies store two rows and the payloads are identical, so nothing is lost.
    for (const policy of ["upsert", "insert-only"] as StorePolicy[]) {
      const rows = applyStore(postedBodies, policy);
      assert.equal(rows.length, 2, policy);
      assert.deepEqual(idsOfType(rows, "interaction_response"), ["approval-1"], policy);
    }

    // WHEN INSERTS BECOME IMMUTABLE: this test must keep passing unchanged. It is the one
    // repeated-id case that an immutable insert already handles correctly.
  });
});

describe("stable record_id: progressive update inside one turn", () => {
  it("three argument snapshots then a result coalesce into two records", async () => {
    // The happy path: one open tool slot absorbs every snapshot, so only the final
    // arguments are ever POSTed. No id repeats.
    const { emit, flush } = buildPersistingEmitter(
      "sess-coalesce",
      () => "Secret t",
      undefined,
      undefined,
      "turn-1",
    );
    emit({ type: "tool_call", id: "call_1", name: "bash", input: {} });
    emit({ type: "tool_call", id: "call_1", name: "bash", input: { command: "fi" } });
    emit({ type: "tool_call", id: "call_1", name: "bash", input: { command: "find ." } });
    emit({ type: "tool_result", id: "call_1", output: "found" });
    await flush();

    assert.equal(postedBodies.length, 2);
    assert.notEqual(postedBodies[0].record_id, postedBodies[1].record_id);
    const ids = postedBodies.map((body) => body.record_id);
    assert.equal(new Set(ids).size, 2, "no id is sent twice");

    // Identical under both policies: coalescing already produced one final fact per object.
    for (const policy of ["upsert", "insert-only"] as StorePolicy[]) {
      const rows = applyStore(postedBodies, policy);
      assert.deepEqual(toolCallInputs(rows), [{ command: "find ." }], policy);
      assert.deepEqual(
        reconstructMessages(rows),
        [
          {
            role: "assistant",
            content: [
              {
                type: "tool_call",
                toolCallId: "call_1",
                toolName: "bash",
                input: { command: "find ." },
              },
              {
                type: "tool_result",
                toolCallId: "call_1",
                toolName: "bash",
                output: "found",
                isError: undefined,
              },
            ],
          },
        ],
        policy,
      );
    }

    // WHEN INSERTS BECOME IMMUTABLE: this test must keep passing unchanged.
  });

  it("interleaved tool calls re-open a flushed id and send it twice", async () => {
    // Reachable in production: a harness announces a call with empty arguments and fills
    // them on a later `tool_call_update` (`tracing/otel.ts:1872-1876`, and the refresh at
    // :1911-1922). With two calls in flight the second announcement flushes the first slot
    // with EMPTY arguments, and the first call's later update re-opens the same id.
    const { emit, flush } = buildPersistingEmitter(
      "sess-interleave",
      () => "Secret t",
      undefined,
      undefined,
      "turn-1",
    );
    emit({ type: "tool_call", id: "call_a", name: "bash", input: {} });
    emit({ type: "tool_call", id: "call_b", name: "read", input: { path: "/y" } });
    emit({ type: "tool_call", id: "call_a", name: "bash", input: { command: "ls -la" } });
    await flush();

    assert.equal(postedBodies.length, 3);
    // The same record_id is sent twice with DIFFERENT payloads. This is a progressive
    // update, not a delivery retry.
    assert.equal(postedBodies[0].record_id, postedBodies[2].record_id);
    assert.deepEqual(postedBodies[0].attributes.input, {});
    assert.deepEqual(postedBodies[2].attributes.input, { command: "ls -la" });
    // The re-opened slot claims a NEW record_index that the upsert then discards.
    assert.deepEqual(
      postedBodies.map((body) => body.record_index),
      [0, 1, 2],
    );

    const upserted = applyStore(postedBodies, "upsert");
    // Today the arguments are repaired...
    assert.deepEqual(toolCallInputs(upserted), [
      { path: "/y" },
      { command: "ls -la" },
    ]);
    // ...but the repaired row also took the retry's timestamp, so it now sorts AFTER the
    // call that flushed it. The transcript shows call_b before call_a even though call_a
    // was announced first. That is a live ordering defect of the upsert, not of the
    // proposal.
    assert.deepEqual(idsOfType(upserted, "tool_call"), ["call_b", "call_a"]);

    const insertOnly = applyStore(postedBodies, "insert-only");
    // Under immutable insert the order is right but the arguments are lost forever: the
    // durable tool call records an EMPTY input for a command that really ran.
    assert.deepEqual(idsOfType(insertOnly, "tool_call"), ["call_a", "call_b"]);
    assert.deepEqual(toolCallInputs(insertOnly), [{}, { path: "/y" }]);

    // Harness reconstruction inherits the loss: the rebuilt conversation tells the model
    // the agent called bash with no arguments.
    const rebuilt = reconstructMessages(insertOnly);
    const blocks = rebuilt[0].content as Array<Record<string, unknown>>;
    const callA = blocks.find((block) => block.toolCallId === "call_a");
    assert.deepEqual(callA?.input, {});

    // WHEN INSERTS BECOME IMMUTABLE: this case must stop reaching storage as a repeat.
    // Either the runner holds every open tool slot until the call closes (no early flush
    // on a different id), or the later snapshot is appended as its own event with its own
    // event id and the reader folds by `attributes.id`. A plain `ON CONFLICT DO NOTHING`
    // over today's producer loses the arguments. Then update the `insert-only` assertions
    // above to the new expected end state.
  });

  it("the open-tool TTL flushes early arguments and the next snapshot repeats the id", async () => {
    // A tool call that streams its arguments slowly crosses the 3 s idle window
    // (`persist.ts:233`), so the slot flushes with a partial payload and the next
    // snapshot re-opens the same id.
    vi.stubEnv("AGENTA_RECORD_TOOL_TTL_MS", "10");
    const persist = await import("../../src/sessions/persist.ts?ttl-reload");
    const { emit, flush } = persist.buildPersistingEmitter(
      "sess-ttl",
      () => "Secret t",
      undefined,
      undefined,
      "turn-1",
    );
    emit({ type: "tool_call", id: "call_slow", name: "bash", input: {} });
    await new Promise((r) => setTimeout(r, 60));
    emit({
      type: "tool_call",
      id: "call_slow",
      name: "bash",
      input: { command: "rg pattern" },
    });
    await flush();
    vi.unstubAllEnvs();

    assert.equal(postedBodies.length, 2);
    assert.equal(postedBodies[0].record_id, postedBodies[1].record_id);
    assert.deepEqual(postedBodies[0].attributes.input, {});

    assert.deepEqual(toolCallInputs(applyStore(postedBodies, "upsert")), [
      { command: "rg pattern" },
    ]);
    assert.deepEqual(toolCallInputs(applyStore(postedBodies, "insert-only")), [{}]);

    // WHEN INSERTS BECOME IMMUTABLE: same fix as the interleaved case. The TTL exists
    // because a harness may never close a streaming call, so it cannot simply be removed.
  });

  it("a tool_result sent twice in one turn keeps only the last payload today", async () => {
    // Shape: a settle path emits a placeholder result for a still-open call and the real
    // result lands afterwards (`tracing/otel.ts:1979-1993` settleOpenToolCalls, then
    // maybeCloseTool for the same id in a later update).
    const { emit, flush } = buildPersistingEmitter(
      "sess-result-twice",
      () => "Secret t",
      undefined,
      undefined,
      "turn-1",
    );
    emit({ type: "tool_call", id: "call_1", name: "bash", input: { command: "sleep 1" } });
    emit({ type: "tool_result", id: "call_1", output: "" });
    emit({ type: "tool_result", id: "call_1", output: "exit 0\n42 files" });
    await flush();

    assert.equal(postedBodies.length, 3);
    assert.equal(postedBodies[1].record_id, postedBodies[2].record_id);

    const upserted = applyStore(postedBodies, "upsert");
    const upsertBlocks = reconstructMessages(upserted)[0].content as Array<
      Record<string, unknown>
    >;
    assert.equal(
      upsertBlocks.find((block) => block.type === "tool_result")?.output,
      "exit 0\n42 files",
    );

    const insertOnly = applyStore(postedBodies, "insert-only");
    const insertOnlyBlocks = reconstructMessages(insertOnly)[0].content as Array<
      Record<string, unknown>
    >;
    // The first snapshot has an empty output, so immutable insert pins the tool result to
    // "" and the model is told the command produced nothing.
    assert.equal(
      insertOnlyBlocks.find((block) => block.type === "tool_result")?.output,
      "",
    );

    // WHEN INSERTS BECOME IMMUTABLE: the runner must send exactly one durable
    // `tool_result` per call per turn, or send the second snapshot as a distinct event id
    // that the reader folds by `attributes.id` (last one wins). Update the `insert-only`
    // expectation to the final output once that lands.
  });
});

describe("stable record_id: resume re-emission across turns", () => {
  it("a resume re-emits the answer under a new turn, so it becomes a second row", async () => {
    // Every send, steer and approval resume mints a fresh turn id
    // (`api/oss/src/core/sessions/streams/service.py:947`), and `turnId` is part of the
    // uuid5 key (`sessions/record-id.ts:41-50`). A resume therefore never upserts the
    // original turn's rows: it appends.
    const first = buildPersistingEmitter(
      "sess-resume",
      () => "Secret t",
      undefined,
      undefined,
      "turn-1",
    );
    first.persist({ type: "message", text: "delete the file" }, "user");
    first.emit({ type: "tool_call", id: "call_rm", name: "bash", input: { command: "rm x" } });
    first.emit({ type: "interaction_request", id: "gate-1", kind: "user_approval" });
    first.emit({ type: "done", stopReason: "paused" });
    await first.flush();

    const second = buildPersistingEmitter(
      "sess-resume",
      () => "Secret t",
      undefined,
      undefined,
      "turn-2",
    );
    second.emit({
      type: "interaction_response",
      id: "gate-1",
      kind: "user_approval",
      payload: { toolCallId: "call_rm", approved: true },
    });
    second.emit({ type: "tool_result", id: "call_rm", output: "removed" });
    second.emit({ type: "done" });
    await second.flush();

    const turn1 = postedBodies.filter((body) => body.turn_id === "turn-1");
    const turn2 = postedBodies.filter((body) => body.turn_id === "turn-2");
    assert.equal(turn1.length, 4);
    assert.equal(turn2.length, 3);
    // No id is shared across the two turns, so no cross-turn conflict exists.
    const turn1Ids = new Set(turn1.map((body) => body.record_id).filter(Boolean));
    for (const body of turn2) {
      if (body.record_id) assert.ok(!turn1Ids.has(body.record_id));
    }

    // Both policies store all seven rows, and reconstruction is identical.
    for (const policy of ["upsert", "insert-only"] as StorePolicy[]) {
      const rows = applyStore(postedBodies, policy);
      assert.equal(rows.length, 7, policy);
      const rebuilt = reconstructMessages(rows);
      assert.deepEqual(rebuilt[0], { role: "user", content: "delete the file" }, policy);
      const blocks = rebuilt[1].content as Array<Record<string, unknown>>;
      assert.deepEqual(
        blocks.map((block) => block.type),
        ["tool_call", "tool_result"],
        policy,
      );
      assert.equal(
        blocks.find((block) => block.type === "tool_result")?.output,
        "removed",
        policy,
      );
    }

    // WHEN INSERTS BECOME IMMUTABLE: this test must keep passing unchanged. Resume is
    // already append-only. Note that the paired `tool_call` (turn-1) and `tool_result`
    // (turn-2) are separate rows in separate turns; any migration that scopes an event id
    // to a turn must keep them paired by `attributes.id`, which is how both readers bind
    // them (`sessions/reconstruct.ts:60-68`, `interactions_dispatcher.py:123-149`).
  });

  it("the same gate re-raised in a later turn appends rather than overwriting", async () => {
    // `resolveInteractionToken` re-emits an answer for a token claimed in an EARLIER turn
    // (`run-turn.ts:745-751`: "a client can see it twice for the same id").
    const answer = {
      type: "interaction_response" as const,
      id: "gate-9",
      kind: "user_approval" as const,
      payload: { toolCallId: "call_9", approved: true },
    };
    const first = buildPersistingEmitter(
      "sess-regate",
      () => "Secret t",
      undefined,
      undefined,
      "turn-1",
    );
    first.emit(answer);
    await first.flush();
    const second = buildPersistingEmitter(
      "sess-regate",
      () => "Secret t",
      undefined,
      undefined,
      "turn-2",
    );
    second.emit(answer);
    await second.flush();

    assert.equal(postedBodies.length, 2);
    assert.notEqual(postedBodies[0].record_id, postedBodies[1].record_id);
    // Two durable rows carry one logical answer under both policies. Immutability does not
    // create this duplicate and cannot remove it.
    for (const policy of ["upsert", "insert-only"] as StorePolicy[]) {
      assert.deepEqual(
        idsOfType(applyStore(postedBodies, policy), "interaction_response"),
        ["gate-9", "gate-9"],
        policy,
      );
    }

    // WHEN INSERTS BECOME IMMUTABLE: unchanged, but the duplicate becomes visible in a
    // replay cursor. A reader that folds interaction answers by `attributes.id` must treat
    // the second as idempotent, which the frontend already does
    // (`transcriptToMessages.ts` splices the duplicate approval part).
  });
});

describe("stable record_id: terminal events", () => {
  it("a done event sent twice becomes two rows because it carries no stable id", async () => {
    const { emit, flush } = buildPersistingEmitter(
      "sess-done",
      () => "Secret t",
      undefined,
      undefined,
      "turn-1",
    );
    emit({ type: "message", text: "finished" });
    emit({ type: "done", stopReason: "end_turn" });
    emit({ type: "done", stopReason: "end_turn" });
    await flush();

    // No record_id is sent for a terminal event, so the API mints a fresh uuid4 each time
    // (`mappings.py:20`) and dedup is impossible at any storage policy.
    assert.equal(postedBodies.length, 3);
    for (const body of postedBodies) {
      assert.equal(body.record_id, undefined);
    }
    for (const policy of ["upsert", "insert-only"] as StorePolicy[]) {
      const rows = applyStore(postedBodies, policy);
      assert.equal(rows.length, 3, policy);
      assert.equal(
        rows.filter((row) => row.record_type === "done").length,
        2,
        policy,
      );
      // The runner's reconstruction drops `done`, so the rebuilt conversation is unharmed.
      assert.deepEqual(
        reconstructMessages(rows),
        [{ role: "assistant", content: "finished" }],
        policy,
      );
    }

    // WHEN INSERTS BECOME IMMUTABLE: this is the gap immutability alone does not close.
    // A terminal event needs a producer-generated stable event id before its first send,
    // or a lost ingest response turns into a duplicate terminal fact in the replay cursor.
    // The frontend closes an assistant message on every `done`
    // (`transcriptToMessages.ts:567-587`), so a duplicate terminal event can split one
    // turn into two bubbles. Replace the `rows.length === 3` expectation with 2 when every
    // durable event carries a stable id.
  });
});

describe("detectable incompleteness: the drop counter is consumed twice", () => {
  it("flush() clears the per-session drop count, so the caller always reads zero", async () => {
    // `server.ts:588` (success) and `:602` (throw) both await `flush()`, which calls
    // `takePersistFailures` at `persist.ts:448` — a READ AND CLEAR. The `finally` block at
    // `server.ts:608-616` then calls `takePersistFailures` again to decide whether to call
    // `noteRecordsIncomplete`. It can only ever see zero, so `recordsIncomplete()` at
    // `engines/sandbox_agent/reconstruct-history.ts:85` never fires and a turn rebuilds
    // model context from a log with a hole in it.
    //
    // This test pins the defect. The proposed fix is in
    // `docs/design/session-control-and-live-events/spike-d-stable-record-ids.md`.
    const persist = await import("../../src/sessions/persist.ts?drop-counter");
    vi.stubEnv("AGENTA_RECORDS_INGEST_MAX_RETRIES", "1");
    const failing = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", failing);

    const { emit, flush } = persist.buildPersistingEmitter(
      "sess-drop-counter",
      () => "Secret t",
      undefined,
      undefined,
      "turn-1",
    );
    emit({ type: "message", text: "this record never lands" });
    await flush();

    assert.ok(failing.mock.calls.length > 0, "the POST was attempted and failed");
    // The record was dropped, but the count the run handler reads is already gone.
    assert.equal(persist.takePersistFailures("sess-drop-counter"), 0);
    assert.equal(persist.recordsIncomplete("sess-drop-counter"), false);

    vi.unstubAllEnvs();

    // WHEN THE DEFECT IS FIXED: `recordsIncomplete("sess-drop-counter")` must be true here,
    // or `flush()` must return the dropped count for the caller to act on. Flip both
    // assertions then. This test is unrelated to immutability; it is the delivery-loss
    // signal immutable history depends on.
  });
});

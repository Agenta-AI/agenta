/**
 * Unit tests for the reconstruction seam (reconstruct-history.ts).
 *
 * The safety contract: the flag is ON by default (only the literal "false" disables it), and
 * reconstruction is a strict no-op until BOTH the flag is on AND the client sent a minimal
 * history. Anything else leaves the inbound history untouched (returns null).
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

let fetchCalls = 0;
let recordsToReturn: unknown[] = [];
let fetchShouldFail = false;

vi.stubGlobal("fetch", async () => {
  fetchCalls++;
  if (fetchShouldFail) return new Response("err", { status: 500 });
  return new Response(JSON.stringify({ records: recordsToReturn }), { status: 200 });
});

const { reconstructHistoryIfNeeded } = await import(
  "../../src/engines/sandbox_agent/reconstruct-history.ts"
);
const { noteRecordsIncomplete } = await import("../../src/sessions/persist.ts");

const auth = () => "Secret t";
const userTurn = { role: "user", content: "hi again" };
/** An out-of-band approval reply: the parked call plus its `{approved}` envelope, no user text. */
const approvalReplyMessage = {
  role: "assistant",
  content: [
    { type: "tool_call", toolCallId: "toolu_1", toolName: "Write" },
    {
      type: "tool_result",
      toolCallId: "toolu_1",
      toolName: "Write",
      output: { approved: true, interactionToken: "tok-1" },
    },
  ],
};

beforeEach(() => {
  fetchCalls = 0;
  recordsToReturn = [];
  fetchShouldFail = false;
  vi.unstubAllEnvs();
  // The hermetic setup pins the flag off for the engine suites; this file tests the real
  // default, so drop the pin (absent = on).
  delete process.env.AGENTA_SESSIONS_RECONSTRUCT;
});

describe("reconstructHistoryIfNeeded", () => {
  it('no-op when the flag is explicitly "false" (never even queries)', async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "false");
    const req = { messages: [userTurn] } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.equal(out, null);
    assert.equal(fetchCalls, 0);
  });

  it("on by default: an absent flag reconstructs a minimal history", async () => {
    recordsToReturn = [
      { record_source: "user", attributes: { type: "message", text: "q1" } },
      { record_source: "agent", attributes: { type: "message", text: "a1" } },
    ];
    const req = { messages: [userTurn], harness: "pi" } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.notEqual(out, null);
    assert.equal(fetchCalls, 1);
  });

  it('an empty flag (compose "${VAR:-}" passthrough) still means on', async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "");
    recordsToReturn = [
      { record_source: "user", attributes: { type: "message", text: "q1" } },
      { record_source: "agent", attributes: { type: "message", text: "a1" } },
    ];
    const req = { messages: [userTurn], harness: "pi" } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.notEqual(out, null);
    assert.equal(fetchCalls, 1);
  });

  it("no-op when the client already sent a full history", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    const req = { messages: [userTurn, userTurn] } as never; // length > 1
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.equal(out, null);
    assert.equal(fetchCalls, 0);
  });

  it("no-op when there is no session id", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    const req = { messages: [userTurn] } as never;
    const out = await reconstructHistoryIfNeeded(req, undefined, auth);
    assert.equal(out, null);
    assert.equal(fetchCalls, 0);
  });

  it("no-op when the record log is empty", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    recordsToReturn = [];
    const req = { messages: [userTurn] } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.equal(out, null);
  });

  it("fails the turn when the records fetch fails (the client kept no history to fall back to)", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    fetchShouldFail = true;
    const req = { messages: [userTurn] } as never;
    await assert.rejects(
      () => reconstructHistoryIfNeeded(req, "sess-1", auth),
      /unreadable/,
    );
  });

  it("fails the turn when the session is known to have dropped a record", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    noteRecordsIncomplete("sess-dropped");
    const req = { messages: [userTurn] } as never;
    await assert.rejects(
      () => reconstructHistoryIfNeeded(req, "sess-dropped", auth),
      /incomplete conversation/,
    );
    assert.equal(fetchCalls, 0, "no query when the log is already known bad");
  });

  it("refuses reconstruction from a smart-truncated record", async () => {
    recordsToReturn = [
      {
        record_source: "user",
        attributes: {
          type: "message",
          text: "partial",
          _truncated: { fields: ["text"], original_bytes: 80_000 },
        },
      },
    ];
    const req = { messages: [userTurn] } as never;

    await assert.rejects(
      () => reconstructHistoryIfNeeded(req, "sess-1", auth),
      /truncated durable record/,
    );
  });

  it("refuses reconstruction from a legacy whole-record truncation", async () => {
    recordsToReturn = [
      {
        record_source: "agent",
        attributes: { _truncated: true, _original_bytes: 80_000 },
      },
    ];
    const req = { messages: [userTurn] } as never;

    await assert.rejects(
      () => reconstructHistoryIfNeeded(req, "sess-1", auth),
      /truncated durable record/,
    );
  });

  it("prepends reconstructed prior turns to the inbound message when enabled", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    recordsToReturn = [
      { record_source: "user", attributes: { type: "message", text: "q1" } },
      { record_source: "agent", attributes: { type: "message", text: "a1" } },
    ];
    const req = { messages: [userTurn], harness: "pi" } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.ok(out);
    assert.deepEqual(out!.messages, [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      userTurn,
    ]);
    // Other request fields are preserved.
    assert.equal((out as { harness?: string }).harness, "pi");
  });

  it("no-op when the request carries no messages at all", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    const req = { messages: [] } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.equal(out, null);
    assert.equal(fetchCalls, 0);
  });

  it("no-op when the single inbound message is not a fresh user turn", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    const req = { messages: [{ role: "assistant", content: "a1" }] } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.equal(out, null);
    assert.equal(fetchCalls, 0);
  });

  it("drops the current turn's own records so the prompt is not replayed twice", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    // The runner persists the inbound prompt BEFORE the engine starts, so by the time this
    // runs the log already holds turn-2's own user record.
    recordsToReturn = [
      { turn_id: "turn-1", record_source: "user", attributes: { type: "message", text: "q1" } },
      { turn_id: "turn-1", record_source: "agent", attributes: { type: "message", text: "a1" } },
      { turn_id: "turn-2", record_source: "user", attributes: { type: "message", text: "hi again" } },
    ];
    const req = { messages: [userTurn], turnId: "turn-2" } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.ok(out);
    assert.deepEqual(out!.messages, [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      userTurn,
    ]);
  });

  it("rebuilds the conversation for an out-of-band approval reply (no user text at all)", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    // A caller answering from the durable interaction row sends only the parked call and its
    // {approved} envelope. It asserts no conversation, so the prior turns must come from the log
    // or the agent answers as though the task had just started.
    recordsToReturn = [
      {
        turn_id: "turn-1",
        record_source: "user",
        attributes: { type: "message", text: "write a test file" },
      },
      {
        turn_id: "turn-1",
        record_source: "agent",
        attributes: {
          type: "tool_call",
          id: "toolu_1",
          name: "Write",
          input: { file_path: "/x" },
        },
      },
    ];
    const approvalReply = {
      role: "assistant",
      content: [
        { type: "tool_call", toolCallId: "toolu_1", toolName: "Write" },
        {
          type: "tool_result",
          toolCallId: "toolu_1",
          toolName: "Write",
          output: { approved: true, interactionToken: "tok-1" },
        },
      ],
    };
    const req = { messages: [approvalReply], turnId: "turn-2" } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.ok(out);
    assert.equal(out!.messages!.length, 3);
    assert.deepEqual(out!.messages![0], {
      role: "user",
      content: "write a test file",
    });
    assert.deepEqual(out!.messages![2], approvalReply);
  });

  it("no-op for a tool result that is not an approval envelope", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    const req = {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_result", toolCallId: "toolu_1", output: "plain" },
          ],
        },
      ],
    } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.equal(out, null);
    assert.equal(fetchCalls, 0);
  });

  it("refuses an approval reply whose prior turns were all dropped as the current turn", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    // Reachable: a caller building its answer from the durable interaction row echoes the row's
    // stored `turn_id`, which is the turn that PARKED — so the filter drops every prior record.
    // Returning null here would run the approval-resume frame alone: no task, no context, ok:true.
    recordsToReturn = [
      {
        turn_id: "turn-1",
        record_source: "user",
        attributes: { type: "message", text: "write a test file" },
      },
    ];
    const req = { messages: [approvalReplyMessage], turnId: "turn-1" } as never;
    await assert.rejects(
      () => reconstructHistoryIfNeeded(req, "sess-1", auth),
      /cannot resume an approval reply/,
    );
  });

  it("refuses an approval reply when the session id is missing", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    const req = { messages: [approvalReplyMessage] } as never;
    await assert.rejects(
      () => reconstructHistoryIfNeeded(req, undefined, auth),
      /cannot resume an approval reply/,
    );
    assert.equal(fetchCalls, 0);
  });

  it("refuses an approval reply when reconstruction is switched off", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "false");
    const req = { messages: [approvalReplyMessage] } as never;
    await assert.rejects(
      () => reconstructHistoryIfNeeded(req, "sess-1", auth),
      /cannot resume an approval reply/,
    );
    assert.equal(fetchCalls, 0);
  });

  it("an ordinary minimal-history request keeps every silent no-op it had", async () => {
    // The loud guards above are for the approval shape ONLY: a fresh user turn asserts its own
    // task, so "nothing to rebuild" is a legitimate first turn, not an anomaly.
    const minimal = { messages: [userTurn] } as never;
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "false");
    assert.equal(await reconstructHistoryIfNeeded(minimal, "sess-1", auth), null);
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    assert.equal(await reconstructHistoryIfNeeded(minimal, undefined, auth), null);
    recordsToReturn = [
      {
        turn_id: "t1",
        record_source: "user",
        attributes: { type: "message", text: "hi again" },
      },
    ];
    const sameTurn = { messages: [userTurn], turnId: "t1" } as never;
    assert.equal(await reconstructHistoryIfNeeded(sameTurn, "sess-1", auth), null);
  });

  it("no-op when the only records belong to the current turn (first turn of a session)", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    recordsToReturn = [
      { turn_id: "turn-1", record_source: "user", attributes: { type: "message", text: "hi again" } },
    ];
    const req = { messages: [userTurn], turnId: "turn-1" } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.equal(out, null);
  });

  it("restores reconstructed attachment working copies before returning history", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    const attachmentId = "11111111-1111-4111-8111-111111111111";
    recordsToReturn = [
      {
        turn_id: "turn-1",
        record_source: "user",
        attributes: {
          type: "message",
          text: "inspect",
          attachments: [{ attachmentId, filename: "wire-name.png" }],
        },
      },
    ];
    let restoreCalls = 0;
    const req = { messages: [userTurn], turnId: "turn-2" } as never;
    const out = await reconstructHistoryIfNeeded(
      req,
      "sess-1",
      auth,
      undefined,
      {
        restore: async (messages) => {
          restoreCalls += 1;
          const content = messages[0].content;
          assert.ok(Array.isArray(content));
          return [
            {
              ...messages[0],
              content: content.map((block) =>
                block.type === "attachment"
                  ? { ...block, filename: "verified-name.png" }
                  : block,
              ),
            },
          ];
        },
      },
    );

    assert.equal(restoreCalls, 1);
    assert.equal(
      Array.isArray(out?.messages?.[0].content)
        ? out.messages[0].content[0].filename
        : undefined,
      "verified-name.png",
    );
  });
});

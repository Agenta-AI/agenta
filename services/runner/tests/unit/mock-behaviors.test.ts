import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  MOCK_BEHAVIORS,
  runMockBehavior,
  type MockBehaviorContext,
} from "../../src/engines/sandbox_agent/mock-behaviors.ts";

function fakeCtx() {
  const emitted: Record<string, unknown>[] = [];
  const permissionRequests: unknown[] = [];
  let toolCallSeq = 0;
  const pending = new Map<string, (reply: string) => void>();
  const ctx: MockBehaviorContext = {
    emit: (update) => emitted.push(update),
    nextToolCallId: () => `tool-${toolCallSeq++}`,
    requestPermission: ({ toolCallId }) => {
      permissionRequests.push({ toolCallId });
      return new Promise<string>((resolve) => pending.set(toolCallId, resolve));
    },
  };
  return { ctx, emitted, permissionRequests, pending };
}

describe("reply", () => {
  it("emits one agent_message_chunk with the given text", async () => {
    const { ctx, emitted } = fakeCtx();
    const outcome = await runMockBehavior("reply", { text: "hi there" }, ctx);
    assert.deepEqual(emitted, [
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi there" } },
    ]);
    assert.deepEqual(outcome, { stopReason: "end_turn" });
  });

  it("rejects a missing text kwarg", async () => {
    const { ctx } = fakeCtx();
    await assert.rejects(() => runMockBehavior("reply", {}, ctx), /non-empty 'text'/);
  });
});

describe("thinking", () => {
  it("emits a thought chunk then a message chunk", async () => {
    const { ctx, emitted } = fakeCtx();
    await runMockBehavior("thinking", { thought: "pondering", text: "done" }, ctx);
    assert.deepEqual(emitted, [
      { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "pondering" } },
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } },
    ]);
  });
});

describe("tool", () => {
  it("announces the call, completes it, then replies", async () => {
    const { ctx, emitted } = fakeCtx();
    await runMockBehavior("tool", { tool: "search", text: "found it" }, ctx);
    assert.equal(emitted.length, 3);
    assert.equal(emitted[0].sessionUpdate, "tool_call");
    assert.equal((emitted[0] as any).name, "search");
    assert.equal(emitted[1].sessionUpdate, "tool_call_update");
    assert.equal((emitted[1] as any).status, "completed");
    assert.equal((emitted[1] as any).toolCallId, (emitted[0] as any).toolCallId);
    assert.deepEqual(emitted[2], {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "found it" },
    });
  });
});

describe("approval", () => {
  it("announces the call and parks until the gate is answered", async () => {
    const { ctx, emitted, permissionRequests, pending } = fakeCtx();
    const outcomePromise = runMockBehavior("approval", { tool: "delete_file" }, ctx);

    // The permission request must fire, but the behaviour must not resolve on its own.
    let settled = false;
    outcomePromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    assert.equal(permissionRequests.length, 1);
    assert.equal(settled, false);
    assert.equal(emitted[0].sessionUpdate, "tool_call");

    const toolCallId = (emitted[0] as any).toolCallId as string;
    pending.get(toolCallId)?.("once");
    const outcome = await outcomePromise;

    assert.deepEqual(outcome, { stopReason: "end_turn" });
    assert.equal(emitted[1].sessionUpdate, "tool_call_update");
    assert.equal((emitted[1] as any).status, "completed");
  });

  it("closes the call as failed on a reject reply", async () => {
    const { ctx, emitted, pending } = fakeCtx();
    const outcomePromise = runMockBehavior("approval", { tool: "delete_file" }, ctx);
    await Promise.resolve();
    const toolCallId = (emitted[0] as any).toolCallId as string;
    pending.get(toolCallId)?.("reject");
    await outcomePromise;
    assert.equal((emitted[1] as any).status, "failed");
  });
});

describe("slow", () => {
  it("delays then defers to the named behaviour", async () => {
    const { ctx, emitted } = fakeCtx();
    const outcome = await runMockBehavior(
      "slow",
      { ms: 5, then: "reply", text: "eventually" },
      ctx,
    );
    assert.deepEqual(outcome, { stopReason: "end_turn" });
    assert.deepEqual(emitted, [
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "eventually" } },
    ]);
  });

  it("refuses to chain into itself", async () => {
    const { ctx } = fakeCtx();
    await assert.rejects(
      () => runMockBehavior("slow", { ms: 1, then: "slow" }, ctx),
      /cannot chain into itself/,
    );
  });
});

describe("error", () => {
  it("fails the turn with the given message", async () => {
    const { ctx } = fakeCtx();
    await assert.rejects(
      () => runMockBehavior("error", { message: "boom" }, ctx),
      /boom/,
    );
  });
});

describe("multi", () => {
  it("emits one agent_message_chunk per text", async () => {
    const { ctx, emitted } = fakeCtx();
    await runMockBehavior("multi", { texts: ["one", "two", "three"] }, ctx);
    assert.deepEqual(
      emitted.map((e) => (e as any).content.text),
      ["one", "two", "three"],
    );
  });

  it("rejects an empty texts array", async () => {
    const { ctx } = fakeCtx();
    await assert.rejects(() => runMockBehavior("multi", { texts: [] }, ctx), /non-empty 'texts'/);
  });
});

describe("runMockBehavior", () => {
  it("rejects an unknown behaviour name", async () => {
    const { ctx } = fakeCtx();
    await assert.rejects(
      () => runMockBehavior("does-not-exist", {}, ctx),
      /unknown mock behaviour/,
    );
  });

  it("registers exactly the seven documented behaviours", () => {
    assert.deepEqual(
      Object.keys(MOCK_BEHAVIORS).sort(),
      ["approval", "error", "multi", "reply", "slow", "thinking", "tool"],
    );
  });
});

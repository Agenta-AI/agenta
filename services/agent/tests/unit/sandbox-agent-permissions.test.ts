/**
 * Unit tests for sandbox-agent ACP permission wiring.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-permissions.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentEvent } from "../../src/protocol.ts";
import type { PermissionRequest, Responder } from "../../src/responder.ts";
import { attachPermissionResponder } from "../../src/engines/sandbox_agent/permissions.ts";

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("attachPermissionResponder", () => {
  it("emits an interaction_request and answers the ACP permission", async () => {
    let handler: ((req: any) => void) | undefined;
    const replies: Array<{ id: string; reply: string }> = [];
    const session = {
      onPermissionRequest(cb: (req: any) => void) {
        handler = cb;
      },
      async respondPermission(id: string, reply: string) {
        replies.push({ id, reply });
      },
    };
    const events: AgentEvent[] = [];
    const seenRequests: PermissionRequest[] = [];
    const responder: Responder = {
      async onPermission(request) {
        seenRequests.push(request);
        return "allow";
      },
    };

    attachPermissionResponder({
      session,
      run: { emitEvent: (event) => events.push(event) },
      responder,
    });
    handler?.({
      id: "perm-1",
      availableReplies: ["once", "always", "reject"],
      toolCall: { toolCallId: "tool-1", name: "edit" },
      options: { cwd: "/repo" },
    });
    await flushPromises();

    assert.deepEqual(events, [
      {
        type: "interaction_request",
        id: "perm-1",
        kind: "permission",
        payload: {
          toolCallId: "tool-1",
          toolCall: { toolCallId: "tool-1", name: "edit" },
          availableReplies: ["once", "always", "reject"],
          options: { cwd: "/repo" },
        },
      },
    ]);
    assert.deepEqual(seenRequests, [
      {
        id: "perm-1",
        availableReplies: ["once", "always", "reject"],
        raw: {
          id: "perm-1",
          availableReplies: ["once", "always", "reject"],
          toolCall: { toolCallId: "tool-1", name: "edit" },
          options: { cwd: "/repo" },
        },
      },
    ]);
    // allow maps to ONCE, not always: a per-call approval must not broaden into a
    // turn-wide grant that skips re-gating later calls (the over-authorization hole).
    assert.deepEqual(replies, [{ id: "perm-1", reply: "once" }]);
  });

  it("parks: emits the interaction_request but sends NO harness reply (F-024 regression)", async () => {
    // The park outcome must never reach the harness as a reply: a `reject` would make Claude
    // emit a failed tool call ("User refused permission") whose tool_result{isError} clobbers
    // the approval prompt on the same tool-call id. So on park the approval-request event is
    // emitted and respondPermission is NOT called — the turn ends with the tool pending.
    let handler: ((req: any) => void) | undefined;
    const replies: Array<{ id: string; reply: string }> = [];
    const session = {
      onPermissionRequest(cb: (req: any) => void) {
        handler = cb;
      },
      async respondPermission(id: string, reply: string) {
        replies.push({ id, reply });
      },
    };
    const events: AgentEvent[] = [];

    attachPermissionResponder({
      session,
      run: { emitEvent: (event) => events.push(event) },
      responder: {
        async onPermission() {
          return "park";
        },
      },
    });
    handler?.({
      id: "perm-park",
      availableReplies: ["once", "always", "reject"],
      toolCall: { toolCallId: "tool-9", name: "edit" },
    });
    await flushPromises();

    // The approval-request event IS emitted (the FE needs it to prompt) ...
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "interaction_request");
    assert.equal((events[0] as any).id, "perm-park");
    // ... but the harness gets NO reply (no reject to clobber the prompt with).
    assert.deepEqual(replies, []);
  });

  it("does not respond when the ACP request has no id", async () => {
    let handler: ((req: any) => void) | undefined;
    const replies: Array<{ id: string; reply: string }> = [];
    const session = {
      onPermissionRequest(cb: (req: any) => void) {
        handler = cb;
      },
      async respondPermission(id: string, reply: string) {
        replies.push({ id, reply });
      },
    };

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder: {
        async onPermission() {
          return "deny";
        },
      },
    });
    handler?.({ availableReplies: ["reject"] });
    await flushPromises();

    assert.deepEqual(replies, []);
  });
});

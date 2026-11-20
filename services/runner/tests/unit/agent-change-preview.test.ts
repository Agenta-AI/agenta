/**
 * The server preview on the approval card of an agent write.
 *
 * When the gate of `edit_agent_config` or `create_agent` opens, the runner asks the API what the
 * call would change and puts the answer on the approval event as `preview`. Two things matter:
 * the API resolves the SAME target the call would (bindings filled, the note for the person
 * removed), and a preview that cannot be had never blocks the card.
 *
 * Run: pnpm exec vitest run tests/unit/agent-change-preview.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentEvent, ResolvedToolSpec } from "../../src/protocol.ts";
import { buildAgentChangePreviewFetcher } from "../../src/tools/agent-change-preview.ts";
import { attachPermissionResponder } from "../../src/engines/sandbox_agent/acp-interactions.ts";
import { buildExecutableToolGate } from "../../src/engines/sandbox_agent/executable-tools.ts";
import {
  ApprovalResponder,
  ConversationDecisions,
} from "../../src/responder.ts";
import { toolSpecsByName } from "../../src/tools/public-spec.ts";
import type { Responder } from "../../src/responder.ts";
import { fixedToolCallback } from "../utils/tool-callback.ts";

const ENDPOINT = "https://agenta.example/api/tools/call";

const EDIT_SPEC: ResolvedToolSpec = {
  name: "edit_agent_config",
  kind: "callback",
  callRef: "tools.agenta.edit_agent_config",
  contextBindings: {
    caller_agent_id: "$ctx.workflow.artifact.id",
    caller_session_id: "$ctx.session.id",
  },
  ephemeralArgs: ["description"],
  permission: "ask",
  readOnly: false,
};

const READ_SPEC: ResolvedToolSpec = {
  name: "read_agent_config",
  kind: "callback",
  callRef: "tools.agenta.read_agent_config",
  permission: "allow",
  readOnly: true,
};

const runContext = {
  workflow: { artifact: { id: "agent-builder" } },
  session: { id: "session-1" },
} as never;

const EDIT_ARGS = {
  agent: "invoice-helper",
  base_revision_id: "rev-3",
  operations: [{ operation: "set", target: ["x"], value: 1 }],
  description: "Make it shorter.",
};

const PREVIEW = { applies: true, operations: [], changes: [] };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Capture the request and answer with one canned tool result. */
function stub(content: unknown, code = "STATUS_CODE_OK"): any[] {
  const sent: any[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    sent.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(
      JSON.stringify({
        call: {
          data: { tool_call_id: "t", content: JSON.stringify(content) },
          status: { code },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  return sent;
}

const fetcher = (callback = true) =>
  buildAgentChangePreviewFetcher({
    callback: callback
      ? fixedToolCallback({
          endpoint: ENDPOINT,
          authorization: "ApiKey secret",
        })
      : undefined,
    runContext,
    toolSpecs: [EDIT_SPEC, READ_SPEC],
  });

describe("the agent change preview fetcher", () => {
  it("asks the API with the call's own arguments, bound and without the note", async () => {
    const sent = stub(PREVIEW);

    const preview = await fetcher()({
      toolName: "edit_agent_config",
      toolCallId: "call-1",
      args: EDIT_ARGS,
    });

    assert.deepEqual(preview, PREVIEW);
    assert.equal(sent.length, 1);
    assert.equal(
      sent[0].data.function.name,
      "tools.agenta.preview_agent_change",
    );
    const { description: _, ...withoutNote } = EDIT_ARGS;
    assert.deepEqual(sent[0].data.function.arguments, {
      call_ref: "tools.agenta.edit_agent_config",
      arguments: {
        ...withoutNote,
        caller_agent_id: "agent-builder",
        caller_session_id: "session-1",
      },
    });
  });

  it("previews nothing for a tool that is not an agent write, and calls nobody", async () => {
    const sent = stub(PREVIEW);

    const preview = await fetcher()({
      toolName: "read_agent_config",
      toolCallId: "call-1",
      args: {},
    });

    assert.equal(preview, undefined);
    assert.equal(sent.length, 0);
  });

  it("gives no preview, and does not throw, when the API refuses", async () => {
    stub({ code: "revision_conflict", message: "moved" }, "STATUS_CODE_ERROR");

    const preview = await fetcher()({
      toolName: "edit_agent_config",
      toolCallId: "call-1",
      args: EDIT_ARGS,
    });

    assert.equal(preview, undefined);
  });

  it("gives no preview without a callback endpoint", async () => {
    const sent = stub(PREVIEW);

    const preview = await fetcher(false)({
      toolName: "edit_agent_config",
      toolCallId: "call-1",
      args: EDIT_ARGS,
    });

    assert.equal(preview, undefined);
    assert.equal(sent.length, 0);
  });
});

describe("the approval event of an agent write", () => {
  const askResponder: Responder = {
    async onPermission() {
      return { kind: "pendingApproval" } as never;
    },
    async onClientTool() {
      return { kind: "deny" } as never;
    },
  } as Responder;

  function gate(
    onResolveChangePreview: any,
    onResolveApprovedContent?: any,
    pauseSignal?: Promise<unknown>,
  ): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];
    let handler: ((req: any) => void) | undefined;
    attachPermissionResponder({
      session: {
        onPermissionRequest(cb: (req: any) => void) {
          handler = cb;
        },
        respondPermission: async () => {},
      },
      run: { emitEvent: (event: AgentEvent) => events.push(event) },
      responder: askResponder,
      toolSpecsByName: toolSpecsByName([EDIT_SPEC]),
      onResolveChangePreview,
      onResolveApprovedContent,
      pauseSignal,
    } as never);
    handler?.({
      id: "permission-1",
      availableReplies: ["once", "reject"],
      toolCall: {
        toolCallId: "call-1",
        name: "edit_agent_config",
        rawInput: EDIT_ARGS,
      },
    });
    return (async () => {
      const deadline = Date.now() + 2000;
      while (events.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return events;
    })();
  }

  it("carries the preview", async () => {
    const events = await gate(async () => PREVIEW);

    assert.equal(events.length, 1);
    const event = events[0] as { type: string; payload: { preview?: unknown } };
    assert.equal(event.type, "interaction_request");
    assert.deepEqual(event.payload.preview, PREVIEW);
  });

  it("still opens without one", async () => {
    const events = await gate(async () => undefined);

    assert.equal(events.length, 1);
    const event = events[0] as { payload: Record<string, unknown> };
    assert.equal("preview" in event.payload, false);
  });

  it("carries the preview beside the manifest of approved content", async () => {
    const manifest = { version: 1, files: [] };
    const events = await gate(
      async () => PREVIEW,
      async () => ({ ok: true, manifest }),
    );

    const event = events[0] as { payload: Record<string, unknown> };
    assert.deepEqual(event.payload.manifest, manifest);
    assert.deepEqual(event.payload.preview, PREVIEW);
  });

  it("opens without the preview when a sibling gate pauses the turn first", async () => {
    // The preview never answers; the turn pauses because another gate asked.
    const events = await gate(
      () => new Promise(() => {}),
      undefined,
      Promise.resolve(),
    );

    assert.equal(events.length, 1);
    const event = events[0] as { payload: Record<string, unknown> };
    assert.equal("preview" in event.payload, false);
  });

  it("carries the preview on the executable tool gate too", async () => {
    const events: AgentEvent[] = [];
    const gate = buildExecutableToolGate({
      responder: new ApprovalResponder(
        { default: "ask", rules: [] },
        new ConversationDecisions(new Map()),
      ),
      run: {
        emitEvent: (event: AgentEvent) => events.push(event),
        wasForceSettled: () => false,
      },
      pause: { markPausedToolCall: () => {}, pause: () => {} },
      recordPendingInteraction: () => {},
      resolveChangePreview: async () => PREVIEW,
    });

    const outcome = await gate.onExecutableTool({
      id: "permission-1",
      toolCallId: "call-1",
      toolName: "edit_agent_config",
      input: EDIT_ARGS,
      spec: EDIT_SPEC,
    });

    assert.deepEqual(outcome, { kind: "pendingApproval" });
    const event = events[0] as { type: string; payload: { preview?: unknown } };
    assert.equal(event.type, "interaction_request");
    assert.deepEqual(event.payload.preview, PREVIEW);
  });
});

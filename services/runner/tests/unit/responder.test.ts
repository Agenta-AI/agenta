/**
 * Unit tests for the interaction responder seam and the otel `emitEvent` hook.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/responder.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  createSandboxAgentOtel,
  TOOL_NOT_EXECUTED_PAUSED,
} from "../../src/tracing/otel.ts";
import type { AgentEvent, AgentRunRequest } from "../../src/protocol.ts";
import type {
  GateDescriptor,
  PermissionPlan,
} from "../../src/permission-plan.ts";
import {
  ApprovalResponder,
  ConversationDecisions,
  approvedCallKey,
  decisionToReply,
  extractApprovalDecisions,
  extractClientToolOutputs,
  type PermissionDecision,
} from "../../src/responder.ts";

function plan(defaultMode: PermissionPlan["default"]): PermissionPlan {
  return { default: defaultMode, rules: [] };
}

function gate(overrides: Partial<GateDescriptor> = {}): GateDescriptor {
  return {
    executor: "harness",
    toolName: "edit",
    args: { path: "a.txt" },
    ...overrides,
  };
}

async function permissionVerdict(
  responder: ApprovalResponder,
  descriptor: GateDescriptor,
) {
  return responder.onPermission({
    id: "perm-1",
    availableReplies: ["once", "reject"],
    gate: descriptor,
  });
}

describe("decisionToReply", () => {
  it("maps allow to ONCE (never always) so an approval grants only this call", () => {
    assert.equal(
      decisionToReply("allow", ["always", "once", "reject"]),
      "once",
      "allow must NOT map to always even when always is offered",
    );
    assert.equal(decisionToReply("allow", ["once", "reject"]), "once");
    assert.equal(decisionToReply("allow", []), "once");
    assert.equal(decisionToReply("allow", ["always"]), "once");
  });

  it("maps deny onto reject", () => {
    assert.equal(
      decisionToReply("deny", ["always", "once", "reject"]),
      "reject",
    );
    assert.equal(decisionToReply("deny", []), "reject");
  });
});

describe("approvedCallKey", () => {
  it("binds name + args, order-independently", () => {
    assert.equal(
      approvedCallKey("edit", { a: 1, b: 2 }),
      approvedCallKey("edit", { b: 2, a: 1 }),
    );
    assert.notEqual(
      approvedCallKey("edit", { path: "a" }),
      approvedCallKey("edit", { path: "b" }),
    );
    assert.notEqual(
      approvedCallKey("edit", { path: "a" }),
      approvedCallKey("bash", { path: "a" }),
    );
  });

  it("normalizes absent args to {} so a no-arg tool resumes", () => {
    assert.ok(approvedCallKey("edit", {}));
    assert.equal(
      approvedCallKey("edit", undefined),
      approvedCallKey("edit", {}),
    );
    assert.equal(approvedCallKey("edit", null), approvedCallKey("edit", {}));
    assert.notEqual(
      approvedCallKey("edit", { path: "a" }),
      approvedCallKey("edit", {}),
    );
  });

  it("returns no key for no name or non-JSON args", () => {
    assert.equal(approvedCallKey(undefined, { a: 1 }), undefined);
    assert.equal(approvedCallKey("edit", 10n as unknown), undefined);
    assert.equal(approvedCallKey("edit", new Date()), undefined);
    assert.equal(approvedCallKey("edit", { x: NaN }), undefined);
    assert.equal(approvedCallKey("edit", new Map()), undefined);
  });

  it("matches object-valued args re-issued as JSON strings", () => {
    const toolName = "mcp__agenta-tools__commit_revision";
    const workflowRevision = { delta: { a: 1 } };

    assert.equal(
      approvedCallKey(toolName, {
        workflow_revision: workflowRevision,
      }),
      approvedCallKey(toolName, {
        workflow_revision: JSON.stringify(workflowRevision),
      }),
    );
  });

  it("keeps key ordering stable inside stringified JSON args", () => {
    const toolName = "mcp__agenta-tools__commit_revision";

    assert.equal(
      approvedCallKey(toolName, {
        workflow_revision: { delta: { a: 1, b: 2 } },
      }),
      approvedCallKey(toolName, {
        workflow_revision: '{"delta":{"b":2,"a":1}}',
      }),
    );
    assert.equal(
      approvedCallKey(toolName, {
        workflow_revision: '{"delta":{"a":1,"b":2}}',
      }),
      approvedCallKey(toolName, {
        workflow_revision: '{"delta":{"b":2,"a":1}}',
      }),
    );
  });

  it("does not match semantically different args", () => {
    const toolName = "mcp__agenta-tools__commit_revision";

    assert.notEqual(
      approvedCallKey(toolName, {
        workflow_revision: { delta: { a: 1 } },
      }),
      approvedCallKey(toolName, {
        workflow_revision: JSON.stringify({ delta: { a: 2 } }),
      }),
    );
  });

  it("tolerates stray trailing closers on stringified JSON args", () => {
    const toolName = "mcp__agenta-tools__commit_revision";
    const workflowRevision = { delta: { a: 1 } };
    const objectKey = approvedCallKey(toolName, {
      workflow_revision: workflowRevision,
    });

    // The turn-6d34b1ea round-5 shape: a JSON string with ONE stray trailing `}`.
    assert.equal(
      approvedCallKey(toolName, {
        workflow_revision: `${JSON.stringify(workflowRevision)}}`,
      }),
      objectKey,
    );
    assert.equal(
      approvedCallKey(toolName, {
        workflow_revision: `${JSON.stringify(workflowRevision)} }]`,
      }),
      objectKey,
    );
    assert.equal(
      approvedCallKey(toolName, {
        workflow_revision: `${JSON.stringify([1, 2])}]`,
      }),
      approvedCallKey(toolName, { workflow_revision: [1, 2] }),
    );
  });

  it("keeps genuinely non-JSON strings as literals, trailing brace or not", () => {
    // A stray closer on a non-JSON string never turns into an object key.
    assert.equal(
      approvedCallKey("echo", { message: "oops}" }),
      approvedCallKey("echo", { message: "oops}" }),
    );
    assert.notEqual(
      approvedCallKey("echo", { message: "oops}" }),
      approvedCallKey("echo", { message: "oops" }),
    );
    // A stringified scalar stays a string literal (containers only), as before.
    assert.notEqual(
      approvedCallKey("echo", { message: "5}" }),
      approvedCallKey("echo", { message: 5 }),
    );
    // Non-trailing junk after the JSON value is not repaired.
    assert.notEqual(
      approvedCallKey("echo", { message: '{"a":1} trailing text' }),
      approvedCallKey("echo", { message: { a: 1 } }),
    );
  });

  it("keeps plain non-JSON strings canonicalizable", () => {
    assert.equal(
      approvedCallKey("echo", { message: "hello world" }),
      approvedCallKey("echo", { message: "hello world" }),
    );
    assert.notEqual(
      approvedCallKey("echo", { message: "hello world" }),
      approvedCallKey("echo", { message: { text: "hello world" } }),
    );
  });
});

describe("ApprovalResponder", () => {
  it("allows and denies from the effective permission before stored decisions", async () => {
    const key = approvedCallKey("edit", { path: "a.txt" })!;
    const stored = new Map<string, unknown>([[key, "allow"]]);
    const deny = new ApprovalResponder(
      plan("deny"),
      new ConversationDecisions(stored),
    );

    assert.deepEqual(await permissionVerdict(deny, gate()), { kind: "deny" });
    assert.equal(
      stored.has(key),
      true,
      "effective deny does not consume stale allow",
    );

    const allow = new ApprovalResponder(
      plan("allow"),
      new ConversationDecisions(new Map([[key, "deny"]])),
    );
    assert.deepEqual(await permissionVerdict(allow, gate()), { kind: "allow" });
  });

  it("under ask, consumes a stored allow only once", async () => {
    const key = approvedCallKey("edit", { path: "a.txt" })!;
    const responder = new ApprovalResponder(
      plan("ask"),
      new ConversationDecisions(new Map([[key, "allow"]])),
    );

    assert.deepEqual(await permissionVerdict(responder, gate()), {
      kind: "allow",
    });
    assert.deepEqual(await permissionVerdict(responder, gate()), {
      kind: "pendingApproval",
    });
  });

  it("under ask, consumes a stored deny and otherwise pauses", async () => {
    const key = approvedCallKey("edit", { path: "a.txt" })!;
    const responder = new ApprovalResponder(
      plan("ask"),
      new ConversationDecisions(new Map([[key, "deny"]])),
    );

    assert.deepEqual(await permissionVerdict(responder, gate()), {
      kind: "deny",
    });
    assert.deepEqual(await permissionVerdict(responder, gate()), {
      kind: "pendingApproval",
    });

    const noStored = new ApprovalResponder(
      plan("ask"),
      new ConversationDecisions(new Map()),
    );
    assert.deepEqual(await permissionVerdict(noStored, gate()), {
      kind: "pendingApproval",
    });
  });

  it("client tools default to browser-forward pause and explicit deny refuses", async () => {
    const responder = new ApprovalResponder(
      plan("ask"),
      new ConversationDecisions(new Map()),
    );
    const client = gate({ executor: "client", toolName: "request_connection" });

    assert.deepEqual(
      await responder.onClientTool({ id: "tool-1", gate: client }),
      { kind: "pendingApproval" },
    );
    assert.deepEqual(
      await responder.onClientTool({
        id: "tool-1",
        gate: { ...client, specPermission: "deny" },
      }),
      { kind: "deny" },
    );
  });

  it("client tools peek at stored output by default", async () => {
    const key = approvedCallKey("request_connection", {
      integration: "slack",
    })!;
    const output = { connected: true };
    const responder = new ApprovalResponder(
      plan("deny"),
      new ConversationDecisions(new Map(), new Map([[key, [output]]])),
    );
    const client = gate({
      executor: "client",
      toolName: "request_connection",
      args: { integration: "slack" },
    });
    const request = { id: "tool-1", gate: client };

    assert.deepEqual(await responder.onClientTool(request), {
      kind: "fulfilled",
      output,
    });
    assert.deepEqual(await responder.onClientTool(request), {
      kind: "fulfilled",
      output,
    });
  });

  it("client tools consume stored output when the relay fulfills", async () => {
    const key = approvedCallKey("request_connection", {
      integration: "slack",
    })!;
    const output = { connected: true };
    const responder = new ApprovalResponder(
      plan("deny"),
      new ConversationDecisions(new Map(), new Map([[key, [output]]])),
    );
    const client = gate({
      executor: "client",
      toolName: "request_connection",
      args: { integration: "slack" },
    });
    const request = { id: "tool-1", gate: client };

    assert.deepEqual(await responder.onClientTool(request, { consume: true }), {
      kind: "fulfilled",
      output,
    });
    assert.deepEqual(await responder.onClientTool(request, { consume: true }), {
      kind: "deny",
    });
  });

  it("client tools support peek then consume for the Claude two-read flow", async () => {
    const key = approvedCallKey("request_connection", {
      integration: "slack",
    })!;
    const output = { connected: true };
    const responder = new ApprovalResponder(
      plan("deny"),
      new ConversationDecisions(new Map(), new Map([[key, [output]]])),
    );
    const client = gate({
      executor: "client",
      toolName: "request_connection",
      args: { integration: "slack" },
    });
    const request = { id: "tool-1", gate: client };

    assert.deepEqual(await responder.onClientTool(request), {
      kind: "fulfilled",
      output,
    });
    assert.deepEqual(await responder.onClientTool(request, { consume: true }), {
      kind: "fulfilled",
      output,
    });
    assert.deepEqual(await responder.onClientTool(request), { kind: "deny" });
  });

  it("client explicit ask consumes stored deny; stored allow still forwards to the browser", async () => {
    const denyKey = approvedCallKey("request_connection", {
      integration: "slack",
    })!;
    const denyResponder = new ApprovalResponder(
      plan("allow"),
      new ConversationDecisions(new Map([[denyKey, "deny"]])),
    );
    const client = gate({
      executor: "client",
      toolName: "request_connection",
      specPermission: "ask",
      args: { integration: "slack" },
    });
    assert.deepEqual(
      await denyResponder.onClientTool({ id: "tool-1", gate: client }),
      {
        kind: "deny",
      },
    );

    const allowResponder = new ApprovalResponder(
      plan("allow"),
      new ConversationDecisions(new Map([[denyKey, "allow"]])),
    );
    assert.deepEqual(
      await allowResponder.onClientTool({ id: "tool-1", gate: client }),
      {
        kind: "pendingApproval",
      },
    );
  });
});

describe("extractApprovalDecisions", () => {
  it("builds the lookup from approval tool_result blocks by name+args", () => {
    const request: AgentRunRequest = {
      sessionId: "s-1",
      messages: [
        { role: "user", content: "do the thing" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCallId: "tc-1",
              toolName: "edit",
              input: { path: "a.txt" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolCallId: "tc-1",
              toolName: "edit",
              output: { approved: true },
            },
            {
              type: "tool_result",
              toolCallId: "tc-2",
              toolName: "bash",
              input: { cmd: "ls" },
              output: { approved: false },
            },
          ],
        },
      ],
    };

    const decisions = extractApprovalDecisions(request);
    assert.deepEqual(
      decisions.get(approvedCallKey("edit", { path: "a.txt" })!),
      ["allow"],
    );
    assert.deepEqual(decisions.get(approvedCallKey("bash", { cmd: "ls" })!), [
      "deny",
    ]);
    assert.equal(decisions.has("edit"), false);
    assert.equal(decisions.has("tc-1"), false);
  });

  it("keeps duplicate identical approval decisions in FIFO order", () => {
    const request: AgentRunRequest = {
      sessionId: "s-duplicates",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCallId: "tc-1",
              toolName: "edit",
              input: { path: "a.txt" },
            },
            {
              type: "tool_call",
              toolCallId: "tc-2",
              toolName: "edit",
              input: { path: "a.txt" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolCallId: "tc-1",
              output: { approved: true },
            },
            {
              type: "tool_result",
              toolCallId: "tc-2",
              output: { approved: true },
            },
          ],
        },
      ],
    };
    const key = approvedCallKey("edit", { path: "a.txt" })!;
    const decisions = extractApprovalDecisions(request);

    assert.deepEqual(decisions.get(key), ["allow", "allow"]);

    const stored = new ConversationDecisions(decisions);
    const duplicateGate = gate({ toolName: "edit", args: { path: "a.txt" } });
    assert.equal(stored.take(duplicateGate), "allow");
    assert.equal(stored.take(duplicateGate), "allow");
    assert.equal(stored.take(duplicateGate), undefined);
  });

  it("consumes an approval when the live gate re-issues an object arg as a JSON string", () => {
    const workflowRevision = { delta: { a: 1 } };
    const request: AgentRunRequest = {
      sessionId: "s-jsonish",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCallId: "tc-jsonish",
              toolName: "mcp__agenta-tools__commit_revision",
              input: { workflow_revision: workflowRevision },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolCallId: "tc-jsonish",
              output: { approved: true },
            },
          ],
        },
      ],
    };
    const stored = new ConversationDecisions(extractApprovalDecisions(request));

    assert.equal(
      stored.take({
        executor: "harness",
        toolName: "mcp__agenta-tools__commit_revision",
        args: { workflow_revision: JSON.stringify(workflowRevision) },
      }),
      "allow",
    );
  });

  it("routes a correlated client-tool output to the CLIENT store, not the approval store", () => {
    const request: AgentRunRequest = {
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCallId: "tc-client",
              toolName: "request_connection",
              input: { integration: "slack" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolCallId: "tc-client",
              output: { connected: true },
            },
          ],
        },
      ],
    };

    const key = approvedCallKey("request_connection", {
      integration: "slack",
    })!;
    // A raw browser output is NOT an approval decision; it lives only in the client store.
    assert.equal(extractApprovalDecisions(request).has(key), false);
    assert.deepEqual(extractClientToolOutputs(request).get(key), [
      { connected: true },
    ]);
  });

  it("ignores ordinary tool results that cannot be bound to a call shape", () => {
    const request: AgentRunRequest = {
      messages: [
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolCallId: "tc-9",
              output: "the weather is 24C",
            },
            { type: "tool_result", toolCallId: "tc-10", output: { temp: 24 } },
            { type: "text", text: "hello" },
          ],
        },
      ],
    };

    assert.equal(extractApprovalDecisions(request).size, 0);
  });

  it("returns an empty lookup when there are no structured messages", () => {
    const request: AgentRunRequest = {
      messages: [{ role: "user", content: "just a single turn" }],
    };
    assert.equal(extractApprovalDecisions(request).size, 0);
  });
});

describe("client-tool output store (separate from approvals)", () => {
  const clientGate = (
    input: unknown = { integration: "slack" },
  ): GateDescriptor => ({
    executor: "client",
    toolName: "request_connection",
    args: input,
  });

  it("extractClientToolOutputs stores raw outputs (not approvals) as a FIFO list per key", () => {
    const request: AgentRunRequest = {
      sessionId: "s-client",
      messages: [
        {
          role: "tool",
          content: [
            // Two identical request_connection calls -> same name+args key -> a FIFO list of 2.
            {
              type: "tool_result",
              toolCallId: "c-1",
              toolName: "request_connection",
              input: { integration: "slack" },
              output: { connected: true, account: "first" },
            },
            {
              type: "tool_result",
              toolCallId: "c-2",
              toolName: "request_connection",
              input: { integration: "slack" },
              output: { connected: true, account: "second" },
            },
            // An approval envelope must NOT land in the client-output store.
            {
              type: "tool_result",
              toolCallId: "c-3",
              toolName: "edit",
              input: { path: "a" },
              output: { approved: true },
            },
          ],
        },
      ],
    };
    const outputs = extractClientToolOutputs(request);
    const key = approvedCallKey("request_connection", {
      integration: "slack",
    })!;
    assert.deepEqual(outputs.get(key), [
      { connected: true, account: "first" },
      { connected: true, account: "second" },
    ]);
    // The approval-envelope result is absent from the client-output store...
    assert.equal(outputs.has(approvedCallKey("edit", { path: "a" })!), false);
    // ...and lives only in the approval store.
    const decisions = extractApprovalDecisions(request);
    assert.deepEqual(decisions.get(approvedCallKey("edit", { path: "a" })!), [
      "allow",
    ]);
  });

  it("excludes a DEFERRED_NOT_EXECUTED sibling so the model's retry re-parks", async () => {
    // Turn parked on another connection; this one was force-settled as deferred. Its result must
    // NOT enter the client-output store, or the re-request resolves against it and never re-parks.
    const request: AgentRunRequest = {
      sessionId: "s-client",
      messages: [
        { role: "user", content: "connect github and slack" },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolCallId: "c-github",
              toolName: "request_connection",
              input: { integration: "github" },
              output: { connected: true },
            },
            {
              type: "tool_result",
              toolCallId: "c-slack",
              toolName: "request_connection",
              input: { integration: "slack" },
              output: TOOL_NOT_EXECUTED_PAUSED,
              isError: true,
            },
          ],
        },
      ],
    };
    const outputs = extractClientToolOutputs(request);
    // The real github output is stored; the deferred slack result is not.
    assert.deepEqual(
      outputs.get(
        approvedCallKey("request_connection", { integration: "github" })!,
      ),
      [{ connected: true }],
    );
    assert.equal(
      outputs.has(
        approvedCallKey("request_connection", { integration: "slack" })!,
      ),
      false,
    );
    // So the model's retry of slack re-parks (a fresh widget) instead of resolving as fulfilled.
    const responder = new ApprovalResponder(
      plan("ask"),
      new ConversationDecisions(extractApprovalDecisions(request), outputs),
    );
    assert.deepEqual(
      await responder.onClientTool(
        { id: "i-1", toolCallId: "live-slack", gate: clientGate() },
        { consume: true },
      ),
      { kind: "pendingApproval" },
    );
  });

  it("resolves two identical client calls from the FIFO store, in order", async () => {
    const request: AgentRunRequest = {
      sessionId: "s-client",
      messages: [
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolCallId: "c-1",
              toolName: "request_connection",
              input: { integration: "slack" },
              output: { account: "first" },
            },
            {
              type: "tool_result",
              toolCallId: "c-2",
              toolName: "request_connection",
              input: { integration: "slack" },
              output: { account: "second" },
            },
          ],
        },
      ],
    };
    const responder = new ApprovalResponder(
      plan("ask"),
      new ConversationDecisions(
        extractApprovalDecisions(request),
        extractClientToolOutputs(request),
      ),
    );
    const request1 = { id: "i-1", toolCallId: "live-1", gate: clientGate() };
    // First call consumes the first output; the second identical call consumes the second.
    assert.deepEqual(
      await responder.onClientTool(request1, { consume: true }),
      {
        kind: "fulfilled",
        output: { account: "first" },
      },
    );
    assert.deepEqual(
      await responder.onClientTool(request1, { consume: true }),
      {
        kind: "fulfilled",
        output: { account: "second" },
      },
    );
    // A third identical call has no stored output left -> forward to the browser (pause).
    assert.deepEqual(
      await responder.onClientTool(request1, { consume: true }),
      {
        kind: "pendingApproval",
      },
    );
  });

  it("does NOT fulfill a new identical call from a PRIOR turn's output (cross-turn)", async () => {
    // Turn 1 called + answered request_connection; turn 2 (a NEW user message) asks the same
    // thing. The prior answer is resolved-in-transcript, so a fresh identical call must pause for
    // a new answer, not silently reuse turn 1's output.
    const request: AgentRunRequest = {
      sessionId: "s-client",
      messages: [
        { role: "user", content: "connect slack" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCallId: "c-1",
              toolName: "request_connection",
              input: { integration: "slack" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolCallId: "c-1",
              toolName: "request_connection",
              input: { integration: "slack" },
              output: { account: "first" },
            },
          ],
        },
        // Latest user message: turn 1's output now belongs to a PRIOR turn.
        { role: "user", content: "connect slack" },
      ],
    };
    const responder = new ApprovalResponder(
      plan("ask"),
      new ConversationDecisions(
        extractApprovalDecisions(request),
        extractClientToolOutputs(request),
      ),
    );
    assert.deepEqual(
      await responder.onClientTool(
        { id: "i-1", toolCallId: "live-1", gate: clientGate() },
        { consume: true },
      ),
      { kind: "pendingApproval" },
      "a new identical call after a prior-turn answer must pause for a fresh answer",
    );
  });

  it("still fulfills an in-turn resume from its current-turn output", async () => {
    // The just-paused call's answer sits AFTER the latest user message (same turn); it must
    // still resolve the call so a genuine resume never re-pauses.
    const request: AgentRunRequest = {
      sessionId: "s-client",
      messages: [
        { role: "user", content: "connect slack" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCallId: "c-1",
              toolName: "request_connection",
              input: { integration: "slack" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolCallId: "c-1",
              toolName: "request_connection",
              input: { integration: "slack" },
              output: { account: "first" },
            },
          ],
        },
      ],
    };
    const responder = new ApprovalResponder(
      plan("ask"),
      new ConversationDecisions(
        extractApprovalDecisions(request),
        extractClientToolOutputs(request),
      ),
    );
    assert.deepEqual(
      await responder.onClientTool(
        { id: "i-1", toolCallId: "live-1", gate: clientGate() },
        { consume: true },
      ),
      { kind: "fulfilled", output: { account: "first" } },
      "an output resolved in the current turn still resolves the call",
    );
  });

  it('returns a client output literally "allow" as output, never as a permission decision', async () => {
    const request: AgentRunRequest = {
      sessionId: "s-client",
      messages: [
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolCallId: "c-1",
              toolName: "confirm",
              input: { q: "ok?" },
              // The raw browser output happens to be the string "allow" — under the old shared
              // store this collided with a permission decision and was skipped.
              output: "allow",
            },
          ],
        },
      ],
    };
    const responder = new ApprovalResponder(
      plan("ask"),
      new ConversationDecisions(
        extractApprovalDecisions(request),
        extractClientToolOutputs(request),
      ),
    );
    assert.deepEqual(
      await responder.onClientTool(
        {
          id: "i-1",
          toolCallId: "live",
          gate: { executor: "client", toolName: "confirm", args: { q: "ok?" } },
        },
        { consume: true },
      ),
      { kind: "fulfilled", output: "allow" },
      "the client output is returned verbatim, not interpreted as a permission allow",
    );
  });
});

describe("emitEvent", () => {
  it("streaming path: flushes to the live sink and the batch log", () => {
    const emitted: AgentEvent[] = [];
    const run = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/x",
      emit: (e) => emitted.push(e),
    });
    run.start({ prompt: "hi" });
    const interaction: AgentEvent = {
      type: "interaction_request",
      id: "p1",
      kind: "user_approval",
      payload: { availableReplies: ["once", "reject"] },
    };
    run.emitEvent(interaction);

    const live = emitted.find((e) => e.type === "interaction_request");
    assert.ok(live);
    assert.equal((live as any).id, "p1");
    assert.ok(run.events().some((e) => e.type === "interaction_request"));
  });

  it("one-shot path: records in the batch log only", () => {
    const run = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/x",
    });
    run.start({ prompt: "hi" });
    run.emitEvent({ type: "data", name: "weather", data: { temp: 24 } });
    const ev = run.events().find((e) => e.type === "data");
    assert.ok(ev);
    assert.equal((ev as any).name, "weather");
  });
});

/**
 * The server's answer at the approval gate (`tools.agenta.resolve_gate`), against a fake API.
 *
 * Two parts. The fetcher: which calls it asks about, the request it sends, and that every fault
 * reads as `ask`. The responder: `allow` and `deny` replace the card, `ask` keeps it, and the
 * answer is kept for the next gate of the same call only (tool name, arguments and tool call id).
 *
 * Run: pnpm exec vitest run tests/unit/gate-answer.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import type { ResolvedToolSpec } from "../../src/protocol.ts";
import type { GateDescriptor } from "../../src/permission-plan.ts";
import {
  ApprovalResponder,
  ConversationDecisions,
  approvedCallKey,
} from "../../src/responder.ts";
import {
  GATE_ANSWER_TIMEOUT_MS,
  buildGateAnswerFetcher,
  type GateAnswerFetcher,
} from "../../src/tools/gate-answer.ts";
import { fixedToolCallback } from "../utils/tool-callback.ts";

const ENDPOINT = "https://agenta.example/api/tools/call";
const EXECUTION = "019c-execution";

const START: ResolvedToolSpec = {
  name: "start_session",
  callRef: "tools.agenta.start_session",
  permission: "ask",
  configuredPermission: "allow",
  targetPermissions: { "email-writer": "ask" },
  ephemeralArgs: ["description"],
};
const COMMIT: ResolvedToolSpec = {
  name: "commit_revision",
  callRef: "tools.agenta.commit_revision",
  permission: "ask",
};

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: any;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function toolResult(content: unknown, code = "STATUS_CODE_OK"): Response {
  return new Response(
    JSON.stringify({
      call: {
        data: {
          tool_call_id: "t",
          content:
            typeof content === "string" ? content : JSON.stringify(content),
        },
        status: { code },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function stubFetch(
  answer: (sent: Sent) => Response | Promise<Response>,
): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const entry = {
      url: String(url),
      headers: init?.headers ?? {},
      body: JSON.parse(String(init?.body ?? "{}")),
    };
    sent.push(entry);
    return answer(entry);
  }) as typeof fetch;
  return sent;
}

function fetcher(
  toolSpecs: ResolvedToolSpec[] = [START, COMMIT],
  logs: string[] = [],
  timeoutMs?: number,
): GateAnswerFetcher {
  return buildGateAnswerFetcher({
    callback: fixedToolCallback({
      endpoint: ENDPOINT,
      authorization: "Secret run-credential",
    }),
    runContext: undefined,
    toolSpecs,
    executionId: EXECUTION,
    log: (line) => logs.push(line),
    timeoutMs,
  });
}

describe("buildGateAnswerFetcher", () => {
  it("asks only about the three session writes", () => {
    stubFetch(() =>
      toolResult({ permission: "allow", basis: "configured_permission" }),
    );
    const fetch = fetcher();
    assert.equal(
      fetch({ toolName: "commit_revision", callId: "c1", args: {} }),
      undefined,
      "another platform op keeps its card and makes no call",
    );
    assert.equal(
      fetch({ toolName: "unknown_tool", callId: "c1", args: {} }),
      undefined,
    );
    assert.equal(
      fetch({ toolName: undefined, callId: "c1", args: {} }),
      undefined,
    );
    for (const callRef of [
      "tools.agenta.start_session",
      "tools.agenta.send_session_message",
      "tools.agenta.cancel_session",
    ]) {
      const asked = fetcher([{ name: "op", callRef }])({
        toolName: "op",
        callId: "c1",
        args: {},
      });
      assert.ok(asked, `${callRef} asks the server`);
    }
  });

  it("sends the call ref, the arguments, the execution and both policy fields", async () => {
    const sent = stubFetch(() =>
      toolResult({ permission: "allow", basis: "configured_permission" }),
    );
    const answer = await fetcher()({
      toolName: "start_session",
      callId: "call-1",
      args: {
        agent: "email-writer",
        message: "Draft it",
        description: "for the person",
      },
    });
    assert.deepEqual(answer, {
      permission: "allow",
      basis: "configured_permission",
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, ENDPOINT);
    assert.equal(sent[0].headers.authorization, "Secret run-credential");
    assert.deepEqual(sent[0].body, {
      data: {
        id: "resolve-gate-call-1",
        type: "function",
        function: {
          name: "tools.agenta.resolve_gate",
          arguments: {
            call_ref: "tools.agenta.start_session",
            // The note for the person is not part of the call.
            arguments: { agent: "email-writer", message: "Draft it" },
            execution_id: EXECUTION,
            configured_permission: "allow",
            target_permissions: { "email-writer": "ask" },
          },
        },
      },
    });
  });

  it("sends null and an empty map when the spec has no policy fields", async () => {
    const sent = stubFetch(() =>
      toolResult({ permission: "ask", basis: null }),
    );
    const answer = await fetcher([
      { name: "cancel_session", callRef: "tools.agenta.cancel_session" },
    ])({
      toolName: "cancel_session",
      callId: "c",
      args: { session_id: "s" },
    });
    assert.deepEqual(answer, { permission: "ask" });
    const args = sent[0].body.data.function.arguments;
    assert.equal(args.configured_permission, null);
    assert.deepEqual(args.target_permissions, {});
  });

  it("reads deny with its basis", async () => {
    stubFetch(() =>
      toolResult({ permission: "deny", basis: "configured_permission" }),
    );
    const answer = await fetcher()({
      toolName: "start_session",
      callId: "c",
      args: {},
    });
    assert.deepEqual(answer, {
      permission: "deny",
      basis: "configured_permission",
    });
  });

  const faults: Array<[string, () => Response | Promise<Response>]> = [
    [
      "an unknown op answered as a tool error",
      () => toolResult("unknown tool", "STATUS_CODE_ERROR"),
    ],
    [
      "an unknown op answered with HTTP 404",
      () => new Response("not found", { status: 404 }),
    ],
    ["an HTTP 500", () => new Response("boom", { status: 500 })],
    [
      "a transport error",
      () => Promise.reject(new Error("connection refused")),
    ],
    ["a body that is not JSON", () => toolResult("not json")],
    [
      "an unknown permission word",
      () => toolResult({ permission: "yes", basis: "x" }),
    ],
    ["an allow with no basis", () => toolResult({ permission: "allow" })],
    ["an array", () => toolResult([])],
  ];
  for (const [name, answer] of faults) {
    it(`reads ${name} as ask`, async () => {
      stubFetch(answer);
      const logs: string[] = [];
      const result = await fetcher(
        undefined,
        logs,
      )({
        toolName: "start_session",
        callId: "c",
        args: {},
      });
      assert.deepEqual(result, { permission: "ask" });
      assert.ok(logs.some((line) => line.includes("resolve_gate failed")));
    });
  }

  it("reads ask when the run has no callback endpoint", async () => {
    const sent = stubFetch(() =>
      toolResult({ permission: "allow", basis: "x" }),
    );
    const answer = await buildGateAnswerFetcher({
      callback: undefined,
      runContext: undefined,
      toolSpecs: [START],
      executionId: EXECUTION,
    })({ toolName: "start_session", callId: "c", args: {} });
    assert.deepEqual(answer, { permission: "ask" });
    assert.equal(sent.length, 0);
  });

  it("reads ask when a context binding has no value", async () => {
    const sent = stubFetch(() =>
      toolResult({ permission: "allow", basis: "x" }),
    );
    const answer = await fetcher([
      { ...START, contextBindings: { session_id: "$ctx.session.id" } },
    ])({ toolName: "start_session", callId: "c", args: {} });
    assert.deepEqual(answer, { permission: "ask" });
    assert.equal(sent.length, 0);
  });

  it("gives up after the time limit and reads ask", async () => {
    assert.equal(GATE_ANSWER_TIMEOUT_MS, 5_000);
    stubFetch(
      () =>
        new Promise<Response>(() => {
          // Never answers.
        }),
    );
    // The stub ignores the signal, so wire the abort the way the platform fetch does.
    const hanging = globalThis.fetch;
    globalThis.fetch = ((url: any, init: any) =>
      new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal.reason ?? new Error("aborted")),
        );
        void hanging(url, init).then(resolve, reject);
      })) as typeof fetch;
    const limit = 100;
    const started = Date.now();
    const answer = await fetcher(
      undefined,
      undefined,
      limit,
    )({
      toolName: "start_session",
      callId: "c",
      args: {},
    });
    const waited = Date.now() - started;
    assert.deepEqual(answer, { permission: "ask" });
    assert.ok(waited >= limit - 20, `waited ${waited} ms`);
  });
});

function relayGate(overrides: Partial<GateDescriptor> = {}): GateDescriptor {
  return {
    executor: "relay",
    toolName: "start_session",
    specPermission: "ask",
    args: { agent: "email-writer", message: "Draft it" },
    ...overrides,
  };
}

/** A fake fetcher that counts calls and answers with the given permission. */
function fakeFetcher(permission: "allow" | "ask" | "deny") {
  const calls: Array<{
    toolName?: string;
    callId: string;
    args: unknown;
  }> = [];
  const fetch: GateAnswerFetcher = (input) => {
    calls.push(input);
    return Promise.resolve(
      permission === "ask"
        ? { permission }
        : { permission, basis: "configured_permission" },
    );
  };
  return { calls, fetch };
}

function responder(
  fetch?: GateAnswerFetcher,
  stored = new Map<string, unknown>(),
) {
  return new ApprovalResponder(
    { default: "allow_reads", rules: [] },
    new ConversationDecisions(stored),
    () => {},
    fetch,
  );
}

function ask(r: ApprovalResponder, gate: GateDescriptor, toolCallId?: string) {
  return r.onPermission({
    id: "perm-1",
    toolCallId,
    availableReplies: ["once", "reject"],
    gate,
  });
}

describe("ApprovalResponder at the gate", () => {
  it("runs the call with no card when the server answers allow", async () => {
    const { calls, fetch } = fakeFetcher("allow");
    const verdict = await ask(responder(fetch), relayGate(), "call-1");
    assert.deepEqual(verdict, {
      kind: "allow",
      byGateAnswer: true,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].callId, "call-1");
  });

  it("refuses the call with no card when the server answers deny", async () => {
    const { fetch } = fakeFetcher("deny");
    const verdict = await ask(responder(fetch), relayGate(), "call-1");
    assert.deepEqual(verdict, {
      kind: "deny",
      byGateAnswer: true,
    });
  });

  it("shows the card when the server answers ask", async () => {
    const { fetch } = fakeFetcher("ask");
    const verdict = await ask(responder(fetch), relayGate(), "call-1");
    assert.deepEqual(verdict, { kind: "pendingApproval" });
  });

  it("shows the card when the fetcher does not ask about the call", async () => {
    const verdict = await ask(
      responder(() => undefined),
      relayGate(),
      "call-1",
    );
    assert.deepEqual(verdict, { kind: "pendingApproval" });
  });

  it("shows the card when there is no fetcher, as before", async () => {
    const verdict = await ask(responder(undefined), relayGate(), "call-1");
    assert.deepEqual(verdict, { kind: "pendingApproval" });
  });

  it("does not ask the server when the configuration already decided", async () => {
    const { calls, fetch } = fakeFetcher("deny");
    const r = responder(fetch);
    assert.equal(
      (await ask(r, relayGate({ specPermission: "allow" }), "a")).kind,
      "allow",
    );
    assert.equal(
      (await ask(r, relayGate({ specPermission: "deny" }), "b")).kind,
      "deny",
    );
    assert.equal(calls.length, 0);
  });

  it("does not ask the server when a person already answered this call", async () => {
    const { calls, fetch } = fakeFetcher("deny");
    const gate = relayGate();
    const stored = new Map<string, unknown>([
      [approvedCallKey(gate.toolName, gate.args)!, "allow"],
    ]);
    const verdict = await ask(responder(fetch, stored), gate, "call-1");
    assert.equal(verdict.kind, "allow");
    assert.equal(calls.length, 0);
  });

  it("does not ask the server for a harness builtin", async () => {
    const { calls, fetch } = fakeFetcher("allow");
    const verdict = await ask(
      responder(fetch),
      relayGate({ executor: "harness", toolName: "Bash" }),
      "call-1",
    );
    assert.deepEqual(verdict, { kind: "pendingApproval" });
    assert.equal(calls.length, 0);
  });

  it("spends a grant that an earlier gate left, and does not ask the server", async () => {
    const { calls, fetch } = fakeFetcher("deny");
    let taken = 0;
    const verdict = await responder(fetch).onPermission({
      id: "perm-1",
      availableReplies: ["once", "reject"],
      gate: relayGate(),
      takeGrant: () => {
        taken += 1;
        return true;
      },
    });
    assert.deepEqual(verdict, { kind: "allow" });
    assert.equal(taken, 1);
    assert.equal(calls.length, 0);
  });

  it("asks the server when no grant is left", async () => {
    const { calls, fetch } = fakeFetcher("allow");
    const verdict = await responder(fetch).onPermission({
      id: "perm-1",
      availableReplies: ["once", "reject"],
      gate: relayGate(),
      takeGrant: () => false,
    });
    assert.deepEqual(verdict, { kind: "allow", byGateAnswer: true });
    assert.equal(calls.length, 1);
  });

  it("does not spend a grant when the configuration already decided", async () => {
    let taken = 0;
    await responder(fakeFetcher("allow").fetch).onPermission({
      id: "perm-1",
      availableReplies: ["once", "reject"],
      gate: relayGate({ specPermission: "deny" }),
      takeGrant: () => {
        taken += 1;
        return true;
      },
    });
    assert.equal(taken, 0);
  });

  it("asks the server for every gate, with no kept answer", async () => {
    const { calls, fetch } = fakeFetcher("allow");
    const r = responder(fetch);
    await ask(r, relayGate(), "call-1");
    await ask(
      r,
      relayGate({ args: { agent: "other-agent", message: "Something else" } }),
      "call-1",
    );
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].args, {
      agent: "other-agent",
      message: "Something else",
    });
  });

  it("names the server request by the gate's id when there is no tool call id", async () => {
    const { calls, fetch } = fakeFetcher("allow");
    await ask(responder(fetch), relayGate());
    assert.equal(calls[0].callId, "perm-1");
  });
});

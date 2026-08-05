/**
 * A failed history reconstruction must not destroy a live approval resume.
 *
 * `carriesApprovalReplyOnly` makes `reconstructHistoryIfNeeded` run on the LIVE resume too, but the
 * resume never sends the rebuilt history: it continues the ORIGINAL prompt promise, so `turnText`
 * is discarded. If reconstruction threw there, `runTurn` returned `{ok:false}`, the dispatch
 * evicted the live session and retried cold, and reconstruction threw again — one 500 from the
 * records endpoint lost the human's approval AND the parked session. The resume path now keeps the
 * inbound request and continues; the COLD path still fails loudly, which is where it matters.
 *
 * Run: pnpm exec vitest run tests/unit/reconstruct-resume-nonfatal.test.ts
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

import type { AgentEvent, AgentRunRequest } from "../../src/protocol.ts";
import {
  acquireEnvironment,
  runTurn,
  type SandboxAgentDeps,
} from "../../src/engines/sandbox_agent.ts";
import { noteRecordsIncomplete } from "../../src/sessions/persist.ts";

const SESSION_ID = "sess-resume-nonfatal";

/** The out-of-band approval reply: the parked call plus its `{approved}` envelope, no user text. */
const approvalReply: AgentRunRequest = {
  harness: "claude",
  model: "m1",
  sessionId: SESSION_ID,
  telemetry: {
    exporters: { otlp: { headers: { authorization: "ApiKey run" } } },
  } as never,
  messages: [
    {
      role: "assistant",
      content: [
        { type: "tool_call", toolCallId: "tc-gate", toolName: "commit" },
        {
          type: "tool_result",
          toolCallId: "tc-gate",
          toolName: "commit",
          output: { approved: true, interactionToken: "tc-gate" },
        },
      ],
    },
  ],
};

function fakeHarness() {
  const calls = {
    logs: [] as string[],
    permissionReplies: [] as Array<{ id: string; reply: string }>,
    promptCount: 0,
  };

  const session = {
    id: "session-1",
    onEvent(_handler: (event: unknown) => void) {},
    onPermissionRequest(_handler: (request: unknown) => void) {},
    async respondPermission(id: string, reply: string) {
      calls.permissionReplies.push({ id, reply });
    },
    async prompt(_blocks: unknown) {
      calls.promptCount += 1;
      return {
        stopReason: "complete",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };

  const sandbox = {
    async createSession(_opts: unknown) {
      return session;
    },
    async destroySession(_id: string) {},
    async destroySandbox() {},
    async dispose() {},
  };

  const makeRun = (): Record<string, unknown> => {
    const emitted: AgentEvent[] = [];
    return {
      start() {},
      handleUpdate() {},
      emitEvent(event: AgentEvent) {
        emitted.push(event);
      },
      usage() {
        return { input: 0, output: 0, total: 0, cost: 0 };
      },
      setUsage() {},
      finish() {
        return "assistant output";
      },
      recordError() {},
      output() {
        return "assistant output";
      },
      async flush() {},
      events() {
        return emitted;
      },
      settleOpenToolCalls() {},
      openToolCallIds() {
        return [];
      },
      markToolCallDenied() {},
      traceId() {
        return "0123456789abcdef0123456789abcdef";
      },
    };
  };

  const deps: SandboxAgentDeps = {
    log: (message) => calls.logs.push(message),
    createLocalCwd: (durable?: string) => durable ?? "/tmp/agenta-fake-cwd",
    createDaytonaCwd: (durable?: string) =>
      durable ?? "/home/sandbox/agenta-fake-cwd",
    resolveSkillDirs: () => ({ skills: [], cleanup: () => {} }),
    buildDaemonEnv: () => ({}),
    resolveDaemonBinary: () => "/bin/sandbox-agent",
    buildSandboxProvider: () => ({ provider: true }) as never,
    createPersist: () => ({}) as never,
    startSandboxAgent: (async () => sandbox) as never,
    prepareWorkspace: (async () => ({ cleanup: async () => {} })) as never,
    probeCapabilities: async () =>
      ({
        source: "probed",
        capabilities: {
          mcpTools: true,
          toolCalls: true,
          usage: true,
          streamingDeltas: true,
        },
      }) as never,
    applyModel: async (_session, model) => model ?? "resolved-model",
    createOtel: (() => makeRun()) as never,
    startToolRelay: (() => ({ stop: async () => {} })) as never,
    localRelayHost: (() => "local-relay-host") as never,
    sandboxRelayHost: (() => "sandbox-relay-host") as never,
    responderFactory: () => ({
      async onPermission() {
        return { kind: "allow" } as const;
      },
      async onClientTool() {
        return { kind: "deny" } as const;
      },
    }),
    hydrateHarnessSessionFromDurable: async () => {},
    appendSessionTurn: Object.assign(async () => {}, {
      complete: async () => {},
    }) as never,
  };

  return { calls, deps };
}

describe("runTurn: a broken record log does not kill a live approval resume", () => {
  beforeEach(() => {
    // The turn's side-channel writes (session ownership, interaction resolve) are fire-and-forget;
    // answer them locally so the suite never reaches for the network.
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    // The hermetic setup pins reconstruction off for the engine suites; this file needs it on.
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    // Mark the log broken so reconstruction throws before it even queries (the same failure a
    // 500 from the records endpoint produces, without a network stub).
    noteRecordsIncomplete(SESSION_ID);
  });

  it("keeps the inbound request and completes the turn when reconstruction throws on a resume", async () => {
    const { calls, deps } = fakeHarness();
    const acquired = await acquireEnvironment(approvalReply, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;

    const result = await runTurn(
      acquired.env,
      approvalReply,
      undefined,
      undefined,
      {
        approvalParkMode: true,
        resume: {
          decisions: [
            {
              permissionId: "perm-1",
              reply: "once",
              toolCallId: "tc-gate",
              toolName: "commit",
              args: { message: "hi" },
              interactionToken: "tc-gate",
              promptPromise: Promise.resolve({
                stopReason: "complete",
                usage: { inputTokens: 1, outputTokens: 1 },
              }),
            },
          ],
          carriedForward: [],
        },
      },
    );

    assert.equal(
      result.ok,
      true,
      "a records failure must not fail the turn that answers a parked gate",
    );
    assert.deepEqual(
      calls.permissionReplies,
      [{ id: "perm-1", reply: "once" }],
      "the parked gate was still answered on the live session",
    );
    assert.ok(
      calls.logs.some((line) => line.includes("[reconstruct] live resume")),
      "the skipped reconstruction is logged exactly once, not swallowed",
    );

    await acquired.env.destroy();
  });

  it("still fails the turn loudly when reconstruction throws on a COLD turn", async () => {
    const { deps } = fakeHarness();
    const acquired = await acquireEnvironment(approvalReply, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;

    // No `resume`: nothing holds this conversation, so answering from an unreadable log would
    // let the agent reply as though the task had just started.
    const result = await runTurn(
      acquired.env,
      approvalReply,
      undefined,
      undefined,
      {
        approvalParkMode: true,
      },
    );

    assert.equal(result.ok, false, "a cold turn with no history must fail");
    if (result.ok) return;
    assert.match(String(result.error), /incomplete conversation/);

    await acquired.env.destroy();
  });
});

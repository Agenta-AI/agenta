/**
 * What a FAILED turn leaves behind for the next one.
 *
 * A failed turn used to drop the harness's resume point, so the next turn rebuilt the
 * conversation cold by replaying it as text, failed turn included. When the failure was a
 * provider refusal of something in that turn (Inception refusing a tool result about its own
 * model), every later turn resent it and was refused too: one bad turn poisoned the session.
 *
 * The rule these tests pin: a harness session that can take the failed turn back out of its
 * transcript (`rollbackFailedTurn`, the in-process Pi session) keeps its native continuity, with
 * the same pointer and ledger completion a finished turn writes. One that cannot (a sandbox-agent
 * session) drops the resume point as before, and the replay leaves the failed turn out
 * (`session-reconstruct.test.ts`).
 *
 * Run: pnpm exec vitest run --project unit failed-turn-continuity
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "vitest";

import { runSandboxAgent } from "../../src/engines/sandbox_agent.ts";
import type { SandboxAgentDeps } from "../../src/engines/sandbox_agent.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";
import { SessionContinuityStore } from "../../src/engines/sandbox_agent/session-continuity.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";

beforeEach(() => {
  process.env.AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS = "local,daytona";
  process.env.AGENTA_RUNNER_DAYTONA_API_KEY = "test-key";
  resetRunnerConfigCache();
});

const AGENT_SESSION_ID = "agent-native-9";
const REFUSAL =
  "Internal error: Upstream error from Inception: I'm sorry, but I can't share details of my architecture or training process.";

function fakeFailingSandbox(
  rollback?: () => Promise<boolean>,
  completed?: { nativeHistorySaved?: () => boolean },
) {
  const continuityStore = new SessionContinuityStore();
  // The conversation's previous turn finished on this harness session.
  continuityStore.record("sess-fail", "claude", AGENT_SESSION_ID, 0);
  const calls = {
    rollbacks: 0,
    completed: [] as Array<{
      sessionId: string;
      turnIndex: number;
      agentSessionId?: string;
      endTime: string;
    }>,
  };
  const session: any = {
    id: "harness-session-1",
    agentSessionId: AGENT_SESSION_ID,
    onEvent() {},
    onPermissionRequest() {},
    async prompt() {
      if (completed) return { stopReason: "end_turn" };
      throw new Error(REFUSAL);
    },
  };
  if (completed?.nativeHistorySaved)
    session.nativeHistorySaved = completed.nativeHistorySaved;
  if (rollback) {
    session.rollbackFailedTurn = async () => {
      calls.rollbacks += 1;
      return rollback();
    };
  }
  const sandbox: any = {
    sandboxId: "daytona/sbx-warm",
    sandboxProvider: { destroy: async () => {} },
    sandboxProviderRawId: "sbx-warm",
    async createSession() {
      return session;
    },
    async resumeSession() {
      return session;
    },
    async destroySession() {},
    async pauseSandbox() {},
    async destroySandbox() {},
    async dispose() {},
    async runProcess() {
      return { stdout: "", exitCode: 0 };
    },
  };
  const appendSessionTurn: any = async () => {};
  appendSessionTurn.complete = async (
    sessionId: string,
    turnIndex: number,
    turn: { agentSessionId?: string; endTime: string },
  ) => {
    calls.completed.push({
      sessionId,
      turnIndex,
      agentSessionId: turn.agentSessionId,
      endTime: turn.endTime,
    });
  };
  const deps: SandboxAgentDeps = {
    log: () => {},
    createDaytonaCwd: (durable?: string) => durable ?? "/tmp/agenta-fake-cwd",
    createLocalCwd: (durable?: string) => durable ?? "/tmp/agenta-fake-cwd",
    resolveSkillDirs: () => ({ skills: [], dropped: [], cleanup: () => {} }),
    buildDaemonEnv: () => ({}),
    resolveDaemonBinary: () => "/bin/sandbox-agent",
    buildSandboxProvider: () =>
      ({ provider: true, deleteSandbox: async () => {} }) as any,
    createPersist: () => ({ updateSession: async () => {} }) as any,
    sessionContinuityStore: continuityStore,
    hydrateHarnessSessionFromDurable: async () => {},
    appendSessionTurn,
    startSandboxAgent: (async () => sandbox) as any,
    prepareWorkspace: (async () => ({ cleanup: async () => {} })) as any,
    prepareDaytonaPiAssets: async () => true,
    discoverTunnelEndpoint: async () => null,
    probeCapabilities: async () =>
      ({
        source: "probed",
        capabilities: {
          mcpTools: true,
          toolCalls: true,
          usage: true,
          streamingDeltas: true,
        },
      }) as any,
    applyModel: async (_s, model) => model ?? "resolved-model",
    createOtel: (() => ({
      start() {},
      handleUpdate() {},
      emitEvent() {},
      usage: () => ({ input: 0, output: 0, total: 0, cost: 0 }),
      setUsage() {},
      finish: () => "",
      recordError() {},
      output: () => "",
      flush: async () => {},
      events: () => [],
      settleOpenToolCalls() {},
      traceId: () => "trace-1",
    })) as any,
    startToolRelay: (() => ({ stop: async () => {} })) as any,
    localRelayHost: (() => "local-relay-host") as any,
    sandboxRelayHost: (() => "sandbox-relay-host") as any,
    responderFactory: () => ({
      async onPermission() {
        return { kind: "allow" } as const;
      },
      async onClientTool() {
        return { kind: "deny" } as const;
      },
    }),
    readStoredSandboxPointer: async () => ({ sandboxId: "sbx-warm" }),
  };
  return { calls, deps, continuityStore };
}

const failRequest: AgentRunRequest = {
  harness: "claude",
  sandbox: "daytona",
  sessionId: "sess-fail",
  streamId: "stream-fail",
  messages: [{ role: "user", content: "check the pricing for mercury-2.5" }],
  telemetry: {
    exporters: { otlp: { headers: { authorization: "ApiKey abc" } } },
  } as any,
};

describe("a failed turn's continuity", () => {
  it("keeps the native session when the harness rolled the failed turn back", async () => {
    const { calls, deps, continuityStore } = fakeFailingSandbox(async () => true);

    const result = await runSandboxAgent(failRequest, undefined, undefined, deps);

    assert.equal(result.ok, false);
    assert.equal(calls.rollbacks, 1);
    assert.deepEqual(continuityStore.get("sess-fail", "claude"), {
      agentSessionId: AGENT_SESSION_ID,
      turnIndex: 1,
    });
    assert.equal(continuityStore.latestTurn("sess-fail"), 1);
    assert.equal(calls.completed.length, 1, "the failed turn's ledger row is completed");
    assert.equal(calls.completed[0].turnIndex, 1);
    assert.equal(calls.completed[0].agentSessionId, AGENT_SESSION_ID);
  });

  it("drops the resume point when the rollback could not vouch for the transcript", async () => {
    const { calls, deps, continuityStore } = fakeFailingSandbox(async () => false);

    await runSandboxAgent(failRequest, undefined, undefined, deps);

    assert.equal(calls.rollbacks, 1);
    assert.equal(continuityStore.get("sess-fail", "claude"), undefined);
    assert.equal(calls.completed.length, 0);
  });

  it("drops the resume point for a session that cannot roll back (sandbox-agent), as before", async () => {
    const { calls, deps, continuityStore } = fakeFailingSandbox();

    await runSandboxAgent(failRequest, undefined, undefined, deps);

    assert.equal(continuityStore.get("sess-fail", "claude"), undefined);
    assert.equal(calls.completed.length, 0);
  });

  it("drops the resume point when the rollback throws", async () => {
    const { deps, continuityStore } = fakeFailingSandbox(async () => {
      throw new Error("transcript unreadable");
    });

    await runSandboxAgent(failRequest, undefined, undefined, deps);

    assert.equal(continuityStore.get("sess-fail", "claude"), undefined);
  });

  it("tells the person what the provider said, not to resend", async () => {
    const { deps } = fakeFailingSandbox(async () => true);

    const result = await runSandboxAgent(failRequest, undefined, undefined, deps);

    assert.equal(result.ok, false);
    const error = String((result as { error?: string }).error);
    assert.match(error, /Inception/);
    assert.match(error, /can't share details of my architecture/);
    assert.doesNotMatch(error, /Send the message again/);
  });
});

describe("a completed turn whose conversation file did not reach the drive (Codex R9-2)", () => {
  it("does not become a resume point: the next cold turn rebuilds from the records", async () => {
    const { calls, deps, continuityStore } = fakeFailingSandbox(undefined, {
      nativeHistorySaved: () => false,
    });

    const result = await runSandboxAgent(failRequest, undefined, undefined, deps);

    assert.equal(result.ok, true);
    assert.equal(continuityStore.get("sess-fail", "claude"), undefined);
    assert.equal(calls.completed.length, 0, "the ledger row stays incomplete");
  });

  it("is a resume point when the file was saved, as before", async () => {
    const { calls, deps, continuityStore } = fakeFailingSandbox(undefined, {
      nativeHistorySaved: () => true,
    });

    const result = await runSandboxAgent(failRequest, undefined, undefined, deps);

    assert.equal(result.ok, true);
    assert.deepEqual(continuityStore.get("sess-fail", "claude"), {
      agentSessionId: AGENT_SESSION_ID,
      turnIndex: 1,
    });
    assert.equal(calls.completed.length, 1);
  });
});

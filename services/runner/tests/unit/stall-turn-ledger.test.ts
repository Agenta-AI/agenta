/**
 * The `session_turns` row of an attempt that stalled before its first response.
 *
 * The stall retry runs the prompt again under the next turn index, so the stalled attempt's row
 * used to keep `end_time` NULL forever. It is closed by the next turn that starts, after that
 * turn's own row is written: closed any earlier, it would be the latest finished row, and the
 * retry's cold start would resume the harness session the stall threw away.
 *
 * Run: pnpm exec vitest run tests/unit/stall-turn-ledger.test.ts
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

const STALL_LIMITS = { totalMs: 5000, idleMs: 400, ttfbMs: 100, toolCallMs: 5000 };

function fixture() {
  const store = new SessionContinuityStore();
  const ledger: string[] = [];
  let stall = true;
  let release: ((value: unknown) => void) | undefined;
  const session: any = {
    id: "harness-session-1",
    agentSessionId: "agent-native-1",
    onEvent() {},
    onPermissionRequest() {},
    async prompt() {
      if (!stall) return { stopReason: "end_turn" };
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  };
  const sandbox: any = {
    sandboxId: "daytona/sbx-1",
    sandboxProvider: { destroy: async () => {} },
    sandboxProviderRawId: "sbx-1",
    async createSession() {
      return session;
    },
    async resumeSession() {
      return session;
    },
    async destroySession() {
      release?.({ stopReason: "cancelled" });
    },
    async pauseSandbox() {},
    async destroySandbox() {},
    async dispose() {},
    async runProcess() {
      return { stdout: "", exitCode: 0 };
    },
  };
  const appendSessionTurn: any = async (
    _sessionId: string,
    _harness: string,
    turnIndex: number,
  ) => {
    ledger.push(`append ${turnIndex}`);
  };
  appendSessionTurn.complete = async (_sessionId: string, turnIndex: number) => {
    ledger.push(`complete ${turnIndex}`);
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
    sessionContinuityStore: store,
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
    readStoredSandboxPointer: async () => ({ sandboxId: "sbx-1" }),
    resolveRunLimits: () => STALL_LIMITS,
  };
  return {
    deps,
    ledger,
    answer: () => {
      stall = false;
    },
  };
}

const request: AgentRunRequest = {
  harness: "claude",
  sandbox: "daytona",
  sessionId: "sess-stall",
  streamId: "stream-stall",
  messages: [{ role: "user", content: "hello" }],
  telemetry: {
    exporters: { otlp: { headers: { authorization: "ApiKey abc" } } },
  } as any,
};

describe("a stalled attempt's turn row", () => {
  it("stays open until the retry has written its own row, then is closed", async () => {
    const { deps, ledger, answer } = fixture();

    const stalled = await runSandboxAgent(request, undefined, undefined, deps);
    assert.equal(stalled.stalledBeforeFirstResponse, true);
    assert.deepEqual(ledger, ["append 0"]);

    answer();
    const retried = await runSandboxAgent(request, undefined, undefined, deps);

    assert.equal(retried.ok, true);
    assert.deepEqual(ledger, ["append 0", "append 1", "complete 0", "complete 1"]);
  });

  it("is closed once, not again by a later turn", async () => {
    const { deps, ledger, answer } = fixture();
    await runSandboxAgent(request, undefined, undefined, deps);
    answer();
    await runSandboxAgent(request, undefined, undefined, deps);
    ledger.length = 0;

    await runSandboxAgent(request, undefined, undefined, deps);

    assert.deepEqual(ledger, ["append 2", "complete 2"]);
  });
});

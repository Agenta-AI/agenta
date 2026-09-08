/**
 * The continuity record a STOPPED turn writes.
 *
 * A user Stop keeps the sandbox warm (see `harness-cancel-park.test.ts`), but the park is
 * process-local: it dies with the runner. What survives a runner restart is the durable turn
 * ledger, and `hydrateHarnessSessionFromDurable` re-seeds the in-memory store from it only when
 * the latest row carries `end_time` AND `agent_session_id`. A stopped turn used to write neither,
 * so a restart after a Stop lost the native harness session and the next message rebuilt cold.
 *
 * These tests pin the rule that fixes it: the record follows the HARNESS's confirmation, not the
 * park decision. A settled cancel means the harness answered the cancelled prompt and is idle, so
 * its native transcript holds a short but finished turn — a faithful resume point. An unsettled
 * cancel leaves the harness in an unknown state and still falls back to cold replay.
 *
 * Run: pnpm exec vitest run tests/unit/cancel-continuity.test.ts
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "vitest";

import { runSandboxAgent } from "../../src/engines/sandbox_agent.ts";
import type { SandboxAgentDeps } from "../../src/engines/sandbox_agent.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";
import { SessionContinuityStore } from "../../src/engines/sandbox_agent/session-continuity.ts";
import { USER_STOP_ABORT_REASON } from "../../src/sessions/stop-signal.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";

beforeEach(() => {
  process.env.AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS = "local,daytona";
  process.env.AGENTA_RUNNER_DAYTONA_API_KEY = "test-key";
  resetRunnerConfigCache();
});

const AGENT_SESSION_ID = "agent-native-7";

interface CancelFakeOpts {
  /**
   * Whether the sandbox client can send `session/cancel` at all. An unpatched client has no
   * `cancelSession`, which is the shipped "unsettled" shape: the harness is never told to stop.
   */
  cancellable?: boolean;
  /** Trigger the test's abort only after acquisition has completed and prompt has started. */
  onPrompt?: () => void;
  /** Model the shell child Codex leaves behind after answering a cancelled prompt. */
  leakedCodexChild?: boolean;
  /** Force Codex's best-effort post-cancel reap to fail in a known or unexpected way. */
  codexReapFailure?: "failed" | "unknown";
}

/**
 * A sandbox whose prompt stays open until the cancel arrives — the real shape of a Stop. The
 * abort alone never ends the prompt; only `session/cancel` does.
 */
function fakeCancellableSandbox(opts: CancelFakeOpts = {}) {
  const continuityStore = new SessionContinuityStore();
  const calls = {
    paused: 0,
    destroyed: 0,
    appended: [] as Array<{ turnIndex: number; agentSessionId?: string }>,
    completed: [] as Array<{
      sessionId: string;
      turnIndex: number;
      agentSessionId?: string;
      endTime: string;
    }>,
    cancelled: [] as string[],
    logs: [] as string[],
    lifecycle: [] as string[],
  };
  let leakedCodexChildRunning = opts.leakedCodexChild === true;

  let answerPrompt: (() => void) | undefined;
  const session = {
    id: "harness-session-1",
    agentSessionId: AGENT_SESSION_ID,
    onEvent() {},
    onPermissionRequest() {},
    prompt() {
      const response = new Promise((resolve) => {
        answerPrompt = () => resolve({ stopReason: "cancelled" });
      });
      opts.onPrompt?.();
      return response;
    },
  };

  const sandbox: any = {
    sandboxId: "daytona/sbx-warm",
    sandboxProvider: { destroy: async () => {} },
    sandboxProviderRawId: "sbx-warm",
    async createSession() {
      return session;
    },
    async destroySession() {},
    async pauseSandbox() {
      calls.lifecycle.push("park");
      calls.paused += 1;
    },
    async destroySandbox() {
      calls.destroyed += 1;
    },
    async dispose() {},
    async runProcess(request: { command: string; args?: string[] }) {
      if (request.command === "ps") {
        calls.lifecycle.push("ps");
        if (opts.codexReapFailure === "failed") {
          throw new Error("ps unavailable");
        }
        return {
          stdout: [
            "100 1 120 /x/bin/sandbox-agent server --port 3000",
            "110 100 119 node /x/codex-acp",
            "120 110 118 /x/bin/codex app-server",
            ...(leakedCodexChildRunning ? ["130 120 0 sleep 300"] : []),
          ].join("\n"),
          exitCode: 0,
        };
      }
      if (request.command === "kill") {
        calls.lifecycle.push("kill");
        leakedCodexChildRunning = false;
        return { stdout: "", exitCode: 0 };
      }
      return { stdout: "", exitCode: 0 };
    },
  };
  if (opts.codexReapFailure === "unknown") {
    Object.defineProperty(sandbox, "runProcess", {
      get() {
        throw new Error("reap inspection unavailable");
      },
    });
  }
  if (opts.cancellable !== false) {
    sandbox.cancelSession = async (id: string) => {
      calls.lifecycle.push("cancel");
      calls.cancelled.push(id);
      // The harness answers the cancelled prompt: this is what `settled` measures.
      answerPrompt?.();
    };
  }

  const appendSessionTurn: any = async (
    _sessionId: string,
    _harness: string,
    turnIndex: number,
    turn: { agentSessionId?: string },
  ) => {
    calls.appended.push({ turnIndex, agentSessionId: turn.agentSessionId });
  };
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
    log: (message) => {
      calls.logs.push(message);
    },
    createDaytonaCwd: (durable?: string) => durable ?? "/tmp/agenta-fake-cwd",
    createLocalCwd: (durable?: string) => durable ?? "/tmp/agenta-fake-cwd",
    resolveSkillDirs: () => ({ skills: [], cleanup: () => {} }),
    buildDaemonEnv: () => ({}),
    resolveDaemonBinary: () => "/bin/sandbox-agent",
    buildSandboxProvider: () =>
      ({ provider: true, deleteSandbox: async () => {} }) as any,
    createPersist: () => ({}) as any,
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
      finish: () => "partial answer",
      recordError() {},
      output: () => "partial answer",
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

  return {
    calls,
    deps,
    continuityStore,
    leakedCodexChildRunning: () => leakedCodexChildRunning,
  };
}

const stopRequest: AgentRunRequest = {
  harness: "claude",
  sandbox: "daytona",
  sessionId: "sess-stop",
  streamId: "stream-stop",
  messages: [{ role: "user", content: "remember the codeword" }],
  telemetry: {
    exporters: { otlp: { headers: { authorization: "ApiKey abc" } } },
  } as any,
};

/** Build the real timing shape: acquire first, then abort when the harness prompt is in flight. */
function fakeAbortingSandbox(
  opts: CancelFakeOpts = {},
  kind: "user-stop" | "plain" = "user-stop",
) {
  const controller = new AbortController();
  const fake = fakeCancellableSandbox({
    ...opts,
    onPrompt: () =>
      kind === "user-stop"
        ? controller.abort(USER_STOP_ABORT_REASON)
        : controller.abort(),
  });
  return { ...fake, signal: controller.signal };
}

describe("a stopped turn's continuity record", () => {
  it("completes the durable ledger row with an end time and the native session id", async () => {
    const { calls, deps, signal } = fakeAbortingSandbox();

    const result = await runSandboxAgent(stopRequest, undefined, signal, deps);

    assert.equal(result.ok, true);
    assert.equal(result.stopReason, "cancelled");
    assert.equal(result.cancelSettled, true, "the harness confirmed the stop");
    assert.deepEqual(calls.cancelled, ["harness-session-1"]);

    assert.equal(
      calls.completed.length,
      1,
      "a settled Stop completes its ledger row exactly once",
    );
    const completed = calls.completed[0];
    assert.equal(completed.sessionId, "sess-stop");
    assert.equal(completed.turnIndex, 0, "it completes the row it started");
    assert.equal(
      completed.agentSessionId,
      AGENT_SESSION_ID,
      "the row carries the harness session the next turn must load",
    );
    // `hydrateHarnessSessionFromDurable` refuses a row without this field.
    assert.ok(
      completed.endTime && !Number.isNaN(Date.parse(completed.endTime)),
      "end_time is an ISO instant, not empty",
    );
  });

  it("advances the in-memory resume pointer, so the next turn may load by id", async () => {
    const { deps, continuityStore, signal } = fakeAbortingSandbox();

    await runSandboxAgent(stopRequest, undefined, signal, deps);

    assert.deepEqual(continuityStore.get("sess-stop", "claude"), {
      agentSessionId: AGENT_SESSION_ID,
      turnIndex: 0,
    });
    assert.equal(
      continuityStore.latestTurn("sess-stop"),
      0,
      "the stopped turn consumed its index",
    );
  });

  it("keeps the sandbox warm as well, so both halves of the resume survive", async () => {
    const { calls, deps, signal } = fakeAbortingSandbox();

    await runSandboxAgent(stopRequest, undefined, signal, deps);

    assert.equal(calls.paused, 1, "a confirmed Stop parks");
    assert.equal(calls.destroyed, 0);
  });

  it("reaps the Codex shell child before parking the warm sandbox", async () => {
    const controller = new AbortController();
    const fake = fakeCancellableSandbox({
      leakedCodexChild: true,
      onPrompt: () => controller.abort(USER_STOP_ABORT_REASON),
    });

    const result = await runSandboxAgent(
      { ...stopRequest, harness: "codex" },
      undefined,
      controller.signal,
      fake.deps,
    );

    assert.equal(result.ok, true);
    assert.equal(result.stopReason, "cancelled");
    assert.equal(fake.leakedCodexChildRunning(), false);
    assert.deepEqual(fake.calls.lifecycle, ["cancel", "ps", "kill", "park"]);
  });

  for (const codexReapFailure of ["failed", "unknown"] as const) {
    it(`keeps a settled Codex Stop warm after a ${codexReapFailure} reap`, async () => {
      const { calls, continuityStore, deps, signal } = fakeAbortingSandbox({
        codexReapFailure,
      });

      const result = await runSandboxAgent(
        { ...stopRequest, harness: "codex" },
        undefined,
        signal,
        deps,
      );

      assert.equal(result.ok, true);
      assert.equal(result.cancelSettled, true);
      assert.equal(calls.paused, 1, "a settled Stop still parks");
      assert.equal(calls.destroyed, 0);
      assert.equal(calls.completed.length, 1, "continuity stays durable");
      assert.equal(
        continuityStore.get("sess-stop", "codex")?.agentSessionId,
        AGENT_SESSION_ID,
      );
      assert.ok(calls.logs.some((line) => line.includes("cleanup_miss=true")));
    });
  }

  it("writes the record even when the abort was not a user Stop and the sandbox is deleted", async () => {
    // A disconnect deletes the sandbox, but the harness still confirmed it is idle and its
    // native session lives on the durable cwd, so the record stays worth keeping: the next turn
    // mounts the same durable directory and may `session/load` into a fresh sandbox.
    const { calls, deps, continuityStore, signal } = fakeAbortingSandbox(
      {},
      "plain",
    );

    const result = await runSandboxAgent(stopRequest, undefined, signal, deps);

    assert.equal(result.ok, true);
    assert.equal(calls.destroyed, 1, "an unlabelled abort still deletes");
    assert.equal(calls.paused, 0);
    assert.equal(calls.completed.length, 1);
    assert.equal(
      continuityStore.get("sess-stop", "claude")?.agentSessionId,
      AGENT_SESSION_ID,
    );
  });
});

describe("an abort the harness never confirmed", () => {
  it("drops the record and leaves the ledger row open", async () => {
    // An unpatched client cannot send `session/cancel`, so the harness may still be writing.
    // This is the unchanged floor: no record, no completion, cold replay next turn.
    const { calls, deps, continuityStore, signal } = fakeAbortingSandbox({
      cancellable: false,
    });

    const result = await runSandboxAgent(stopRequest, undefined, signal, deps);

    assert.equal(result.ok, true);
    assert.equal(result.cancelSettled, false);
    assert.deepEqual(calls.completed, [], "no end_time for an unknown state");
    assert.equal(continuityStore.get("sess-stop", "claude"), undefined);
    assert.equal(calls.destroyed, 1, "unknown means delete");
    assert.equal(calls.paused, 0);
  });

  it("still appended the started row, which alone must never look resumable", async () => {
    const { calls, deps, signal } = fakeAbortingSandbox({
      cancellable: false,
    });

    await runSandboxAgent(stopRequest, undefined, signal, deps);

    assert.equal(calls.appended.length, 1, "the turn started, so a row exists");
    assert.equal(calls.appended[0].turnIndex, 0);
    assert.deepEqual(calls.completed, []);
  });
});

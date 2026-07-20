/**
 * Engine-seam tests for the remote (Daytona) sandbox lifecycle: reconnect a parked sandbox by
 * stored id, park to warm on a clean turn-end, and destroy on abort. Exercised through
 * `runSandboxAgent` with a fake sandbox + injected deps (no live Daytona).
 *
 * Run: pnpm exec vitest run tests/unit/sandbox-lifecycle.test.ts
 */
import { beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import { runSandboxAgent } from "../../src/engines/sandbox_agent.ts";
import type { SandboxAgentDeps } from "../../src/engines/sandbox_agent.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";
import { DaytonaReconnectTerminalError } from "../../src/engines/sandbox_agent/daytona-provider.ts";
import { SessionContinuityStore } from "../../src/engines/sandbox_agent/session-continuity.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";

// This whole suite drives the remote (Daytona) lifecycle: enable it (with a provisioning
// credential) on top of the hermetic scrub, then drop the memoized config.
beforeEach(() => {
  process.env.AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS = "local,daytona";
  process.env.AGENTA_RUNNER_DAYTONA_API_KEY = "test-key";
  resetRunnerConfigCache();
});

interface FakeOpts {
  /** What the harness reports for the turn. `"paused"` must never park. */
  stopReason?: string;
  /** Throw from prompt(): a failed turn must never park. */
  promptThrows?: boolean;
  /** Reject the first start that carries a sandboxId (the dead rung: archived/deleted). */
  reconnectThrows?: boolean;
  /** Reject reconnect with a confirmed terminal Daytona state. */
  reconnectTerminalState?: string;
  /**
   * pauseSandbox() throws while retaining its provider handles for the delete fallback.
   */
  pauseThrows?: boolean;
}

function fakeSandbox(sandboxId: string | undefined, opts: FakeOpts = {}) {
  const continuityStore = new SessionContinuityStore();
  const calls = {
    starts: [] as Array<{ sandboxId: string | undefined }>,
    paused: 0,
    destroyed: 0,
    disposed: 0,
    wrote: [] as Array<{ sandboxId: string; turnIndex: number }>,
    cleared: [] as Array<{ sessionId: string; turnIndex: number }>,
    logs: [] as string[],
  };
  const session = {
    id: "session-1",
    onEvent() {},
    onPermissionRequest() {},
    async prompt() {
      if (opts.promptThrows) throw new Error("harness exploded");
      return {
        stopReason: opts.stopReason ?? "complete",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
  const sandbox: any = {
    sandboxId,
    sandboxProvider: { destroy: async () => {} },
    sandboxProviderRawId: sandboxId,
    async createSession() {
      return session;
    },
    async destroySession() {},
    async pauseSandbox() {
      calls.paused += 1;
      if (opts.pauseThrows)
        throw new Error("pause RPC failed: daemon unreachable");
    },
    async destroySandbox() {
      calls.destroyed += 1;
      // Mirror the vendored behavior post-clear: no attached provider means "not attached".
      if (!this.sandboxProvider || !this.sandboxProviderRawId) {
        throw new Error(
          "SandboxAgent is not attached to a provisioned sandbox.",
        );
      }
    },
    async dispose() {
      calls.disposed += 1;
    },
  };

  const deps: SandboxAgentDeps = {
    log: (message) => {
      calls.logs.push(message);
    },
    createDaytonaCwd: (durable?: string) =>
      durable ?? "/home/sandbox/agenta-fake-cwd",
    createLocalCwd: (durable?: string) => durable ?? "/tmp/agenta-fake-cwd",
    resolveSkillDirs: () => ({ skills: [], cleanup: () => {} }),
    buildDaemonEnv: () => ({}),
    resolveDaemonBinary: () => "/bin/sandbox-agent",
    buildSandboxProvider: () =>
      ({
        provider: true,
        deleteSandbox: async () => {},
      }) as any,
    createPersist: () => ({}) as any,
    sessionContinuityStore: continuityStore,
    hydrateHarnessSessionFromDurable: async () => {},
    syncHarnessSessionDurable: async () => {},
    startSandboxAgent: (async (startOpts: any) => {
      calls.starts.push({ sandboxId: startOpts.sandboxId });
      // The dead rung: Daytona already archived/deleted the parked sandbox, so reconnect
      // by id fails and the caller must fall through to a fresh create.
      if (startOpts.sandboxId && opts.reconnectTerminalState) {
        throw new DaytonaReconnectTerminalError(
          startOpts.sandboxId,
          opts.reconnectTerminalState,
        );
      }
      if (opts.reconnectThrows && startOpts.sandboxId) {
        throw new Error("temporary Daytona API failure");
      }
      return sandbox;
    }) as any,
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
      finish: () => "out",
      recordError() {},
      output: () => "out",
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
    // Lifecycle seam under test:
    readStoredSandboxPointer: async () =>
      sandboxId ? { sandboxId } : undefined,
    clearSandboxPointer: async (sessionId, turnIndex) => {
      calls.cleared.push({ sessionId, turnIndex });
      return "applied";
    },
    writeSandboxPointer: async (_sessionId, pointer) => {
      calls.wrote.push({
        sandboxId: pointer.sandboxId,
        turnIndex: pointer.turnIndex,
      });
      return "applied";
    },
  };
  return { calls, deps };
}

const daytonaRequest: AgentRunRequest = {
  harness: "claude",
  sandbox: "daytona",
  sessionId: "sess-1",
  messages: [{ role: "user", content: "hello" }],
  // A session-owned run always carries the invoke credential; the read/write helpers need it.
  telemetry: {
    exporters: { otlp: { headers: { authorization: "ApiKey abc" } } },
  } as any,
};

describe("remote sandbox reconnect ladder", () => {
  it("starts with the stored sandbox id when one is recorded", async () => {
    const { calls, deps } = fakeSandbox("sbx-99");
    const result = await runSandboxAgent(
      daytonaRequest,
      undefined,
      undefined,
      deps,
    );
    assert.equal(result.ok, true);
    assert.equal(calls.starts.length, 1);
    assert.equal(
      calls.starts[0].sandboxId,
      "sbx-99",
      "reconnect passes the stored id",
    );
  });

  it("logs acquire timing for sandbox start, session creation, and total", async () => {
    const { calls, deps } = fakeSandbox(undefined);

    const result = await runSandboxAgent(
      daytonaRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    for (const stage of ["sandbox_start", "create_session", "acquire_total"]) {
      assert.ok(
        calls.logs.some((message) =>
          message.startsWith(`[timing] stage=${stage} `),
        ),
        `missing timing line for ${stage}`,
      );
    }
  });

  it("starts fresh (no id) when nothing is recorded", async () => {
    const { calls, deps } = fakeSandbox(undefined);
    await runSandboxAgent(daytonaRequest, undefined, undefined, deps);
    assert.equal(calls.starts[0].sandboxId, undefined);
  });

  it("falls through to a fresh create without clearing on a transient reconnect failure", async () => {
    const { calls, deps } = fakeSandbox("sbx-gone", { reconnectThrows: true });
    const result = await runSandboxAgent(
      daytonaRequest,
      undefined,
      undefined,
      deps,
    );
    assert.equal(
      result.ok,
      true,
      "a dead parked sandbox must not fail the run",
    );
    assert.equal(
      calls.starts.length,
      2,
      "one doomed reconnect, then a fresh create",
    );
    assert.equal(calls.starts[0].sandboxId, "sbx-gone");
    assert.equal(
      calls.starts[1].sandboxId,
      undefined,
      "the retry carries no id",
    );
    assert.deepEqual(calls.cleared, []);
  });

  it("clears the pointer before a fresh create on a terminal reconnect failure", async () => {
    const { calls, deps } = fakeSandbox("sbx-gone", {
      reconnectTerminalState: "not-found",
    });

    const result = await runSandboxAgent(
      daytonaRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    assert.equal(calls.starts.length, 2);
    assert.deepEqual(calls.cleared, [{ sessionId: "sess-1", turnIndex: 0 }]);
  });

  it("hydrates the turn index before the guarded clear (post-restart token)", async () => {
    const { calls, deps } = fakeSandbox("sbx-gone", {
      reconnectTerminalState: "not-found",
    });
    // A restarted runner has an empty in-memory store; the durable row knows turn 5.
    deps.hydrateHarnessSessionFromDurable = async (
      sessionId,
      _harness,
      store,
    ) => {
      store.restoreLatestTurn(sessionId, 5);
    };

    const result = await runSandboxAgent(
      daytonaRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    assert.deepEqual(
      calls.cleared,
      [{ sessionId: "sess-1", turnIndex: 6 }],
      "the clear must carry the hydrated index, not the cold store's 0",
    );
  });

  it("does not write a pointer for a local run", async () => {
    const { calls, deps } = fakeSandbox(undefined);

    const result = await runSandboxAgent(
      { ...daytonaRequest, sandbox: "local" },
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    assert.deepEqual(
      calls.wrote,
      [],
      "a local run must not overwrite a conversation's remote pointer",
    );
  });

  it("writes the live sandbox id forward for the next turn", async () => {
    const { calls, deps } = fakeSandbox("sbx-99");
    await runSandboxAgent(daytonaRequest, undefined, undefined, deps);
    assert.deepEqual(calls.wrote, [{ sandboxId: "sbx-99", turnIndex: 0 }]);
  });

  it("writes the next turn index after durable continuity hydration", async () => {
    const { calls, deps } = fakeSandbox("sbx-99");
    deps.hydrateHarnessSessionFromDurable = async (
      sessionId,
      _harness,
      store,
    ) => {
      store.restoreLatestTurn(sessionId, 5);
    };

    await runSandboxAgent(daytonaRequest, undefined, undefined, deps);

    assert.deepEqual(calls.wrote, [{ sandboxId: "sbx-99", turnIndex: 6 }]);
  });

  it("trusts a stored pointer and reconnects by id without a compatibility check", async () => {
    const { calls, deps } = fakeSandbox("sbx-trusted");

    await runSandboxAgent(daytonaRequest, undefined, undefined, deps);

    assert.equal(
      calls.starts.length,
      1,
      "no delete-and-rebuild, a single reconnect",
    );
    assert.equal(calls.starts[0].sandboxId, "sbx-trusted");
    assert.ok(
      !calls.logs.some((message) => message.includes("compatibility teardown")),
    );
  });

  it("awaits a rejected pointer write and logs the outcome without failing", async () => {
    const { calls, deps } = fakeSandbox(undefined);
    let writeFinished = false;
    deps.writeSandboxPointer = async () => {
      await Promise.resolve();
      writeFinished = true;
      return "rejected";
    };

    const result = await runSandboxAgent(
      daytonaRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    assert.equal(writeFinished, true);
    assert.ok(
      calls.logs.some((message) => message.includes("pointer write rejected")),
    );
  });
});

describe("remote sandbox teardown", () => {
  it("stops a clean resumable Daytona turn without deleting", async () => {
    const { calls, deps } = fakeSandbox("sbx-99");
    await runSandboxAgent(daytonaRequest, undefined, undefined, deps);
    assert.equal(calls.paused, 1, "clean resumable teardown parks");
    assert.equal(calls.destroyed, 0, "parking must not delete the sandbox");
  });

  it("destroys (not parks) when the run is aborted", async () => {
    const { calls, deps } = fakeSandbox("sbx-99");
    const controller = new AbortController();
    controller.abort();
    await runSandboxAgent(daytonaRequest, undefined, controller.signal, deps);
    assert.equal(calls.paused, 0, "an aborted run must not park");
    assert.equal(calls.destroyed, 1);
  });

  it("destroys (not parks) a paused turn", async () => {
    // A pause has not finished authoring the turn: parking would resume a half-written one.
    const { calls, deps } = fakeSandbox("sbx-99", { stopReason: "paused" });
    await runSandboxAgent(daytonaRequest, undefined, undefined, deps);
    assert.equal(calls.paused, 0, "a paused turn must not park");
    assert.equal(calls.destroyed, 1);
  });

  it("destroys (not parks) when the turn throws", async () => {
    // The sandbox may be the thing that wedged: reconnecting it reuses the wedge.
    const { calls, deps } = fakeSandbox("sbx-99", { promptThrows: true });
    const result = await runSandboxAgent(
      daytonaRequest,
      undefined,
      undefined,
      deps,
    );
    assert.equal(result.ok, false);
    assert.equal(calls.paused, 0, "a failed turn must not park");
    assert.equal(calls.destroyed, 1);
  });

  it("does not park a local run (no sessionId / not daytona)", async () => {
    const { calls, deps } = fakeSandbox(undefined);
    const localRequest: AgentRunRequest = {
      harness: "claude",
      messages: [{ role: "user", content: "hello" }],
    };
    await runSandboxAgent(localRequest, undefined, undefined, deps);
    assert.equal(calls.paused, 0, "local runs are never parked");
    assert.equal(calls.destroyed, 1);
  });
});

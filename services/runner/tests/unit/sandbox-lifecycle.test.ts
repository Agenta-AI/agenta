/**
 * Engine-seam tests for the remote (Daytona) sandbox lifecycle: reconnect a parked sandbox by
 * stored id, park to warm on a clean turn-end, and destroy on abort. Exercised through
 * `runSandboxAgent` with a fake sandbox + injected deps (no live Daytona).
 *
 * Run: pnpm exec vitest run tests/unit/sandbox-lifecycle.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { runSandboxAgent } from "../../src/engines/sandbox_agent.ts";
import type { SandboxAgentDeps } from "../../src/engines/sandbox_agent.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";
import { createSpecFingerprint } from "../../src/engines/sandbox_agent/daytona-provider.ts";
import { buildResolvedDaytonaCreate } from "../../src/engines/sandbox_agent/provider.ts";
import { SessionContinuityStore } from "../../src/engines/sandbox_agent/session-continuity.ts";

interface FakeOpts {
  /** What the harness reports for the turn. `"paused"` must never park. */
  stopReason?: string;
  /** Throw from prompt(): a failed turn must never park. */
  promptThrows?: boolean;
  /** Reject the first start that carries a sandboxId (the dead rung: archived/deleted). */
  reconnectThrows?: boolean;
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
    deleted: [] as string[],
    wrote: [] as Array<{ sandboxId: string; turnIndex: number }>,
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
      if (opts.pauseThrows) throw new Error("pause RPC failed: daemon unreachable");
    },
    async destroySandbox() {
      calls.destroyed += 1;
      // Mirror the vendored behavior post-clear: no attached provider means "not attached".
      if (!this.sandboxProvider || !this.sandboxProviderRawId) {
        throw new Error("SandboxAgent is not attached to a provisioned sandbox.");
      }
    },
    async dispose() {
      calls.disposed += 1;
    },
  };

  const deps: SandboxAgentDeps = {
    log: (message) => { calls.logs.push(message); },
    createDaytonaCwd: (durable?: string) => durable ?? "/home/sandbox/agenta-fake-cwd",
    createLocalCwd: (durable?: string) => durable ?? "/tmp/agenta-fake-cwd",
    resolveSkillDirs: () => ({ skills: [], cleanup: () => {} }),
    buildDaemonEnv: () => ({}),
    resolveDaemonBinary: () => "/bin/sandbox-agent",
    buildSandboxProvider: () => ({
      provider: true,
      deleteSandbox: async (id: string) => { calls.deleted.push(id); },
    }) as any,
    createPersist: () => ({}) as any,
    sessionContinuityStore: continuityStore,
    hydrateHarnessSessionFromDurable: async () => {},
    syncHarnessSessionDurable: async () => {},
    startSandboxAgent: (async (startOpts: any) => {
      calls.starts.push({ sandboxId: startOpts.sandboxId });
      // The dead rung: Daytona already archived/deleted the parked sandbox, so reconnect
      // by id fails and the caller must fall through to a fresh create.
      if (opts.reconnectThrows && startOpts.sandboxId) {
        throw new Error("sandbox not found");
      }
      return sandbox;
    }) as any,
    prepareWorkspace: (async () => ({ cleanup: async () => {} })) as any,
    prepareDaytonaPiAssets: async () => {},
    discoverTunnelEndpoint: async () => null,
    probeCapabilities: async () =>
      ({
        source: "probed",
        capabilities: { mcpTools: true, toolCalls: true, usage: true, streamingDeltas: true },
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
    readStoredSandboxPointer: async () => sandboxId ? ({
      sandboxId,
      fingerprint: createSpecFingerprint(buildResolvedDaytonaCreate({}, {}, undefined)),
    }) : undefined,
    writeSandboxPointer: async (_sessionId, pointer) => {
      calls.wrote.push({ sandboxId: pointer.sandboxId, turnIndex: pointer.turnIndex });
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
  telemetry: { exporters: { otlp: { headers: { authorization: "ApiKey abc" } } } } as any,
};

describe("remote sandbox reconnect ladder", () => {
  it("starts with the stored sandbox id when one is recorded", async () => {
    const { calls, deps } = fakeSandbox("sbx-99");
    const result = await runSandboxAgent(daytonaRequest, undefined, undefined, deps);
    assert.equal(result.ok, true);
    assert.equal(calls.starts.length, 1);
    assert.equal(calls.starts[0].sandboxId, "sbx-99", "reconnect passes the stored id");
  });

  it("starts fresh (no id) when nothing is recorded", async () => {
    const { calls, deps } = fakeSandbox(undefined);
    await runSandboxAgent(daytonaRequest, undefined, undefined, deps);
    assert.equal(calls.starts[0].sandboxId, undefined);
  });

  it("falls through to a fresh create when reconnect fails (dead rung)", async () => {
    // Daytona's auto-archive/auto-delete timer won: the stored id no longer resolves.
    const { calls, deps } = fakeSandbox("sbx-gone", { reconnectThrows: true });
    const result = await runSandboxAgent(daytonaRequest, undefined, undefined, deps);
    assert.equal(result.ok, true, "a dead parked sandbox must not fail the run");
    assert.equal(calls.starts.length, 2, "one doomed reconnect, then a fresh create");
    assert.equal(calls.starts[0].sandboxId, "sbx-gone");
    assert.equal(calls.starts[1].sandboxId, undefined, "the retry carries no id");
  });

  it("writes the live sandbox id forward for the next turn", async () => {
    const { calls, deps } = fakeSandbox("sbx-99");
    await runSandboxAgent(daytonaRequest, undefined, undefined, deps);
    assert.deepEqual(calls.wrote, [{ sandboxId: "sbx-99", turnIndex: 0 }]);
  });

  it("writes the next turn index after durable continuity hydration", async () => {
    const { calls, deps } = fakeSandbox("sbx-99");
    deps.hydrateHarnessSessionFromDurable = async (sessionId, _harness, store) => {
      store.restoreLatestTurn(sessionId, 5);
    };

    await runSandboxAgent(daytonaRequest, undefined, undefined, deps);

    assert.deepEqual(calls.wrote, [{ sandboxId: "sbx-99", turnIndex: 6 }]);
  });

  it("does not reconnect and deletes best-effort when the fingerprint is absent", async () => {
    const { calls, deps } = fakeSandbox("sbx-legacy");
    deps.readStoredSandboxPointer = async () => ({
      sandboxId: "sbx-legacy",
      fingerprint: undefined,
    });

    await runSandboxAgent(daytonaRequest, undefined, undefined, deps);

    assert.equal(calls.starts[0].sandboxId, undefined);
    assert.deepEqual(calls.deleted, ["sbx-legacy"]);
    assert.ok(calls.logs.some((message) => message.includes("compatibility teardown")));
  });

  it("does not reconnect when the stored fingerprint differs", async () => {
    const { calls, deps } = fakeSandbox("sbx-incompatible");
    deps.readStoredSandboxPointer = async () => ({
      sandboxId: "sbx-incompatible",
      fingerprint: "different-fingerprint",
    });

    await runSandboxAgent(daytonaRequest, undefined, undefined, deps);

    assert.equal(calls.starts[0].sandboxId, undefined);
    assert.deepEqual(calls.deleted, ["sbx-incompatible"]);
  });

  it("awaits a rejected pointer write and logs the outcome without failing", async () => {
    const { calls, deps } = fakeSandbox(undefined);
    let writeFinished = false;
    deps.writeSandboxPointer = async () => {
      await Promise.resolve();
      writeFinished = true;
      return "rejected";
    };

    const result = await runSandboxAgent(daytonaRequest, undefined, undefined, deps);

    assert.equal(result.ok, true);
    assert.equal(writeFinished, true);
    assert.ok(calls.logs.some((message) => message.includes("pointer write rejected")));
  });
});

describe("remote sandbox teardown", () => {
  it("deletes a clean resumable turn while parking is inert", async () => {
    const { calls, deps } = fakeSandbox("sbx-99");
    await runSandboxAgent(daytonaRequest, undefined, undefined, deps);
    assert.equal(calls.paused, 0, "Slice 1 must not park yet");
    assert.equal(calls.destroyed, 1, "clean resumable teardown still deletes");
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
    const result = await runSandboxAgent(daytonaRequest, undefined, undefined, deps);
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

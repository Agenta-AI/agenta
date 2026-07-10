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

function fakeSandbox(sandboxId: string | undefined) {
  const calls = {
    starts: [] as Array<{ sandboxId: string | undefined }>,
    paused: 0,
    destroyed: 0,
    disposed: 0,
    wrote: [] as string[],
  };
  const session = {
    id: "session-1",
    onEvent() {},
    onPermissionRequest() {},
    async prompt() {
      return { stopReason: "complete", usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
  const sandbox = {
    sandboxId,
    async createSession() {
      return session;
    },
    async destroySession() {},
    async pauseSandbox() {
      calls.paused += 1;
    },
    async destroySandbox() {
      calls.destroyed += 1;
    },
    async dispose() {
      calls.disposed += 1;
    },
  };

  const deps: SandboxAgentDeps = {
    log: () => {},
    createDaytonaCwd: (durable?: string) => durable ?? "/home/sandbox/agenta-fake-cwd",
    createLocalCwd: (durable?: string) => durable ?? "/tmp/agenta-fake-cwd",
    resolveSkillDirs: () => ({ skills: [], cleanup: () => {} }),
    buildDaemonEnv: () => ({}),
    resolveDaemonBinary: () => "/bin/sandbox-agent",
    buildSandboxProvider: () => ({ provider: true }) as any,
    createPersist: () => ({}) as any,
    startSandboxAgent: (async (opts: any) => {
      calls.starts.push({ sandboxId: opts.sandboxId });
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
    readStoredSandboxId: async () => sandboxId,
    writeSandboxId: async (_sess: string, id: string) => {
      calls.wrote.push(id);
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

  it("writes the live sandbox id forward for the next turn", async () => {
    const { calls, deps } = fakeSandbox("sbx-99");
    await runSandboxAgent(daytonaRequest, undefined, undefined, deps);
    assert.deepEqual(calls.wrote, ["sbx-99"]);
  });
});

describe("remote sandbox park (warm) vs destroy", () => {
  it("pauses (parks warm) instead of destroying on a clean turn-end", async () => {
    const { calls, deps } = fakeSandbox("sbx-99");
    await runSandboxAgent(daytonaRequest, undefined, undefined, deps);
    assert.equal(calls.paused, 1, "a resumable remote turn parks to warm");
    assert.equal(calls.destroyed, 0, "it must not hard-delete a parkable sandbox");
  });

  it("destroys (not parks) when the run is aborted", async () => {
    const { calls, deps } = fakeSandbox("sbx-99");
    const controller = new AbortController();
    controller.abort();
    await runSandboxAgent(daytonaRequest, undefined, controller.signal, deps);
    assert.equal(calls.paused, 0, "an aborted run must not park");
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

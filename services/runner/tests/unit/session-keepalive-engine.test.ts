/**
 * Engine-seam tests for the acquireEnvironment / runTurn split (keep-alive slice 1), through
 * `SandboxAgentDeps` with fake sandbox/session handles (no live harness).
 *
 * These pin the properties the split exists for: one acquired environment serves many turns
 * (the second turn does NOT re-acquire), the shared `destroy` is idempotent and runs after a
 * mid-acquire failure, the session-lifetime listeners demux into exactly the ACTIVE turn's
 * sink (between-turns events are dropped by decision, never routed to a dead turn), and the
 * per-turn error boundary matches the pre-split shape (a createOtel throw returns `ok:false`).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/session-keepalive-engine.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentEvent, AgentRunRequest } from "../../src/protocol.ts";
import {
  acquireEnvironment,
  runTurn,
  type SandboxAgentDeps,
} from "../../src/engines/sandbox_agent.ts";

interface FakeOptions {
  probeError?: Error;
  createOtelError?: Error;
}

/** One fake otel run per createOtel call, recording which updates it handled. */
interface FakeRun {
  id: number;
  handled: unknown[];
  emitted: AgentEvent[];
}

function fakeHarness(options: FakeOptions = {}) {
  const calls = {
    createSessionCount: 0,
    promptCount: 0,
    sandboxDestroyed: 0,
    sandboxDisposed: 0,
    sessionDestroyed: 0,
    permissionReplies: [] as Array<{ id: string; reply: string }>,
    logs: [] as string[],
    runs: [] as FakeRun[],
  };

  // Captured session-lifetime handlers, so tests can fire events/permissions at any moment
  // (during a turn, between turns).
  const captured = {
    onEvent: undefined as ((event: any) => void) | undefined,
    onPermissionRequest: undefined as ((req: any) => void) | undefined,
  };

  const session = {
    id: "session-1",
    onEvent(handler: (event: any) => void) {
      captured.onEvent = handler;
    },
    onPermissionRequest(handler: (request: any) => void) {
      captured.onPermissionRequest = handler;
    },
    async respondPermission(id: string, reply: string) {
      calls.permissionReplies.push({ id, reply });
    },
    async prompt(_blocks: any) {
      calls.promptCount += 1;
      return {
        stopReason: "complete",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };

  const sandbox = {
    async createSession(_opts: any) {
      calls.createSessionCount += 1;
      return session;
    },
    async destroySession(_id: string) {
      calls.sessionDestroyed += 1;
    },
    async destroySandbox() {
      calls.sandboxDestroyed += 1;
    },
    async dispose() {
      calls.sandboxDisposed += 1;
    },
  };

  const makeRun = (): FakeRun & Record<string, any> => {
    const run: FakeRun & Record<string, any> = {
      id: calls.runs.length + 1,
      handled: [],
      emitted: [],
      start() {},
      handleUpdate(update: unknown) {
        run.handled.push(update);
      },
      emitEvent(event: AgentEvent) {
        run.emitted.push(event);
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
        return run.emitted;
      },
      settleOpenToolCalls() {},
      traceId() {
        return "trace-1";
      },
    };
    calls.runs.push(run);
    return run;
  };

  const deps: SandboxAgentDeps = {
    log: (message) => calls.logs.push(message),
    createLocalCwd: (durable?: string) => durable ?? "/tmp/agenta-fake-cwd",
    createDaytonaCwd: (durable?: string) =>
      durable ?? "/home/sandbox/agenta-fake-cwd",
    resolveSkillDirs: () => ({ skills: [], cleanup: () => {} }),
    buildDaemonEnv: () => ({}),
    resolveDaemonBinary: () => "/bin/sandbox-agent",
    buildSandboxProvider: () => ({ provider: true }) as any,
    createPersist: () => ({}) as any,
    startSandboxAgent: (async () => sandbox) as any,
    prepareWorkspace: (async () => ({ cleanup: async () => {} })) as any,
    probeCapabilities: async () => {
      if (options.probeError) throw options.probeError;
      return {
        source: "probed",
        capabilities: {
          mcpTools: true,
          toolCalls: true,
          usage: true,
          streamingDeltas: true,
        },
      } as any;
    },
    applyModel: async (_session, model) => model ?? "resolved-model",
    createOtel: (() => {
      if (options.createOtelError) throw options.createOtelError;
      return makeRun();
    }) as any,
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
  };

  return { calls, deps, captured };
}

const request: AgentRunRequest = {
  harness: "claude",
  messages: [{ role: "user", content: "hello" }],
};

function updateEvent(update: Record<string, unknown>) {
  return { payload: { update } };
}

describe("acquireEnvironment / runTurn split", () => {
  it("one acquired environment serves two turns without re-acquiring the session", async () => {
    const { calls, deps } = fakeHarness();

    const acquired = await acquireEnvironment(request, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    const env = acquired.env;
    assert.equal(
      calls.createSessionCount,
      1,
      "the session is created once, in acquire",
    );

    const r1 = await runTurn(env, request, undefined, undefined, {});
    assert.equal(r1.ok, true);
    const r2 = await runTurn(
      env,
      { harness: "claude", messages: [{ role: "user", content: "again" }] },
      undefined,
      undefined,
      { continuation: true },
    );
    assert.equal(r2.ok, true);

    assert.equal(
      calls.promptCount,
      2,
      "both turns prompted the SAME live session",
    );
    assert.equal(
      calls.createSessionCount,
      1,
      "the second turn did NOT re-acquire",
    );
    assert.equal(
      calls.sandboxDestroyed,
      0,
      "the environment is still alive between turns",
    );

    await env.destroy();
    assert.equal(calls.sandboxDestroyed, 1);
  });

  it("extends the redactor with every fresh continuation credential before the turn", async () => {
    const { deps } = fakeHarness();
    const acquired = await acquireEnvironment(request, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    const values = {
      model: "fresh-model-secret",
      mcp: "fresh-mcp-secret",
      run: "Bearer fresh-run-secret",
      callback: "Bearer fresh-callback-secret",
      otlp: "Bearer fresh-otlp-secret",
    };
    const continuation: AgentRunRequest = {
      harness: "claude",
      messages: [{ role: "user", content: "again" }],
      modelConnection: {
        provider: "anthropic",
        deployment: "direct",
        endpoint: { baseUrl: "https://api.anthropic.com" },
        credentialMode: "env",
        credentials: [
          {
            binding: { kind: "environment", name: "ANTHROPIC_API_KEY" },
            value: values.model,
            usage: "opaque_http",
          },
        ],
      },
      mcpServers: [
        {
          name: "linear",
          transport: "http",
          url: "https://mcp.linear.app",
          credentials: [
            {
              binding: { kind: "header", name: "Authorization" },
              value: values.mcp,
              usage: "opaque_http",
            },
          ],
        },
      ],
      toolCallback: {
        endpoint: "https://callback.example",
        authorization: values.callback,
      },
      telemetry: {
        exporters: {
          otlp: {
            endpoint: "https://otel.example/v1/traces",
            headers: { authorization: values.otlp },
          },
        },
      },
    };
    // The run credential is the same OTLP authorization field on the current wire.
    continuation.telemetry!.exporters!.otlp!.headers!.authorization =
      values.run;
    await runTurn(acquired.env, continuation, undefined, undefined, {
      continuation: true,
    });
    for (const value of [
      values.model,
      values.mcp,
      values.run,
      values.callback,
    ]) {
      assert.doesNotMatch(
        acquired.env.redactor.redactString(value)!,
        new RegExp(value),
      );
    }
    await acquired.env.destroy();
  });

  it("destroy is idempotent: a second destroy is a no-op", async () => {
    const { calls, deps } = fakeHarness();
    const acquired = await acquireEnvironment(request, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;

    await acquired.env.destroy();
    await acquired.env.destroy();
    assert.equal(
      calls.sandboxDestroyed,
      1,
      "the sandbox is destroyed exactly once",
    );
    assert.equal(calls.sandboxDisposed, 1);
  });

  it("a mid-acquire failure runs the already-registered finalizers (no leak) and returns ok:false", async () => {
    const { calls, deps } = fakeHarness({
      probeError: new Error("probe blew up"),
    });

    const acquired = await acquireEnvironment(request, deps);
    assert.equal(acquired.ok, false);
    if (acquired.ok) return;
    assert.match(acquired.error, /probe blew up/);
    // The sandbox was started before the probe failed, so its finalizer must have torn it down.
    assert.equal(
      calls.sandboxDestroyed,
      1,
      "the partially-acquired sandbox is destroyed",
    );
    assert.equal(calls.sandboxDisposed, 1);
    assert.equal(calls.createSessionCount, 0, "the session was never created");
  });

  it("a createOtel throw returns { ok:false, error } (pre-split error frame), not a raw throw", async () => {
    const { calls, deps } = fakeHarness({
      createOtelError: new Error("otel exploded"),
    });
    const acquired = await acquireEnvironment(request, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;

    const result = await runTurn(
      acquired.env,
      request,
      undefined,
      undefined,
      {},
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error ?? "", /otel exploded/);
    // The environment is untouched by the failed turn; the caller still owns destroy.
    assert.equal(calls.sandboxDestroyed, 0);
    await acquired.env.destroy();
    assert.equal(calls.sandboxDestroyed, 1);
  });
});

describe("session-lifetime listener demux (currentTurn swap)", () => {
  it("each turn's sink sees only its own events; between-turns events are dropped by decision", async () => {
    const { calls, deps, captured } = fakeHarness();
    const acquired = await acquireEnvironment(request, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    const env = acquired.env;
    assert.ok(
      captured.onEvent,
      "the session-lifetime listener attached once, in acquire",
    );

    // Turn 1: an event fired during the turn routes to turn 1's otel run.
    const r1 = await runTurn(env, request, undefined, undefined, {});
    assert.equal(r1.ok, true);
    // runTurn leaves the sink set (the dispatch clears it); fire while turn 1 is still current.
    captured.onEvent!(
      updateEvent({ sessionUpdate: "agent_message_chunk", text: "one" }),
    );
    const run1 = calls.runs[0];
    assert.equal(run1.handled.length, 1, "turn 1's run received its event");

    // The dispatch ends the turn: clear the sink. A stray event now hits the between-turns
    // handler (log + drop), never a dead turn's closures.
    env.clearTurn();
    captured.onEvent!(
      updateEvent({ sessionUpdate: "agent_message_chunk", text: "stray" }),
    );
    assert.equal(
      run1.handled.length,
      1,
      "the dead turn's run received NOTHING new",
    );
    assert.ok(
      calls.logs.some((l) => l.includes("between-turns event dropped")),
      "the between-turns handler logged the deliberate drop",
    );

    // Turn 2: a fresh sink; its events route to turn 2's run only.
    const r2 = await runTurn(
      env,
      { harness: "claude", messages: [{ role: "user", content: "again" }] },
      undefined,
      undefined,
      { continuation: true },
    );
    assert.equal(r2.ok, true);
    captured.onEvent!(
      updateEvent({ sessionUpdate: "agent_message_chunk", text: "two" }),
    );
    const run2 = calls.runs[1];
    assert.equal(run2.handled.length, 1, "turn 2's run received its event");
    assert.equal(
      run1.handled.length,
      1,
      "turn 1's run still received nothing new",
    );

    await env.destroy();
  });

  it("a between-turns permission request is cancelled by policy, not routed to a dead turn", async () => {
    const { calls, deps, captured } = fakeHarness();
    const acquired = await acquireEnvironment(request, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    const env = acquired.env;

    await runTurn(env, request, undefined, undefined, {});
    env.clearTurn();

    captured.onPermissionRequest!({ id: "perm-stray" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      calls.permissionReplies,
      [{ id: "perm-stray", reply: "reject" }],
      "the stray gate is cancelled by policy (slice 2 will park instead)",
    );
    assert.ok(
      calls.logs.some((l) => l.includes("between-turns permission request")),
      "the deliberate cancel is logged",
    );

    await env.destroy();
  });

  it("records the turn's emitted tool-call ids (unique, in order) on env.lastTurnToolCallIds", async () => {
    const { deps, captured } = fakeHarness();
    const acquired = await acquireEnvironment(request, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    const env = acquired.env;

    await runTurn(env, request, undefined, undefined, {});
    // Fire tool_call frames while the turn is current (the fake prompt fires none itself).
    captured.onEvent!(
      updateEvent({ sessionUpdate: "tool_call", toolCallId: "tc-1" }),
    );
    captured.onEvent!(
      updateEvent({
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        status: "completed",
      }),
    );
    captured.onEvent!(
      updateEvent({ sessionUpdate: "tool_call", toolCallId: "tc-2" }),
    );
    captured.onEvent!(
      updateEvent({ sessionUpdate: "tool_call", toolCallId: "tc-2" }),
    );
    assert.deepEqual(
      env.lastTurnToolCallIds,
      ["tc-1", "tc-2"],
      "unique tool_call ids in first-seen order (updates and repeats do not duplicate)",
    );

    // The next turn resets the record.
    await runTurn(
      env,
      { harness: "claude", messages: [{ role: "user", content: "again" }] },
      undefined,
      undefined,
      { continuation: true },
    );
    assert.deepEqual(env.lastTurnToolCallIds, [], "reset at turn start");

    await env.destroy();
  });
});

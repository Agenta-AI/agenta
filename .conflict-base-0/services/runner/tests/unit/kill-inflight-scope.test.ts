/**
 * Regression tests for `destroyInFlightSandboxesForSession` (backs the scoped HTTP `/kill`
 * route): the in-flight sandbox filter must agree with `poolKeyFor`'s project-scope precedence
 * (run-context preferred, mount fallback), not filter on the mount-derived `mountProjectId`
 * alone — a mountless run has no `mountProjectId`, so that filter never matched and a scoped
 * `/kill` silently left the sandbox running.
 *
 * Run: pnpm exec vitest run tests/unit/kill-inflight-scope.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentRunRequest } from "../../src/protocol.ts";
import {
  acquireEnvironment,
  destroyInFlightSandboxesForSession,
  type SandboxAgentDeps,
} from "../../src/engines/sandbox_agent.ts";

function fakeHarness() {
  const calls = { sandboxDestroyed: 0, sessionDestroyed: 0 };
  const session = {
    id: "session-1",
    onEvent() {},
    onPermissionRequest() {},
    async prompt() {
      return {
        stopReason: "complete",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
  const sandbox = {
    async createSession() {
      return session;
    },
    async destroySession() {
      calls.sessionDestroyed += 1;
    },
    async destroySandbox() {
      calls.sandboxDestroyed += 1;
    },
    async dispose() {},
  };
  const deps: SandboxAgentDeps = {
    log: () => {},
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
    applyModel: async (_session, model) => model ?? "resolved-model",
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
  };
  return { calls, deps };
}

describe("destroyInFlightSandboxesForSession (scoped /kill of an in-flight sandbox)", () => {
  it("(a) destroys a MOUNTLESS run's in-flight sandbox when the caller's project matches the run-context scope", async () => {
    // The bug: filtering on `mountProjectId` (undefined for a mountless run) never matches, so
    // the scoped kill was a silent no-op. The fix filters on the same run-context-preferred
    // scope `poolKeyFor` uses.
    const { calls, deps } = fakeHarness();
    const request: AgentRunRequest = {
      harness: "claude",
      sessionId: "sess-1",
      messages: [{ role: "user", content: "hello" }],
      runContext: { project: { id: "proj-a" } },
    };

    const acquired = await acquireEnvironment(request, deps, undefined, null);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    assert.equal(acquired.env.mountCreds, null, "this run has no mount");

    await destroyInFlightSandboxesForSession("sess-1", "proj-a", 5000, "kill");

    assert.equal(
      calls.sandboxDestroyed,
      1,
      "the mountless run's sandbox was destroyed by the scoped kill",
    );
  });

  it("(b) does NOT destroy a same-session-id sandbox belonging to a different project", async () => {
    const { calls, deps } = fakeHarness();
    const request: AgentRunRequest = {
      harness: "claude",
      sessionId: "sess-1",
      messages: [{ role: "user", content: "hello" }],
      runContext: { project: { id: "proj-a" } },
    };

    const acquired = await acquireEnvironment(request, deps, undefined, null);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;

    await destroyInFlightSandboxesForSession(
      "sess-1",
      "proj-b",
      5000,
      "kill",
    );

    assert.equal(
      calls.sandboxDestroyed,
      0,
      "a different tenant's scoped kill must not touch this sandbox",
    );

    await acquired.env.destroy();
  });

  it("(c) a run with NO project scope at all is never claimed by a scoped kill (no-scope-no-scoped-kill)", async () => {
    // Mirrors the pool's no-scope-no-park invariant: `/kill` always requires a non-blank
    // projectId, so an in-flight sandbox with no provable scope can never match any caller's
    // filter. It still falls to the unscoped shutdown sweep (destroyInFlightSandboxes), just
    // not to a scoped /kill.
    const { calls, deps } = fakeHarness();
    const request: AgentRunRequest = {
      harness: "claude",
      sessionId: "sess-1",
      messages: [{ role: "user", content: "hello" }],
      // No runContext.project.id, and no mount (presignedMount: null below): no scope source.
    };

    const acquired = await acquireEnvironment(request, deps, undefined, null);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    assert.equal(acquired.env.projectScopeId, undefined);

    await destroyInFlightSandboxesForSession(
      "sess-1",
      "proj-a",
      5000,
      "kill",
    );
    assert.equal(
      calls.sandboxDestroyed,
      0,
      "no project scope means no tenant can claim this sandbox via a scoped kill",
    );

    await acquired.env.destroy();
    assert.equal(calls.sandboxDestroyed, 1, "unscoped teardown still reaps it");
  });
});

/** Long turns must complete the durable turn ledger with the current platform credential. */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import { isTurnIndexTaken, runSandboxAgent, type SandboxAgentDeps } from "../../src/engines/sandbox_agent.ts";
import {
  SessionTurnIndexTaken,
  appendSessionTurn,
  type AppendSessionTurnFn,
  type DurableContinuityDeps,
} from "../../src/engines/sandbox_agent/session-continuity-durable.ts";
import { SessionContinuityStore } from "../../src/engines/sandbox_agent/session-continuity.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";
import { startPlatformCredentialLease } from "../../src/sessions/auth.ts";
import { USER_STOP_ABORT_REASON } from "../../src/sessions/stop-signal.ts";

const API_BASE = "https://api.agenta.test/api";
const INITIAL = "Secret initial";
const INITIAL_TIME = Date.parse("2026-10-05T15:30:00Z");
const MINUTE = 60_000;

beforeEach(() => {
  vi.stubEnv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", "local,daytona");
  vi.stubEnv("AGENTA_RUNNER_DAYTONA_API_KEY", "test-key");
  vi.stubEnv("AGENTA_API_URL", API_BASE);
  vi.stubEnv("AGENTA_API_INTERNAL_URL", API_BASE);
  // No background session query or credential exchange may reach a real API.
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
  resetRunnerConfigCache();
  // Exercise 104 minutes of credential rotation without advancing the run's timeout machinery.
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(INITIAL_TIME);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetRunnerConfigCache();
});

function fakeTurn(onPrompt: () => Promise<"completed" | "cancelled" | "failed">) {
  const controller = new AbortController();
  const requests: Array<{ path: string; authorization: string; status: number }> = [];
  const logs: string[] = [];
  let currentAuthorization = INITIAL;
  let resolveCancel: ((value: { stopReason: string }) => void) | undefined;
  const session = {
    id: "harness-session",
    agentSessionId: "native-session",
    onEvent() {},
    onPermissionRequest() {},
    async rollbackFailedTurn() { return true; },
    async prompt() {
      const ending = await onPrompt();
      if (ending === "failed") throw new Error("provider refused the turn");
      if (ending === "cancelled") {
        const response = new Promise<{ stopReason: string }>((resolve) => { resolveCancel = resolve; });
        controller.abort(USER_STOP_ABORT_REASON);
        return response;
      }
      return { stopReason: "end_turn" };
    },
  };
  const sandbox: any = {
    sandboxId: "daytona/fake",
    sandboxProvider: { destroy: async () => {} },
    sandboxProviderRawId: "fake",
    createSession: async () => session,
    cancelSession: async () => { resolveCancel?.({ stopReason: "cancelled" }); },
    destroySession: async () => {},
    pauseSandbox: async () => {},
    destroySandbox: async () => {},
    dispose: async () => {},
    runProcess: async () => ({ stdout: "", exitCode: 0 }),
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    const status = authorization === currentAuthorization ? 200 : 401;
    requests.push({ path: String(input), authorization, status });
    return new Response("{}", { status });
  };
  const httpDeps = (deps: DurableContinuityDeps): DurableContinuityDeps => ({
    ...deps, apiBase: API_BASE, fetchImpl,
  });
  // Keep the real append/completion HTTP helpers, so a stale header is rejected by the fake API.
  const ledger: AppendSessionTurnFn = (id, harness, index, turn, deps) =>
    appendSessionTurn(id, harness, index, turn, httpDeps(deps));
  ledger.complete = (id, index, turn, deps) =>
    appendSessionTurn.complete!(id, index, turn, httpDeps(deps));
  const deps: SandboxAgentDeps = {
    log: (line) => logs.push(line),
    createDaytonaCwd: () => "/tmp/fake-credential-turn",
    resolveSkillDirs: () => ({ skills: [], dropped: [], cleanup: () => {} }),
    buildDaemonEnv: () => ({}),
    resolveDaemonBinary: () => "/bin/sandbox-agent",
    buildSandboxProvider: () => ({ deleteSandbox: async () => {} }) as any,
    createPersist: () => ({}) as any,
    sessionContinuityStore: new SessionContinuityStore(),
    hydrateHarnessSessionFromDurable: async () => {},
    appendSessionTurn: ledger,
    startSandboxAgent: (async () => sandbox) as any,
    prepareWorkspace: (async () => ({ cleanup: async () => {} })) as any,
    probeCapabilities: async () => ({
      source: "probed",
      capabilities: { mcpTools: true, toolCalls: true, usage: true, streamingDeltas: true },
    }),
    applyModel: async () => "resolved-model",
    createOtel: (() => ({
      start() {}, handleUpdate() {}, emitEvent() {}, setUsage() {}, recordError() {},
      usage: () => ({ input: 0, output: 0, total: 0 }),
      finish: () => "answer", output: () => "answer", flush: async () => {},
      events: () => [], settleOpenToolCalls() {}, traceId: () => "trace-1",
    })) as any,
    startToolRelay: (() => ({ stop: async () => {} })) as any,
    localRelayHost: (() => "unused") as any,
    sandboxRelayHost: (() => "unused") as any,
    responderFactory: () => ({
      onPermission: async () => ({ kind: "allow" }),
      onClientTool: async () => ({ kind: "deny" }),
    }),
    readStoredSandboxPointer: async () => ({ sandboxId: "fake" }),
  };
  const request: AgentRunRequest = {
    harness: "claude", sandbox: "daytona", sessionId: "session-long-turn", streamId: "stream-1",
    messages: [{ role: "user", content: "work for a long time" }],
    telemetry: { exporters: { otlp: { endpoint: `${API_BASE}/otlp/v1/traces`, headers: { authorization: INITIAL } } } },
  };
  return {
    request, deps, requests, logs, signal: controller.signal,
    credential: () => currentAuthorization,
    rotate: (value: string) => { currentAuthorization = value; },
  };
}

describe("turn ledger credential rotation", () => {
  for (const ending of ["completed", "cancelled", "failed"] as const) {
    it(`uses the current credential after a long ${ending} turn`, async () => {
      const fake = fakeTurn(async () => {
        vi.setSystemTime(INITIAL_TIME + 104 * MINUTE);
        fake.rotate("Secret fresh-at-completion");
        return ending;
      });
      const result = await runSandboxAgent(fake.request, undefined, fake.signal, fake.deps, { credential: fake.credential });
      assert.equal(result.ok, ending !== "failed");
      if (ending === "cancelled") assert.equal(result.cancelSettled, true);
      assert.deepEqual(fake.requests, [
        { path: `${API_BASE}/sessions/turns/`, authorization: INITIAL, status: 200 },
        { path: `${API_BASE}/sessions/turns/complete`, authorization: "Secret fresh-at-completion", status: 200 },
      ]);
      assert.ok(fake.logs.some((line) => line.includes("complete OK")));
    });
  }

  it("hands the run's signal to the turn-start write and not to the completion", async () => {
    const fake = fakeTurn(async () => "cancelled");
    const seen: Array<AbortSignal | undefined> = [];
    const ledger = fake.deps.appendSessionTurn!;
    const watched: AppendSessionTurnFn = (id, harness, index, turn, deps) => {
      seen.push(deps.signal);
      return ledger(id, harness, index, turn, deps);
    };
    watched.complete = (id, index, turn, deps) => {
      seen.push(deps.signal);
      return ledger.complete!(id, index, turn, deps);
    };
    fake.deps.appendSessionTurn = watched;
    await runSandboxAgent(fake.request, undefined, fake.signal, fake.deps, { credential: fake.credential });
    // A Stop must not cut the completion: a settled cancel is a resume point.
    assert.deepEqual(seen, [fake.signal, undefined]);
  });

  it("uses an already-refreshed credential when appending the start row", async () => {
    const fake = fakeTurn(async () => "completed");
    fake.rotate("Secret fresh-before-start");
    await runSandboxAgent(fake.request, undefined, undefined, fake.deps, { credential: fake.credential });
    assert.equal(fake.requests.length, 2);
    assert.ok(fake.requests.every((request) => request.authorization === "Secret fresh-before-start" && request.status === 200));
  });

  it("preserves a non-rotating credential", async () => {
    const fake = fakeTurn(async () => "completed");
    const result = await runSandboxAgent(fake.request, undefined, undefined, fake.deps, { credential: fake.credential });
    assert.equal(result.ok, true);
    assert.equal(fake.requests.length, 2);
    assert.ok(fake.requests.every((request) => request.authorization === INITIAL && request.status === 200));
  });

  it("uses the standalone turn's own lease after 104 minutes", async () => {
    let rotations = 0;
    const fake = fakeTurn(async () => {
      await vi.advanceTimersByTimeAsync(104 * MINUTE);
      return "completed";
    });
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      if (String(input).includes("/access/permissions/check")) {
        assert.equal(new Headers(init?.headers).get("authorization"), fake.credential());
        const fresh = `Secret standalone-${++rotations}`;
        fake.rotate(fresh);
        return Response.json({ credentials: fresh });
      }
      return new Response("{}", { status: 401 });
    });
    const result = await runSandboxAgent(fake.request, undefined, undefined, fake.deps);
    assert.equal(result.ok, true);
    assert.equal(rotations, 20);
    assert.equal(fake.requests.at(-1)?.authorization, "Secret standalone-20");
    assert.equal(fake.requests.at(-1)?.status, 200);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    assert.equal(rotations, 20, "the completed turn releases its lease");
  });

  it("completes after 104 minutes with the real proactive credential lease", async () => {
    let rotations = 0;
    const fake = fakeTurn(async () => {
      await vi.advanceTimersByTimeAsync(104 * MINUTE);
      return "completed";
    });
    const lease = startPlatformCredentialLease(API_BASE, INITIAL, {
      refresh: async (_base, authorization) => {
        assert.equal(authorization, fake.credential(), "each exchange uses the previous fresh credential");
        const fresh = `Secret rotation-${++rotations}`;
        fake.rotate(fresh);
        return fresh;
      },
    });
    try {
      const result = await runSandboxAgent(fake.request, undefined, undefined, fake.deps, { credential: lease.credential });
      assert.equal(result.ok, true);
      assert.equal(rotations, 20);
      assert.equal(fake.requests.at(-1)?.authorization, "Secret rotation-20");
      assert.equal(fake.requests.at(-1)?.status, 200);
    } finally {
      lease.release();
    }
  });
});

describe("one-turn engine teardown when another runner wrote the turn", () => {
  /** Record what the teardown does to the Daytona sandbox: park (pause) or delete. */
  function watchSandbox(fake: ReturnType<typeof fakeTurn>) {
    const teardown: string[] = [];
    const start = fake.deps.startSandboxAgent as (...args: unknown[]) => Promise<any>;
    fake.deps.startSandboxAgent = (async (...args: unknown[]) => {
      const sandbox = await start(...args);
      sandbox.pauseSandbox = async () => { teardown.push("pause"); };
      sandbox.destroySandbox = async () => { teardown.push("destroy"); };
      return sandbox;
    }) as any;
    return teardown;
  }

  it("a fresh prompt refused with turn_index_taken parks the sandbox", async () => {
    const fake = fakeTurn(async () => "completed");
    const teardown = watchSandbox(fake);
    const ledger: AppendSessionTurnFn = async (sessionId, _harness, turnIndex) => {
      throw new SessionTurnIndexTaken(sessionId, turnIndex);
    };
    ledger.complete = async () => {};
    fake.deps.appendSessionTurn = ledger;

    const result = await runSandboxAgent(fake.request, undefined, undefined, fake.deps, { credential: fake.credential });

    assert.equal(result.ok, false);
    assert.equal(isTurnIndexTaken(result), true);
    assert.deepEqual(teardown, ["pause"]);
  });

  it("an ordinary failed turn still deletes the sandbox", async () => {
    const fake = fakeTurn(async () => "failed");
    const teardown = watchSandbox(fake);

    const result = await runSandboxAgent(fake.request, undefined, undefined, fake.deps, { credential: fake.credential });

    assert.equal(result.ok, false);
    assert.equal(isTurnIndexTaken(result), false);
    assert.deepEqual(teardown, ["destroy"]);
  });
});

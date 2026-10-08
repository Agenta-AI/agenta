/**
 * The runner's shutdown: drain, then wait, then cancel with a settled wait, then tear down.
 *
 * Run: pnpm exec vitest run --project unit tests/unit/shutdown-drain.test.ts
 */
import { afterEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import {
  createAgentServer,
  hasRunningWork,
  parkedSessionControls,
  registerShutdownHandler,
  runWithKeepalive,
  stopParkedApprovalSession,
  tearDownHeldSandboxes,
  type KeepaliveContext,
  type KeepaliveEngine,
  type RunAgent,
} from "../../src/server.ts";
import {
  cancelExecutions,
  cancelParkedPrompts,
  drainThenTearDown,
  isDraining,
  resetDrainForTest,
} from "../../src/lifecycle/shutdown.ts";
import {
  liveExecutions,
  registerExecution,
  resetExecutionsForTest,
  unregisterExecution,
} from "../../src/sessions/execution-registry.ts";
import {
  activeTurnCount,
  resetActiveTurns,
} from "../../src/sessions/active-turns.ts";
import { SessionPool } from "../../src/engines/sandbox_agent/session-pool.ts";
import {
  teardownDisposition,
  type TeardownReason,
} from "../../src/engines/sandbox_agent/teardown.ts";
import {
  AppliedState,
  appliedStateForRequest,
} from "../../src/engines/sandbox_agent/applied-state.ts";
import {
  FACETS,
  type FacetDigests,
} from "../../src/lifecycle/desired-state.ts";
import { CredentialMaterial } from "../../src/engines/sandbox_agent/session-identity.ts";
import {
  isUserStopAbort,
  RUNNER_SHUTDOWN_ABORT_REASON,
  USER_STOP_ABORT_REASON,
} from "../../src/sessions/stop-signal.ts";
import type { SessionEnvironment } from "../../src/engines/sandbox_agent.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";
import { turnLogUnmoved } from "../utils/turn-log.ts";
import {
  ABANDONED_ATTEMPT_REASON,
  SubscriptionLoginAttempts,
  setSubscriptionLoginAttempts,
  type AttemptOutcome,
  type DeviceCodeLogin,
} from "../../src/subscription-login-attempts.ts";

const TOKEN_ENV = "AGENTA_RUNNER_TOKEN";
const TEST_TOKEN = "test-runner-token";
const AUTH = { authorization: `Bearer ${TEST_TOKEN}` };
const previousToken = process.env[TOKEN_ENV];

// Harmless signals, so the test never sends itself a real SIGTERM.
const TEST_SIGNALS = ["SIGUSR2"] as const;

const noLog = (): void => {};

afterEach(() => {
  for (const signal of TEST_SIGNALS) process.removeAllListeners(signal);
  resetDrainForTest();
  resetExecutionsForTest();
  resetActiveTurns();
  setSubscriptionLoginAttempts(undefined);
  vi.restoreAllMocks();
  if (previousToken === undefined) delete process.env[TOKEN_ENV];
  else process.env[TOKEN_ENV] = previousToken;
});

async function listen(run: RunAgent): Promise<{ url: string; close: () => Promise<void> }> {
  process.env[TOKEN_ENV] = TEST_TOKEN;
  const server = createAgentServer(run, async () => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Keep the test server reachable; answer every other call (the api) with an empty 200. */
function stubApiCalls(serverUrl: string): void {
  const realFetch = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(serverUrl)) return realFetch(input, init);
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("drain at SIGTERM", () => {
  it("after SIGTERM, /run and /stream answer 503 while /cancel, /kill and /health stay open", async () => {
    let engineCalls = 0;
    const s = await listen(async () => {
      engineCalls += 1;
      return { ok: true, output: "hi" };
    });
    stubApiCalls(s.url);
    const cleanupStarted = deferred();
    registerShutdownHandler({
      signals: TEST_SIGNALS,
      // The cleanup stays pending, as it does while running turns finish.
      onCleanup: () => {
        cleanupStarted.resolve();
        return new Promise<void>(() => {});
      },
      exit: () => {},
    });
    // A turn this pod still runs, which a Stop must still reach during the drain.
    const aborted = deferred();
    registerExecution({
      projectId: "proj-1",
      sessionId: "sess-running",
      turnId: "turn-1",
      startedAt: Date.now() - 1_000,
      abort: () => {
        aborted.resolve();
        unregisterExecution("sess-running", "turn-1");
      },
    });
    try {
      process.emit("SIGUSR2", "SIGUSR2");
      await cleanupStarted.promise;
      assert.equal(isDraining(), true, "the flag is up before the cleanup runs");

      const run = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ harness: "pi_core" }),
      });
      assert.equal(run.status, 503);
      const runBody = (await run.json()) as { ok: boolean; error: string };
      assert.equal(runBody.ok, false);
      assert.match(runBody.error, /shutting down/);

      const stream = await fetch(`${s.url}/stream`, {
        method: "POST",
        headers: { ...AUTH, accept: "application/x-ndjson" },
        body: JSON.stringify({ harness: "pi_core", sessionId: "sess-new" }),
      });
      assert.equal(stream.status, 503);
      await stream.body?.cancel();
      assert.equal(engineCalls, 0, "a draining pod starts no engine run");

      const unauthorized = await fetch(`${s.url}/run`, { method: "POST", body: "{}" });
      assert.equal(unauthorized.status, 401, "the token gate still answers first");

      const cancel = await fetch(`${s.url}/cancel`, {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({
          commandId: "cmd-stop",
          projectId: "proj-1",
          sessionId: "sess-running",
          targetTurnId: "turn-1",
          createdAt: new Date().toISOString(),
        }),
      });
      assert.equal(cancel.status, 202, "Stop still reaches the turn this pod runs");
      await aborted.promise;

      const kill = await fetch(`${s.url}/kill`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ sessionId: "sess-running", projectId: "proj-1" }),
      });
      assert.equal(kill.status, 200);

      const health = await fetch(`${s.url}/health`);
      assert.equal(health.status, 200, "liveness must not fail while the pod drains");
    } finally {
      await s.close();
    }
  });
});

describe("the wait before the cancel", () => {
  it("covers a Daytona turn, which the in-process active-turn set does not hold", async () => {
    let aborted = false;
    registerExecution({
      projectId: "proj-1",
      sessionId: "sess-daytona",
      turnId: "turn-d",
      startedAt: Date.now(),
      abort: () => {
        aborted = true;
      },
    });
    assert.equal(activeTurnCount(), 0, "a Daytona turn is not an in-process active turn");
    assert.equal(hasRunningWork(), true, "the execution registry holds it");

    const tornDown = deferred();
    const shutdown = drainThenTearDown({
      waitMs: 10_000,
      busy: hasRunningWork,
      cancelRunning: () => cancelExecutions(liveExecutions(), 1_000, noLog),
      cancelParked: async () => {},
      tearDown: async () => tornDown.resolve(),
      log: noLog,
    });
    const early = await Promise.race([
      tornDown.promise.then(() => "torn down"),
      new Promise((resolve) => setTimeout(() => resolve("still waiting"), 400)),
    ]);
    assert.equal(early, "still waiting", "teardown waits for the running Daytona turn");

    unregisterExecution("sess-daytona", "turn-d");
    await shutdown;
    assert.equal(aborted, false, "a turn that finished inside the wait is never cancelled");
  });

  it("ends at once when no execution is registered, as for a pod holding only parked approvals", async () => {
    let now = 0;
    const steps: string[] = [];
    await drainThenTearDown({
      waitMs: 60_000,
      busy: hasRunningWork,
      cancelRunning: async () => void steps.push("cancel running"),
      cancelParked: async () => void steps.push("cancel parked"),
      tearDown: async () => void steps.push("teardown"),
      log: noLog,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    assert.equal(now, 0, "nothing ran, so nothing was waited for");
    assert.deepEqual(steps, ["cancel running", "cancel parked", "teardown"]);
  });

  it("stops waiting at the limit, then cancels, then tears down", async () => {
    let now = 0;
    const steps: string[] = [];
    await drainThenTearDown({
      waitMs: 2_000,
      busy: () => true,
      cancelRunning: async () => void steps.push(`cancel running at ${now}`),
      cancelParked: async () => void steps.push("cancel parked"),
      tearDown: async () => void steps.push("teardown"),
      log: noLog,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    assert.deepEqual(steps, ["cancel running at 2000", "cancel parked", "teardown"]);
  });

  it("still tears down when a cancel step throws", async () => {
    const steps: string[] = [];
    await drainThenTearDown({
      waitMs: 0,
      busy: () => false,
      cancelRunning: async () => {
        throw new Error("boom");
      },
      cancelParked: async () => void steps.push("cancel parked"),
      tearDown: async () => void steps.push("teardown"),
      log: noLog,
    });
    assert.deepEqual(steps, ["cancel parked", "teardown"]);
  });
});

// --- A pooled turn through the real coordinator, stopped by the shutdown cancel. ---

interface FakeEnv {
  readonly appliedState: unknown;
  commitApplied: (result: never) => void;
  parkedApprovals: Map<string, unknown>;
  approvalGateCount: number;
  nonParkablePauseCount: number;
  installedMountExpiries: Record<string, number>;
  lastTurnToolCallIds: string[];
  clearTurn: () => void;
  destroy: (opts?: { reason?: TeardownReason }) => Promise<void>;
  destroyReasons: Array<TeardownReason | undefined>;
}

/** An engine whose one turn runs until it is aborted, then reports the harness cancel's result. */
function engineStoppedByCancel(cancelSettled: boolean): {
  engine: KeepaliveEngine;
  envs: FakeEnv[];
  started: Promise<void>;
} {
  const envs: FakeEnv[] = [];
  const started = deferred();
  const engine: KeepaliveEngine = {
    async resolveKeepaliveMount() {
      return {
        region: "us-east-1",
        bucket: "b",
        prefix: "mounts/proj/mount",
        accessKey: "AK",
        secretKey: "SK",
        projectId: "proj-1",
      };
    },
    async acquireEnvironment(request) {
      const applied = appliedStateForRequest(request);
      const env: FakeEnv = {
        get appliedState() {
          return applied.appliedState;
        },
        commitApplied: (result) => applied.commitApplied(result),
        parkedApprovals: new Map(),
        approvalGateCount: 0,
        nonParkablePauseCount: 0,
        installedMountExpiries: {},
        lastTurnToolCallIds: [],
        clearTurn: () => {},
        destroy: async (opts) => {
          env.destroyReasons.push(opts?.reason);
        },
        destroyReasons: [],
      };
      envs.push(env);
      return { ok: true, env: env as unknown as SessionEnvironment };
    },
    async runTurn(_env, _request, _emit, signal) {
      started.resolve();
      await new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve();
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      // What `run-turn.ts` returns after it sent the harness `session/cancel`.
      return { ok: true, output: "partial", stopReason: "cancelled", cancelSettled };
    },
    readLatestTurnIndex: turnLogUnmoved,
    async runCold() {
      throw new Error("a scoped session never takes the unpooled cold path");
    },
  };
  return { engine, envs, started: started.promise };
}

function sessionRequest(sessionId: string, turnId: string): AgentRunRequest {
  return {
    harness: "claude",
    model: "m1",
    sessionId,
    turnId,
    telemetry: { exporters: { otlp: { headers: { authorization: "ApiKey run" } } } },
    messages: [{ role: "user", content: "hello" }],
  };
}

/** Admit one turn the way `/stream` does, then shut down while it still runs. */
async function shutDownDuringTurn(cancelSettled: boolean) {
  const { engine, envs, started } = engineStoppedByCancel(cancelSettled);
  const pool = new SessionPool<SessionEnvironment>({ poolMax: 8 }, noLog);
  const ctx: KeepaliveContext = {
    engine,
    pool,
    config: { enabled: true, ttlMs: 60_000, approvalTtlMs: 600_000, poolMax: 8 },
  };
  const sessionId = `sess-${cancelSettled ? "settled" : "unsettled"}`;
  const turnId = "turn-1";
  const controller = new AbortController();
  registerExecution({
    projectId: "proj-1",
    sessionId,
    turnId,
    startedAt: Date.now(),
    abort: (reason = USER_STOP_ABORT_REASON) => controller.abort(reason),
  });
  const turn = runWithKeepalive(
    sessionRequest(sessionId, turnId),
    undefined,
    controller.signal,
    ctx,
  ).finally(() => unregisterExecution(sessionId, turnId));
  await started;

  const reasonsAtTeardown: Array<Array<TeardownReason | undefined>> = [];
  const inFlightSweeps: TeardownReason[] = [];
  await drainThenTearDown({
    waitMs: 50,
    busy: hasRunningWork,
    cancelRunning: () => cancelExecutions(liveExecutions(), 5_000, noLog),
    cancelParked: async () => {},
    tearDown: async () => {
      reasonsAtTeardown.push(...envs.map((env) => [...env.destroyReasons]));
      await tearDownHeldSandboxes([pool], async (_ms, reason) => {
        inFlightSweeps.push(reason);
      });
    },
    log: noLog,
  });
  return {
    result: await turn,
    signal: controller.signal,
    env: envs[0],
    pool,
    reasonsAtTeardown,
    inFlightSweeps,
  };
}

describe("the cancel at the wait limit", () => {
  it("cancels a turn with the shutdown reason, not a user Stop's", async () => {
    const { signal } = await shutDownDuringTurn(true);
    assert.equal(signal.reason, RUNNER_SHUTDOWN_ABORT_REASON);
    assert.equal(isUserStopAbort(signal), false, "the turn must not end as a Stop");
  });

  it("parks a turn whose harness cancel settled, then deletes its sandbox at teardown", async () => {
    const { result, env, pool, reasonsAtTeardown } = await shutDownDuringTurn(true);
    assert.equal(result.stopReason, "cancelled", "the harness cancel ran as a Stop's does");
    assert.equal(result.cancelSettled, true);
    assert.deepEqual(
      reasonsAtTeardown,
      [[]],
      "the settled cancel parked the environment: the turn itself deleted nothing",
    );
    assert.deepEqual(env.destroyReasons, ["shutdown-idle"]);
    assert.equal(teardownDisposition("shutdown-idle"), "delete");
    assert.equal(pool.size(), 0);
  });

  it("deletes the sandbox of a turn whose harness cancel did not settle, before teardown", async () => {
    const { result, env, reasonsAtTeardown } = await shutDownDuringTurn(false);
    assert.equal(result.stopReason, "cancelled");
    assert.deepEqual(reasonsAtTeardown, [["aborted"]], "today's rule: unsettled deletes");
    assert.equal(teardownDisposition("aborted"), "delete");
    assert.deepEqual(env.destroyReasons, ["aborted"], "teardown does not touch it again");
  });

  it("does not abort an execution whose prompt already settled, and waits for its release", async () => {
    let aborted = false;
    const release = deferred<boolean>();
    const done = cancelExecutions(
      [
        {
          projectId: "proj-1",
          sessionId: "sess-tearing-down",
          turnId: "turn-1",
          startedAt: 0,
          settled: true,
          released: release.promise,
          abort: () => {
            aborted = true;
          },
        },
      ],
      5_000,
      noLog,
    );
    let finished = false;
    void done.then(() => {
      finished = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(finished, false, "the cancel step waits for the release");
    release.resolve(true);
    await done;
    assert.equal(aborted, false);
  });

  it("is bounded when a turn never releases", async () => {
    const startedAt = Date.now();
    await cancelExecutions(
      [
        {
          projectId: "proj-1",
          sessionId: "sess-stuck",
          turnId: "turn-1",
          startedAt: 0,
          released: new Promise<boolean>(() => {}),
          abort: () => {},
        },
      ],
      50,
      noLog,
    );
    assert.ok(Date.now() - startedAt < 2_000);
  });
});

describe("the parked prompt at shutdown", () => {
  it("gets a settled cancel before teardown", async () => {
    const order: string[] = [];
    const prompt = deferred<{ stopReason: string }>();
    const env = {
      parkedApprovals: new Map([
        ["token-1", { permissionId: "perm-1", promptPromise: prompt.promise }],
      ]),
      parkedApproval: { toolName: "write" },
      parkedApprovedExecutions: new Map(),
      approvalGateCount: 1,
      nonParkablePauseCount: 0,
      session: {
        id: "harness-session-1",
        respondPermission: async (id: string, reply: string) => {
          order.push(`permission ${id} ${reply}`);
        },
      },
      sandbox: {
        cancelSession: async (id: string) => {
          order.push(`cancel ${id}`);
          setTimeout(() => {
            order.push("prompt settled");
            prompt.resolve({ stopReason: "cancelled" });
          }, 20);
        },
      },
      logger: noLog,
      clearTurn: () => {},
    };
    const parked = {
      turnId: "turn-parked",
      stop: () =>
        stopParkedApprovalSession({
          environment: env as unknown as SessionEnvironment,
          repark: async () => {
            order.push("reparked");
            return true;
          },
          teardown: async () => {
            order.push("torn down unsettled");
          },
          cancelSettleMs: 5_000,
        }),
    };

    await drainThenTearDown({
      waitMs: 0,
      busy: () => false,
      cancelRunning: async () => {},
      cancelParked: () => cancelParkedPrompts([parked], 5_000, noLog),
      tearDown: async () => void order.push("teardown"),
      log: noLog,
    });

    assert.deepEqual(order, [
      "permission perm-1 reject",
      "cancel harness-session-1",
      "prompt settled",
      "reparked",
      "teardown",
    ]);
  });

  it("is released from the pool without any api call, so the approval stays answerable", async () => {
    // A Stop outcome would make the api cancel the pending approval. The shutdown must report
    // nothing: no outcome, no session record, no interaction write.
    const apiCalls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      apiCalls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    const harness: string[] = [];
    const prompt = deferred<{ stopReason: string }>();
    const applied = new AppliedState("cfg", FAKE_FACETS, {});
    const env = {
      get appliedState() {
        return applied.appliedState;
      },
      commitApplied: (result: Parameters<AppliedState["commitApplied"]>[0]) =>
        applied.commitApplied(result),
      parkedTurnId: "turn-parked",
      parkedApprovals: new Map([
        ["token-1", { permissionId: "perm-1", promptPromise: prompt.promise }],
      ]),
      parkedApproval: { toolName: "write" },
      parkedApprovedExecutions: new Map(),
      approvalGateCount: 1,
      nonParkablePauseCount: 0,
      session: {
        id: "harness-session-1",
        respondPermission: async (id: string, reply: string) => {
          harness.push(`permission ${id} ${reply}`);
        },
      },
      sandbox: {
        cancelSession: async (id: string) => {
          harness.push(`cancel ${id}`);
          prompt.resolve({ stopReason: "cancelled" });
        },
      },
      logger: noLog,
      clearTurn: () => {},
    };
    const teardownReasons: string[] = [];
    const pools = {
      local: new SessionPool<SessionEnvironment>({ poolMax: 8 }, noLog),
      daytona: new SessionPool<SessionEnvironment>({ poolMax: 8 }, noLog),
      inprocess: new SessionPool<SessionEnvironment>({ poolMax: 8 }, noLog),
    };
    await pools.daytona.park(
      {
        key: "proj-1:sess-parked",
        environment: env as unknown as SessionEnvironment,
        historyFingerprint: "hist",
        credentialEpoch: {
          secrets: new CredentialMaterial("h"),
          direct: new CredentialMaterial("d"),
        },
        teardown: async (reason) => {
          teardownReasons.push(reason);
        },
      },
      60_000,
      "awaiting_approval",
    );

    const parked = parkedSessionControls(pools);
    assert.equal(parked.length, 1, "the enumeration finds the approval-parked entry");
    assert.equal(parked[0]!.turnId, "turn-parked");

    await drainThenTearDown({
      waitMs: 0,
      busy: () => false,
      cancelRunning: async () => {},
      cancelParked: () => cancelParkedPrompts(parked, 5_000, noLog),
      tearDown: () =>
        tearDownHeldSandboxes(Object.values(pools), async () => {}),
      log: noLog,
    });

    assert.deepEqual(harness, ["permission perm-1 reject", "cancel harness-session-1"]);
    assert.deepEqual(teardownReasons, ["shutdown-idle"], "settled, reparked, then deleted");
    assert.deepEqual(apiCalls, [], "the shutdown sent nothing to the api");
  });
});

// --- Teardown: every sandbox the process holds. ---

const FAKE_FACETS = Object.fromEntries(
  FACETS.map((facet) => [facet, "facet-digest"]),
) as FacetDigests;

function pooledEnv() {
  const applied = new AppliedState("cfg", FAKE_FACETS, {});
  const reasons: string[] = [];
  return {
    reasons,
    env: {
      get appliedState() {
        return applied.appliedState;
      },
      commitApplied: (result: Parameters<AppliedState["commitApplied"]>[0]) =>
        applied.commitApplied(result),
    },
    teardown: async (reason: string) => {
      reasons.push(reason);
    },
  };
}

describe("teardown at the end of the shutdown", () => {
  it("deletes every sandbox the pod holds: idle, busy, approval-parked and in flight", async () => {
    const pool = new SessionPool<SessionEnvironment>({ poolMax: 8 }, noLog);
    const held = { idle: pooledEnv(), busy: pooledEnv(), parked: pooledEnv() };
    const epoch = {
      secrets: new CredentialMaterial("h"),
      direct: new CredentialMaterial("d"),
    };
    for (const [key, entry] of Object.entries(held)) {
      await pool.park(
        {
          key,
          environment: entry.env as unknown as SessionEnvironment,
          historyFingerprint: "hist",
          credentialEpoch: epoch,
          teardown: entry.teardown,
        },
        60_000,
        key === "parked" ? "awaiting_approval" : "idle",
      );
    }
    pool.checkoutIdle("busy");

    const inFlightSweeps: TeardownReason[] = [];
    await tearDownHeldSandboxes([pool], async (_ms, reason) => {
      inFlightSweeps.push(reason);
    });

    assert.equal(pool.size(), 0);
    for (const [key, entry] of Object.entries(held)) {
      assert.equal(entry.reasons.length, 1, `${key} was torn down once`);
      assert.equal(
        teardownDisposition(entry.reasons[0] as TeardownReason),
        "delete",
        `${key} (${entry.reasons[0]}) is deleted, not stopped`,
      );
    }
    assert.deepEqual(inFlightSweeps, ["shutdown-in-flight"]);
    assert.equal(teardownDisposition("shutdown-in-flight"), "delete");
  });
});

describe("device logins at shutdown", () => {
  /** A device-code provider whose approval the test resolves, and a store over it. */
  function loginStore() {
    let approve: () => void = () => {};
    const login: DeviceCodeLogin = (opts) => {
      opts.onDeviceCode({
        userCode: "ABCD-1234",
        verificationUri: "https://auth.openai.com/codex/device",
        expiresInSeconds: 900,
      });
      return new Promise((resolve, reject) => {
        approve = () =>
          resolve({ access: "a", refresh: "r", expires: 1_800_000_000_000 });
        opts.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    };
    const outcomes: AttemptOutcome[] = [];
    const attempts = new SubscriptionLoginAttempts(
      login,
      async (outcome) => {
        outcomes.push(outcome);
      },
      noLog,
    );
    setSubscriptionLoginAttempts(attempts);
    return { attempts, outcomes, approve: () => approve() };
  }

  const OWNER = { projectId: "project-1", secretId: "secret-1" };

  it("reports a sign-in still waiting at teardown as failed, so its user can start again", async () => {
    const { attempts, outcomes } = loginStore();
    const { attemptId } = await attempts.start("chatgpt", OWNER);

    await tearDownHeldSandboxes([], async () => {});

    assert.deepEqual(outcomes, [
      { attemptId, ...OWNER, state: "failed", error: ABANDONED_ATTEMPT_REASON },
    ]);
    assert.equal(attempts.size(), 0);
  });

  it("lets a sign-in that finishes during the drain wait report its success", async () => {
    const { attempts, outcomes, approve } = loginStore();
    const { attemptId } = await attempts.start("chatgpt", OWNER);
    let now = 0;

    await drainThenTearDown({
      waitMs: 1_000,
      busy: () => now < 500,
      cancelRunning: async () => {},
      cancelParked: async () => {},
      tearDown: () => tearDownHeldSandboxes([], async () => {}),
      log: noLog,
      now: () => now,
      sleep: async (ms) => {
        // The user approves the code while the pod waits for its turns.
        approve();
        await new Promise((resolve) => setTimeout(resolve, 0));
        now += ms;
      },
    });

    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].attemptId, attemptId);
    assert.equal(outcomes[0].state, "succeeded");
  });
});

/**
 * A stuck sandbox is rebuilt on the SAME Daytona Secret.
 *
 * THE DEFECT (production runner logs, 2026-09-01..02). The preflight convicts a sandbox that
 * never received its credential-substitution wiring, the acquire path destroys it and retries.
 * The retry was stuck again in 4 of 7 observed rebuilds. Every rebuild deleted the stuck
 * sandbox's Secret and allocated a NEW one within a second, so the retry never tested the one
 * thing Daytona support confirmed works (2026-08-31): a new sandbox on the SAME Secret.
 *
 * These tests pin the fix at two levels. The provider must be able to destroy a sandbox while
 * KEEPING its Secrets, and to create the next sandbox against an inherited lease without calling
 * the Secret API at all. The acquire path must carry that lease from one attempt to the next, and
 * delete it exactly once when no sandbox ends up owning it.
 *
 * Ownership is the whole risk here, so most of these cases are about who is allowed to DELETE:
 * an attached lease never deletes, an indeterminate one refuses, a failed delete stays retryable
 * rather than marking itself done, and overlapping releases share one delete.
 *
 * The last pair covers what the PERSON sees when every attempt is convicted: the standard
 * credential-delivery copy and code, not the preflight's internal sentence.
 *
 * Run: pnpm exec vitest run tests/unit/stuck-substitution-rebuild.test.ts
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "vitest";

import type { AgentRunRequest } from "../../src/protocol.ts";
import {
  acquireEnvironment,
  type SandboxAgentDeps,
} from "../../src/engines/sandbox_agent.ts";
import {
  daytonaWithProcessLocalSecrets,
  retainDaytonaSecretsOnDestroy,
  takeDaytonaSecretLease,
  type DaytonaProviderLike,
} from "../../src/engines/sandbox_agent/daytona-secret-provider.ts";
import type { DaytonaSecretPlan } from "../../src/engines/sandbox_agent/daytona-secret-plan.ts";
import {
  DaytonaSecretLease,
  type DaytonaSecretApi,
} from "../../src/engines/sandbox_agent/daytona-secrets.ts";
import { STUCK_ACQUIRE_ATTEMPTS } from "../../src/engines/sandbox_agent/credential-preflight.ts";
import { CREDENTIAL_DELIVERY_FAILED_MESSAGE } from "../../src/engines/sandbox_agent/errors.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";

const GENERATION = "create-fingerprint-a";

const plan: DaytonaSecretPlan = {
  environment: {},
  candidates: [
    {
      ordinal: 0,
      consumer: { kind: "model" },
      binding: { kind: "environment", name: "ANTHROPIC_API_KEY" },
      allowedHost: "api.anthropic.com",
      value: "model-plaintext",
    },
  ],
};

/** A second plan whose slot set differs, so an inherited lease cannot serve it. */
const mcpPlan: DaytonaSecretPlan = {
  environment: {},
  candidates: [
    ...plan.candidates,
    {
      ordinal: 1,
      consumer: { kind: "http_mcp", server: "linear" },
      binding: { kind: "header", name: "Authorization" },
      allowedHost: "mcp.linear.app",
      value: "mcp-plaintext",
    },
  ],
};

interface SecretApiOptions {
  /** Reject the first N deletes, so a release has to retry. */
  failDeletes?: number;
}

/** A fake vault that counts what the runner asked Daytona to do, and never records a value. */
function secretApi(
  events: string[],
  options: SecretApiOptions = {},
): DaytonaSecretApi {
  let count = 0;
  let deleteFailures = options.failDeletes ?? 0;
  return {
    async create(input) {
      count += 1;
      const id = `secret-${count}`;
      events.push(`secret:create:${id}`);
      return {
        id,
        name: input.name,
        placeholder: `dtn_secret_${count}`,
        hosts: input.hosts,
      };
    },
    async update(id) {
      events.push(`secret:update:${id}`);
      return { id, placeholder: "dtn_secret_1" };
    },
    async delete(id) {
      if (deleteFailures > 0) {
        deleteFailures -= 1;
        events.push(`secret:delete-failed:${id}`);
        throw new Error("daytona refused the delete");
      }
      events.push(`secret:delete:${id}`);
    },
  };
}

interface FakeProviderOptions {
  /** Reject `create` on the Nth call, after Daytona would have made the remote sandbox. */
  createRejectsOn?: number;
  /** Reject the first N `destroy` calls with a non-404, so absence cannot be confirmed. */
  destroyRejectsTimes?: number;
}

function providerFactory(events: string[], options: FakeProviderOptions = {}) {
  let created = 0;
  let destroyFailures = options.destroyRejectsTimes ?? 0;
  return (_attachments: Record<string, string>): DaytonaProviderLike => ({
    name: "daytona",
    async create() {
      created += 1;
      if (created === options.createRejectsOn) {
        events.push("sandbox:create-failed");
        throw new Error("daemon never came up");
      }
      const id = `sandbox-${created}`;
      events.push(`sandbox:create:${id}`);
      return id;
    },
    async destroy(id) {
      if (destroyFailures > 0) {
        destroyFailures -= 1;
        events.push(`sandbox:destroy-failed:${id}`);
        throw new Error("daytona API is down");
      }
      events.push(`sandbox:destroy:${id}`);
    },
    async pause(id) {
      events.push(`sandbox:pause:${id}`);
    },
    async reconnect(id) {
      events.push(`sandbox:reconnect:${id}`);
    },
  });
}

const secretEvents = (events: string[]) =>
  events.filter((event) => event.startsWith("secret:"));

describe("the provider destroys a stuck sandbox and keeps its Secrets", () => {
  it("hands back a detached lease instead of deleting", async () => {
    const events: string[] = [];
    const provider = daytonaWithProcessLocalSecrets(
      providerFactory(events),
      plan,
      secretApi(events),
      {
        registry: new Map(),
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );

    const id = await provider.create();
    retainDaytonaSecretsOnDestroy(provider, id);
    await provider.destroy(id);

    assert.deepEqual(events, [
      "secret:create:secret-1",
      "sandbox:create:sandbox-1",
      "sandbox:destroy:sandbox-1",
    ]);
    const lease = takeDaytonaSecretLease(provider);
    assert.ok(lease, "the destroy must hand back the lease it kept");
    assert.equal(lease.state, "detached");
    assert.equal(lease.allocation.created.length, 1);
  });

  it("accepts the prefixed id the sandbox-agent handle exposes", async () => {
    // The handle reports `"daytona/<rawId>"` and the registry is keyed by the raw id. The acquire
    // path only ever holds the prefixed form, so a retain keyed on it has to match.
    const events: string[] = [];
    const provider = daytonaWithProcessLocalSecrets(
      providerFactory(events),
      plan,
      secretApi(events),
      {
        registry: new Map(),
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );

    const id = await provider.create();
    retainDaytonaSecretsOnDestroy(provider, `daytona/${id}`);
    await provider.destroy(id);

    const lease = takeDaytonaSecretLease(provider);
    assert.ok(lease, "the prefixed id must name the same sandbox");
    assert.equal(lease.state, "detached");
    assert.deepEqual(secretEvents(events), ["secret:create:secret-1"]);
  });

  it("ignores a retain keyed to a different sandbox", async () => {
    const events: string[] = [];
    const provider = daytonaWithProcessLocalSecrets(
      providerFactory(events),
      plan,
      secretApi(events),
      {
        registry: new Map(),
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );

    const id = await provider.create();
    retainDaytonaSecretsOnDestroy(provider, "some-other-sandbox");
    await provider.destroy(id);

    assert.equal(
      takeDaytonaSecretLease(provider),
      undefined,
      "the retain key names another sandbox, so this cleanup must delete",
    );
    assert.deepEqual(secretEvents(events), [
      "secret:create:secret-1",
      "secret:delete:secret-1",
    ]);
  });

  it("creates the next sandbox against an inherited lease without touching the Secret API", async () => {
    const events: string[] = [];
    const api = secretApi(events);
    const registry = new Map();
    const first = daytonaWithProcessLocalSecrets(
      providerFactory(events),
      plan,
      api,
      {
        registry,
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );
    const firstId = await first.create();
    retainDaytonaSecretsOnDestroy(first, firstId);
    await first.destroy(firstId);
    const lease = takeDaytonaSecretLease(first)!;

    const events2: string[] = [];
    const second = daytonaWithProcessLocalSecrets(
      providerFactory(events2),
      plan,
      api,
      {
        registry,
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
        inheritedLease: lease,
      },
    );
    const secondId = await second.create();

    assert.deepEqual(
      events2,
      ["sandbox:create:sandbox-1"],
      "an inherited lease must not allocate a new Secret",
    );
    assert.equal(lease.state, "attached");

    // The second sandbox now owns the lease, so its own teardown deletes it. The Secret API
    // writes into `events`, the sandbox provider into `events2`.
    await second.destroy(secondId);
    assert.deepEqual(events2.slice(1), ["sandbox:destroy:sandbox-1"]);
    assert.deepEqual(secretEvents(events), [
      "secret:create:secret-1",
      "secret:delete:secret-1",
    ]);
    assert.equal(lease.state, "released");
  });

  it("releases nothing while a live sandbox holds the lease", async () => {
    const events: string[] = [];
    const api = secretApi(events);
    const registry = new Map();
    const first = daytonaWithProcessLocalSecrets(
      providerFactory(events),
      plan,
      api,
      {
        registry,
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );
    const firstId = await first.create();
    retainDaytonaSecretsOnDestroy(first, firstId);
    await first.destroy(firstId);
    const lease = takeDaytonaSecretLease(first)!;

    const second = daytonaWithProcessLocalSecrets(
      providerFactory([]),
      plan,
      api,
      {
        registry,
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
        inheritedLease: lease,
      },
    );
    await second.create();

    const before = events.length;
    await lease.release();
    assert.equal(
      events.length,
      before,
      "release must not delete a Secret a live sandbox is mounted on",
    );
    assert.equal(lease.state, "attached");
  });

  it("leaves the lease indeterminate when an inherited create rejects", async () => {
    const events: string[] = [];
    const api = secretApi(events);
    const registry = new Map();
    const logs: string[] = [];
    // The lease keeps the logger of the provider that minted it, so both providers write here.
    const first = daytonaWithProcessLocalSecrets(
      providerFactory(events),
      plan,
      api,
      {
        registry,
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
        log: (message) => logs.push(message),
      },
    );
    const firstId = await first.create();
    retainDaytonaSecretsOnDestroy(first, firstId);
    await first.destroy(firstId);
    const lease = takeDaytonaSecretLease(first)!;

    // Daytona made the remote sandbox and the daemon never came up. The create rejects with no
    // sandbox id, so nothing can prove the remote sandbox is absent.
    const second = daytonaWithProcessLocalSecrets(
      providerFactory(events, { createRejectsOn: 1 }),
      plan,
      api,
      {
        registry,
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
        inheritedLease: lease,
        log: (message) => logs.push(message),
      },
    );
    await assert.rejects(() => second.create(), /daemon never came up/);

    assert.equal(lease.state, "indeterminate");
    const before = secretEvents(events).length;
    await lease.release();
    assert.deepEqual(
      secretEvents(events).length,
      before,
      "a lease that cannot prove absence must never delete",
    );
    assert.equal(
      logs.filter((line) => line.includes("reason=create-outcome-unknown"))
        .length,
      1,
      "exactly one line explains the retained Secrets",
    );
  });

  it("stays releasable when the delete fails, and a second release succeeds", async () => {
    const events: string[] = [];
    const provider = daytonaWithProcessLocalSecrets(
      providerFactory(events),
      plan,
      secretApi(events, { failDeletes: 1 }),
      {
        registry: new Map(),
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );
    const id = await provider.create();
    retainDaytonaSecretsOnDestroy(provider, id);
    await provider.destroy(id);
    const lease = takeDaytonaSecretLease(provider)!;

    await assert.rejects(() => lease.release());
    assert.equal(
      lease.state,
      "detached",
      "a failed delete must leave the lease releasable",
    );

    await lease.release();
    assert.equal(lease.state, "released");
    assert.deepEqual(secretEvents(events), [
      "secret:create:secret-1",
      "secret:delete-failed:secret-1",
      "secret:delete:secret-1",
    ]);
  });

  it("shares one delete between overlapping release calls", async () => {
    const events: string[] = [];
    const provider = daytonaWithProcessLocalSecrets(
      providerFactory(events),
      plan,
      secretApi(events),
      {
        registry: new Map(),
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );
    const id = await provider.create();
    retainDaytonaSecretsOnDestroy(provider, id);
    await provider.destroy(id);
    const lease = takeDaytonaSecretLease(provider)!;

    // Both callers start before either finishes. The second must join the in-flight delete
    // rather than issue its own against the same provider ids.
    await Promise.all([lease.release(), lease.release()]);

    assert.deepEqual(secretEvents(events), [
      "secret:create:secret-1",
      "secret:delete:secret-1",
    ]);
    assert.equal(lease.state, "released");
  });

  it("both overlapping callers see a failed delete, and the next release succeeds", async () => {
    const events: string[] = [];
    const provider = daytonaWithProcessLocalSecrets(
      providerFactory(events),
      plan,
      secretApi(events, { failDeletes: 1 }),
      {
        registry: new Map(),
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );
    const id = await provider.create();
    retainDaytonaSecretsOnDestroy(provider, id);
    await provider.destroy(id);
    const lease = takeDaytonaSecretLease(provider)!;

    // One delete, one rejection, delivered to both callers. Neither may conclude it succeeded.
    const first = lease.release();
    const second = lease.release();
    await assert.rejects(() => first);
    await assert.rejects(() => second);
    assert.equal(lease.state, "detached");

    await lease.release();
    assert.equal(lease.state, "released");
    assert.deepEqual(secretEvents(events), [
      "secret:create:secret-1",
      "secret:delete-failed:secret-1",
      "secret:delete:secret-1",
    ]);
  });

  it("says the indeterminate refusal once, however many callers ask", async () => {
    const events: string[] = [];
    const logs: string[] = [];
    const api = secretApi(events);
    const registry = new Map();
    const first = daytonaWithProcessLocalSecrets(
      providerFactory(events),
      plan,
      api,
      {
        registry,
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
        log: (message) => logs.push(message),
      },
    );
    const firstId = await first.create();
    retainDaytonaSecretsOnDestroy(first, firstId);
    await first.destroy(firstId);
    const lease = takeDaytonaSecretLease(first)!;

    const second = daytonaWithProcessLocalSecrets(
      providerFactory(events, { createRejectsOn: 1 }),
      plan,
      api,
      {
        registry,
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
        inheritedLease: lease,
        log: (message) => logs.push(message),
      },
    );
    await assert.rejects(() => second.create());

    await lease.release();
    await lease.release();
    await lease.release();

    assert.equal(
      logs.filter((line) => line.includes("reason=create-outcome-unknown"))
        .length,
      1,
      "a retried teardown must not read as several separate leaks",
    );
  });

  it("hands back no lease when the retained destroy itself fails", async () => {
    // A destroy that rejects with anything but a 404 cannot prove the sandbox is gone, so the
    // cleanup re-raises before it reaches the lease. The Secret and the sandbox are stranded
    // together, exactly as a failed destroy has always stranded them, and the caller allocates
    // fresh rather than mounting Secrets that may still be attached to a live sandbox.
    const events: string[] = [];
    const provider = daytonaWithProcessLocalSecrets(
      providerFactory(events, { destroyRejectsTimes: 1 }),
      plan,
      secretApi(events),
      {
        registry: new Map(),
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );
    const id = await provider.create();
    retainDaytonaSecretsOnDestroy(provider, id);

    await assert.rejects(() => provider.destroy(id), /daytona API is down/);
    assert.equal(takeDaytonaSecretLease(provider), undefined);
    assert.deepEqual(secretEvents(events), ["secret:create:secret-1"]);
  });

  it("refuses an inherited lease whose slot set does not match the plan", async () => {
    const events: string[] = [];
    const api = secretApi(events);
    const registry = new Map();
    const logs: string[] = [];
    const first = daytonaWithProcessLocalSecrets(
      providerFactory(events),
      plan,
      api,
      {
        registry,
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );
    const firstId = await first.create();
    retainDaytonaSecretsOnDestroy(first, firstId);
    await first.destroy(firstId);
    const lease = takeDaytonaSecretLease(first)!;

    // The second provider wants a model slot AND an MCP slot. The inherited lease has only the
    // model slot, so mounting it would fail later with a missing-placeholder message.
    const second = daytonaWithProcessLocalSecrets(
      providerFactory([]),
      mcpPlan,
      api,
      {
        registry,
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
        inheritedLease: lease,
        log: (message) => logs.push(message),
      },
    );
    await second.create();

    assert.equal(lease.state, "released", "the unusable lease is deleted");
    assert.deepEqual(secretEvents(events), [
      "secret:create:secret-1",
      "secret:delete:secret-1",
      "secret:create:secret-2",
      "secret:create:secret-3",
    ]);
    assert.equal(
      logs.filter((line) => line.includes("inherited lease unusable")).length,
      1,
    );
  });
});

describe("the stuck-acquire budget", () => {
  it("allows two rebuilds after the first stuck sandbox", () => {
    assert.equal(STUCK_ACQUIRE_ATTEMPTS, 3);
  });
});

// ---- acquire level ------------------------------------------------------------------- //

const daytonaRequest: AgentRunRequest = {
  harness: "claude",
  sandbox: "daytona",
  sessionId: "sess-stuck",
  streamId: "stream-1",
  messages: [{ role: "user", content: "hello" }],
  modelConnection: {
    provider: "anthropic",
    deployment: "direct",
    credentialMode: "env",
    endpoint: { baseUrl: "https://api.anthropic.com" },
    credentials: [
      {
        binding: { kind: "environment", name: "ANTHROPIC_API_KEY" },
        value: "sk-ant-fixture-value",
        usage: "opaque_http",
      },
    ],
  },
  telemetry: {
    exporters: { otlp: { headers: { authorization: "ApiKey abc" } } },
  } as never,
};

interface AcquireFixtureOptions {
  /** Fail the harness session on the Nth attempt, so the attempt fails without being stuck. */
  sessionFailsOnAttempt?: number;
  /** Abort this signal as soon as an attempt is convicted stuck. */
  abortWhenStuck?: AbortController;
  /** Reject the first N sandbox destroys, so teardown cannot confirm absence. */
  destroyRejectsTimes?: number;
  /** Reject the first N Secret deletes, so teardown cannot finish the cleanup. */
  failDeletes?: number;
}

/**
 * Drive the REAL acquire path over the REAL Secret provider, with only the transport faked.
 *
 * `startSandboxAgent` stands in for the sandbox-agent package: it calls the provider's `create`
 * and returns a handle whose `destroySandbox` calls the provider's `destroy`. That is the wiring
 * the lease's ownership rules depend on, so a fake that skipped it would prove nothing.
 *
 * The handle's `sandboxId` is the PREFIXED `"daytona/<rawId>"` the real client exposes, while
 * `destroy` gets the raw id. Faking that asymmetry is load-bearing: a fixture that reported the
 * raw id would let a retain keyed on the handle's id pass here and match nothing in production.
 */
function acquireFixture(
  verdicts: Array<"ok" | "stuck">,
  options: AcquireFixtureOptions = {},
) {
  const events: string[] = [];
  const api = secretApi(events, {
    ...(options.failDeletes ? { failDeletes: options.failDeletes } : {}),
  });
  const registry = new Map();
  const buildFake = providerFactory(events, {
    ...(options.destroyRejectsTimes
      ? { destroyRejectsTimes: options.destroyRejectsTimes }
      : {}),
  });
  const preflightCalls: number[] = [];
  const logs: string[] = [];
  // The provider's cleanup-retry timer, captured instead of scheduled, so a test can run it.
  const timers: Array<() => void> = [];
  let attempts = 0;

  const deps: SandboxAgentDeps = {
    log: (message) => logs.push(message),
    createDaytonaCwd: (durable?: string) =>
      durable ?? "/home/sandbox/agenta-fake-cwd",
    createLocalCwd: (durable?: string) => durable ?? "/tmp/agenta-fake-cwd",
    resolveSkillDirs: () => ({ skills: [], cleanup: () => {} }),
    buildDaemonEnv: () => ({}),
    resolveDaemonBinary: () => "/bin/sandbox-agent",
    signSessionMountCredentials: (async () => null) as never,
    signAgentMountCredentials: (async () => null) as never,
    readStoredSandboxPointer: (async () => undefined) as never,
    buildSandboxProvider: ((...args: unknown[]) =>
      daytonaWithProcessLocalSecrets(
        buildFake,
        args[6] as DaytonaSecretPlan,
        api,
        {
          registry,
          cleanupDelayMilliseconds: 1_000,
          createFingerprint: GENERATION,
          log: (message) => logs.push(message),
          setCleanupTimer: ((run: () => void) => {
            timers.push(run);
            return { unref() {} };
          }) as never,
          ...(args[7] as { inheritedLease?: DaytonaSecretLease }),
        },
      )) as never,
    createPersist: () => ({}) as never,
    startSandboxAgent: (async (startOptions: any) => {
      attempts += 1;
      const thisAttempt = attempts;
      const provider = startOptions.sandbox;
      const rawSandboxId = await provider.create();
      return {
        sandboxId: `daytona/${rawSandboxId}`,
        async createSession() {
          if (thisAttempt === options.sessionFailsOnAttempt) {
            throw new Error("the harness session refused to open");
          }
          return {
            id: "session-1",
            agentSessionId: "agent-fake-1",
            onEvent() {},
            onPermissionRequest() {},
            async prompt() {
              return {
                stopReason: "complete",
                usage: { inputTokens: 1, outputTokens: 1 },
              };
            },
          };
        },
        async destroySession() {},
        async destroySandbox() {
          await provider.destroy(rawSandboxId);
        },
        async dispose() {},
      };
    }) as never,
    prepareWorkspace: (async () => ({ cleanup: async () => {} })) as never,
    prepareDaytonaPiAssets: (async () => true) as never,
    discoverTunnelEndpoint: (async () => null) as never,
    probeCapabilities: (async () => ({
      source: "probed",
      capabilities: {
        mcpTools: true,
        toolCalls: true,
        usage: true,
        streamingDeltas: true,
      },
    })) as never,
    applyModel: (async (_session: unknown, model: string | undefined) =>
      model ?? "resolved-model") as never,
    startToolRelay: (() => ({ stop: async () => {} })) as never,
    localRelayHost: (() => "local-relay-host") as never,
    sandboxRelayHost: (() => "sandbox-relay-host") as never,
    awaitCredentialSubstitution: (async () => {
      preflightCalls.push(preflightCalls.length + 1);
      const verdict = verdicts.shift() ?? "ok";
      if (verdict === "stuck") options.abortWhenStuck?.abort();
      return verdict;
    }) as never,
  };

  return { deps, events, preflightCalls, logs, timers };
}

describe("acquireEnvironment rebuilds a stuck sandbox on the same Secret", () => {
  beforeEach(() => {
    process.env.AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS = "local,daytona";
    process.env.AGENTA_RUNNER_DAYTONA_API_KEY = "test-key";
    resetRunnerConfigCache();
  });

  it("allocates one Secret across a stuck attempt and a healthy retry", async () => {
    const { deps, events, preflightCalls } = acquireFixture(["stuck", "ok"]);

    const result = await acquireEnvironment(daytonaRequest, deps);

    assert.equal(result.ok, true, `acquire failed: ${(result as any).error}`);
    assert.equal(preflightCalls.length, 2, "the retry must run the preflight");
    assert.deepEqual(
      secretEvents(events),
      ["secret:create:secret-1"],
      "the rebuild must reuse the first allocation and delete nothing",
    );
    assert.deepEqual(
      events.filter((event) => event.startsWith("sandbox:")),
      [
        "sandbox:create:sandbox-1",
        "sandbox:destroy:sandbox-1",
        "sandbox:create:sandbox-2",
      ],
    );

    if (result.ok) await result.env.destroy({ reason: "failed-turn" });
    assert.deepEqual(
      secretEvents(events),
      ["secret:create:secret-1", "secret:delete:secret-1"],
      "the Secret is deleted once, at the environment's own teardown",
    );
  });

  it("tries a third sandbox and deletes the Secret once when every attempt is stuck", async () => {
    const { deps, events, preflightCalls } = acquireFixture([
      "stuck",
      "stuck",
      "stuck",
    ]);

    const result = await acquireEnvironment(daytonaRequest, deps);

    assert.equal(result.ok, false);
    assert.equal(
      (result as { stuckSubstitution?: boolean }).stuckSubstitution,
      true,
    );
    assert.equal(preflightCalls.length, 3, "three attempts, not two");
    assert.deepEqual(
      secretEvents(events),
      ["secret:create:secret-1", "secret:delete:secret-1"],
      "one allocation for the whole run, deleted once when the run gives up",
    );
    assert.deepEqual(
      events.filter((event) => event.startsWith("sandbox:create")),
      [
        "sandbox:create:sandbox-1",
        "sandbox:create:sandbox-2",
        "sandbox:create:sandbox-3",
      ],
    );
  });

  it("reports a doubly stuck acquire as a credential-delivery failure", async () => {
    // The user used to read the preflight's internal sentence, coded `agent_run_failed`, which
    // the web cannot offer a retry for. Every attempt being convicted means the model key never
    // reached the model, which is the class the client already knows how to handle.
    const { deps } = acquireFixture(["stuck", "stuck", "stuck"]);
    const emitted: Array<Record<string, unknown>> = [];

    const result = await acquireEnvironment(
      daytonaRequest,
      deps,
      undefined,
      undefined,
      (event) => emitted.push(event as Record<string, unknown>),
    );

    assert.equal(result.ok, false);
    assert.equal(
      (result as { error: string }).error,
      CREDENTIAL_DELIVERY_FAILED_MESSAGE,
    );
    assert.equal(
      (result as { error: string }).error.includes("placeholder"),
      false,
      "the internal sentence belongs in the runner log, not in the chat",
    );
    assert.deepEqual(
      emitted.filter((event) => event.type === "error"),
      [
        {
          type: "error",
          message: CREDENTIAL_DELIVERY_FAILED_MESSAGE,
          code: "credential_delivery_failed",
        },
      ],
      "exactly one error event, carrying the class the client renders a retry from",
    );
  });

  it("says nothing to the user about an attempt that was rebuilt successfully", async () => {
    const { deps } = acquireFixture(["stuck", "ok"]);
    const emitted: Array<Record<string, unknown>> = [];

    const result = await acquireEnvironment(
      daytonaRequest,
      deps,
      undefined,
      undefined,
      (event) => emitted.push(event as Record<string, unknown>),
    );

    assert.equal(result.ok, true);
    assert.deepEqual(
      emitted.filter((event) => event.type === "error"),
      [],
      "a recovered rebuild is not a failure the user should hear about",
    );
    if (result.ok) await result.env.destroy({ reason: "failed-turn" });
  });

  it("logs a failed sandbox delete at teardown and retries the whole cleanup", async () => {
    // The environment is already marked destroyed and dropped from the in-flight map by the time
    // the rejection is swallowed, so without the retry nothing is left holding the sandbox or its
    // Secret. Both used to disappear here without a line in the log.
    const { deps, events, logs, timers } = acquireFixture(["ok"], {
      destroyRejectsTimes: 1,
    });

    const result = await acquireEnvironment(daytonaRequest, deps);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    await result.env.destroy({ reason: "failed-turn" });

    assert.ok(
      logs.some((line) => line.startsWith("sandbox delete failed sandbox=")),
      "the swallowed rejection must reach the operator log",
    );
    assert.equal(timers.length, 1, "the cleanup retry must be armed");
    assert.deepEqual(secretEvents(events), ["secret:create:secret-1"]);

    // The later attempt destroys the sandbox and deletes the Secret, exactly once each.
    timers[0]();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(secretEvents(events), [
      "secret:create:secret-1",
      "secret:delete:secret-1",
    ]);
    assert.deepEqual(
      events.filter((event) => event.startsWith("sandbox:destroy")),
      ["sandbox:destroy-failed:sandbox-1", "sandbox:destroy:sandbox-1"],
    );
  });

  it("logs a failed Secret delete at teardown and retries only the delete", async () => {
    const { deps, events, logs, timers } = acquireFixture(["ok"], {
      failDeletes: 1,
    });

    const result = await acquireEnvironment(daytonaRequest, deps);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    await result.env.destroy({ reason: "failed-turn" });

    assert.ok(
      logs.some((line) => line.startsWith("sandbox delete failed sandbox=")),
      "the swallowed rejection must reach the operator log",
    );
    assert.ok(
      logs.some((line) =>
        line.includes("cleanup failed sandbox=sandbox-1 reason=secret-delete"),
      ),
      "the provider names which half of the cleanup failed",
    );
    assert.equal(timers.length, 1, "the cleanup retry must be armed");

    timers[0]();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(secretEvents(events), [
      "secret:create:secret-1",
      "secret:delete-failed:secret-1",
      "secret:delete:secret-1",
    ]);
  });

  it("never returns the lease to its caller", async () => {
    const { deps } = acquireFixture(["stuck", "stuck", "stuck"]);

    const result = await acquireEnvironment(daytonaRequest, deps);

    assert.deepEqual(
      Object.keys(result).sort(),
      ["error", "ok", "stuckSubstitution"],
      "the lease is an ownership token and must not leave the acquire loop",
    );
  });

  it("releases the lease once when the signal aborts before the retry", async () => {
    const abort = new AbortController();
    const { deps, events, preflightCalls } = acquireFixture(["stuck", "ok"], {
      abortWhenStuck: abort,
    });

    const result = await acquireEnvironment(daytonaRequest, deps, abort.signal);

    assert.equal(result.ok, false);
    assert.equal(preflightCalls.length, 1, "the abort stops the rebuild");
    assert.deepEqual(
      secretEvents(events),
      ["secret:create:secret-1", "secret:delete:secret-1"],
      "an abandoned lease is deleted exactly once",
    );
  });

  it("deletes the Secret exactly once when the retry fails for another reason", async () => {
    // Attempt 1 is stuck and hands over its lease. Attempt 2 adopts it and then fails to open
    // the harness session, so its own teardown deletes the Secret. The loop's release must find
    // the lease already released and add no second delete.
    const { deps, events, preflightCalls } = acquireFixture(["stuck", "ok"], {
      sessionFailsOnAttempt: 2,
    });

    const result = await acquireEnvironment(daytonaRequest, deps);

    assert.equal(result.ok, false);
    // The preflight is kicked off right after the sandbox exists and only awaited at the end, so
    // attempt 2 starts one even though it fails at the session before reading the verdict.
    assert.equal(preflightCalls.length, 2);
    assert.deepEqual(secretEvents(events), [
      "secret:create:secret-1",
      "secret:delete:secret-1",
    ]);
  });
});

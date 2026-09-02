/**
 * A stuck sandbox is rebuilt on the SAME Daytona Secret.
 *
 * THE DEFECT (production runner logs, 2026-09-01..02). The preflight convicts a sandbox that
 * never received its credential-substitution wiring, the acquire path destroys it and retries.
 * The retry was stuck again in 4 of 7 observed rebuilds. Every rebuild deleted the stuck
 * sandbox's Secret and allocated a NEW one within a second, so the retry never tested the one
 * thing Daytona support confirmed works (2026-08-31): a new sandbox on the SAME Secret.
 *
 * These tests pin the fix at two levels. The facade must be able to destroy a sandbox while
 * KEEPING its Secrets, and to create the next sandbox against an inherited allocation without
 * calling the Secret API at all. The acquire path must carry that allocation from one attempt
 * to the next, and delete it exactly once when no further attempt follows.
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
  takeRetainedDaytonaSecrets,
  type DaytonaProviderLike,
} from "../../src/engines/sandbox_agent/daytona-secret-provider.ts";
import type { DaytonaSecretPlan } from "../../src/engines/sandbox_agent/daytona-secret-plan.ts";
import type {
  DaytonaSecretAllocation,
  DaytonaSecretApi,
} from "../../src/engines/sandbox_agent/daytona-secrets.ts";
import { STUCK_ACQUIRE_ATTEMPTS } from "../../src/engines/sandbox_agent/credential-preflight.ts";
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

/** A fake vault that counts what the runner asked Daytona to do, and never records a value. */
function secretApi(events: string[]): DaytonaSecretApi {
  let count = 0;
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
      events.push(`secret:delete:${id}`);
    },
  };
}

function providerFactory(events: string[]) {
  let created = 0;
  return (_attachments: Record<string, string>): DaytonaProviderLike => ({
    name: "daytona",
    async create() {
      created += 1;
      const id = `sandbox-${created}`;
      events.push(`sandbox:create:${id}`);
      return id;
    },
    async destroy(id) {
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

describe("the facade destroys a stuck sandbox and keeps its Secrets", () => {
  it("returns the allocation instead of deleting it", async () => {
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
    retainDaytonaSecretsOnDestroy(provider);
    await provider.destroy(id);

    assert.deepEqual(events, [
      "secret:create:secret-1",
      "sandbox:create:sandbox-1",
      "sandbox:destroy:sandbox-1",
    ]);
    const retained = takeRetainedDaytonaSecrets(provider);
    assert.ok(retained, "the destroy must hand back the allocation it kept");
    assert.equal(retained.allocation.created.length, 1);
  });

  it("creates the next sandbox against an inherited allocation without touching the Secret API", async () => {
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
    retainDaytonaSecretsOnDestroy(first);
    await first.destroy(firstId);
    const retained = takeRetainedDaytonaSecrets(first);
    assert.ok(retained);

    const events2: string[] = [];
    const second = daytonaWithProcessLocalSecrets(
      providerFactory(events2),
      plan,
      api,
      {
        registry,
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
        inheritedAllocation: retained.allocation,
      },
    );
    const secondId = await second.create();

    assert.deepEqual(
      events2,
      ["sandbox:create:sandbox-1"],
      "an inherited allocation must not allocate a new Secret",
    );
    // The second sandbox now owns the allocation, so its own teardown deletes it. The Secret API
    // writes into `events`, the sandbox provider into `events2`.
    await second.destroy(secondId);
    assert.deepEqual(events2.slice(1), ["sandbox:destroy:sandbox-1"]);
    assert.deepEqual(
      events.filter((event) => event.startsWith("secret:")),
      ["secret:create:secret-1", "secret:delete:secret-1"],
    );
  });

  it("keeps release() from deleting Secrets a live sandbox already adopted", async () => {
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
    retainDaytonaSecretsOnDestroy(first);
    await first.destroy(firstId);
    const retained = takeRetainedDaytonaSecrets(first)!;

    const second = daytonaWithProcessLocalSecrets(
      providerFactory([]),
      plan,
      api,
      {
        registry,
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
        inheritedAllocation: retained.allocation,
      },
    );
    await second.create();

    const before = events.length;
    await retained.release();
    assert.equal(
      events.length,
      before,
      "release must not delete a Secret a live sandbox is mounted on",
    );
  });

  it("release() deletes the retained Secrets when nothing adopted them", async () => {
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
    retainDaytonaSecretsOnDestroy(provider);
    await provider.destroy(id);
    const retained = takeRetainedDaytonaSecrets(provider)!;

    await retained.release();
    await retained.release();

    assert.deepEqual(
      events.filter((event) => event.startsWith("secret:delete")),
      ["secret:delete:secret-1"],
      "release is idempotent and deletes exactly once",
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

/**
 * Drive the REAL acquire path over the REAL Secret facade, with only the transport faked.
 *
 * `startSandboxAgent` stands in for the sandbox-agent package: it calls the provider's `create`
 * and returns a handle whose `destroySandbox` calls the provider's `destroy`. That is the wiring
 * the facade's ownership rules depend on, so a fake that skipped it would prove nothing.
 */
function acquireFixture(verdicts: Array<"ok" | "stuck">) {
  const events: string[] = [];
  const api = secretApi(events);
  const registry = new Map();
  const buildFake = providerFactory(events);
  const preflightCalls: number[] = [];

  const deps: SandboxAgentDeps = {
    log: () => {},
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
          ...(args[7]
            ? { inheritedAllocation: args[7] as DaytonaSecretAllocation }
            : {}),
        },
      )) as never,
    createPersist: () => ({}) as never,
    startSandboxAgent: (async (options: any) => {
      const provider = options.sandbox;
      const sandboxId = await provider.create();
      return {
        sandboxId,
        async createSession() {
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
          await provider.destroy(sandboxId);
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
      return verdicts.shift() ?? "ok";
    }) as never,
  };

  return { deps, events, preflightCalls };
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
      events.filter((event) => event.startsWith("secret:")),
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
      events.filter((event) => event.startsWith("secret:delete")),
      ["secret:delete:secret-1"],
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
      events.filter((event) => event.startsWith("secret:")),
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
});

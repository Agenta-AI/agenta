import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";

import type { AgentRunRequest, McpServerConfig } from "../../src/protocol.ts";
import {
  daytonaWithProcessLocalSecrets,
  type DaytonaProviderLike,
  type ProcessLocalDaytonaSecretProvider,
} from "../../src/engines/sandbox_agent/daytona-secret-provider.ts";
import { DaytonaReconnectTerminalError } from "../../src/engines/sandbox_agent/daytona-provider.ts";
import {
  buildDaytonaSecretPlan,
  type DaytonaSecretPlan,
} from "../../src/engines/sandbox_agent/daytona-secret-plan.ts";
import type { DaytonaSecretApi } from "../../src/engines/sandbox_agent/daytona-secrets.ts";
import { computeCredentialEpoch } from "../../src/engines/sandbox_agent/session-identity.ts";
import {
  daytonaCredentialCapabilities,
  mechanismForRotation,
  runCredentialDelivery,
  type CredentialDeliveryCapabilities,
  type CredentialDeliveryLogEvent,
} from "../../src/providers/credential-delivery-port.ts";
import { desiredCredentialSetFor } from "../../src/providers/daytona-credential-delivery.ts";
import {
  buildDaytonaCreate,
  daytonaCreateFingerprint,
} from "../../src/engines/sandbox_agent/provider.ts";
import { parseRunnerConfig } from "../../src/config/runner-config.ts";

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
    {
      ordinal: 1,
      consumer: { kind: "http_mcp", server: "linear" },
      binding: { kind: "header", name: "Authorization" },
      allowedHost: "mcp.linear.app",
      value: "mcp-plaintext",
    },
  ],
};

const mcpServers: McpServerConfig[] = [
  {
    name: "linear",
    connection: {
      type: "http",
      url: "https://mcp.linear.app/rpc",
      credentials: [
        {
          binding: { kind: "header", name: "Authorization" },
          value: "mcp-plaintext",
          usage: "opaque_http",
        },
      ],
    },
    policy: { tools: { mode: "all" } },
  },
];

/**
 * A fake vault. `stored` is the assertion surface for a rotation: an in-place update must leave the
 * record id and placeholder alone and change only the value behind them, which is a claim about
 * `stored`, not about the event log. Values stay OUT of `events` so the event log can be asserted
 * as a stand-in for what the runner is allowed to say out loud.
 */
function secretApi(
  events: string[],
  stored: Map<string, string> = new Map(),
  options: { moveIdentityOnUpdate?: boolean; failUpdate?: boolean } = {},
): DaytonaSecretApi {
  let count = 0;
  return {
    async create(input) {
      count += 1;
      const id = `secret-${count}`;
      stored.set(id, input.value);
      events.push(`secret:create:${input.value}`);
      return {
        id,
        name: input.name,
        placeholder: `dtn_secret_${count}`,
        hosts: input.hosts,
      };
    },
    async update(id, input) {
      events.push(`secret:update:${id}`);
      if (options.failUpdate) throw new Error("daytona refused the update");
      stored.set(id, input.value);
      const suffix = id.replace("secret-", "");
      return options.moveIdentityOnUpdate
        ? { id: `${id}-moved`, placeholder: `dtn_secret_${suffix}` }
        : { id, placeholder: `dtn_secret_${suffix}` };
    },
    async delete(id) {
      stored.delete(id);
      events.push(`secret:delete:${id}`);
    },
  };
}

/**
 * A create fingerprint for tests that do not care what is in it.
 *
 * It is a REQUIRED dependency now (lifecycle migration, step 9): it used to default to
 * `JSON.stringify(plan)`, a raw-value serialization of every credential in the run. Naming one
 * here per call site keeps every test honest about which generation it is describing.
 */
const GENERATION = "create-fingerprint-a";

function providerFactory(events: string[], attachmentLog: any[]) {
  return (attachments: Record<string, string>): DaytonaProviderLike => {
    attachmentLog.push(attachments);
    return {
      name: "daytona",
      async create() {
        events.push("sandbox:create");
        return "sandbox-1";
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
    };
  };
}

afterEach(() => vi.useRealTimers());

describe("process-local Daytona Secret provider", () => {
  it("attaches Secret names at create and substitutes MCP plaintext with placeholders", async () => {
    const events: string[] = [];
    const attachments: any[] = [];
    const headerPlan: DaytonaSecretPlan = {
      ...plan,
      candidates: [
        ...plan.candidates,
        {
          ordinal: 2,
          consumer: { kind: "http_mcp", server: "linear" },
          binding: { kind: "header", name: "X-Foo" },
          allowedHost: "mcp.linear.app",
          value: "mcp-public-plaintext",
        },
      ],
    };
    const provider = daytonaWithProcessLocalSecrets(
      providerFactory(events, attachments),
      headerPlan,
      secretApi(events),
      {
        registry: new Map(),
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );

    await provider.create();
    assert.deepEqual(attachments[0], {
      ANTHROPIC_API_KEY: attachments[0].ANTHROPIC_API_KEY,
      AGENTA_MCP_SECRET_1: attachments[0].AGENTA_MCP_SECRET_1,
      AGENTA_MCP_SECRET_2: attachments[0].AGENTA_MCP_SECRET_2,
    });
    assert.notEqual(attachments[0].ANTHROPIC_API_KEY, "model-plaintext");
    const materialized = provider.materializeMcpServers([
      {
        ...mcpServers[0],
        connection: {
          ...mcpServers[0].connection,
          headers: { "X-Foo": "mcp-public-plaintext" },
        },
      },
    ])!;
    assert.equal(
      materialized[0].connection.credentials?.[0].value,
      "dtn_secret_2",
    );
    assert.equal(materialized[0].connection.headers?.["X-Foo"], "dtn_secret_3");
    assert.equal(JSON.stringify(materialized).includes("mcp-plaintext"), false);
    assert.equal(
      JSON.stringify(materialized).includes("mcp-public-plaintext"),
      false,
    );
  });

  it("deletes the sandbox before Secrets on destructive teardown", async () => {
    const events: string[] = [];
    const provider = daytonaWithProcessLocalSecrets(
      providerFactory(events, []),
      plan,
      secretApi(events),
      {
        registry: new Map(),
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );
    const id = await provider.create();
    await provider.destroy(id);

    const destroyIndex = events.indexOf("sandbox:destroy:sandbox-1");
    const firstSecretDelete = events.findIndex((event) =>
      event.startsWith("secret:delete"),
    );
    assert.ok(destroyIndex >= 0 && destroyIndex < firstSecretDelete);
    assert.deepEqual(events.slice(firstSecretDelete), [
      "secret:delete:secret-2",
      "secret:delete:secret-1",
    ]);
  });

  it("retains Secrets when create rejects and remote sandbox absence is unknown", async () => {
    const events: string[] = [];
    const logs: string[] = [];
    const provider = daytonaWithProcessLocalSecrets(
      (): DaytonaProviderLike => ({
        name: "daytona",
        async create() {
          events.push("sandbox:create:remote-created");
          throw new Error("daemon start failed");
        },
        async destroy() {
          events.push("sandbox:destroy");
        },
      }),
      plan,
      secretApi(events),
      {
        registry: new Map(),
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
        log: (message) => logs.push(message),
      },
    );

    await assert.rejects(() => provider.create(), /daemon start failed/);
    assert.equal(
      events.some((event) => event.startsWith("secret:delete")),
      false,
    );
    assert.equal(events.includes("sandbox:destroy"), false);
    assert.match(logs[0], /retaining 2 Secret allocation/);
  });

  it("deletes Secrets when provider construction proves no remote create started", async () => {
    const events: string[] = [];
    const provider = daytonaWithProcessLocalSecrets(
      (): DaytonaProviderLike => {
        throw new Error("provider construction failed");
      },
      plan,
      secretApi(events),
      {
        registry: new Map(),
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );

    await assert.rejects(
      () => provider.create(),
      /provider construction failed/,
    );
    assert.deepEqual(events.slice(-2), [
      "secret:delete:secret-2",
      "secret:delete:secret-1",
    ]);
  });

  it("retains allocation across park/reconnect and cancels timed cleanup", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const registry = new Map();
    const api = secretApi(events);
    const first = daytonaWithProcessLocalSecrets(
      providerFactory(events, []),
      plan,
      api,
      {
        registry,
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );
    const id = await first.create();
    await first.pause!(id);

    const second = daytonaWithProcessLocalSecrets(
      providerFactory(events, []),
      plan,
      api,
      {
        registry,
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );
    await vi.advanceTimersByTimeAsync(500);
    await second.reconnect!(id);
    await vi.advanceTimersByTimeAsync(1_000);

    assert.equal(
      events.some((event) => event.startsWith("secret:delete")),
      false,
    );
    assert.equal(
      second.materializeMcpServers(mcpServers)?.[0].connection.credentials?.[0]
        .value,
      "dtn_secret_2",
    );
  });

  it("never reconnects concurrently with an already-started timer cleanup", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const registry = new Map();
    const api = secretApi(events);
    let cleanupStarted!: () => void;
    const cleanupEntered = new Promise<void>((resolve) => {
      cleanupStarted = resolve;
    });
    let releaseCleanup!: () => void;
    const cleanupBlocked = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const first = daytonaWithProcessLocalSecrets(
      (attachments): DaytonaProviderLike => ({
        name: "daytona",
        async create() {
          assert.ok(Object.keys(attachments).length > 0);
          return "sandbox-1";
        },
        async pause() {
          events.push("sandbox:pause");
        },
        async destroy() {
          events.push("sandbox:destroy:start");
          cleanupStarted();
          await cleanupBlocked;
          events.push("sandbox:destroy:end");
        },
      }),
      plan,
      api,
      {
        registry,
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );
    const id = await first.create();
    await first.pause!(id);
    await vi.advanceTimersByTimeAsync(1_000);
    await cleanupEntered;

    const second = daytonaWithProcessLocalSecrets(
      (): DaytonaProviderLike => ({
        name: "daytona",
        async create() {
          throw new Error("unused");
        },
        async reconnect() {
          events.push("sandbox:reconnect");
        },
        async destroy() {
          events.push("sandbox:destroy:second");
        },
      }),
      plan,
      api,
      {
        registry,
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );
    const reconnect = second.reconnect!(id);
    await Promise.resolve();
    assert.equal(
      events.includes("sandbox:reconnect"),
      false,
      "reconnect waits while timer cleanup owns the lifecycle operation",
    );

    releaseCleanup();
    await assert.rejects(
      reconnect,
      (error: unknown) =>
        error instanceof DaytonaReconnectTerminalError &&
        error.state === "missing-process-local-secret-allocation",
    );
    assert.equal(events.includes("sandbox:reconnect"), false);
    assert.deepEqual(events.slice(-3), [
      "sandbox:destroy:end",
      "secret:delete:secret-2",
      "secret:delete:secret-1",
    ]);
  });

  it("cleans a parked sandbox and its Secrets slightly after the auto-delete window", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const provider = daytonaWithProcessLocalSecrets(
      providerFactory(events, []),
      plan,
      secretApi(events),
      {
        registry: new Map(),
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );
    const id = await provider.create();
    await provider.pause!(id);
    await vi.advanceTimersByTimeAsync(999);
    assert.equal(events.includes("sandbox:destroy:sandbox-1"), false);
    await vi.advanceTimersByTimeAsync(1);
    assert.deepEqual(events.slice(-3), [
      "sandbox:destroy:sandbox-1",
      "secret:delete:secret-2",
      "secret:delete:secret-1",
    ]);
  });

  it("deletes and rejects reconnect when the process-local allocation is missing", async () => {
    const events: string[] = [];
    const provider = daytonaWithProcessLocalSecrets(
      providerFactory(events, []),
      plan,
      secretApi(events),
      {
        registry: new Map(),
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );
    await assert.rejects(
      () => provider.reconnect!("old-sandbox"),
      (error: unknown) =>
        error instanceof DaytonaReconnectTerminalError &&
        error.state === "missing-process-local-secret-allocation",
    );
    assert.deepEqual(events, ["sandbox:destroy:old-sandbox"]);
  });

  it("deletes the old sandbox and Secrets when the credential SLOT SET changes", async () => {
    // The half of the old rotation test that SURVIVES the creation-identity split. A changed VALUE
    // is now delivered in place (see the acceptance describe below); a changed slot SET still
    // deletes, because this sandbox was created holding one placeholder per allocated slot and no
    // runner action can add one. Credential material left the create fingerprint, so this check
    // moved to where it can be answered without values: the slot identities themselves.
    const events: string[] = [];
    const registry = new Map();
    const api = secretApi(events);
    const first = daytonaWithProcessLocalSecrets(
      providerFactory(events, []),
      plan,
      api,
      {
        registry,
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );
    const id = await first.create();
    const extraSlot: DaytonaSecretPlan = {
      ...plan,
      candidates: [
        ...plan.candidates,
        {
          ordinal: 2,
          consumer: { kind: "http_mcp", server: "sentry" },
          binding: { kind: "header", name: "Authorization" },
          allowedHost: "mcp.sentry.dev",
          value: "sentry-plaintext",
        },
      ],
    };
    const second = daytonaWithProcessLocalSecrets(
      providerFactory(events, []),
      extraSlot,
      api,
      {
        registry,
        cleanupDelayMilliseconds: 1_000,
        createFingerprint: GENERATION,
      },
    );

    await assert.rejects(
      () => second.reconnect!(id),
      (error: unknown) =>
        error instanceof DaytonaReconnectTerminalError &&
        error.state === "process-local-secret-slot-set-mismatch",
    );
    assert.equal(events.includes("sandbox:reconnect:sandbox-1"), false);
    assert.deepEqual(events.slice(-3), [
      "sandbox:destroy:sandbox-1",
      "secret:delete:secret-2",
      "secret:delete:secret-1",
    ]);
  });

  /**
   * THE ACCEPTANCE TEST FOR Q5, over two turns.
   *
   * Mahmoud's requirement is that a rotated Daytona model key restarts at most the daemon and never
   * rebuilds the sandbox. Everything else in this lane is machinery for that sentence, and this is
   * the test that says whether it is true.
   *
   * IT MUST BE TWO TURNS. A single-turn test would create an allocation and rotate it in the same
   * breath, which proves nothing: the interesting state is a sandbox that was PARKED under one
   * value and is picked up by a later dispatch carrying another. That second dispatch is where the
   * old code deleted the sandbox — the create fingerprint covered credential values, so a rotation
   * read as a different sandbox and the delivery port would have had nothing left to rotate.
   *
   * Both arms drive the PRODUCTION decomposition (`buildDaytonaSecretPlan` at create,
   * `desiredCredentialSetFor` at delivery) rather than hand-built slots, because the failure this
   * guards against is precisely the two vocabularies drifting apart: a delivery keyed on a slot the
   * allocation never recorded updates nothing and, without this, would say it succeeded.
   */
  describe("ACCEPTANCE: a rotated value survives a reconnect, in place (Q5)", () => {
    const requestFor = (modelKey: string, mcpKey: string): AgentRunRequest =>
      ({
        harness: "claude",
        sessionId: "s1",
        modelConnection: {
          provider: "anthropic",
          deployment: "direct",
          endpoint: { baseUrl: "https://api.anthropic.com" },
          credentialMode: "env",
          credentials: [
            {
              binding: { kind: "environment", name: "ANTHROPIC_API_KEY" },
              value: modelKey,
              usage: "opaque_http",
            },
          ],
        },
        mcpServers: [
          {
            name: "linear",
            connection: {
              type: "http",
              url: "https://mcp.linear.app/rpc",
              credentials: [
                {
                  binding: { kind: "header", name: "Authorization" },
                  value: mcpKey,
                  usage: "opaque_http",
                },
              ],
            },
            policy: { tools: { mode: "all" } },
          },
        ],
      }) as AgentRunRequest;

    /** Turn 1 creates and parks; turn 2 reconnects and hands back the port for the rotation. */
    const parkThenReconnect = async (options: {
      capabilities?: CredentialDeliveryCapabilities;
      api?: DaytonaSecretApi;
      events?: string[];
      stored?: Map<string, string>;
    }) => {
      const events = options.events ?? [];
      const stored = options.stored ?? new Map<string, string>();
      const api = options.api ?? secretApi(events, stored);
      const registry = new Map();
      const deps = {
        registry,
        cleanupDelayMilliseconds: 600_000,
        createFingerprint: GENERATION,
        ...(options.capabilities
          ? { credentialCapabilities: options.capabilities }
          : {}),
      };
      const turn1 = requestFor("model-key-1", "mcp-key-1");
      const first = daytonaWithProcessLocalSecrets(
        providerFactory(events, []),
        buildDaytonaSecretPlan(turn1),
        api,
        deps,
      );
      const sandboxId = await first.create();
      await first.pause!(sandboxId);

      // TURN 2. A new dispatch: same registry, same generation, rotated values.
      const turn2 = requestFor("model-key-2", "mcp-key-2");
      const second = daytonaWithProcessLocalSecrets(
        providerFactory(events, []),
        buildDaytonaSecretPlan(turn2),
        api,
        deps,
      );
      await second.reconnect!(sandboxId);
      return { events, stored, sandboxId, second, turn2 };
    };

    const deliver = async (
      port: ReturnType<
        ProcessLocalDaytonaSecretProvider["credentialDeliveryPort"]
      >,
      request: AgentRunRequest,
      log: CredentialDeliveryLogEvent[],
    ) => {
      assert.ok(port, "a Secrets-backed sandbox must offer a delivery port");
      const mechanism = mechanismForRotation(port.capabilities);
      return runCredentialDelivery(
        port,
        { mechanism, delta: { rotated: true, slotSetChanged: false } },
        desiredCredentialSetFor(
          request,
          computeCredentialEpoch(request).secrets,
        )!,
        (event) => log.push(event),
        // The propagation hold is real in production. Waiting it out here would buy the assertions
        // nothing and cost the suite ten seconds per arm.
        { wait: async () => {} },
      );
    };

    it("BOUNDED provider: the same sandbox survives, and the record is updated in place", async () => {
      const log: CredentialDeliveryLogEvent[] = [];
      const { events, stored, sandboxId, second, turn2 } =
        await parkThenReconnect({});

      const result = await deliver(second.credentialDeliveryPort(), turn2, log);

      assert.equal(result.ok, true);
      assert.equal(
        result.ok && result.holdTurnForMs,
        10_000,
        "the turn is held for the provider's stated propagation bound",
      );
      // THE SANDBOX IS THE SAME ONE. This is the assertion the whole lane exists for.
      assert.equal(sandboxId, "sandbox-1");
      assert.equal(events.includes("sandbox:reconnect:sandbox-1"), true);
      assert.equal(
        events.some((event) => event.startsWith("sandbox:destroy")),
        false,
        "a rotation must not destroy the sandbox",
      );
      // UPDATED IN PLACE: the same two records, no new ones, carrying the new values.
      assert.deepEqual(
        events.filter((event) => event.startsWith("secret:")),
        [
          "secret:create:model-key-1",
          "secret:create:mcp-key-1",
          "secret:update:secret-1",
          "secret:update:secret-2",
        ],
      );
      assert.deepEqual(
        [...stored.entries()],
        [
          ["secret-1", "model-key-2"],
          ["secret-2", "mcp-key-2"],
        ],
      );
      // NOTHING THE LOG MAY NOT SAY. Not a value, not a length, not a record name, not a host.
      const logged = JSON.stringify(log);
      for (const forbidden of [
        "model-key-1",
        "model-key-2",
        "mcp-key-1",
        "mcp-key-2",
        "secret-1",
        "api.anthropic.com",
      ]) {
        assert.equal(
          logged.includes(forbidden),
          false,
          `the delivery log must never carry ${forbidden}`,
        );
      }
      assert.deepEqual(
        log.map((event) => event.event),
        ["planned", "delivered"],
      );
    });

    it("UNBOUNDED provider: the delivery refuses, and the caller tears the sandbox down", async () => {
      // THE CONSTRAINT THAT SURVIVED MAHMOUD'S OVERRIDE. The ruling was that Daytona HAS a
      // propagation signal, not that the signal is optional. Take the bound away and eligibility
      // goes with it — by a capability value, with no other line changing anywhere.
      const log: CredentialDeliveryLogEvent[] = [];
      const { events, stored, sandboxId, second, turn2 } =
        await parkThenReconnect({
          capabilities: {
            ...daytonaCredentialCapabilities,
            egressPropagation: { kind: "unbounded" },
          },
        });

      const result = await deliver(second.credentialDeliveryPort(), turn2, log);

      assert.equal(result.ok, false);
      assert.equal(
        result.ok === false && result.reason,
        "mechanism-unsupported",
      );
      assert.equal(
        result.ok === false && result.teardown,
        "runtime-incompatible",
        "the failure carries the disposition, and it DELETES rather than parks",
      );
      assert.equal(
        events.some((event) => event.startsWith("secret:update")),
        false,
        "a refused delivery must not have touched a single record",
      );
      assert.deepEqual(
        [...stored.values()],
        ["model-key-1", "mcp-key-1"],
        "the stored values are untouched",
      );

      // FAIL CLOSED: the caller destroys, which is what `runtime-incompatible` means.
      await second.destroy(sandboxId);
      assert.deepEqual(events.slice(-3), [
        "sandbox:destroy:sandbox-1",
        "secret:delete:secret-2",
        "secret:delete:secret-1",
      ]);
    });

    it("a MOVED reference identity fails closed rather than reporting success", async () => {
      // The check the security review required. A moved id or placeholder means the sandbox now
      // holds a reference to a record that no longer carries the credential — a failure that would
      // otherwise surface much later, somewhere else, as an authentication error nobody could
      // trace back to a rotation.
      const events: string[] = [];
      const stored = new Map<string, string>();
      const log: CredentialDeliveryLogEvent[] = [];
      const { second, turn2 } = await parkThenReconnect({
        events,
        stored,
        api: secretApi(events, stored, { moveIdentityOnUpdate: true }),
      });

      const result = await deliver(second.credentialDeliveryPort(), turn2, log);

      assert.equal(result.ok, false);
      assert.equal(
        result.ok === false && result.reason,
        "reference-identity-moved",
      );
    });

    it("a REFUSED vault update is a failure, never a partial success", async () => {
      const events: string[] = [];
      const stored = new Map<string, string>();
      const log: CredentialDeliveryLogEvent[] = [];
      const { second, turn2 } = await parkThenReconnect({
        events,
        stored,
        api: secretApi(events, stored, { failUpdate: true }),
      });

      const result = await deliver(second.credentialDeliveryPort(), turn2, log);

      assert.equal(result.ok, false);
      assert.equal(result.ok === false && result.reason, "vault-update-failed");
      // The provider's own error text never reaches the log: provider messages echo request
      // content, which is how a value leaks into a log line by accident.
      assert.equal(
        JSON.stringify(log).includes("daytona refused the update"),
        false,
      );
    });
  });

  // Zero-candidate plans ARE a production state: buildRunPlan keeps the (empty) plan on every
  // Daytona run that hides credentials, and provider.ts wraps on plan presence, so a run whose
  // credentials are all local_use/direct still flows through this wrapper — creating no Secrets
  // but subjecting every reconnect to the create-fingerprint check. These tests pin exactly the
  // fingerprints production computes (`daytonaCreateFingerprint` over `buildDaytonaCreate`).
  describe("zero-candidate plan (hiding on, but no opaque credentials)", () => {
    const emptyPlan: DaytonaSecretPlan = { environment: {}, candidates: [] };
    const daytonaConfig = parseRunnerConfig({
      AGENTA_RUNNER_DAYTONA_API_KEY: "test-key",
    }).daytona;
    const fingerprintFor = (
      piExtEnv: Record<string, string>,
      environment: Record<string, string>,
    ) =>
      daytonaCreateFingerprint({
        create: buildDaytonaCreate(
          daytonaConfig,
          piExtEnv,
          environment,
          undefined,
        ),
      });

    it("creates no Secrets and attaches nothing, end to end", async () => {
      const events: string[] = [];
      const attachments: any[] = [];
      const provider = daytonaWithProcessLocalSecrets(
        providerFactory(events, attachments),
        emptyPlan,
        secretApi(events),
        {
          registry: new Map(),
          cleanupDelayMilliseconds: 1_000,
          createFingerprint: fingerprintFor({}, { AWS_PROFILE: "profile-a" }),
        },
      );

      const id = await provider.create();
      await provider.destroy(id);

      assert.equal(
        events.some((event) => event.startsWith("secret:")),
        false,
        "no Secret is ever created or deleted for a zero-candidate plan",
      );
      assert.deepEqual(
        attachments[0],
        {},
        "sandbox create gets no attachments",
      );
      // No http_mcp candidates: MCP servers pass through untouched.
      assert.deepEqual(provider.materializeMcpServers(undefined), undefined);
    });

    it("reconnects a parked sandbox when the create fingerprint is unchanged", async () => {
      const events: string[] = [];
      const registry = new Map();
      const fingerprint = fingerprintFor({}, { AWS_PROFILE: "profile-a" });
      const first = daytonaWithProcessLocalSecrets(
        providerFactory(events, []),
        emptyPlan,
        secretApi(events),
        {
          registry,
          cleanupDelayMilliseconds: 1_000,
          createFingerprint: fingerprint,
        },
      );
      const id = await first.create();
      const second = daytonaWithProcessLocalSecrets(
        providerFactory(events, []),
        emptyPlan,
        secretApi(events),
        {
          registry,
          cleanupDelayMilliseconds: 1_000,
          createFingerprint: fingerprint,
        },
      );

      await second.reconnect!(id);

      assert.equal(events.includes("sandbox:reconnect:sandbox-1"), true);
      assert.equal(events.includes("sandbox:destroy:sandbox-1"), false);
      assert.equal(
        events.some((event) => event.startsWith("secret:")),
        false,
      );
    });

    type FingerprintInputs = [Record<string, string>, Record<string, string>];
    const rotations: Array<{
      name: string;
      before: FingerprintInputs;
      after: FingerprintInputs;
    }> = [
      {
        name: "local_use credential rotation",
        before: [{}, { AWS_REGION: "us-east-1", AWS_PROFILE: "profile-a" }],
        after: [{}, { AWS_REGION: "us-east-1", AWS_PROFILE: "profile-b" }],
      },
      {
        name: "custom endpoint override rotation",
        before: [
          {
            AGENTA_AGENT_MODEL_PROVIDER_OVERRIDE:
              '{"baseUrl":"https://a.test"}',
          },
          { AWS_PROFILE: "profile-a" },
        ],
        after: [
          {
            AGENTA_AGENT_MODEL_PROVIDER_OVERRIDE:
              '{"baseUrl":"https://b.test"}',
          },
          { AWS_PROFILE: "profile-a" },
        ],
      },
    ];
    for (const { name, before, after } of rotations) {
      it(`deletes instead of reconnecting after ${name}`, async () => {
        const events: string[] = [];
        const registry = new Map();
        const first = daytonaWithProcessLocalSecrets(
          providerFactory(events, []),
          emptyPlan,
          secretApi(events),
          {
            registry,
            cleanupDelayMilliseconds: 1_000,
            createFingerprint: fingerprintFor(...before),
          },
        );
        const id = await first.create();
        const second = daytonaWithProcessLocalSecrets(
          providerFactory(events, []),
          emptyPlan,
          secretApi(events),
          {
            registry,
            cleanupDelayMilliseconds: 1_000,
            createFingerprint: fingerprintFor(...after),
          },
        );

        await assert.rejects(
          () => second.reconnect!(id),
          (error: unknown) =>
            error instanceof DaytonaReconnectTerminalError &&
            error.state === "process-local-secret-allocation-mismatch",
        );
        assert.equal(events.includes("sandbox:reconnect:sandbox-1"), false);
        assert.equal(events.at(-1), "sandbox:destroy:sandbox-1");
        assert.equal(
          events.some((event) => event.startsWith("secret:")),
          false,
        );
      });
    }
  });
});

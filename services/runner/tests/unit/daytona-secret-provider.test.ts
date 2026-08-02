import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";

import type { McpServerConfig } from "../../src/protocol.ts";
import {
  daytonaWithProcessLocalSecrets,
  type DaytonaProviderLike,
} from "../../src/engines/sandbox_agent/daytona-secret-provider.ts";
import { DaytonaReconnectTerminalError } from "../../src/engines/sandbox_agent/daytona-provider.ts";
import type { DaytonaSecretPlan } from "../../src/engines/sandbox_agent/daytona-secret-plan.ts";
import type { DaytonaSecretApi } from "../../src/engines/sandbox_agent/daytona-secrets.ts";
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

function secretApi(events: string[]): DaytonaSecretApi {
  let count = 0;
  return {
    async create(input) {
      count += 1;
      events.push(`secret:create:${input.value}`);
      return {
        id: `secret-${count}`,
        name: input.name,
        placeholder: `dtn_secret_${count}`,
        hosts: input.hosts,
      };
    },
    async delete(id) {
      events.push(`secret:delete:${id}`);
    },
  };
}

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
      { registry: new Map(), cleanupDelayMilliseconds: 1_000 },
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
      { registry: new Map(), cleanupDelayMilliseconds: 1_000 },
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
      { registry: new Map(), cleanupDelayMilliseconds: 1_000 },
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
      { registry, cleanupDelayMilliseconds: 1_000 },
    );
    const id = await first.create();
    await first.pause!(id);

    const second = daytonaWithProcessLocalSecrets(
      providerFactory(events, []),
      plan,
      api,
      { registry, cleanupDelayMilliseconds: 1_000 },
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
      { registry, cleanupDelayMilliseconds: 1_000 },
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
      { registry, cleanupDelayMilliseconds: 1_000 },
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
      { registry: new Map(), cleanupDelayMilliseconds: 1_000 },
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
      { registry: new Map(), cleanupDelayMilliseconds: 1_000 },
    );
    await assert.rejects(
      () => provider.reconnect!("old-sandbox"),
      (error: unknown) =>
        error instanceof DaytonaReconnectTerminalError &&
        error.state === "missing-process-local-secret-allocation",
    );
    assert.deepEqual(events, ["sandbox:destroy:old-sandbox"]);
  });

  it("deletes the old sandbox and Secrets instead of reconnecting rotated credentials", async () => {
    const events: string[] = [];
    const registry = new Map();
    const api = secretApi(events);
    const first = daytonaWithProcessLocalSecrets(
      providerFactory(events, []),
      plan,
      api,
      { registry, cleanupDelayMilliseconds: 1_000 },
    );
    const id = await first.create();
    const rotated: DaytonaSecretPlan = {
      ...plan,
      candidates: plan.candidates.map((candidate, index) =>
        index === 0
          ? { ...candidate, value: "rotated-model-plaintext" }
          : candidate,
      ),
    };
    const second = daytonaWithProcessLocalSecrets(
      providerFactory(events, []),
      rotated,
      api,
      { registry, cleanupDelayMilliseconds: 1_000 },
    );

    await assert.rejects(
      () => second.reconnect!(id),
      (error: unknown) =>
        error instanceof DaytonaReconnectTerminalError &&
        error.state === "process-local-secret-allocation-mismatch",
    );
    assert.equal(events.includes("sandbox:reconnect:sandbox-1"), false);
    assert.deepEqual(events.slice(-3), [
      "sandbox:destroy:sandbox-1",
      "secret:delete:secret-2",
      "secret:delete:secret-1",
    ]);
  });

  // Zero-candidate plans ARE a production state: buildRunPlan keeps the (empty) plan on every
  // flag-on Daytona run and provider.ts wraps unconditionally on plan presence, so a run whose
  // credentials are all local_use/direct still flows through this wrapper — creating no Secrets
  // but subjecting every reconnect to the create-fingerprint check. These tests pin exactly the
  // fingerprints production computes (`daytonaCreateFingerprint` over `buildDaytonaCreate`).
  describe("zero-candidate plan (flag-on run with no opaque credentials)", () => {
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
        secretPlan: emptyPlan,
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

/**
 * Unit tests for the Layer 2 network policy -> Daytona create field mapping, the stop/delete
 * lifecycle intervals (now sourced from the typed runner config), and the provider factory's
 * enabled-provider gate.
 *
 * The mapping is tested directly because the real `daytona()` provider closes over its create
 * object and constructs a Daytona client, so it cannot be inspected through `buildSandboxProvider`.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-provider.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  buildDaytonaCreate,
  buildSandboxProvider,
  daytonaCreateFingerprint,
  daytonaNetworkFields,
} from "../../src/engines/sandbox_agent/provider.ts";
import { buildDaytonaSecretPlan } from "../../src/engines/sandbox_agent/daytona-secret-plan.ts";
import {
  DAYTONA_PI_COMMAND,
  DAYTONA_PI_DIR,
} from "../../src/engines/sandbox_agent/daytona.ts";
import {
  DEFAULT_DAYTONA_AUTOSTOP_MINUTES,
  DEFAULT_DAYTONA_AUTODELETE_MINUTES,
  DEFAULT_DAYTONA_SNAPSHOT,
  parseRunnerConfig,
  type RunnerConfig,
  type RunnerDaytonaConfig,
} from "../../src/config/runner-config.ts";

/** A typed Daytona config with the given overrides on top of parsed defaults. */
function daytonaConfig(
  overrides: Partial<RunnerDaytonaConfig> = {},
): RunnerDaytonaConfig {
  const base = parseRunnerConfig({}).daytona;
  return { ...base, ...overrides };
}

/** A full runner config with a given enabled set + Daytona overrides (bypasses process.env). */
function runnerConfig(
  enabled: string,
  daytona: Partial<RunnerDaytonaConfig> = {},
): RunnerConfig {
  const config = parseRunnerConfig({
    AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: enabled,
    AGENTA_RUNNER_DAYTONA_API_KEY: "test-key",
  });
  return { ...config, daytona: { ...config.daytona, ...daytona } };
}

describe("daytonaNetworkFields", () => {
  it("blocks all egress for network:off", () => {
    assert.deepEqual(
      daytonaNetworkFields({ network: { mode: "off" }, enforcement: "strict" }),
      { networkBlockAll: true },
    );
  });

  it("renders a non-empty allowlist as a comma-separated CIDR string", () => {
    assert.deepEqual(
      daytonaNetworkFields({
        network: { mode: "allowlist", allowlist: ["a", "b"] },
        enforcement: "strict",
      }),
      { networkAllowList: "a,b" },
    );
  });

  it("blocks all egress for an empty allowlist (allow zero ranges == allow nothing)", () => {
    assert.deepEqual(
      daytonaNetworkFields({
        network: { mode: "allowlist", allowlist: [] },
        enforcement: "strict",
      }),
      { networkBlockAll: true },
    );
  });

  it("leaves the sandbox default-open for network:on", () => {
    assert.deepEqual(
      daytonaNetworkFields({ network: { mode: "on" }, enforcement: "strict" }),
      {},
    );
  });

  it("leaves the sandbox default-open when no policy is set", () => {
    assert.deepEqual(daytonaNetworkFields(undefined), {});
  });
});

describe("daytonaCreateFingerprint", () => {
  it("changes for local_use values and Pi custom endpoint routing", () => {
    const fingerprint = (
      piExtEnv: Record<string, string>,
      environment: Record<string, string>,
    ) =>
      daytonaCreateFingerprint({
        image: "runner-image",
        create: buildDaytonaCreate(
          daytonaConfig(),
          piExtEnv,
          environment,
          undefined,
        ),
      });

    const base = fingerprint(
      { AGENTA_AGENT_MODEL_PROVIDER_OVERRIDE: '{"baseUrl":"https://a.test"}' },
      { AWS_PROFILE: "profile-a" },
    );
    assert.notEqual(
      base,
      fingerprint(
        {
          AGENTA_AGENT_MODEL_PROVIDER_OVERRIDE: '{"baseUrl":"https://a.test"}',
        },
        { AWS_PROFILE: "profile-b" },
      ),
    );
    assert.notEqual(
      base,
      fingerprint(
        {
          AGENTA_AGENT_MODEL_PROVIDER_OVERRIDE: '{"baseUrl":"https://b.test"}',
        },
        { AWS_PROFILE: "profile-a" },
      ),
    );
  });

  it("does NOT change when a hidden credential's VALUE rotates", () => {
    // THE CREATION-IDENTITY SPLIT (lifecycle migration, step 9), pinned at the production path.
    //
    // This is the assertion the whole Q5 route rests on. While credential material was inside the
    // create fingerprint, a rotated model key made a parked sandbox read as a DIFFERENT sandbox,
    // so the reconnect comparison deleted it — and a credential-delivery port that rotates a
    // sandbox which no longer exists delivers nothing. An opaque value is hidden behind a Secret
    // reference, so it changes nothing about how the sandbox was created; only the value behind
    // the placeholder moves, and the epoch owns that.
    const fingerprintForKey = (key: string) => {
      const plan = buildDaytonaSecretPlan({
        modelConnection: {
          provider: "anthropic",
          deployment: "direct",
          endpoint: { baseUrl: "https://api.anthropic.com" },
          credentialMode: "env",
          credentials: [
            {
              binding: { kind: "environment", name: "ANTHROPIC_API_KEY" },
              value: key,
              usage: "opaque_http",
            },
          ],
        },
      });
      return daytonaCreateFingerprint({
        image: "runner-image",
        create: buildDaytonaCreate(
          daytonaConfig(),
          {},
          plan.environment,
          undefined,
        ),
      });
    };

    assert.equal(
      fingerprintForKey("sk-ant-old"),
      fingerprintForKey("sk-ant-new"),
    );
  });
});

describe("buildDaytonaCreate (lifecycle + artifact on the create object)", () => {
  it("carries Secret names separately and never puts opaque plaintext in env/config", () => {
    const opaque = "marker-opaque-plaintext";
    const plan = buildDaytonaSecretPlan({
      modelConnection: {
        provider: "anthropic",
        deployment: "direct",
        endpoint: { baseUrl: "https://api.anthropic.com" },
        credentialMode: "env",
        credentials: [
          {
            binding: { kind: "environment", name: "ANTHROPIC_API_KEY" },
            value: opaque,
            usage: "opaque_http",
          },
        ],
      },
    });
    const create = buildDaytonaCreate(
      daytonaConfig(),
      { PUBLIC_EXTENSION_CONFIG: "enabled" },
      { ...plan.environment, AWS_REGION: "us-east-1" },
      undefined,
      { ANTHROPIC_API_KEY: "agenta_random_secret_name" },
    );
    assert.deepEqual(create.secrets, {
      ANTHROPIC_API_KEY: "agenta_random_secret_name",
    });
    assert.deepEqual(create.envVars, {
      PI_CODING_AGENT_DIR: DAYTONA_PI_DIR,
      PUBLIC_EXTENSION_CONFIG: "enabled",
      AWS_REGION: "us-east-1",
      PI_ACP_PI_COMMAND: DAYTONA_PI_COMMAND,
    });
    assert.equal(JSON.stringify(create).includes(opaque), false);
  });

  it("omits the secrets field when no Secret attachments exist", () => {
    const create = buildDaytonaCreate(daytonaConfig(), {}, {}, undefined, {});
    assert.equal("secrets" in create, false);
  });

  it("carries stop and delete intervals without auto-archive by default", () => {
    const create = buildDaytonaCreate(daytonaConfig(), {}, {}, undefined);
    // ephemeral:false so a stop PARKS (warm) instead of deleting; the intervals are the reapers.
    assert.equal(create.ephemeral, false);
    assert.equal(create.autoStopInterval, DEFAULT_DAYTONA_AUTOSTOP_MINUTES);
    assert.equal("autoArchiveInterval" in create, false);
    assert.equal(create.autoDeleteInterval, DEFAULT_DAYTONA_AUTODELETE_MINUTES);
  });

  it("falls back to the runner's pinned default snapshot when none is configured", () => {
    const create = buildDaytonaCreate(daytonaConfig(), {}, {}, undefined);
    assert.equal(create.snapshot, DEFAULT_DAYTONA_SNAPSHOT);
  });

  it("uses the configured snapshot when set", () => {
    const create = buildDaytonaCreate(
      daytonaConfig({ snapshot: "daytona-small" }),
      {},
      {},
      undefined,
    );
    assert.equal(create.snapshot, "daytona-small");
  });

  it("omits the snapshot when an image is configured (image via the top-level option)", () => {
    const create = buildDaytonaCreate(
      daytonaConfig({ image: "custom:latest", snapshot: undefined }),
      {},
      {},
      undefined,
    );
    assert.equal("snapshot" in create, false);
  });

  it("carries the config-supplied lifecycle intervals", () => {
    const create = buildDaytonaCreate(
      daytonaConfig({ autostopMinutes: 5, autodeleteMinutes: 120 }),
      {},
      {},
      undefined,
    );
    assert.equal(create.autoStopInterval, 5);
    assert.equal("autoArchiveInterval" in create, false);
    assert.equal(create.autoDeleteInterval, 120);
    assert.equal(create.ephemeral, false);
  });
});

describe("buildSandboxProvider (enabled-provider gate + unknown-id refusal)", () => {
  const localOnly = parseRunnerConfig({});

  it("throws for an unrecognized sandbox id instead of falling back to local", () => {
    assert.throws(
      () =>
        buildSandboxProvider(
          "typo-sandbox",
          {},
          undefined,
          {},
          {},
          undefined,
          undefined,
          localOnly,
        ),
      /Unknown sandbox id 'typo-sandbox'/,
    );
  });

  it("resolves 'local' without refusing", () => {
    assert.doesNotThrow(() =>
      buildSandboxProvider(
        "local",
        {},
        undefined,
        {},
        {},
        undefined,
        undefined,
        localOnly,
      ),
    );
  });

  it("refuses 'daytona' when it is not enabled on this deployment", () => {
    assert.throws(
      () =>
        buildSandboxProvider(
          "daytona",
          {},
          undefined,
          {},
          {},
          undefined,
          undefined,
          localOnly,
        ),
      /not enabled on this deployment/,
    );
  });

  it("builds the 'daytona' provider when enabled and configured", () => {
    assert.doesNotThrow(() =>
      buildSandboxProvider(
        "daytona",
        {},
        undefined,
        {},
        {},
        undefined,
        undefined,
        runnerConfig("local,daytona"),
      ),
    );
  });

  it("wraps Daytona with process-local Secrets for EVERY plan-bearing run, zero candidates included", () => {
    const plan = buildDaytonaSecretPlan({
      modelConnection: {
        provider: "anthropic",
        deployment: "direct",
        endpoint: { baseUrl: "https://api.anthropic.com" },
        credentialMode: "env",
        credentials: [
          {
            binding: { kind: "environment", name: "ANTHROPIC_API_KEY" },
            value: "opaque",
            usage: "opaque_http",
          },
        ],
      },
    });
    const build = (secretPlan?: typeof plan) =>
      buildSandboxProvider(
        "daytona",
        {},
        undefined,
        {},
        {},
        undefined,
        secretPlan,
        runnerConfig("local,daytona"),
      ) as { materializeMcpServers?: unknown };

    // A run with hiding switched off never carries a plan (buildRunPlan builds one only while
    // hiding is on), and the plain provider is unchanged from the pre-feature runner.
    assert.equal(
      typeof build(undefined).materializeMcpServers,
      "undefined",
      "no plan stays on the plain provider",
    );

    // Hiding is ON by default, so a plan-bearing run wraps without any variable being set.
    assert.equal(
      typeof build(plan).materializeMcpServers,
      "function",
      "the default attaches the Secret wrapper",
    );
    // Zero candidates must ALSO wrap: buildRunPlan keeps the empty plan on every Daytona run
    // that hides credentials, precisely so the wrapper's create-fingerprint check governs
    // reconnects (a rotated local_use credential forces a rebuild, never a stale plaintext
    // reconnect).
    assert.equal(
      typeof build(buildDaytonaSecretPlan({})).materializeMcpServers,
      "function",
      "zero candidates still attaches the Secret wrapper",
    );

    try {
      // Defense-in-depth: a direct caller handing a candidate-bearing plan while hiding is
      // switched off is refused. That plan's environment already dropped the opaque values, so
      // proceeding unwrapped would silently run without credentials.
      process.env.AGENTA_RUNNER_DAYTONA_OPAQUE_SECRETS = "off";
      assert.throws(() => build(plan), /no plaintext fallback/);
    } finally {
      delete process.env.AGENTA_RUNNER_DAYTONA_OPAQUE_SECRETS;
    }
  });
});

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
  daytonaNetworkFields,
} from "../../src/engines/sandbox_agent/provider.ts";
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

describe("buildDaytonaCreate (lifecycle + artifact on the create object)", () => {
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
          localOnly,
        ),
      /Unknown sandbox id 'typo-sandbox'/,
    );
  });

  it("resolves 'local' without refusing", () => {
    assert.doesNotThrow(() =>
      buildSandboxProvider("local", {}, undefined, {}, {}, undefined, localOnly),
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
        runnerConfig("local,daytona"),
      ),
    );
  });
});

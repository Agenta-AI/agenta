/**
 * Unit tests for the Layer 2 network policy -> Daytona create field mapping and the
 * stop and delete lifecycle intervals.
 *
 * The mapping is tested directly because the real `daytona()` provider closes over its
 * create object and constructs a Daytona client (needs API-key env), so it cannot be
 * inspected through `buildSandboxProvider`. The orchestration test covers that the run
 * plan's `sandboxPermission` reaches `buildSandboxProvider` as the new argument.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-provider.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  DEFAULT_DAYTONA_AUTOSTOP_MINUTES,
  DEFAULT_DAYTONA_AUTODELETE_MINUTES,
  buildDaytonaCreate,
  buildSandboxProvider,
  daytonaCreateFingerprint,
  daytonaAutoStopMinutes,
  daytonaAutoDeleteMinutes,
  daytonaNetworkFields,
} from "../../src/engines/sandbox_agent/provider.ts";
import { buildDaytonaSecretPlan } from "../../src/engines/sandbox_agent/daytona-secret-plan.ts";

const LIFECYCLE_ENVS = ["DAYTONA_AUTOSTOP", "DAYTONA_AUTODELETE"];
const previous = Object.fromEntries(
  LIFECYCLE_ENVS.map((k) => [k, process.env[k]]),
);

afterEach(() => {
  for (const k of LIFECYCLE_ENVS) {
    if (previous[k] === undefined) delete process.env[k];
    else process.env[k] = previous[k];
  }
});

const AUTOSTOP_ENV = "DAYTONA_AUTOSTOP";

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
  const secretPlan = {
    environment: {},
    candidates: [],
  };

  it("changes for local_use values and Pi custom endpoint routing", () => {
    const fingerprint = (
      piExtEnv: Record<string, string>,
      environment: Record<string, string>,
    ) =>
      daytonaCreateFingerprint({
        image: "runner-image",
        create: buildDaytonaCreate(piExtEnv, environment, undefined),
        secretPlan,
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
});

describe("daytona lifecycle interval parsers", () => {
  it("use the env value when it is a positive integer", () => {
    assert.equal(daytonaAutoStopMinutes("30"), 30);
    assert.equal(daytonaAutoDeleteMinutes("2880"), 2880);
  });

  it("floor a fractional env value to whole minutes", () => {
    assert.equal(daytonaAutoStopMinutes("12.9"), 12);
  });

  it("fall back to their defaults when the env is unset", () => {
    assert.equal(
      daytonaAutoStopMinutes(undefined),
      DEFAULT_DAYTONA_AUTOSTOP_MINUTES,
    );
    assert.equal(
      daytonaAutoDeleteMinutes(undefined),
      DEFAULT_DAYTONA_AUTODELETE_MINUTES,
    );
  });

  it("fall back to the default for a non-numeric env value", () => {
    assert.equal(
      daytonaAutoStopMinutes("soon"),
      DEFAULT_DAYTONA_AUTOSTOP_MINUTES,
    );
  });

  it("clamp 0 and negatives to the default (a disabled reaper would leak)", () => {
    assert.equal(daytonaAutoStopMinutes("0"), DEFAULT_DAYTONA_AUTOSTOP_MINUTES);
    assert.equal(
      daytonaAutoDeleteMinutes("-5"),
      DEFAULT_DAYTONA_AUTODELETE_MINUTES,
    );
  });

  it("orders the defaults stop before delete", () => {
    assert.ok(DEFAULT_DAYTONA_AUTOSTOP_MINUTES >= 1);
    assert.ok(
      DEFAULT_DAYTONA_AUTOSTOP_MINUTES < DEFAULT_DAYTONA_AUTODELETE_MINUTES,
    );
  });
});

describe("buildDaytonaCreate (lifecycle on the create object)", () => {
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
      { PUBLIC_EXTENSION_CONFIG: "enabled" },
      { ...plan.environment, AWS_REGION: "us-east-1" },
      undefined,
      { ANTHROPIC_API_KEY: "agenta_random_secret_name" },
    );
    assert.deepEqual(create.secrets, {
      ANTHROPIC_API_KEY: "agenta_random_secret_name",
    });
    assert.deepEqual(create.envVars, {
      PI_CODING_AGENT_DIR: "/home/sandbox/.pi/agent",
      PUBLIC_EXTENSION_CONFIG: "enabled",
      AWS_REGION: "us-east-1",
      PI_ACP_PI_COMMAND: "/home/sandbox/.agenta-pi/node_modules/.bin/pi",
    });
    assert.equal(JSON.stringify(create).includes(opaque), false);
  });

  it("carries stop and delete intervals without auto-archive by default", () => {
    for (const k of LIFECYCLE_ENVS) delete process.env[k];
    const create = buildDaytonaCreate({}, {}, undefined);
    // ephemeral:false so a stop PARKS (warm) instead of deleting; the intervals are the reapers.
    assert.equal(create.ephemeral, false);
    assert.equal(create.autoStopInterval, DEFAULT_DAYTONA_AUTOSTOP_MINUTES);
    assert.equal("autoArchiveInterval" in create, false);
    assert.equal(create.autoDeleteInterval, DEFAULT_DAYTONA_AUTODELETE_MINUTES);
  });

  it("prefers the agent snapshot var over the shared code-evaluator one", () => {
    process.env["DAYTONA_SNAPSHOT"] = "daytona-small";
    const shared = buildDaytonaCreate({}, {}, undefined);
    assert.equal(shared.snapshot, "daytona-small");
    process.env["DAYTONA_SNAPSHOT_AGENT"] = "agenta-sandbox-pi";
    const own = buildDaytonaCreate({}, {}, undefined);
    assert.equal(own.snapshot, "agenta-sandbox-pi");
    delete process.env["DAYTONA_SNAPSHOT"];
    delete process.env["DAYTONA_SNAPSHOT_AGENT"];
  });

  it("carries the env-configured intervals", () => {
    process.env["DAYTONA_AUTOSTOP"] = "5";
    process.env["DAYTONA_AUTODELETE"] = "120";
    const create = buildDaytonaCreate({}, {}, undefined);
    assert.equal(create.autoStopInterval, 5);
    assert.equal("autoArchiveInterval" in create, false);
    assert.equal(create.autoDeleteInterval, 120);
    assert.equal(create.ephemeral, false);
  });
});

describe("buildSandboxProvider (unknown sandbox id must refuse, not run local)", () => {
  it("throws for an unrecognized sandbox id instead of falling back to local", () => {
    assert.throws(
      () => buildSandboxProvider("typo-sandbox", {}, undefined, {}, {}),
      /Unknown sandbox id 'typo-sandbox'/,
    );
  });

  it("still resolves 'local' without refusing (no widening/narrowing of the known set)", () => {
    assert.doesNotThrow(() =>
      buildSandboxProvider("local", {}, undefined, {}, {}),
    );
  });

  it("'daytona' reaches the daytona() constructor, not the unknown-id refusal", () => {
    // No DAYTONA_* credentials in this test env, so daytona() itself throws — proving the
    // known-id branch was taken (the unknown-id error is never a credential error).
    assert.throws(
      () => buildSandboxProvider("daytona", {}, undefined, {}, {}),
      (err: unknown) =>
        err instanceof Error && !/Unknown sandbox id/.test(err.message),
    );
  });
});

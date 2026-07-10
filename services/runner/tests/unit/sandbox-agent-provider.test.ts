/**
 * Unit tests for the Layer 2 network policy -> Daytona create field mapping and the
 * five-state lifecycle intervals.
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
  DEFAULT_DAYTONA_AUTOARCHIVE_MINUTES,
  DEFAULT_DAYTONA_AUTODELETE_MINUTES,
  buildDaytonaCreate,
  buildSandboxProvider,
  daytonaAutoStopMinutes,
  daytonaAutoArchiveMinutes,
  daytonaAutoDeleteMinutes,
  daytonaNetworkFields,
} from "../../src/engines/sandbox_agent/provider.ts";

const LIFECYCLE_ENVS = ["DAYTONA_AUTOSTOP", "DAYTONA_AUTOARCHIVE", "DAYTONA_AUTODELETE"];
const previous = Object.fromEntries(LIFECYCLE_ENVS.map((k) => [k, process.env[k]]));

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

describe("daytona lifecycle interval parsers", () => {
  it("use the env value when it is a positive integer", () => {
    assert.equal(daytonaAutoStopMinutes("30"), 30);
    assert.equal(daytonaAutoArchiveMinutes("90"), 90);
    assert.equal(daytonaAutoDeleteMinutes("2880"), 2880);
  });

  it("floor a fractional env value to whole minutes", () => {
    assert.equal(daytonaAutoStopMinutes("12.9"), 12);
  });

  it("fall back to their defaults when the env is unset", () => {
    assert.equal(daytonaAutoStopMinutes(undefined), DEFAULT_DAYTONA_AUTOSTOP_MINUTES);
    assert.equal(daytonaAutoArchiveMinutes(undefined), DEFAULT_DAYTONA_AUTOARCHIVE_MINUTES);
    assert.equal(daytonaAutoDeleteMinutes(undefined), DEFAULT_DAYTONA_AUTODELETE_MINUTES);
  });

  it("fall back to the default for a non-numeric env value", () => {
    assert.equal(daytonaAutoStopMinutes("soon"), DEFAULT_DAYTONA_AUTOSTOP_MINUTES);
  });

  it("clamp 0 and negatives to the default (a disabled reaper would leak)", () => {
    assert.equal(daytonaAutoStopMinutes("0"), DEFAULT_DAYTONA_AUTOSTOP_MINUTES);
    assert.equal(daytonaAutoDeleteMinutes("-5"), DEFAULT_DAYTONA_AUTODELETE_MINUTES);
  });

  it("order the defaults stop < archive < delete (states advance, never regress)", () => {
    assert.ok(DEFAULT_DAYTONA_AUTOSTOP_MINUTES >= 1);
    assert.ok(DEFAULT_DAYTONA_AUTOSTOP_MINUTES < DEFAULT_DAYTONA_AUTOARCHIVE_MINUTES);
    assert.ok(DEFAULT_DAYTONA_AUTOARCHIVE_MINUTES < DEFAULT_DAYTONA_AUTODELETE_MINUTES);
  });
});

describe("buildDaytonaCreate (five-state lifecycle on the create object)", () => {
  it("carries the three lifecycle intervals and ephemeral:false by default", () => {
    for (const k of LIFECYCLE_ENVS) delete process.env[k];
    const create = buildDaytonaCreate({}, {}, undefined);
    // ephemeral:false so a stop PARKS (warm) instead of deleting; the intervals are the reapers.
    assert.equal(create.ephemeral, false);
    assert.equal(create.autoStopInterval, DEFAULT_DAYTONA_AUTOSTOP_MINUTES);
    assert.equal(create.autoArchiveInterval, DEFAULT_DAYTONA_AUTOARCHIVE_MINUTES);
    assert.equal(create.autoDeleteInterval, DEFAULT_DAYTONA_AUTODELETE_MINUTES);
  });

  it("carries the env-configured intervals", () => {
    process.env["DAYTONA_AUTOSTOP"] = "5";
    process.env["DAYTONA_AUTOARCHIVE"] = "30";
    process.env["DAYTONA_AUTODELETE"] = "120";
    const create = buildDaytonaCreate({}, {}, undefined);
    assert.equal(create.autoStopInterval, 5);
    assert.equal(create.autoArchiveInterval, 30);
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

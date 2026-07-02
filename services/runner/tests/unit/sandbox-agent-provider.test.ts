/**
 * Unit tests for the Layer 2 network policy -> Daytona create field mapping (S1b).
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
  buildDaytonaCreate,
  daytonaAutoStopMinutes,
  daytonaNetworkFields,
} from "../../src/engines/sandbox_agent/provider.ts";

const AUTOSTOP_ENV = "DAYTONA_AUTOSTOP";
const previousAutoStop = process.env[AUTOSTOP_ENV];

afterEach(() => {
  if (previousAutoStop === undefined) delete process.env[AUTOSTOP_ENV];
  else process.env[AUTOSTOP_ENV] = previousAutoStop;
});

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

describe("daytonaAutoStopMinutes (leak backstop)", () => {
  it("uses the env value when it is a positive integer", () => {
    assert.equal(daytonaAutoStopMinutes("30"), 30);
  });

  it("floors a fractional env value to whole minutes", () => {
    assert.equal(daytonaAutoStopMinutes("12.9"), 12);
  });

  it("falls back to the default when the env is unset", () => {
    assert.equal(
      daytonaAutoStopMinutes(undefined),
      DEFAULT_DAYTONA_AUTOSTOP_MINUTES,
    );
  });

  it("falls back to the default for a non-numeric env value", () => {
    assert.equal(
      daytonaAutoStopMinutes("soon"),
      DEFAULT_DAYTONA_AUTOSTOP_MINUTES,
    );
  });

  it("clamps 0 to the default so auto-stop is never re-disabled (the leak)", () => {
    // 0 would mean auto-stop OFF, which pairs with ephemeral to leak forever — exactly the bug.
    assert.equal(daytonaAutoStopMinutes("0"), DEFAULT_DAYTONA_AUTOSTOP_MINUTES);
  });

  it("clamps a negative env value to the default", () => {
    assert.equal(
      daytonaAutoStopMinutes("-5"),
      DEFAULT_DAYTONA_AUTOSTOP_MINUTES,
    );
  });

  it("the default is a positive backstop (auto-stop stays ON)", () => {
    assert.ok(DEFAULT_DAYTONA_AUTOSTOP_MINUTES >= 1);
  });
});

describe("buildDaytonaCreate (leak backstop on the create object)", () => {
  it("carries a positive auto-stop interval + ephemeral by default (self-reaps a leak)", () => {
    delete process.env[AUTOSTOP_ENV];
    const create = buildDaytonaCreate("pi", {}, {}, undefined);
    // ephemeral auto-deletes ON STOP; a non-zero auto-stop is what makes a leaked sandbox stop.
    assert.equal(create.ephemeral, true);
    assert.equal(create.autoStopInterval, DEFAULT_DAYTONA_AUTOSTOP_MINUTES);
    assert.ok(
      (create.autoStopInterval as number) > 0,
      "auto-stop must be > 0 or the ephemeral auto-delete never fires (the leak)",
    );
  });

  it("carries the env-configured auto-stop interval", () => {
    process.env[AUTOSTOP_ENV] = "42";
    const create = buildDaytonaCreate("pi", {}, {}, undefined);
    assert.equal(create.autoStopInterval, 42);
    assert.equal(create.ephemeral, true);
  });
});

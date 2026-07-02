/**
 * Unit tests for the E2B provider options and leak-backstop logic.
 *
 * `buildE2BCreate` is tested directly because the real `e2b()` provider constructs an
 * E2B client (needs E2B_API_KEY), so it cannot be inspected through `buildSandboxProvider`.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-e2b-provider.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  DEFAULT_E2B_TIMEOUT_MS,
  buildE2BCreate,
  e2bTimeoutMs,
} from "../../src/engines/sandbox_agent/provider.ts";

const TIMEOUT_ENV = "E2B_TIMEOUT_MS";
const previousTimeout = process.env[TIMEOUT_ENV];

afterEach(() => {
  if (previousTimeout === undefined) delete process.env[TIMEOUT_ENV];
  else process.env[TIMEOUT_ENV] = previousTimeout;
});

describe("e2bTimeoutMs (leak backstop)", () => {
  it("uses the env value when it is a positive integer", () => {
    assert.equal(e2bTimeoutMs("60000"), 60000);
  });

  it("floors a fractional env value", () => {
    assert.equal(e2bTimeoutMs("12000.9"), 12000);
  });

  it("falls back to the default when the env is unset", () => {
    assert.equal(e2bTimeoutMs(undefined), DEFAULT_E2B_TIMEOUT_MS);
  });

  it("falls back to the default for a non-numeric env value", () => {
    assert.equal(e2bTimeoutMs("soon"), DEFAULT_E2B_TIMEOUT_MS);
  });

  it("clamps 0 to the default so the backstop is never disabled", () => {
    assert.equal(e2bTimeoutMs("0"), DEFAULT_E2B_TIMEOUT_MS);
  });

  it("clamps a negative value to the default", () => {
    assert.equal(e2bTimeoutMs("-5000"), DEFAULT_E2B_TIMEOUT_MS);
  });

  it("the default is a positive backstop (never zero)", () => {
    assert.ok(DEFAULT_E2B_TIMEOUT_MS >= 1);
  });
});

describe("buildE2BCreate (leak backstop on the create object)", () => {
  it("carries a positive timeoutMs + autoPause by default (self-reaps a leak)", () => {
    delete process.env[TIMEOUT_ENV];
    const create = buildE2BCreate({}, {});
    assert.equal(create.timeoutMs, DEFAULT_E2B_TIMEOUT_MS);
    assert.ok(create.timeoutMs > 0, "timeoutMs must be > 0 or the sandbox never self-reaps on process KILL");
    assert.equal(create.autoPause, true);
  });

  it("carries the env-configured timeoutMs", () => {
    process.env[TIMEOUT_ENV] = "120000";
    const create = buildE2BCreate({}, {});
    assert.equal(create.timeoutMs, 120000);
    assert.equal(create.autoPause, true);
  });

  it("merges piExtEnv and secrets into envs", () => {
    const create = buildE2BCreate(
      { TRACEPARENT: "trace-id", OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://otel" },
      { OPENAI_API_KEY: "sk-test" },
    );
    assert.deepEqual(create.envs, {
      TRACEPARENT: "trace-id",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://otel",
      OPENAI_API_KEY: "sk-test",
    });
  });

  it("produces empty envs when no env or secrets are passed", () => {
    const create = buildE2BCreate({}, {});
    assert.deepEqual(create.envs, {});
  });
});

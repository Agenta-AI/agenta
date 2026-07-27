/**
 * Unit tests for the typed runner configuration parser (the single parse-and-validate boundary).
 * Mirrors the API-side parser cases (qa.md section 2) so both readers agree on every input.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/runner-config.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  DEFAULT_DAYTONA_AUTOSTOP_MINUTES,
  DEFAULT_DAYTONA_AUTODELETE_MINUTES,
  RunnerConfigError,
  parseRunnerConfig,
} from "../../src/config/runner-config.ts";

/** Parse with only the given keys set (a valid Daytona key is supplied when daytona is enabled). */
function parse(env: Record<string, string | undefined>) {
  return parseRunnerConfig(env);
}

describe("enabled providers", () => {
  it("unset gives exactly local", () => {
    assert.deepEqual(parse({}).providers.enabled, ["local"]);
  });

  it("explicit local,daytona is order-independent set equality", () => {
    const a = parse({
      AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "local,daytona",
      AGENTA_RUNNER_DAYTONA_API_KEY: "k",
    }).providers.enabled;
    const b = parse({
      AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "daytona,local",
      AGENTA_RUNNER_DAYTONA_API_KEY: "k",
    }).providers.enabled;
    assert.deepEqual([...a].sort(), [...b].sort());
  });

  it("normalizes leading/trailing whitespace and case", () => {
    assert.deepEqual(
      parse({
        AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "  LOCAL , Daytona ",
        AGENTA_RUNNER_DAYTONA_API_KEY: "k",
      }).providers.enabled,
      ["local", "daytona"],
    );
  });

  it("duplicate ids fail", () => {
    assert.throws(
      () => parse({ AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "local,local" }),
      RunnerConfigError,
    );
  });

  it("unknown ids fail", () => {
    assert.throws(
      () => parse({ AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "local,e2b" }),
      RunnerConfigError,
    );
  });

  it("explicit empty string fails", () => {
    assert.throws(
      () => parse({ AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "" }),
      RunnerConfigError,
    );
    assert.throws(
      () => parse({ AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "   " }),
      RunnerConfigError,
    );
  });
});

describe("default provider", () => {
  it("unset gives local", () => {
    assert.equal(parse({}).providers.default, "local");
  });

  it("respects an explicit default within the enabled set", () => {
    assert.equal(
      parse({
        AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "local,daytona",
        AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "daytona",
        AGENTA_RUNNER_DAYTONA_API_KEY: "k",
      }).providers.default,
      "daytona",
    );
  });

  it("a default outside the enabled set fails", () => {
    assert.throws(
      () =>
        parse({
          AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "daytona",
          AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "local",
          AGENTA_RUNNER_DAYTONA_API_KEY: "k",
        }),
      RunnerConfigError,
    );
  });
});

describe("daytona configuration", () => {
  it("daytona enabled without a provisioning credential fails", () => {
    assert.throws(
      () => parse({ AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "local,daytona" }),
      RunnerConfigError,
    );
  });

  it("daytona absent ignores optional daytona tuning (no credential required)", () => {
    const config = parse({
      AGENTA_RUNNER_DAYTONA_TARGET: "eu",
      AGENTA_RUNNER_DAYTONA_AUTOSTOP_MINUTES: "9",
    });
    assert.deepEqual(config.providers.enabled, ["local"]);
    // Optional tuning is still parsed, but with no credential requirement.
    assert.equal(config.daytona.target, "eu");
    assert.equal(config.daytona.apiKey, undefined);
  });

  it("snapshot plus image fails", () => {
    assert.throws(
      () =>
        parse({
          AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "local,daytona",
          AGENTA_RUNNER_DAYTONA_API_KEY: "k",
          AGENTA_RUNNER_DAYTONA_SNAPSHOT: "snap",
          AGENTA_RUNNER_DAYTONA_IMAGE: "img",
        }),
      RunnerConfigError,
    );
  });

  it("invalid zero, negative, non-numeric, and fractional lifecycle values fail", () => {
    for (const bad of ["0", "-5", "soon", "12.9"]) {
      assert.throws(
        () => parse({ AGENTA_RUNNER_DAYTONA_AUTOSTOP_MINUTES: bad }),
        RunnerConfigError,
        `expected '${bad}' to fail`,
      );
    }
  });

  it("compose-substituted empty optional values become absent (default lifecycle)", () => {
    const config = parse({
      AGENTA_RUNNER_DAYTONA_SNAPSHOT: "",
      AGENTA_RUNNER_DAYTONA_IMAGE: "",
      AGENTA_RUNNER_DAYTONA_TARGET: "",
      AGENTA_RUNNER_DAYTONA_AUTOSTOP_MINUTES: "",
      AGENTA_RUNNER_DAYTONA_AUTODELETE_MINUTES: "  ",
    });
    assert.equal(config.daytona.snapshot, undefined);
    assert.equal(config.daytona.image, undefined);
    assert.equal(config.daytona.target, undefined);
    assert.equal(config.daytona.autostopMinutes, DEFAULT_DAYTONA_AUTOSTOP_MINUTES);
    assert.equal(config.daytona.autodeleteMinutes, DEFAULT_DAYTONA_AUTODELETE_MINUTES);
  });
});

describe("server + callback sections", () => {
  it("empty strings collapse to defaults/absent at the parse boundary", () => {
    const config = parse({
      AGENTA_RUNNER_HOST: "",
      AGENTA_RUNNER_LOG_LEVEL: "",
      AGENTA_RUNNER_TOKEN: "",
      AGENTA_API_INTERNAL_URL: "",
    });
    assert.equal(config.server.host, "127.0.0.1");
    assert.equal(config.server.logLevel, "silent");
    assert.equal(config.server.token, undefined);
    assert.equal(config.callback.apiInternalUrl, undefined);
  });

  it("reads explicit server values", () => {
    const config = parse({
      AGENTA_RUNNER_HOST: "0.0.0.0",
      AGENTA_RUNNER_PORT: "9000",
      AGENTA_RUNNER_LOG_LEVEL: "info",
      AGENTA_RUNNER_TOKEN: "secret",
    });
    assert.equal(config.server.host, "0.0.0.0");
    assert.equal(config.server.port, 9000);
    assert.equal(config.server.logLevel, "info");
    assert.equal(config.server.token, "secret");
  });
});

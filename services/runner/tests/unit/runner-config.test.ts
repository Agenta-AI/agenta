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
  providerNotEnabledMessage,
  runnerConfigSummary,
  withoutImpliedInProcess,
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
      ["local", "daytona", "inprocess"],
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

describe("inprocess follows daytona", () => {
  const withKey = (list: string, extra: Record<string, string> = {}) =>
    parse({ AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: list, AGENTA_RUNNER_DAYTONA_API_KEY: "k", ...extra }).providers;

  it("is enabled wherever daytona is, with no setting of its own", () => {
    assert.deepEqual(withKey("daytona", { AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "daytona" }).enabled, ["daytona", "inprocess"]);
    assert.deepEqual(withKey("local,daytona").enabled, ["local", "daytona", "inprocess"]);
    assert.equal(withKey("daytona", { AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "daytona" }).inprocessImplied, true);
  });

  it("keeps daytona the default: the added entry goes last", () => {
    const providers = withKey("daytona", { AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "daytona" });
    assert.equal(providers.default, "daytona");
    assert.equal(providers.enabled[0], "daytona");
  });

  it("is not enabled on a deployment without daytona", () => {
    assert.deepEqual(parse({}).providers.enabled, ["local"]);
    assert.deepEqual(parse({ AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "local" }).providers.enabled, ["local"]);
  });

  it("an explicit entry is kept as written and is not marked implied", () => {
    const providers = withKey("daytona,inprocess", { AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "daytona" });
    assert.deepEqual(providers.enabled, ["daytona", "inprocess"]);
    assert.equal(providers.inprocessImplied, false);
    assert.equal(withKey("inprocess", { AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "inprocess" }).inprocessImplied, false);
  });

  it("may be the default with daytona alone in the list, which counts as naming it", () => {
    const providers = withKey("daytona", { AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "inprocess" });
    assert.equal(providers.default, "inprocess");
    assert.equal(providers.inprocessImplied, false);
  });

  it("the startup summary shows the effective list", () => {
    const config = parse({
      AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "daytona",
      AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "daytona",
      AGENTA_RUNNER_DAYTONA_API_KEY: "k",
    });
    assert.match(runnerConfigSummary(config), /providers enabled=\[daytona,inprocess\] default=daytona/);
  });

  it("the refusal for inprocess says how it is enabled", () => {
    assert.match(providerNotEnabledMessage("inprocess", ["local"]), /not enabled on this deployment \(enabled: local\)\. 'inprocess' is enabled together with 'daytona'\./);
    assert.doesNotMatch(providerNotEnabledMessage("daytona", ["local"]), /together/);
  });

  it("withoutImpliedInProcess drops only an implied entry", () => {
    const implied = parse({ AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "daytona", AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "daytona", AGENTA_RUNNER_DAYTONA_API_KEY: "k" });
    const dropped = withoutImpliedInProcess(implied);
    assert.deepEqual(dropped.providers.enabled, ["daytona"]);
    assert.equal(dropped.providers.inprocessImplied, false);
    assert.deepEqual(implied.providers.enabled, ["daytona", "inprocess"], "the input is not changed");
    const explicit = parse({ AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "daytona,inprocess", AGENTA_RUNNER_DAYTONA_API_KEY: "k", AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "daytona" });
    assert.throws(() => withoutImpliedInProcess(explicit));
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

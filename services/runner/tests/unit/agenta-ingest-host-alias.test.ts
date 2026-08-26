/**
 * `isAgentaIngest` decides whether a run's OTLP endpoint is this deployment's own ingest, and that
 * answer gates whether the runner may use the caller's credential for its session calls. Getting it
 * wrong is silent: the credential is withheld, and every `/sessions/*` call comes back 401 with
 * nothing naming a hostname.
 *
 * The case that broke: a service in bridge mode cannot reach the host as `localhost`, so the SDK
 * rewrites the configured API URL to `host.docker.internal` before putting it on the run request
 * (`agenta/sdk/utils/helpers.py`, `parse_url`). Compared verbatim against `AGENTA_API_URL`, the
 * deployment failed to recognize its own ingest.
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import { isAgentaIngest } from "../../src/tracing/otel.ts";

const ENV_KEYS = ["AGENTA_API_URL", "AGENTA_API_INTERNAL_URL"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("isAgentaIngest", () => {
  it("accepts the bridge-mode rewrite of its own configured host", () => {
    process.env.AGENTA_API_URL = "http://localhost:8081/api";
    delete process.env.AGENTA_API_INTERNAL_URL;

    // What the SDK actually sends from a bridge-mode container.
    assert.equal(
      isAgentaIngest("http://host.docker.internal:8081/api/otlp/v1/traces"),
      true,
    );
    // ...and the unrewritten spelling still matches.
    assert.equal(
      isAgentaIngest("http://localhost:8081/api/otlp/v1/traces"),
      true,
    );
    assert.equal(
      isAgentaIngest("http://127.0.0.1:8081/api/otlp/v1/traces"),
      true,
    );
  });

  it("still matches the internal service name exactly", () => {
    process.env.AGENTA_API_INTERNAL_URL = "http://api:8000";
    delete process.env.AGENTA_API_URL;

    assert.equal(isAgentaIngest("http://api:8000/otlp/v1/traces"), true);
  });

  it("keeps the port significant — an alias is not a wildcard", () => {
    process.env.AGENTA_API_URL = "http://localhost:8081/api";
    delete process.env.AGENTA_API_INTERNAL_URL;

    // The reported deployment moved off :80; a run still naming it is NOT this ingest.
    assert.equal(
      isAgentaIngest("http://host.docker.internal/api/otlp/v1/traces"),
      false,
    );
    assert.equal(
      isAgentaIngest("http://localhost:9999/api/otlp/v1/traces"),
      false,
    );
  });

  it("refuses a foreign collector, which is the whole point of the gate", () => {
    process.env.AGENTA_API_URL = "http://localhost:8081/api";
    delete process.env.AGENTA_API_INTERNAL_URL;

    assert.equal(
      isAgentaIngest("https://collector.example.com/v1/traces"),
      false,
    );
    // Same host alias, different path — not the deployment's ingest endpoint.
    assert.equal(
      isAgentaIngest("http://host.docker.internal:8081/api/other"),
      false,
    );
    assert.equal(isAgentaIngest("not-a-url"), false);
  });
});

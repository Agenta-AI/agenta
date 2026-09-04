/**
 * `isAgentaIngest` decides whether an OTLP endpoint is THIS deployment's own ingest, and so
 * whether the export credential is attached. Say no about our own host and the batch goes out
 * unauthenticated: every runner session call comes back 401, with nothing in the message naming
 * a hostname.
 *
 * That is exactly what a local stack hit. A service in bridge mode cannot reach the host through
 * `localhost` — the name resolves to its own container — so the SDK rewrites a configured
 * `localhost` API URL to `host.docker.internal` (`agenta/sdk/utils/helpers.py`, `parse_url`). The
 * endpoint arriving on the run request then spells the host differently from the configured base,
 * and a verbatim comparison called the deployment's own ingest somebody else's collector.
 *
 * The pin is two-sided: the local aliases are interchangeable, and NOTHING else is — a third-party
 * collector on the same host, another port, or another path must still be treated as foreign, or
 * the credential leaks to it.
 *
 * Run: pnpm exec vitest run tests/unit/otel-agenta-ingest.test.ts
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isAgentaIngest } from "../../src/tracing/otel.ts";

const TRACES = "/otlp/v1/traces";
const envKeys = ["AGENTA_API_URL", "AGENTA_API_INTERNAL_URL"] as const;
const saved: Partial<Record<(typeof envKeys)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of envKeys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of envKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("isAgentaIngest", () => {
  it("recognizes the configured base itself", () => {
    process.env.AGENTA_API_URL = "http://localhost/api";
    expect(isAgentaIngest(`http://localhost/api${TRACES}`)).toBe(true);
  });

  it("recognizes the cloud ingest with nothing configured", () => {
    expect(isAgentaIngest(`https://cloud.agenta.ai/api${TRACES}`)).toBe(true);
  });

  // The regression: the SDK's bridge-mode rewrite renames the host, and the credential was
  // withheld from our own ingest on that basis alone.
  it.each([
    "127.0.0.1",
    "0.0.0.0",
    "host.docker.internal",
    "[::1]",
  ])("treats %s as the same host as a configured localhost", (alias) => {
    process.env.AGENTA_API_URL = "http://localhost/api";
    expect(isAgentaIngest(`http://${alias}/api${TRACES}`)).toBe(true);
  });

  it("folds the alias in the other direction too", () => {
    process.env.AGENTA_API_URL = "http://host.docker.internal/api";
    expect(isAgentaIngest(`http://localhost/api${TRACES}`)).toBe(true);
  });

  it("matches against the internal base, not only the public one", () => {
    process.env.AGENTA_API_URL = "https://agenta.example.com/api";
    process.env.AGENTA_API_INTERNAL_URL = "http://localhost:8000/api";
    expect(isAgentaIngest(`http://127.0.0.1:8000/api${TRACES}`)).toBe(true);
  });

  // The other side of the fold: aliasing the host name must not alias anything else, or a
  // third-party collector sharing the host would be handed the credential.
  it("does not match a different port on the same host", () => {
    process.env.AGENTA_API_URL = "http://localhost:8000/api";
    expect(isAgentaIngest(`http://localhost:4318/api${TRACES}`)).toBe(false);
  });

  it("does not match a different path on the same host", () => {
    process.env.AGENTA_API_URL = "http://localhost/api";
    expect(isAgentaIngest("http://localhost/collector/v1/traces")).toBe(false);
  });

  it("does not match a foreign host", () => {
    process.env.AGENTA_API_URL = "http://localhost/api";
    expect(isAgentaIngest(`http://jaeger.internal/api${TRACES}`)).toBe(false);
  });

  it("rejects an unparseable endpoint rather than throwing", () => {
    process.env.AGENTA_API_URL = "http://localhost/api";
    expect(isAgentaIngest("not a url")).toBe(false);
  });
});

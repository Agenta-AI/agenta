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
/** A third-party collector path, which must never be taken for Agenta ingest. */
const FOREIGN = "/collector/v1/traces";
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

  // The Kubernetes regression: the SDK drops a trailing `/api` from the base and appends its own,
  // so a base written WITHOUT that suffix — the shape every compose file uses, and the natural
  // value for the Helm chart's optional `agenta.apiInternalUrl` — was handed an endpoint the
  // comparison called somebody else's collector. That withheld the run credential and turned
  // every session call into an HTTP 401.
  describe.each([
    ["no /api suffix", "http://agenta-api:8000"],
    ["a trailing slash and no /api", "http://agenta-api:8000/"],
    ["repeated trailing slashes", "http://agenta-api:8000///"],
  ])("a base written with %s", (_shape, base) => {
    beforeEach(() => {
      process.env.AGENTA_API_INTERNAL_URL = base;
      process.env.AGENTA_API_URL = "https://agenta.example.com/api";
    });

    it("accepts the root trace path its own exporter builds", () => {
      expect(isAgentaIngest(`http://agenta-api:8000${TRACES}`)).toBe(true);
    });

    it("accepts the /api trace path the SDK builds", () => {
      expect(isAgentaIngest(`http://agenta-api:8000/api${TRACES}`)).toBe(true);
    });

    it("rejects a deeper /api path than the SDK can build", () => {
      expect(isAgentaIngest(`http://agenta-api:8000/api/api${TRACES}`)).toBe(
        false,
      );
    });
  });

  // A base that ALREADY carries the suffix is reproduced exactly by the SDK, so it needs no
  // second spelling — and its root sibling must stay foreign, because a shared ingress can route
  // `/api/*` to Agenta and `/otlp/v1/traces` to somebody else's collector.
  describe.each([
    ["an /api suffix", "http://agenta-api:8000/api"],
    ["an /api suffix and a trailing slash", "http://agenta-api:8000/api/"],
  ])("a base written with %s", (_shape, base) => {
    beforeEach(() => {
      process.env.AGENTA_API_INTERNAL_URL = base;
      process.env.AGENTA_API_URL = "https://agenta.example.com/api";
    });

    it("accepts the /api trace path the SDK reproduces", () => {
      expect(isAgentaIngest(`http://agenta-api:8000/api${TRACES}`)).toBe(true);
    });

    it("rejects the root trace path, which a proxy may route elsewhere", () => {
      expect(isAgentaIngest(`http://agenta-api:8000${TRACES}`)).toBe(false);
    });
  });

  // The rejections hold whichever way the base is spelled.
  describe.each([
    ["no /api suffix", "http://agenta-api:8000"],
    ["an /api suffix", "http://agenta-api:8000/api"],
  ])("a base written with %s", (_shape, base) => {
    beforeEach(() => {
      process.env.AGENTA_API_INTERNAL_URL = base;
      process.env.AGENTA_API_URL = "https://agenta.example.com/api";
    });

    it("still rejects another host", () => {
      expect(isAgentaIngest(`http://jaeger.internal/api${TRACES}`)).toBe(false);
    });

    it("still rejects another port on the same host", () => {
      expect(isAgentaIngest(`http://agenta-api:4318/api${TRACES}`)).toBe(false);
    });

    it("still rejects another path on the same host and port", () => {
      expect(isAgentaIngest(`http://agenta-api:8000${FOREIGN}`)).toBe(false);
      expect(isAgentaIngest(`http://agenta-api:8000/proxy/api${TRACES}`)).toBe(
        false,
      );
    });

    it("still rejects another scheme on the same host", () => {
      expect(isAgentaIngest(`https://agenta-api:8000/api${TRACES}`)).toBe(
        false,
      );
    });
  });

  // A base whose HOST is `api` is the trap. Dropping the `/api` suffix as TEXT turns
  // `http://api` into `http:/`, and appending the trace path to that manufactures the host
  // `otlp`. Candidates must be built from the parsed authority, never from the raw string: an
  // allowlist must not invent an origin it was never given.
  it.each(["http://api", "https://api", "http://api/"])(
    "does not manufacture a foreign host from the base %s",
    (base) => {
      process.env.AGENTA_API_INTERNAL_URL = base;
      expect(isAgentaIngest("http://otlp/v1/traces")).toBe(false);
      expect(isAgentaIngest("https://otlp/v1/traces")).toBe(false);
    },
  );

  it("still recognizes its own ingest when the base host is `api`", () => {
    process.env.AGENTA_API_INTERNAL_URL = "http://api";
    expect(isAgentaIngest(`http://api${TRACES}`)).toBe(true);
    expect(isAgentaIngest(`http://api/api${TRACES}`)).toBe(true);
  });

  // The api's own `/api` strip cannot vouch for the root path: it runs only after the proxy has
  // already picked a backend.
  it("does not trust the root path when the public base is mounted under /api", () => {
    process.env.AGENTA_API_URL = "https://agenta.example.com/api";
    expect(isAgentaIngest(`https://agenta.example.com/api${TRACES}`)).toBe(
      true,
    );
    expect(isAgentaIngest(`https://agenta.example.com${TRACES}`)).toBe(false);
  });

  it("does not trust the root path on the built-in cloud base", () => {
    expect(isAgentaIngest(`https://cloud.agenta.ai/api${TRACES}`)).toBe(true);
    expect(isAgentaIngest(`https://cloud.agenta.ai${TRACES}`)).toBe(false);
  });

  // A base behind a path prefix. The SDK drops the LAST `/api`, so it rebuilds this base exactly.
  // Neither the prefix alone nor the prefix-less `/api` path belongs to this deployment.
  it("handles a base mounted under a path prefix", () => {
    process.env.AGENTA_API_URL = "https://example.com/agenta/api";
    expect(isAgentaIngest(`https://example.com/agenta/api${TRACES}`)).toBe(
      true,
    );
    expect(isAgentaIngest(`https://example.com/agenta${TRACES}`)).toBe(false);
    expect(isAgentaIngest(`https://example.com/api${TRACES}`)).toBe(false);
  });

  it("drops only one /api suffix, which is all the SDK drops", () => {
    process.env.AGENTA_API_URL = "http://host:8000/api/api";
    expect(isAgentaIngest(`http://host:8000/api/api${TRACES}`)).toBe(true);
    expect(isAgentaIngest(`http://host:8000/api${TRACES}`)).toBe(false);
  });

  // The path is compared case-sensitively, which matches the api's own strip: it removes a
  // lowercase `/api` only (`api/oss/src/middlewares/prefix.py`). Scheme and host still fold.
  it("compares the path case-sensitively while folding scheme and host case", () => {
    process.env.AGENTA_API_URL = "HTTP://AGENTA-API:8000/API";
    expect(isAgentaIngest(`http://agenta-api:8000/API/api${TRACES}`)).toBe(
      true,
    );
    expect(isAgentaIngest(`http://agenta-api:8000/api${TRACES}`)).toBe(false);
  });

  it("treats a default port as the same origin as no port", () => {
    process.env.AGENTA_API_URL = "http://host";
    expect(isAgentaIngest(`http://host:80/api${TRACES}`)).toBe(true);
    expect(isAgentaIngest(`http://host:8080/api${TRACES}`)).toBe(false);
  });

  it("distinguishes IPv6 addresses that are not local aliases", () => {
    process.env.AGENTA_API_INTERNAL_URL = "http://[fd00::1]:8000";
    expect(isAgentaIngest(`http://[fd00::1]:8000/api${TRACES}`)).toBe(true);
    expect(isAgentaIngest(`http://[fd00::2]:8000/api${TRACES}`)).toBe(false);
  });

  it("rejects an unparseable endpoint rather than throwing", () => {
    process.env.AGENTA_API_URL = "http://localhost/api";
    expect(isAgentaIngest("not a url")).toBe(false);
  });

  it("ignores an unparseable base rather than throwing", () => {
    process.env.AGENTA_API_INTERNAL_URL = "not a url";
    process.env.AGENTA_API_URL = "http://localhost/api";
    expect(isAgentaIngest(`http://localhost/api${TRACES}`)).toBe(true);
    expect(isAgentaIngest(`http://jaeger.internal/api${TRACES}`)).toBe(false);
  });
});

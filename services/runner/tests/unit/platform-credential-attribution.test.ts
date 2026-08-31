/**
 * `platformCredentialForRequest` decides whether the run's Authorization header may authenticate
 * the runner's calls back to the Agenta api (heartbeat, record ingest, record query). One header
 * on the wire has two possible owners: this platform, or a third-party OTLP collector the caller
 * aimed the run at. Getting that wrong in the permissive direction leaks a collector's token into
 * platform calls; getting it wrong in the strict direction silently strips the credential and every
 * session call 401s, which surfaces far away as "record log is unreadable".
 *
 * The attribution is only decidable when the runner knows its platform's PUBLIC api base, because
 * that is the form a dispatched run carries (`https://<host>/api/otlp/v1/traces`) while the
 * runner's own hop is usually internal (`http://api:8000`). These cases pin both directions,
 * including the self-hosted shape that regressed: internal hop configured, public base not.
 *
 * Run: pnpm exec vitest run tests/unit/platform-credential-attribution.test.ts
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import type { AgentRunRequest } from "../../src/protocol.ts";
import {
  platformCredentialForRequest,
  resetPlatformCredentialWarnings,
} from "../../src/engines/sandbox_agent/runtime-policy.ts";
import { publicApiBaseConfigured } from "../../src/tracing/otel.ts";

const PUBLIC_BASE = "https://selfhosted.example.com/api";
const PUBLIC_ENDPOINT = `${PUBLIC_BASE}/otlp/v1/traces`;
const INTERNAL_BASE = "http://api:8000";
const CREDENTIAL = "Secret run-credential";

function request(
  endpoint: string,
  authorization = CREDENTIAL,
): AgentRunRequest {
  return {
    telemetry: {
      exporters: {
        otlp: {
          endpoint,
          headers: authorization ? { authorization } : {},
        },
      },
    },
  } as unknown as AgentRunRequest;
}

/** Collect the warnings a call emits instead of writing them to the suite's stderr. */
function withLog(): { lines: string[]; log: (message: string) => void } {
  const lines: string[] = [];
  return { lines, log: (message) => lines.push(message) };
}

beforeEach(() => {
  resetPlatformCredentialWarnings();
  // Neither var is scrubbed by the hermetic-env setup, and a loaded dev env sets both — which
  // would flip exactly the case this file is about. Start from "operator configured nothing".
  vi.stubEnv("AGENTA_API_URL", undefined);
  vi.stubEnv("AGENTA_API_INTERNAL_URL", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetPlatformCredentialWarnings();
});

describe("platform credential attribution", () => {
  it("uses the credential when the endpoint matches the configured public base", () => {
    vi.stubEnv("AGENTA_API_URL", PUBLIC_BASE);
    const { lines, log } = withLog();

    assert.equal(
      platformCredentialForRequest(request(PUBLIC_ENDPOINT), log),
      CREDENTIAL,
    );
    assert.deepEqual(lines, []);
  });

  it("uses the credential when the endpoint matches the internal hop", () => {
    vi.stubEnv("AGENTA_API_INTERNAL_URL", INTERNAL_BASE);
    const { lines, log } = withLog();

    assert.equal(
      platformCredentialForRequest(
        request(`${INTERNAL_BASE}/otlp/v1/traces`),
        log,
      ),
      CREDENTIAL,
    );
    assert.deepEqual(lines, []);
  });

  it("keeps the credential when only the internal hop is configured, and says what to set", () => {
    // The self-hosted shape that regressed in v0.114.0: the runner knows `http://api:8000`, the
    // dispatched run carries the public base, and the two never string-match. Refusing here strips
    // the credential from a correctly deployed platform, so the runner keeps it and names the gap.
    vi.stubEnv("AGENTA_API_INTERNAL_URL", INTERNAL_BASE);
    const { lines, log } = withLog();

    assert.equal(
      platformCredentialForRequest(request(PUBLIC_ENDPOINT), log),
      CREDENTIAL,
    );
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /AGENTA_API_URL is not set/);
    assert.match(lines[0]!, /selfhosted\.example\.com/);
  });

  it("does not log credentials embedded in an unattributed endpoint or configured base", () => {
    vi.stubEnv(
      "AGENTA_API_INTERNAL_URL",
      "http://internal-user:internal-secret@api:8000/api?token=internal-query-secret",
    );
    const { lines, log } = withLog();

    assert.equal(
      platformCredentialForRequest(
        request(
          "https://collector-user:collector-secret@collector.thirdparty.example/v1/traces?token=collector-query-secret",
        ),
        log,
      ),
      CREDENTIAL,
    );
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /collector\.thirdparty\.example/);
    assert.match(lines[0]!, /api:8000/);
    assert.doesNotMatch(lines[0]!, /collector-user|collector-secret/);
    assert.doesNotMatch(lines[0]!, /internal-user|internal-secret/);
  });

  it("drops the credential for a foreign endpoint once the public base IS configured", () => {
    // With the public base known, a non-matching endpoint really is someone else's collector,
    // so the third-party protection the strict check was written for stays armed.
    vi.stubEnv(
      "AGENTA_API_URL",
      "https://platform-user:platform-secret@selfhosted.example.com/api?token=platform-query-secret",
    );
    vi.stubEnv("AGENTA_API_INTERNAL_URL", INTERNAL_BASE);
    const { lines, log } = withLog();

    assert.equal(
      platformCredentialForRequest(
        request(
          "https://collector-user:collector-secret@collector.thirdparty.example/v1/traces?token=collector-query-secret",
        ),
        log,
      ),
      "",
    );
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /dropping the run credential/);
    assert.match(lines[0]!, /collector\.thirdparty\.example/);
    assert.match(lines[0]!, /selfhosted\.example\.com/);
    assert.doesNotMatch(lines[0]!, /collector-user|collector-secret/);
    assert.doesNotMatch(lines[0]!, /platform-user|platform-secret/);
  });

  it("returns empty without warning when the caller sent no credential", () => {
    vi.stubEnv("AGENTA_API_INTERNAL_URL", INTERNAL_BASE);
    const { lines, log } = withLog();

    assert.equal(
      platformCredentialForRequest(request(PUBLIC_ENDPOINT, ""), log),
      "",
    );
    assert.deepEqual(lines, []);
  });

  it("warns once per endpoint, not once per turn", () => {
    vi.stubEnv("AGENTA_API_INTERNAL_URL", INTERNAL_BASE);
    const { lines, log } = withLog();

    for (let turn = 0; turn < 3; turn += 1) {
      platformCredentialForRequest(request(PUBLIC_ENDPOINT), log);
    }

    assert.equal(lines.length, 1);
  });
});

/**
 * F1: a self-hoster sets `AGENTA_API_URL` to a localhost URL, which is the natural value for a
 * local docker-compose stack. The api rewrites that host to `host.docker.internal` before it
 * dispatches the run, so the endpoint the runner is handed can never string-match the raw env
 * value it holds, and the strict branch drops the credential on a correctly configured platform.
 * Repro: probe session f9483f76 on the rel1144 stack, "trace endpoint host host.docker.internal:8480
 * is not Agenta ingest ... dropping the run credential".
 */
describe("bridge-rewritten localhost ingest", () => {
  const LOCAL_BASE = "http://localhost:8480/api";
  const BRIDGE_ENDPOINT = "http://host.docker.internal:8480/api/otlp/v1/traces";

  it("uses the credential when a localhost base is handed its bridge-rewritten endpoint", () => {
    vi.stubEnv("AGENTA_API_URL", LOCAL_BASE);
    const { lines, log } = withLog();

    assert.equal(
      platformCredentialForRequest(request(BRIDGE_ENDPOINT), log),
      CREDENTIAL,
    );
    assert.deepEqual(lines, []);
  });

  it("uses the credential for the 0.0.0.0 form the api rewrites the same way", () => {
    vi.stubEnv("AGENTA_API_URL", "http://0.0.0.0:8480/api");
    const { lines, log } = withLog();

    assert.equal(
      platformCredentialForRequest(request(BRIDGE_ENDPOINT), log),
      CREDENTIAL,
    );
    assert.deepEqual(lines, []);
  });

  it("admits the bridge form of the internal hop too", () => {
    vi.stubEnv("AGENTA_API_INTERNAL_URL", "http://localhost:8000");
    vi.stubEnv("AGENTA_API_URL", PUBLIC_BASE);
    const { lines, log } = withLog();

    assert.equal(
      platformCredentialForRequest(
        request("http://host.docker.internal:8000/otlp/v1/traces"),
        log,
      ),
      CREDENTIAL,
    );
    assert.deepEqual(lines, []);
  });

  it("still admits the localhost endpoint itself, for a host-network deployment", () => {
    // `parse_url` returns the url unchanged when the api runs with network mode "host", so the
    // raw match this fix widens must keep working exactly as before.
    vi.stubEnv("AGENTA_API_URL", LOCAL_BASE);
    const { lines, log } = withLog();

    assert.equal(
      platformCredentialForRequest(
        request("http://localhost:8480/api/otlp/v1/traces"),
        log,
      ),
      CREDENTIAL,
    );
    assert.deepEqual(lines, []);
  });

  it("does not admit host.docker.internal on another port", () => {
    // The mirror carries the port across, so a different port is a different deployment.
    vi.stubEnv("AGENTA_API_URL", LOCAL_BASE);
    const { lines, log } = withLog();

    assert.equal(
      platformCredentialForRequest(
        request("http://host.docker.internal:9999/api/otlp/v1/traces"),
        log,
      ),
      "",
    );
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /dropping the run credential/);
  });

  it("does not admit host.docker.internal on another path", () => {
    vi.stubEnv("AGENTA_API_URL", LOCAL_BASE);
    const { lines, log } = withLog();

    assert.equal(
      platformCredentialForRequest(
        request("http://host.docker.internal:8480/collector/v1/traces"),
        log,
      ),
      "",
    );
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /dropping the run credential/);
  });

  it("keeps dropping an unrelated host when the base is a localhost url", () => {
    vi.stubEnv("AGENTA_API_URL", LOCAL_BASE);
    const { lines, log } = withLog();

    assert.equal(
      platformCredentialForRequest(
        request("https://collector.thirdparty.example/v1/traces"),
        log,
      ),
      "",
    );
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /dropping the run credential/);
    assert.match(lines[0]!, /collector\.thirdparty\.example/);
  });

  it("leaves a 127.0.0.1 base alone, because the api does not rewrite that host", () => {
    // `parse_url` rewrites only `localhost` and `0.0.0.0`, so a 127.0.0.1 deployment matches
    // itself and never sees the bridge form. Admitting it would widen the allowlist past the
    // platform's own rewrite.
    vi.stubEnv("AGENTA_API_URL", "http://127.0.0.1:8480/api");
    const { lines, log } = withLog();

    assert.equal(
      platformCredentialForRequest(
        request("http://127.0.0.1:8480/api/otlp/v1/traces"),
        log,
      ),
      CREDENTIAL,
    );
    assert.deepEqual(lines, []);

    resetPlatformCredentialWarnings();
    assert.equal(
      platformCredentialForRequest(request(BRIDGE_ENDPOINT), log),
      "",
    );
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /dropping the run credential/);
  });

  it("does not arm the strict branch when only a localhost internal hop is configured", () => {
    // The unconfigured-base behaviour must stay exactly as it is: the runner keeps the credential
    // and names the gap rather than failing closed on an undecidable attribution.
    vi.stubEnv("AGENTA_API_INTERNAL_URL", "http://localhost:8000");
    const { lines, log } = withLog();

    assert.equal(
      platformCredentialForRequest(request(PUBLIC_ENDPOINT), log),
      CREDENTIAL,
    );
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /AGENTA_API_URL is not set/);
  });
});

describe("publicApiBaseConfigured", () => {
  it("is false when only the internal hop is set", () => {
    vi.stubEnv("AGENTA_API_INTERNAL_URL", INTERNAL_BASE);
    assert.equal(publicApiBaseConfigured(), false);
  });

  it("is true when the public base is set", () => {
    vi.stubEnv("AGENTA_API_URL", PUBLIC_BASE);
    assert.equal(publicApiBaseConfigured(), true);
  });

  it("is true for a runner pointed straight at cloud, which needs no operator input", () => {
    vi.stubEnv("AGENTA_API_INTERNAL_URL", "https://cloud.agenta.ai/api");
    assert.equal(publicApiBaseConfigured(), true);
  });
});

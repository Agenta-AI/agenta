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

  it("drops the credential for a foreign endpoint once the public base IS configured", () => {
    // With the public base known, a non-matching endpoint really is someone else's collector,
    // so the third-party protection the strict check was written for stays armed.
    vi.stubEnv("AGENTA_API_URL", PUBLIC_BASE);
    vi.stubEnv("AGENTA_API_INTERNAL_URL", INTERNAL_BASE);
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

/**
 * Unit tests for the api base inferred from a request's telemetry must be scoped to
 * that request, not cached onto `process.env` (a first-write-wins global that pinned every
 * later request to the first caller's base).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/apibase-request-scope.test.ts)
 */
import { afterEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import {
  apiBase,
  runWithRequestApiBase,
  trustedApiBase,
} from "../../src/apiBase.ts";
import { createAgentServer, type RunAgent } from "../../src/server.ts";
import { runnerToken, runnerTokenHeader } from "../../src/sessions/auth.ts";
import { reportContinuationAdmission } from "../../src/sessions/control-channel.ts";

const INTERNAL_ENV = "AGENTA_API_INTERNAL_URL";
const PUBLIC_ENV = "AGENTA_API_URL";
const previousInternal = process.env[INTERNAL_ENV];
const previousPublic = process.env[PUBLIC_ENV];

afterEach(() => {
  if (previousInternal === undefined) delete process.env[INTERNAL_ENV];
  else process.env[INTERNAL_ENV] = previousInternal;
  if (previousPublic === undefined) delete process.env[PUBLIC_ENV];
  else process.env[PUBLIC_ENV] = previousPublic;
});

/** The runner requires a token to serve, so configure one and present it: this suite is about the
 * request-scoped api base, not about auth. */
const TEST_TOKEN = "test-runner-token";
const AUTH = { authorization: `Bearer ${TEST_TOKEN}` };

async function listen(
  run: RunAgent,
): Promise<{ url: string; close: () => Promise<void> }> {
  process.env.AGENTA_RUNNER_TOKEN = TEST_TOKEN;
  const server = createAgentServer(run);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// No sessionId: keep these non-session-owned so the server does not start the alive watchdog
// (which would fire heartbeat/persist calls at the inferred base during the test).
function requestWithOtlpBase(base: string): Record<string, unknown> {
  return {
    telemetry: { exporters: { otlp: { endpoint: `${base}/otlp/v1/traces` } } },
  };
}

describe("apiBase (request-scoped, not a process-global first-write-wins pin)", () => {
  it("two requests with different inferred api bases each see their own base", async () => {
    delete process.env[INTERNAL_ENV];
    delete process.env[PUBLIC_ENV];

    const seenBases: string[] = [];
    const echoRun: RunAgent = async () => {
      seenBases.push(apiBase());
      return { ok: true, output: "done", events: [] };
    };
    const s = await listen(echoRun);
    try {
      const first = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: { accept: "application/x-ndjson", ...AUTH },
        body: JSON.stringify(requestWithOtlpBase("http://first.internal")),
      });
      await first.text();

      const second = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: { accept: "application/x-ndjson", ...AUTH },
        body: JSON.stringify(requestWithOtlpBase("http://second.internal")),
      });
      await second.text();

      assert.deepEqual(seenBases, [
        "http://first.internal",
        "http://second.internal",
      ]);

      // The process-global fallback env is never mutated as a side effect.
      assert.equal(process.env[PUBLIC_ENV], undefined);
    } finally {
      await s.close();
    }
  });

  it("does not leak a request's inferred base to a later request with no telemetry base", async () => {
    delete process.env[INTERNAL_ENV];
    delete process.env[PUBLIC_ENV];

    const seenBases: string[] = [];
    const echoRun: RunAgent = async () => {
      seenBases.push(apiBase());
      return { ok: true, output: "done", events: [] };
    };
    const s = await listen(echoRun);
    try {
      const first = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: { accept: "application/x-ndjson", ...AUTH },
        body: JSON.stringify(requestWithOtlpBase("http://first.internal")),
      });
      await first.text();

      // No telemetry endpoint on this one: must fall back to the hardcoded default, NOT the
      // first request's inferred base.
      const second = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: { accept: "application/x-ndjson", ...AUTH },
        body: JSON.stringify({}),
      });
      await second.text();

      assert.deepEqual(seenBases, ["http://first.internal", "http://api:8000"]);
    } finally {
      await s.close();
    }
  });

  it("keeps two overlapping request scopes isolated across await boundaries", async () => {
    delete process.env[INTERNAL_ENV];
    delete process.env[PUBLIC_ENV];

    // Interleave two scopes so the second is entered while the first is suspended at an await.
    // If the base were a process-global, the read after the yield would see the other's value.
    const readAfterYield = (base: string) =>
      runWithRequestApiBase(base, async () => {
        await new Promise((r) => setTimeout(r, 0));
        return apiBase();
      });

    const [a, b] = await Promise.all([
      readAfterYield("http://a.internal"),
      readAfterYield("http://b.internal"),
    ]);

    assert.equal(a, "http://a.internal");
    assert.equal(b, "http://b.internal");
    assert.equal(process.env[PUBLIC_ENV], undefined);
  });
});

describe("the runner token goes only to a trusted api base", () => {
  const TOKEN_ENV = "AGENTA_RUNNER_TOKEN";
  const previousToken = process.env[TOKEN_ENV];

  afterEach(() => {
    if (previousToken === undefined) delete process.env[TOKEN_ENV];
    else process.env[TOKEN_ENV] = previousToken;
    vi.unstubAllGlobals();
  });

  it("sends the token to the AGENTA_API_INTERNAL_URL base, even inside a request scope", () => {
    process.env[TOKEN_ENV] = "runner-secret";
    process.env[INTERNAL_ENV] = "http://api.internal:8000";
    delete process.env[PUBLIC_ENV];

    runWithRequestApiBase("https://collector.example.com", () => {
      assert.equal(apiBase(), "http://api.internal:8000");
      assert.deepEqual(runnerTokenHeader(apiBase()), {
        "x-agenta-runner-token": "runner-secret",
      });
    });
  });

  it("sends the token to the AGENTA_API_URL base, even inside a request scope", () => {
    process.env[TOKEN_ENV] = "runner-secret";
    delete process.env[INTERNAL_ENV];
    process.env[PUBLIC_ENV] = "https://agenta.example.com/api/";

    runWithRequestApiBase("https://collector.example.com", () => {
      assert.equal(apiBase(), "https://agenta.example.com/api");
      assert.equal(trustedApiBase(), "https://agenta.example.com/api");
      assert.deepEqual(runnerTokenHeader(apiBase()), {
        "x-agenta-runner-token": "runner-secret",
      });
    });
  });

  it("sends the token to the fixed default base outside a request scope", () => {
    process.env[TOKEN_ENV] = "runner-secret";
    delete process.env[INTERNAL_ENV];
    delete process.env[PUBLIC_ENV];

    assert.equal(apiBase(), "http://api:8000");
    assert.deepEqual(runnerTokenHeader(apiBase()), {
      "x-agenta-runner-token": "runner-secret",
    });
  });

  it("sends no token to the base inferred from the request when both env bases are unset", () => {
    process.env[TOKEN_ENV] = "runner-secret";
    delete process.env[INTERNAL_ENV];
    delete process.env[PUBLIC_ENV];

    const inferred = runWithRequestApiBase(
      "https://collector.example.com",
      () => apiBase(),
    );
    assert.equal(inferred, "https://collector.example.com");
    // The destination decides, not the async context: outside the scope the captured base is
    // still refused.
    assert.equal(runnerToken(inferred), undefined);
    assert.deepEqual(runnerTokenHeader(inferred), {});
  });

  it("refuses a continuation admission instead of sending the token to an inferred base", async () => {
    process.env[TOKEN_ENV] = "runner-secret";
    delete process.env[INTERNAL_ENV];
    delete process.env[PUBLIC_ENV];
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await runWithRequestApiBase("https://collector.example.com", async () => {
      await assert.rejects(
        reportContinuationAdmission({
          commandId: "cmd-1",
          sessionId: "sess-1",
          executionId: "turn-1",
        }),
        /no runner token for this API base/,
      );
    });
    assert.equal(fetchSpy.mock.calls.length, 0);
  });
});

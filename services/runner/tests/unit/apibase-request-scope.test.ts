/**
 * Unit tests for the api base inferred from a request's telemetry must be scoped to
 * that request, not cached onto `process.env` (a first-write-wins global that pinned every
 * later request to the first caller's base).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/apibase-request-scope.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import { apiBase, runWithRequestApiBase } from "../../src/apiBase.ts";
import { createAgentServer, type RunAgent } from "../../src/server.ts";

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

async function listen(
  run: RunAgent,
): Promise<{ url: string; close: () => Promise<void> }> {
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
        headers: { accept: "application/x-ndjson" },
        body: JSON.stringify(requestWithOtlpBase("http://first.internal")),
      });
      await first.text();

      const second = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: { accept: "application/x-ndjson" },
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
        headers: { accept: "application/x-ndjson" },
        body: JSON.stringify(requestWithOtlpBase("http://first.internal")),
      });
      await first.text();

      // No telemetry endpoint on this one: must fall back to the hardcoded default, NOT the
      // first request's inferred base.
      const second = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: { accept: "application/x-ndjson" },
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

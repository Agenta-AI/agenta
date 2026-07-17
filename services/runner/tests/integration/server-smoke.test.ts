/**
 * Integration smoke tests: start the real in-process server and drive basic
 * request flows end-to-end via the `createAgentServer(run)` seam with a fake
 * engine (no live sandbox/harness).
 *
 * Tests that need external infra (Redis, live sandbox) are guarded with
 * `skipIfNoRedis` / `skipIfNoSandbox` so the suite stays green in CI.
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import {
  createAgentServer,
  type RunAgent,
} from "../../src/server.ts";

// ---------------------------------------------------------------------------
// Skip guards for external infra
// ---------------------------------------------------------------------------

/** True if a local Redis is reachable on the default port. */
async function redisAvailable(): Promise<boolean> {
  const { createConnection } = await import("node:net");
  return new Promise((resolve) => {
    const conn = createConnection(6379, "127.0.0.1");
    conn.once("connect", () => { conn.destroy(); resolve(true); });
    conn.once("error", () => resolve(false));
    conn.setTimeout(200, () => { conn.destroy(); resolve(false); });
  });
}

// ---------------------------------------------------------------------------
// Token env management
// ---------------------------------------------------------------------------

const TOKEN_ENV = "AGENTA_RUNNER_TOKEN";
const savedToken = process.env[TOKEN_ENV];

afterEach(() => {
  if (savedToken === undefined) delete process.env[TOKEN_ENV];
  else process.env[TOKEN_ENV] = savedToken;
});

const TEST_TOKEN = "test-runner-token";
const AUTH = { authorization: `Bearer ${TEST_TOKEN}` };

async function listen(
  run: RunAgent,
): Promise<{ url: string; close: () => Promise<void> }> {
  if (!process.env[TOKEN_ENV]) process.env[TOKEN_ENV] = TEST_TOKEN;
  const server = createAgentServer(run);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ---------------------------------------------------------------------------
// Basic end-to-end: server boots, endpoints respond
// ---------------------------------------------------------------------------

const okRun: RunAgent = async () => ({ ok: true, output: "hello", events: [] });

describe("server integration — in-process server with fake engine", () => {
  it("GET /health returns 200 with runner identity", async () => {
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/health`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body.status, "ok");
      assert.equal(typeof body.runner, "string");
      assert.equal(typeof body.protocol, "number");
    } finally {
      await s.close();
    }
  });

  it("POST /run is REJECTED when no token is configured (fails closed; there is no unauthenticated mode)", async () => {
    const s = await listen(okRun);
    delete process.env[TOKEN_ENV];
    try {
      const res = await fetch(`${s.url}/run`, {
        method: "POST",
        body: JSON.stringify({ harness: "pi_core" }),
      });
      assert.equal(res.status, 401);
    } finally {
      await s.close();
    }
  });

  it("POST /run returns 401 when AGENTA_RUNNER_TOKEN is set and no bearer supplied", async () => {
    process.env[TOKEN_ENV] = "integration-secret";
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/run`, {
        method: "POST",
        body: "{}",
      });
      assert.equal(res.status, 401);
      const body = (await res.json()) as { ok: boolean; error: string };
      assert.equal(body.ok, false);
      assert.match(body.error, /Unauthorized/);
    } finally {
      await s.close();
    }
  });

  it("POST /run accepts the correct bearer token", async () => {
    process.env[TOKEN_ENV] = "integration-secret";
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: { authorization: "Bearer integration-secret" },
        body: "{}",
      });
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });

  it("POST /run returns NDJSON stream with event lines then a result line", async () => {
    const streamRun: RunAgent = async (_req, emit) => {
      emit?.({ type: "message", text: "chunk1" });
      return { ok: true, output: "done", events: [] };
    };
    const s = await listen(streamRun);
    try {
      const res = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: { accept: "application/x-ndjson", ...AUTH },
        body: "{}",
      });
      assert.equal(res.status, 200);
      const lines = (await res.text())
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { kind: string });
      const kinds = lines.map((r) => r.kind);
      assert.ok(kinds.includes("event"), "at least one event line");
      assert.equal(kinds[kinds.length - 1], "result", "last line is result");
    } finally {
      await s.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Session persistence round-trip (skipped when Redis is absent)
// ---------------------------------------------------------------------------

describe("session record persist — skipped when Redis unavailable", () => {
  it("alive watchdog start+release does not throw (in-process, no Redis)", async () => {
    // The alive watchdog POSTs to the API; without a live API server the fetch
    // will fail, but the module must swallow failures and never throw.
    const { startAliveWatchdog } = await import("../../src/sessions/alive.ts");
    const watchdog = await startAliveWatchdog("integ-sess", "integ-turn", "tok");
    await assert.doesNotReject(() => watchdog.release());
  });

  it("buildPersistingEmitter flush is a no-op when no events emitted", async () => {
    const { buildPersistingEmitter } = await import("../../src/sessions/persist.ts");
    const { flush } = buildPersistingEmitter("integ-sess-2", () => "tok");
    await assert.doesNotReject(() => flush());
  });

  it("Redis-dependent session coordination is skipped when Redis is unavailable", async () => {
    const available = await redisAvailable();
    if (!available) {
      console.log("  [skip] Redis not available — skipping Redis integration assertions");
      return;
    }
    // If Redis IS available, assert that the contract keys have the expected prefix format.
    const { aliveKey, runningKey } = await import("../../src/sessions/contract.ts");
    assert.match(aliveKey("p1", "s1"), /^alive:p1:session:/);
    assert.match(runningKey("p1", "s1"), /^running:p1:session:/);
  });
});

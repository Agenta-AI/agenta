/**
 * Unit tests for the HTTP transport via the `createAgentServer(run)` seam.
 *
 * Starts a real server on an ephemeral port with a FAKE engine (no Pi/Claude/sandbox-agent) and makes
 * real requests. Covers /health, the /run happy path, invalid JSON (400), a failing result
 * (500), and the NDJSON streaming order (events first, then exactly one terminal result).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/server.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

import {
  createAgentServer,
  normalizeKillProjectId,
  registerShutdownHandler,
  type RunAgent,
} from "../../src/server.ts";

const TOKEN_ENV = "AGENTA_RUNNER_TOKEN";
const previousToken = process.env[TOKEN_ENV];

const LIMIT_ENV = "AGENTA_RUNNER_CONCURRENCY_LIMIT";
const previousLimit = process.env[LIMIT_ENV];

afterEach(() => {
  if (previousToken === undefined) delete process.env[TOKEN_ENV];
  else process.env[TOKEN_ENV] = previousToken;
  if (previousLimit === undefined) delete process.env[LIMIT_ENV];
  else process.env[LIMIT_ENV] = previousLimit;
});

/**
 * The token is REQUIRED to serve, so a booted runner always has one. `listen` therefore configures
 * it (unless a test already set its own) and `AUTH` presents it: tests about something OTHER than
 * auth should not have to think about auth. Tests that probe the gate itself override the env
 * and/or omit `AUTH` deliberately.
 */
const TEST_TOKEN = "test-runner-token";
const AUTH = { authorization: `Bearer ${TEST_TOKEN}` };

async function listen(
  run: RunAgent,
  token: string | null = TEST_TOKEN,
): Promise<{ url: string; close: () => Promise<void> }> {
  // Force the configured token unconditionally (default TEST_TOKEN; `null` = leave the env
  // as the test set it, for the tokenless-boot case). A loaded dev env (`load-env` before
  // the suite) sets AGENTA_RUNNER_TOKEN=replace-me; a "set only if unset" guard would let
  // that leak in and 401 every AUTH request. afterEach restores the pre-suite value.
  if (token !== null) process.env[TOKEN_ENV] = token;
  const server = createAgentServer(run);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const okRun: RunAgent = async () => ({ ok: true, output: "hi", events: [] });

describe("createAgentServer", () => {
  it("GET /health returns runner identity", async () => {
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/health`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body.status, "ok");
      assert.equal(typeof body.runner, "string");
      assert.equal(typeof body.protocol, "number");
      assert.ok(
        Array.isArray(body.engines) &&
          (body.engines as unknown[]).includes("sandbox-agent"),
      );
      assert.ok(Array.isArray(body.harnesses));
    } finally {
      await s.close();
    }
  });

  it("POST /run returns the engine result (200)", async () => {
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ harness: "pi_core" }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean; output: string };
      assert.equal(body.ok, true);
      assert.equal(body.output, "hi");
    } finally {
      await s.close();
    }
  });

  it("POST /run with invalid JSON returns 400", async () => {
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: AUTH,
        body: "{not json",
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { ok: boolean; error: string };
      assert.equal(body.ok, false);
      assert.match(body.error, /Invalid JSON/);
    } finally {
      await s.close();
    }
  });

  it("a failing result returns 500", async () => {
    const failRun: RunAgent = async () => ({ ok: false, error: "boom" });
    const s = await listen(failRun);
    try {
      const res = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: AUTH,
        body: "{}",
      });
      assert.equal(res.status, 500);
      const body = (await res.json()) as { ok: boolean; error: string };
      assert.equal(body.ok, false);
      assert.equal(body.error, "boom");
    } finally {
      await s.close();
    }
  });

  it("POST /run is REJECTED when no token is configured (fails closed; there is no unauthenticated mode)", async () => {
    // `assertRunnerToken` stops a tokenless runner at boot, so this state is only reachable if the
    // env is mutated out from under a live process. The gate must deny, never fall open.
    const s = await listen(okRun);
    delete process.env[TOKEN_ENV];
    try {
      const res = await fetch(`${s.url}/run`, { method: "POST", body: "{}" });
      assert.equal(res.status, 401);
    } finally {
      await s.close();
    }
  });

  it("POST /run without the token returns 401 when a token is configured", async () => {
    const s = await listen(okRun, "s3cret");
    try {
      const res = await fetch(`${s.url}/run`, { method: "POST", body: "{}" });
      assert.equal(res.status, 401);
      const body = (await res.json()) as { ok: boolean; error: string };
      assert.equal(body.ok, false);
      assert.match(body.error, /Unauthorized/);
    } finally {
      await s.close();
    }
  });

  it("POST /run with a wrong token returns 401", async () => {
    const s = await listen(okRun, "s3cret");
    try {
      const res = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: { authorization: "Bearer nope" },
        body: "{}",
      });
      assert.equal(res.status, 401);
    } finally {
      await s.close();
    }
  });

  it("POST /run accepts the matching token via Authorization: Bearer", async () => {
    const s = await listen(okRun, "s3cret");
    try {
      const res = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: { authorization: "Bearer s3cret" },
        body: "{}",
      });
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });

  it("POST /run accepts the matching token via X-Agenta-Runner-Token", async () => {
    const s = await listen(okRun, "s3cret");
    try {
      const res = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: { "x-agenta-runner-token": "s3cret" },
        body: "{}",
      });
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });

  it("GET /health is reachable without the token even when one is configured", async () => {
    // Health is for liveness probes and carries no secrets, so the token gate is on /run only.
    const s = await listen(okRun, "s3cret");
    try {
      const res = await fetch(`${s.url}/health`);
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });

  it("POST /kill with sessionId + projectId drains that session's pool entry + sandboxes (idempotent)", async () => {
    // With keep-alive off (default) the pool is empty, so the drain is a no-op that still 200s.
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/kill`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ sessionId: "sess-1", projectId: "proj-1" }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean };
      assert.equal(body.ok, true);
    } finally {
      await s.close();
    }
  });

  it("POST /kill without a sessionId is rejected as unscoped (400)", async () => {
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/kill`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ projectId: "proj-1" }),
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { ok: boolean; error: string };
      assert.equal(body.ok, false);
      assert.match(body.error, /sessionId/);
    } finally {
      await s.close();
    }
  });

  it("POST /kill without a projectId is rejected as under-scoped (400), not half-executed", async () => {
    // The two teardown halves (pool key vs in-flight sandbox filter) must agree on scope; a
    // missing projectId is rejected outright instead of silently draining one and sweeping
    // the other unscoped.
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/kill`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ sessionId: "sess-1" }),
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { ok: boolean; error: string };
      assert.equal(body.ok, false);
      assert.match(body.error, /projectId/);
    } finally {
      await s.close();
    }
  });

  it("POST /kill with an empty-string projectId is rejected as under-scoped (400)", async () => {
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/kill`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ sessionId: "sess-1", projectId: "" }),
      });
      assert.equal(res.status, 400);
    } finally {
      await s.close();
    }
  });

  it("POST /kill with a non-string projectId is rejected as under-scoped (400)", async () => {
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/kill`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ sessionId: "sess-1", projectId: 12345 }),
      });
      assert.equal(res.status, 400);
    } finally {
      await s.close();
    }
  });

  it("POST /kill with invalid JSON returns 400", async () => {
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/kill`, {
        method: "POST",
        headers: AUTH,
        body: "{not json",
      });
      assert.equal(res.status, 400);
    } finally {
      await s.close();
    }
  });

  it("POST /kill with a whitespace-only projectId is rejected: a blank scope is no scope", async () => {
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/kill`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ sessionId: "sess-1", projectId: "   " }),
      });
      assert.equal(res.status, 400);
    } finally {
      await s.close();
    }
  });

  it("POST /kill with an oversized body is rejected with 413, not buffered in full", async () => {
    const s = await listen(okRun);
    try {
      const oversized = JSON.stringify({
        sessionId: "sess-1",
        // 16 KiB cap: this comfortably exceeds it.
        projectId: "p".repeat(64 * 1024),
      });
      // Stream the body in small chunks with a real event-loop tick between them (rather than
      // one synchronous fetch() write) so the server has a chance to detect the overage, respond
      // 413, and destroy the socket WHILE the client is still writing — the same interleaving an
      // actual oversized upload would race, and the scenario the destroy-mid-write guard exists
      // for. A reset while writing is an acceptable client-side outcome as long as the guard
      // itself fired before the whole body was ever buffered; a 413 response is the ideal case.
      const url = new URL(`${s.url}/kill`);
      const responseStatus = await new Promise<number | "reset">((resolve) => {
        const req = http.request(
          {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: "POST",
            // Authorized: the token gate runs BEFORE the body is read, so an un-tokened request
            // would 401 without ever exercising the 413 cap this test is about.
            headers: { "content-type": "application/json", ...AUTH },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? -1);
          },
        );
        req.on("error", () => resolve("reset"));
        (async () => {
          const chunkSize = 1024;
          for (let i = 0; i < oversized.length; i += chunkSize) {
            if (req.destroyed) return;
            const ok = req.write(oversized.slice(i, i + chunkSize));
            if (!ok) await new Promise((r) => req.once("drain", r));
            await new Promise((r) => setImmediate(r));
          }
          if (!req.destroyed) req.end();
        })();
      });
      // Either outcome proves the guard fired before the full 64 KiB body was accepted: a clean
      // 413, or the connection being reset mid-write once the cap was crossed.
      assert.ok(
        responseStatus === 413 || responseStatus === "reset",
        `expected 413 or a reset, got ${responseStatus}`,
      );
    } finally {
      await s.close();
    }
  });

  it("POST /kill with a body within the cap is unaffected by the 413 guard", async () => {
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/kill`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ sessionId: "sess-1", projectId: "proj-1" }),
      });
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });

  it("NDJSON stream: events first, then exactly one terminal result with no echoed events", async () => {
    const streamRun: RunAgent = async (_req, emit) => {
      emit?.({ type: "message", text: "a" });
      emit?.({ type: "message", text: "b" });
      return {
        ok: true,
        output: "ab",
        events: [{ type: "message", text: "a" }],
      };
    };
    const s = await listen(streamRun);
    try {
      const res = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: { accept: "application/x-ndjson", ...AUTH },
        body: "{}",
      });
      assert.equal(res.status, 200);
      const records = (await res.text())
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as {
              kind: string;
              result?: { events: unknown[] };
            },
        );
      assert.deepEqual(
        records.map((r) => r.kind),
        ["event", "event", "result"],
      );
      assert.deepEqual(
        records[2].result!.events,
        [],
        "terminal result does not echo events",
      );
    } finally {
      await s.close();
    }
  });
});

describe("normalizeKillProjectId (blank projectId scope-agreement)", () => {
  it("normalizes undefined to undefined", () => {
    assert.equal(normalizeKillProjectId(undefined), undefined);
  });

  it("normalizes a whitespace-only string to undefined", () => {
    assert.equal(normalizeKillProjectId("   "), undefined);
    assert.equal(normalizeKillProjectId(""), undefined);
    assert.equal(normalizeKillProjectId("\t\n"), undefined);
  });

  it("normalizes a non-string value to undefined", () => {
    assert.equal(normalizeKillProjectId(123), undefined);
    assert.equal(normalizeKillProjectId(null), undefined);
  });

  it("trims and keeps a real projectId", () => {
    assert.equal(normalizeKillProjectId("  proj-1  "), "proj-1");
  });
});

describe("createAgentServer: per-box concurrency admission gate", () => {
  it("rejects with 429 once the configured cap is reached", async () => {
    process.env[LIMIT_ENV] = "1";
    let release: (() => void) | undefined;
    const holdingRun: RunAgent = () =>
      new Promise((resolve) => {
        release = () => resolve({ ok: true, output: "done", events: [] });
      });
    const s = await listen(holdingRun);
    try {
      const first = fetch(`${s.url}/run`, {
        method: "POST",
        headers: AUTH,
        body: "{}",
      });
      // Give the first request a chance to reserve its slot before the second fires.
      await new Promise((resolve) => setImmediate(resolve));

      const second = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: AUTH,
        body: "{}",
      });
      assert.equal(second.status, 429);
      const body = (await second.json()) as { ok: boolean; error: string };
      assert.equal(body.ok, false);
      assert.match(body.error, /capacity/i);

      release?.();
      const firstRes = await first;
      assert.equal(firstRes.status, 200);
    } finally {
      await s.close();
    }
  });

  it("proceeds normally below the cap", async () => {
    process.env[LIMIT_ENV] = "2";
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: AUTH,
        body: "{}",
      });
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });

  it("releases the slot after the run completes, so a later request proceeds", async () => {
    process.env[LIMIT_ENV] = "1";
    const s = await listen(okRun);
    try {
      const first = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: AUTH,
        body: "{}",
      });
      assert.equal(first.status, 200);
      const second = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: AUTH,
        body: "{}",
      });
      assert.equal(second.status, 200);
    } finally {
      await s.close();
    }
  });
});

describe("registerShutdownHandler (sandbox-leak backstop on docker stop)", () => {
  // Register on real, but harmless, signals so we can drive process.emit without touching SIGTERM
  // (which would kill the test runner). The injected exit() makes the handler a no-op on exit.
  const TEST_SIGNALS = ["SIGUSR2"] as const;
  const registered: NodeJS.Signals[] = [];

  afterEach(() => {
    for (const signal of registered.splice(0))
      process.removeAllListeners(signal);
  });

  function register(opts: Parameters<typeof registerShutdownHandler>[0]) {
    registerShutdownHandler({ signals: TEST_SIGNALS, ...opts });
    registered.push(...TEST_SIGNALS);
  }

  it("registers a listener for each shutdown signal", () => {
    register({ onCleanup: async () => {}, exit: () => {} });
    for (const signal of TEST_SIGNALS) {
      assert.ok(
        process.listenerCount(signal) >= 1,
        `expected a listener on ${signal}`,
      );
    }
  });

  it("runs cleanup then exits when a signal fires", async () => {
    let cleaned = false;
    let exitCode: number | undefined;
    register({
      onCleanup: async () => {
        cleaned = true;
      },
      exit: (code) => {
        exitCode = code;
      },
    });

    process.emit("SIGUSR2", "SIGUSR2");
    // The handler awaits cleanup before exiting; let the microtasks settle.
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(cleaned, true, "cleanup ran");
    assert.equal(exitCode, 0, "process exited 0 after cleanup");
  });

  it("still exits when cleanup rejects (cleanup must never block shutdown)", async () => {
    let exitCode: number | undefined;
    register({
      onCleanup: async () => {
        throw new Error("daytona delete failed");
      },
      exit: (code) => {
        exitCode = code;
      },
    });

    process.emit("SIGUSR2", "SIGUSR2");
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(exitCode, 0, "a failing cleanup does not prevent exit");
  });

  it("cleans up only once even if the signal fires repeatedly", async () => {
    let cleanups = 0;
    register({
      onCleanup: async () => {
        cleanups += 1;
      },
      exit: () => {},
    });

    process.emit("SIGUSR2", "SIGUSR2");
    process.emit("SIGUSR2", "SIGUSR2");
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(cleanups, 1, "a repeated signal does not re-run cleanup");
  });
});

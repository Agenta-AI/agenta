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
import type { AddressInfo } from "node:net";

import {
  createAgentServer,
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
      const res = await fetch(`${s.url}/run`, { method: "POST", body: "{}" });
      assert.equal(res.status, 500);
      const body = (await res.json()) as { ok: boolean; error: string };
      assert.equal(body.ok, false);
      assert.equal(body.error, "boom");
    } finally {
      await s.close();
    }
  });

  it("POST /run is accepted with no token configured (default-off, network isolation only)", async () => {
    delete process.env[TOKEN_ENV];
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/run`, { method: "POST", body: "{}" });
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });

  it("POST /run without the token returns 401 when a token is configured", async () => {
    process.env[TOKEN_ENV] = "s3cret";
    const s = await listen(okRun);
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
    process.env[TOKEN_ENV] = "s3cret";
    const s = await listen(okRun);
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
    process.env[TOKEN_ENV] = "s3cret";
    const s = await listen(okRun);
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
    process.env[TOKEN_ENV] = "s3cret";
    const s = await listen(okRun);
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
    process.env[TOKEN_ENV] = "s3cret";
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/health`);
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });

  it("POST /kill drains the pool + sandboxes and returns 200 (idempotent)", async () => {
    // With keep-alive off (default) the pool is empty, so the drain is a no-op that still 200s.
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/kill`, { method: "POST" });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean };
      assert.equal(body.ok, true);
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
        headers: { accept: "application/x-ndjson" },
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
      const first = fetch(`${s.url}/run`, { method: "POST", body: "{}" });
      // Give the first request a chance to reserve its slot before the second fires.
      await new Promise((resolve) => setImmediate(resolve));

      const second = await fetch(`${s.url}/run`, { method: "POST", body: "{}" });
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
      const res = await fetch(`${s.url}/run`, { method: "POST", body: "{}" });
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });

  it("releases the slot after the run completes, so a later request proceeds", async () => {
    process.env[LIMIT_ENV] = "1";
    const s = await listen(okRun);
    try {
      const first = await fetch(`${s.url}/run`, { method: "POST", body: "{}" });
      assert.equal(first.status, 200);
      const second = await fetch(`${s.url}/run`, { method: "POST", body: "{}" });
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

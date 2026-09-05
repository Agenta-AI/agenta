/**
 * Unit tests for the HTTP transport via the `createAgentServer(run)` seam.
 *
 * Starts a real server on an ephemeral port with a FAKE engine (no Pi/Claude/sandbox-agent) and makes
 * real requests. Covers /health, the /run happy path, invalid JSON (400), a failing result
 * (500), and the NDJSON streaming order (events first, then exactly one terminal result).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/server.test.ts)
 */
import { afterEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import * as http from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAgentServer,
  normalizeKillProjectId,
  registerShutdownHandler,
  runWithKeepalive,
  type KeepaliveEngine,
  type RunAgent,
} from "../../src/server.ts";
import type { SessionEnvironment } from "../../src/engines/sandbox_agent.ts";
import { SessionPool } from "../../src/engines/sandbox_agent/session-pool.ts";
import { HEARTBEAT_INTERVAL_SECONDS } from "../../src/sessions/contract.ts";
import {
  liveExecutions,
  resetExecutionsForTest,
} from "../../src/sessions/execution-registry.ts";

const TOKEN_ENV = "AGENTA_RUNNER_TOKEN";
const previousToken = process.env[TOKEN_ENV];

const LIMIT_ENV = "AGENTA_RUNNER_CONCURRENCY_LIMIT";
const previousLimit = process.env[LIMIT_ENV];

afterEach(() => {
  resetExecutionsForTest();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (previousToken === undefined) delete process.env[TOKEN_ENV];
  else process.env[TOKEN_ENV] = previousToken;
  if (previousLimit === undefined) delete process.env[LIMIT_ENV];
  else process.env[LIMIT_ENV] = previousLimit;
});

/** A value that must never reach the wire: it stands in for a real credential. */
const FAKE_LOGIN_SECRET = "not-a-real-token";

/**
 * Point every subscription mount variable at a temp folder holding fake logins, so
 * `/subscription-status` answers about these files instead of the operator's own.
 */
function mountFakeLogins(): { cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "runner-subscription-"));
  const contents = JSON.stringify({ fake: FAKE_LOGIN_SECRET });
  for (const [dirEnv, file] of [
    ["CODEX_HOME", "auth.json"],
    // Mounted, but without the credentials file Claude reads: `login_missing`.
    ["CLAUDE_CONFIG_DIR", null],
    ["PI_CODING_AGENT_DIR", "auth.json"],
  ] as const) {
    const dir = join(root, dirEnv.toLowerCase());
    mkdirSync(dir, { recursive: true });
    if (file) writeFileSync(join(dir, file), contents);
    vi.stubEnv(dirEnv, dir);
  }
  return { cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

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

  it("GET /subscription-status without a token returns 401", async () => {
    // Unlike /health, this describes the operator's own login state: it stays behind the gate.
    const s = await listen(okRun, "s3cret");
    try {
      const res = await fetch(`${s.url}/subscription-status`);
      assert.equal(res.status, 401);
      const body = (await res.json()) as { ok: boolean; error: string };
      assert.equal(body.ok, false);
      assert.match(body.error, /Unauthorized/);
    } finally {
      await s.close();
    }
  });

  it("GET /subscription-status with a wrong token returns 401", async () => {
    const s = await listen(okRun, "s3cret");
    try {
      const res = await fetch(`${s.url}/subscription-status`, {
        headers: { authorization: "Bearer nope" },
      });
      assert.equal(res.status, 401);
    } finally {
      await s.close();
    }
  });

  it("GET /subscription-status with the token returns one state per harness", async () => {
    // Every mount variable is stubbed at a temp folder, so the route reads these fake logins and
    // never the login files of whoever runs the suite — and the expected states are exact.
    const mounts = mountFakeLogins();
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/subscription-status`, {
        headers: AUTH,
      });
      assert.equal(res.status, 200);
      const raw = await res.text();
      const body = JSON.parse(raw) as {
        version: number;
        harnesses: Record<string, { state: string; provider?: string }>;
      };
      assert.equal(body.version, 1);
      assert.deepEqual(body.harnesses, {
        // A login file that parses.
        codex: { state: "ready", provider: "openai" },
        // A mounted folder without the credentials file.
        claude: { state: "login_missing", provider: "anthropic" },
        // One Pi mount, one login: both Pi harnesses read it.
        pi_core: { state: "ready" },
      });
      // The fake credential sitting in the login file the route just read is not on the wire,
      // and neither is any path.
      assert.ok(
        !raw.includes(FAKE_LOGIN_SECRET),
        `response leaked the login contents: ${raw}`,
      );
      assert.ok(!raw.includes("/"), `response carried a path: ${raw}`);
    } finally {
      await s.close();
      mounts.cleanup();
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

  it("persists one stopped ending when user Stop aborts a slow cold acquire", async () => {
    let markAcquireStarted!: () => void;
    const acquireStarted = new Promise<void>((resolve) => {
      markAcquireStarted = resolve;
    });
    let runTurnCalls = 0;
    const engine: KeepaliveEngine = {
      async resolveKeepaliveMount() {
        return null;
      },
      async acquireEnvironment(_request, signal) {
        markAcquireStarted();
        await new Promise<void>((resolve) => {
          if (signal?.aborted) return resolve();
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return { ok: false, error: "sandbox acquisition aborted" };
      },
      async runTurn() {
        runTurnCalls += 1;
        return { ok: true, output: "must not run" };
      },
      async runCold() {
        return { ok: false, error: "must not run cold fallback" };
      },
    };
    const run: RunAgent = (request, emit, signal) =>
      runWithKeepalive(request, emit, signal, {
        engine,
        pool: new SessionPool<SessionEnvironment>({ poolMax: 1 }),
        config: {
          enabled: true,
          ttlMs: 60_000,
          approvalTtlMs: 60_000,
          poolMax: 1,
        },
      });
    const s = await listen(run);
    const realFetch = globalThis.fetch.bind(globalThis);
    const ingested: Array<Record<string, any>> = [];
    let heartbeatCount = 0;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === `${s.url}/run`) return realFetch(input, init);
        if (url.endsWith("/sessions/streams/heartbeat")) {
          heartbeatCount += 1;
          return Response.json({
            stream: { id: "stream-stop-during-acquire" },
            is_current_turn: heartbeatCount === 1,
          });
        }
        if (url.endsWith("/sessions/records/ingest")) {
          ingested.push(JSON.parse(String(init?.body)));
        }
        return Response.json({});
      });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    try {
      const responsePromise = fetchSpy(`${s.url}/run`, {
        method: "POST",
        headers: { accept: "application/x-ndjson", ...AUTH },
        body: JSON.stringify({
          harness: "pi_core",
          sandbox: "local",
          sessionId: "session-stop-during-acquire",
          runContext: { project: { id: "project-1" } },
          telemetry: {
            exporters: {
              otlp: {
                endpoint: `${s.url}/otlp/v1/traces`,
                headers: { authorization: "Test platform authorization" },
              },
            },
          },
          messages: [{ role: "user", content: "start slowly" }],
        }),
      });

      await acquireStarted;
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_SECONDS * 1000);
      const response = await responsePromise;
      const records = (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, any>);

      assert.equal(runTurnCalls, 0, "the Stop landed before the turn started");
      const endings = ingested.filter(
        (record) => record.record_type === "done",
      );
      assert.equal(endings.length, 1, "the transcript has one terminal record");
      assert.equal(
        ingested.filter((record) => record.record_type === "error").length,
        0,
        "a user Stop does not persist an acquire error",
      );
      assert.deepEqual(endings[0].attributes, {
        type: "done",
        stopReason: "cancelled",
      });
      assert.equal(
        records.filter((record) => record.kind === "result").length,
        1,
        "the run outcome is reported once",
      );
      assert.equal(records.at(-1)?.result.ok, false);
    } finally {
      vi.useRealTimers();
      fetchSpy.mockRestore();
      await s.close();
    }
  });

  it("persists an acquire failure error before exactly one ending", async () => {
    const acquireError = "sandbox mount failed";
    let runTurnCalls = 0;
    const engine: KeepaliveEngine = {
      async resolveKeepaliveMount() {
        return null;
      },
      async acquireEnvironment() {
        return { ok: false, error: acquireError };
      },
      async runTurn() {
        runTurnCalls += 1;
        return { ok: true, output: "must not run" };
      },
      async runCold() {
        return { ok: false, error: "must not run cold fallback" };
      },
    };
    const run: RunAgent = (request, emit, signal) =>
      runWithKeepalive(request, emit, signal, {
        engine,
        pool: new SessionPool<SessionEnvironment>({ poolMax: 1 }),
        config: {
          enabled: true,
          ttlMs: 60_000,
          approvalTtlMs: 60_000,
          poolMax: 1,
        },
      });
    const s = await listen(run);
    const realFetch = globalThis.fetch.bind(globalThis);
    const ingested: Array<Record<string, any>> = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === `${s.url}/run`) return realFetch(input, init);
        if (url.endsWith("/sessions/streams/heartbeat")) {
          return Response.json({
            stream: { id: "stream-acquire-failure" },
            is_current_turn: true,
          });
        }
        if (url.endsWith("/sessions/records/ingest")) {
          ingested.push(JSON.parse(String(init?.body)));
        }
        return Response.json({});
      });

    try {
      const response = await fetchSpy(`${s.url}/run`, {
        method: "POST",
        headers: { accept: "application/x-ndjson", ...AUTH },
        body: JSON.stringify({
          harness: "pi_core",
          sandbox: "local",
          sessionId: "session-acquire-failure",
          runContext: { project: { id: "project-1" } },
          telemetry: {
            exporters: {
              otlp: {
                endpoint: `${s.url}/otlp/v1/traces`,
                headers: { authorization: "Test platform authorization" },
              },
            },
          },
          messages: [{ role: "user", content: "fail during acquire" }],
        }),
      });
      const records = (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, any>);

      assert.equal(runTurnCalls, 0, "the failed acquire never starts the turn");
      const endingRecords = ingested.filter((record) =>
        ["error", "done"].includes(record.record_type),
      );
      assert.deepEqual(
        endingRecords.map((record) => record.record_type),
        ["error", "done"],
        "the transcript preserves the error before its ending",
      );
      assert.deepEqual(endingRecords[0].attributes, {
        type: "error",
        message: acquireError,
      });
      assert.deepEqual(endingRecords[1].attributes, { type: "done" });
      assert.equal(
        records.filter((record) => record.kind === "result").length,
        1,
        "the failed run outcome is reported once",
      );
      assert.equal(records.at(-1)?.result.error, acquireError);
    } finally {
      fetchSpy.mockRestore();
      await s.close();
    }
  });

  it("keeps the normal Stop path at exactly one persisted ending", async () => {
    const normalStop: RunAgent = async (_request, emit) => {
      emit?.({ type: "done", stopReason: "cancelled" });
      return { ok: true, stopReason: "cancelled", events: [] };
    };
    const s = await listen(normalStop);
    const realFetch = globalThis.fetch.bind(globalThis);
    const ingested: Array<Record<string, any>> = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === `${s.url}/run`) return realFetch(input, init);
        if (url.endsWith("/sessions/streams/heartbeat")) {
          return Response.json({
            stream: { id: "stream-normal-stop" },
            is_current_turn: true,
          });
        }
        if (url.endsWith("/sessions/records/ingest")) {
          ingested.push(JSON.parse(String(init?.body)));
        }
        return Response.json({});
      });

    try {
      const response = await fetchSpy(`${s.url}/run`, {
        method: "POST",
        headers: { accept: "application/x-ndjson", ...AUTH },
        body: JSON.stringify({
          harness: "pi_core",
          sessionId: "session-normal-stop",
          telemetry: {
            exporters: {
              otlp: {
                endpoint: `${s.url}/otlp/v1/traces`,
                headers: { authorization: "Test platform authorization" },
              },
            },
          },
          messages: [{ role: "user", content: "stop normally" }],
        }),
      });
      const records = (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, any>);

      const endings = ingested.filter(
        (record) => record.record_type === "done",
      );
      assert.equal(
        endings.length,
        1,
        "the server must not duplicate runTurn's ending",
      );
      assert.deepEqual(endings[0].attributes, {
        type: "done",
        stopReason: "cancelled",
      });
      assert.equal(
        records.filter(
          (record) => record.kind === "event" && record.event?.type === "done",
        ).length,
        1,
        "the normal Stop still streams its one done event",
      );
      assert.equal(
        records.filter((record) => record.kind === "result").length,
        1,
        "the run outcome is reported once",
      );
    } finally {
      fetchSpy.mockRestore();
      await s.close();
    }
  });
  for (const testCase of [
    { name: "plain", sessionOwned: false, detached: false, aborts: true },
    { name: "session-owned", sessionOwned: true, detached: false, aborts: false },
    { name: "detached", sessionOwned: true, detached: true, aborts: false },
  ]) {
    it(`a dropped ${testCase.name} invoke ${testCase.aborts ? "cancels" : "does not cancel"} the turn`, async () => {
      vi.stubEnv("AGENTA_API_INTERNAL_URL", "http://api:8000");
      let releaseRun: (() => void) | undefined;
      let observedAbort = false;
      let completed = false;
      let markStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const run: RunAgent = async (_request, _emit, signal) => {
        markStarted?.();
        return await new Promise((resolve) => {
          const finish = () => {
            if (completed) return;
            completed = true;
            resolve({ ok: true, output: "done", events: [] });
          };
          releaseRun = finish;
          signal?.addEventListener(
            "abort",
            () => {
              observedAbort = true;
              finish();
            },
            { once: true },
          );
        });
      };
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith("/sessions/streams/heartbeat")) {
          return Response.json({
            stream: { id: "stream-1" },
            is_current_turn: true,
          });
        }
        return Response.json({});
      });
      const s = await listen(run);

      try {
        const request = http.request(`${s.url}/run`, {
          method: "POST",
          headers: {
            ...AUTH,
            accept: "application/x-ndjson",
            "content-type": "application/json",
          },
        });
        request.on("error", () => {});
        request.end(
          JSON.stringify({
            harness: "pi_core",
            ...(testCase.sessionOwned ? { sessionId: `session-${testCase.name}` } : {}),
            ...(testCase.detached ? { detached: true } : {}),
            telemetry: {
              exporters: {
                otlp: {
                  endpoint: "http://127.0.0.1:8000/otlp/v1/traces",
                  headers: { authorization: "ApiKey test" },
                },
              },
            },
            messages: [{ role: "user", content: "hello" }],
          }),
        );

        await started;
        request.destroy();
        await new Promise<void>((resolve) => setTimeout(resolve, 25));

        if (!testCase.aborts) {
          assert.equal(observedAbort, false, "the dropped response must not own turn lifetime");
          assert.equal(completed, false, "the fake turn is still running after disconnect");
          releaseRun?.();
        }

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("run did not settle")), 1_000);
          const poll = () => {
            if (completed) {
              clearTimeout(timeout);
              resolve();
            } else setImmediate(poll);
          };
          poll();
        });
        assert.equal(observedAbort, testCase.aborts);
      } finally {
        releaseRun?.();
        await s.close();
        fetchSpy.mockRestore();
      }
    });
  }

  it("redacts this run's credentials from the stderr stack log when a run throws", async () => {
    // A per-run provider key rides ONLY the typed request (never process env). When the run
    // throws with that key captured in the error message/stack (an auth failure echoing it,
    // a dumped env), the stack must pass through the run's deny-set before reaching the
    // stderr sink — persistence is already redacted; stderr must be too.
    const PER_RUN_KEY = "sk-escaping-stack-fake-key-DO-NOT-USE-9a8b7c";
    const throwingRun: RunAgent = async () => {
      throw new Error(`provider auth failed for key ${PER_RUN_KEY}`);
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = await listen(throwingRun);
    try {
      const res = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: { accept: "application/x-ndjson", ...AUTH },
        body: JSON.stringify({
          modelConnection: {
            provider: "openai",
            deployment: "direct",
            endpoint: { baseUrl: "https://api.openai.com/v1" },
            credentialMode: "env",
            credentials: [
              {
                binding: { kind: "environment", name: "OPENAI_API_KEY" },
                value: PER_RUN_KEY,
                usage: "opaque_http",
              },
            ],
          },
        }),
      });
      assert.equal(res.status, 200);
      const records = (await res.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, any>);
      // The escaping error still terminates the stream with a failed result.
      assert.equal(records.at(-1)!.kind, "result");
      assert.equal(records.at(-1)!.result.ok, false);

      const logged = errorSpy.mock.calls
        .map((args) => args.map(String).join(" "))
        .join("\n");
      // The log keeps its shape (an Error stack was written)...
      assert.match(logged, /Error: provider auth failed/);
      assert.match(logged, /\n\s+at /);
      // ...but the live credential value never reaches the stderr sink.
      assert.equal(logged.includes(PER_RUN_KEY), false);
      assert.match(logged, /\[ag:redacted/);
    } finally {
      await s.close();
    }
  });

  it("persists one terminal done record when a session-owned run throws", async () => {
    const s = await listen(async () => {
      throw new Error("engine escaped");
    });
    const realFetch = globalThis.fetch.bind(globalThis);
    const ingested: Array<Record<string, any>> = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === `${s.url}/run`) return realFetch(input, init);
        if (url.endsWith("/sessions/streams/heartbeat")) {
          return Response.json({
            stream: { id: "stream-escaped-run" },
            is_current_turn: true,
          });
        }
        if (url.endsWith("/sessions/records/ingest")) {
          ingested.push(JSON.parse(String(init?.body)));
        }
        return Response.json({});
      });

    try {
      const response = await fetchSpy(`${s.url}/run`, {
        method: "POST",
        headers: { accept: "application/x-ndjson", ...AUTH },
        body: JSON.stringify({
          harness: "pi_core",
          sessionId: "session-escaped-run",
          runContext: { project: { id: "project-1" } },
          telemetry: {
            exporters: {
              otlp: {
                endpoint: `${s.url}/otlp/v1/traces`,
                headers: { authorization: "Test platform authorization" },
              },
            },
          },
          messages: [{ role: "user", content: "throw" }],
        }),
      });
      const records = (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, any>);

      assert.deepEqual(
        ingested
          .filter((record) => ["error", "done"].includes(record.record_type))
          .map((record) => record.record_type),
        ["error", "done"],
      );
      assert.equal(
        ingested.filter((record) => record.record_type === "done").length,
        1,
      );
      assert.equal(records.filter((record) => record.kind === "result").length, 1);
      assert.equal(records.at(-1)?.result.error, "engine escaped");
    } finally {
      fetchSpy.mockRestore();
      errorSpy.mockRestore();
      await s.close();
    }
  });

  it("rejects an over-cap session turn before persistence or attachment claiming", async () => {
    // Override the cap rather than generating a default-sized batch, so the case stays small.
    process.env.AGENTA_ATTACHMENTS_MAX_PER_TURN = "2";
    const attachmentIds = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ];
    let runCalls = 0;
    const s = await listen(async () => {
      runCalls += 1;
      return { ok: true, output: "should not run", events: [] };
    });
    const realFetch = globalThis.fetch.bind(globalThis);
    const sessionApiCalls: string[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === `${s.url}/run`) return realFetch(input, init);
        // Trace export is unrelated to session persistence; keep it out so an empty-list
        // failure can only mean a persist or claim call happened.
        if (!url.includes("/otlp/")) sessionApiCalls.push(url);
        return new Response("{}", { status: 200 });
      });

    try {
      const res = await fetchSpy(`${s.url}/run`, {
        method: "POST",
        headers: { accept: "application/x-ndjson", ...AUTH },
        body: JSON.stringify({
          harness: "pi_core",
          sessionId: "session-1",
          telemetry: {
            exporters: {
              otlp: {
                endpoint: `${s.url}/otlp/v1/traces`,
                headers: { authorization: "ApiKey test" },
              },
            },
          },
          messages: [
            {
              role: "user",
              content: attachmentIds.map((attachmentId) => ({
                type: "attachment",
                attachmentId,
              })),
            },
          ],
        }),
      });
      const records = (await res.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, any>);

      assert.equal(runCalls, 0);
      assert.deepEqual(sessionApiCalls, []);
      assert.equal(records.length, 1);
      assert.equal(records[0].kind, "result");
      assert.equal(records[0].result.ok, false);
      assert.equal(
        records[0].result.error,
        "A user turn may carry at most 2 attachments.",
      );
      assert.deepEqual(liveExecutions(), []);
    } finally {
      delete process.env.AGENTA_ATTACHMENTS_MAX_PER_TURN;
      fetchSpy.mockRestore();
      await s.close();
    }
  });

  it("never sends a third-party collector credential to session APIs", async () => {
    // The protection is only decidable once the runner knows its own PUBLIC api base: without it
    // a public-looking endpoint could equally be this platform under its public name. Configure it
    // here so this case exercises the armed check rather than the undecidable state (which the
    // sibling case below covers).
    vi.stubEnv("AGENTA_API_URL", "https://agenta.example.test/api");
    let engineCredential: string | undefined;
    const s = await listen(async (_request, _emit, _signal, options) => {
      engineCredential = options?.credential?.();
      return { ok: true, output: "done", events: [] };
    });
    const realFetch = globalThis.fetch.bind(globalThis);
    const platformCalls: Array<{ url: string; authorization: string }> = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === `${s.url}/run`) return realFetch(input, init);
        const headers = (init?.headers ?? {}) as Record<string, string>;
        platformCalls.push({
          url,
          authorization: headers.authorization ?? "",
        });
        if (url.endsWith("/sessions/streams/heartbeat")) {
          return Response.json({
            stream: { id: "stream-1" },
            is_current_turn: true,
          });
        }
        return Response.json({});
      });

    try {
      const res = await fetchSpy(`${s.url}/run`, {
        method: "POST",
        headers: { accept: "application/x-ndjson", ...AUTH },
        body: JSON.stringify({
          harness: "pi_core",
          sessionId: "session-third-party",
          telemetry: {
            exporters: {
              otlp: {
                endpoint: "https://collector.example.test/v1/traces",
                headers: {
                  authorization: "Bearer collector-secret",
                },
              },
            },
          },
          messages: [{ role: "user", content: "hello" }],
        }),
      });
      await res.text();

      assert.equal(engineCredential, "");
      assert.equal(
        platformCalls.some((call) =>
          call.url.endsWith("/sessions/streams/heartbeat"),
        ),
        true,
      );
      assert.equal(
        platformCalls.some(
          (call) => call.authorization === "Bearer collector-secret",
        ),
        false,
      );
    } finally {
      fetchSpy.mockRestore();
      await s.close();
    }
  });

  it("still authenticates session APIs when only the internal api hop is configured", async () => {
    // The self-hosted shape that broke in v0.114.0. The api and services containers know the
    // deployment by its public name, so a dispatched run's trace endpoint is the public base,
    // while the runner is given only the in-network hop. Those two never string-match, and
    // dropping the credential there 401s every session call — persistence, heartbeat, and the
    // history rebuild that reports it as "record log is unreadable". Undecidable must not mean
    // unauthenticated.
    vi.stubEnv("AGENTA_API_URL", undefined);
    vi.stubEnv("AGENTA_API_INTERNAL_URL", "http://api:8000");
    let engineCredential: string | undefined;
    const s = await listen(async (_request, _emit, _signal, options) => {
      engineCredential = options?.credential?.();
      return { ok: true, output: "done", events: [] };
    });
    const realFetch = globalThis.fetch.bind(globalThis);
    const platformCalls: Array<{ url: string; authorization: string }> = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === `${s.url}/run`) return realFetch(input, init);
        const headers = (init?.headers ?? {}) as Record<string, string>;
        platformCalls.push({ url, authorization: headers.authorization ?? "" });
        if (url.endsWith("/sessions/streams/heartbeat")) {
          return Response.json({
            stream: { id: "stream-1" },
            is_current_turn: true,
          });
        }
        return Response.json({});
      });

    try {
      const res = await fetchSpy(`${s.url}/run`, {
        method: "POST",
        headers: { accept: "application/x-ndjson", ...AUTH },
        body: JSON.stringify({
          harness: "pi_core",
          sessionId: "session-self-hosted",
          telemetry: {
            exporters: {
              otlp: {
                endpoint: "https://selfhosted.example.test/api/otlp/v1/traces",
                headers: { authorization: "Secret platform-credential" },
              },
            },
          },
          messages: [{ role: "user", content: "hello" }],
        }),
      });
      await res.text();

      assert.equal(engineCredential, "Secret platform-credential");
      assert.equal(
        platformCalls.some(
          (call) => call.authorization === "Secret platform-credential",
        ),
        true,
      );
    } finally {
      fetchSpy.mockRestore();
      await s.close();
    }
  });

  it("persists a legacy image-only tail without attachment references", async () => {
    let runCalls = 0;
    const s = await listen(async () => {
      runCalls += 1;
      return { ok: true, output: "done", events: [] };
    });
    const realFetch = globalThis.fetch.bind(globalThis);
    const ingested: Array<Record<string, any>> = [];
    const sessionApiCalls: string[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === `${s.url}/run`) return realFetch(input, init);
        sessionApiCalls.push(url);
        if (url.endsWith("/sessions/streams/heartbeat")) {
          return Response.json({
            stream: { id: "stream-1" },
            is_current_turn: true,
          });
        }
        if (url.endsWith("/sessions/records/ingest")) {
          ingested.push(JSON.parse(String(init?.body)));
        }
        return Response.json({});
      });

    try {
      const res = await fetchSpy(`${s.url}/run`, {
        method: "POST",
        headers: { accept: "application/x-ndjson", ...AUTH },
        body: JSON.stringify({
          harness: "pi_core",
          sessionId: "session-1",
          telemetry: {
            exporters: {
              otlp: {
                endpoint: `${s.url}/otlp/v1/traces`,
                headers: { authorization: "ApiKey test" },
              },
            },
          },
          messages: [
            {
              role: "user",
              content: [{ type: "image", uri: "data:image/png;base64,AQID" }],
            },
          ],
        }),
      });
      await res.text();

      assert.equal(runCalls, 1);
      const userRecords = ingested.filter(
        (record) => record.record_source === "user",
      );
      assert.equal(userRecords.length, 1);
      assert.deepEqual(userRecords[0].attributes, {
        type: "message",
        text: "",
        attachments: [],
      });
      assert.equal(
        sessionApiCalls.some((url) =>
          url.endsWith("/sessions/attachments/reference"),
        ),
        false,
      );
    } finally {
      fetchSpy.mockRestore();
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

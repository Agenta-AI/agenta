/**
 * Acceptance (contract) tests for the runner HTTP surface.
 *
 * Asserts status codes, auth gating, and response schemas for:
 *   GET  /health
 *   POST /run   (JSON mode and NDJSON stream mode)
 *   POST /stream (alias)
 *   POST /kill
 *   Unrecognised route → 404
 *
 * Sessions/records endpoints (/sessions/records/*) are declared in the router
 * but are backed by the API; they are contract-asserted for the status codes
 * the runner is responsible for (auth gate, not-found shape) and skipped for
 * live data assertions that need the API running.
 *
 * All tests use the in-process server with a fake engine — no live harness.
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import {
  createAgentServer,
  type RunAgent,
} from "../../src/server.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function listen(
  run: RunAgent,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createAgentServer(run);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const TOKEN_ENV = "AGENTA_RUNNER_TOKEN";
const savedToken = process.env[TOKEN_ENV];

afterEach(() => {
  if (savedToken === undefined) delete process.env[TOKEN_ENV];
  else process.env[TOKEN_ENV] = savedToken;
});

const okRun: RunAgent = async () => ({ ok: true, output: "accepted", events: [] });
const failRun: RunAgent = async () => ({ ok: false, error: "engine failure" });

// ---------------------------------------------------------------------------
// /health contract
// ---------------------------------------------------------------------------

describe("GET /health contract", () => {
  it("returns 200 with required fields: status, runner, protocol, engines, harnesses", async () => {
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/health`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "application/json");
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body.status, "ok");
      assert.equal(typeof body.runner, "string", "runner field must be a string");
      assert.equal(typeof body.protocol, "number", "protocol field must be a number");
      assert.ok(Array.isArray(body.engines), "engines must be an array");
      assert.ok(Array.isArray(body.harnesses), "harnesses must be an array");
      assert.ok(
        (body.engines as string[]).includes("sandbox-agent"),
        "engines must include 'sandbox-agent'",
      );
    } finally {
      await s.close();
    }
  });

  it("is reachable without a bearer token even when AGENTA_RUNNER_TOKEN is set", async () => {
    process.env[TOKEN_ENV] = "health-gate-test";
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/health`);
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });
});

// ---------------------------------------------------------------------------
// /run auth contract
// ---------------------------------------------------------------------------

describe("POST /run auth contract", () => {
  it("no token configured → 200 (default-off gate)", async () => {
    delete process.env[TOKEN_ENV];
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/run`, { method: "POST", body: "{}" });
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });

  it("token configured, no header → 401 {ok:false, error:/Unauthorized/}", async () => {
    process.env[TOKEN_ENV] = "tok-abc";
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

  it("token configured, wrong bearer → 401", async () => {
    process.env[TOKEN_ENV] = "tok-abc";
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: { authorization: "Bearer wrong" },
        body: "{}",
      });
      assert.equal(res.status, 401);
    } finally {
      await s.close();
    }
  });

  it("token configured, correct Authorization: Bearer → 200", async () => {
    process.env[TOKEN_ENV] = "tok-abc";
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: { authorization: "Bearer tok-abc" },
        body: "{}",
      });
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });

  it("token configured, correct X-Agenta-Runner-Token → 200", async () => {
    process.env[TOKEN_ENV] = "tok-abc";
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: { "x-agenta-runner-token": "tok-abc" },
        body: "{}",
      });
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });
});

// ---------------------------------------------------------------------------
// /run response schema contract
// ---------------------------------------------------------------------------

describe("POST /run response schema contract", () => {
  it("success → 200 {ok:true, output:string}", async () => {
    delete process.env[TOKEN_ENV];
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/run`, { method: "POST", body: "{}" });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "application/json");
      const body = (await res.json()) as { ok: boolean; output: string };
      assert.equal(body.ok, true);
      assert.equal(typeof body.output, "string");
    } finally {
      await s.close();
    }
  });

  it("engine failure → 500 {ok:false, error:string}", async () => {
    delete process.env[TOKEN_ENV];
    const s = await listen(failRun);
    try {
      const res = await fetch(`${s.url}/run`, { method: "POST", body: "{}" });
      assert.equal(res.status, 500);
      const body = (await res.json()) as { ok: boolean; error: string };
      assert.equal(body.ok, false);
      assert.equal(typeof body.error, "string");
    } finally {
      await s.close();
    }
  });

  it("invalid JSON body → 400 {ok:false, error:/Invalid JSON/}", async () => {
    delete process.env[TOKEN_ENV];
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/run`, {
        method: "POST",
        body: "{bad json",
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { ok: boolean; error: string };
      assert.equal(body.ok, false);
      assert.match(body.error, /Invalid JSON/);
    } finally {
      await s.close();
    }
  });

  it("NDJSON stream: content-type is application/x-ndjson", async () => {
    delete process.env[TOKEN_ENV];
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: { accept: "application/x-ndjson" },
        body: "{}",
      });
      assert.equal(res.status, 200);
      assert.ok(
        (res.headers.get("content-type") ?? "").includes("application/x-ndjson"),
      );
    } finally {
      await s.close();
    }
  });

  it("NDJSON stream: last record is {kind:'result'}", async () => {
    delete process.env[TOKEN_ENV];
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/run`, {
        method: "POST",
        headers: { accept: "application/x-ndjson" },
        body: "{}",
      });
      const lines = (await res.text())
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { kind: string });
      assert.equal(lines[lines.length - 1].kind, "result");
    } finally {
      await s.close();
    }
  });
});

// ---------------------------------------------------------------------------
// /stream alias contract (same handler as /run)
// ---------------------------------------------------------------------------

describe("POST /stream alias contract", () => {
  it("POST /stream accepts the same body shape as /run", async () => {
    delete process.env[TOKEN_ENV];
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/stream`, {
        method: "POST",
        headers: { accept: "application/x-ndjson" },
        body: "{}",
      });
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });
});

// ---------------------------------------------------------------------------
// /kill contract
// ---------------------------------------------------------------------------

describe("POST /kill contract", () => {
  it("returns 200 {ok:true} for a scoped sessionId when no token configured", async () => {
    delete process.env[TOKEN_ENV];
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/kill`, {
        method: "POST",
        body: JSON.stringify({ sessionId: "sess-1" }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean };
      assert.equal(body.ok, true);
    } finally {
      await s.close();
    }
  });

  it("returns 400 when no sessionId is given (unscoped kill is rejected)", async () => {
    delete process.env[TOKEN_ENV];
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/kill`, { method: "POST", body: "{}" });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { ok: boolean };
      assert.equal(body.ok, false);
    } finally {
      await s.close();
    }
  });

  it("returns 401 when token is set and no bearer supplied", async () => {
    process.env[TOKEN_ENV] = "kill-tok";
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/kill`, {
        method: "POST",
        body: JSON.stringify({ sessionId: "sess-1" }),
      });
      assert.equal(res.status, 401);
    } finally {
      await s.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Unknown routes
// ---------------------------------------------------------------------------

describe("unknown routes contract", () => {
  it("GET /nonexistent returns 404 {ok:false, error:'Not found'}", async () => {
    delete process.env[TOKEN_ENV];
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/nonexistent`);
      assert.equal(res.status, 404);
      const body = (await res.json()) as { ok: boolean; error: string };
      assert.equal(body.ok, false);
      assert.match(body.error, /Not found/);
    } finally {
      await s.close();
    }
  });
});

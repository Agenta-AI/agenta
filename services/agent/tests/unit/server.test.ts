/**
 * Unit tests for the HTTP transport via the `createAgentServer(run)` seam.
 *
 * Starts a real server on an ephemeral port with a FAKE engine (no Pi/Claude/rivet) and makes
 * real requests. Covers /health, the /run happy path, invalid JSON (400), a failing result
 * (500), and the NDJSON streaming order (events first, then exactly one terminal result).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/server.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import { createAgentServer, type RunAgent } from "../../src/server.ts";

async function listen(run: RunAgent): Promise<{ url: string; close: () => Promise<void> }> {
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
      assert.ok(Array.isArray(body.engines) && (body.engines as unknown[]).includes("pi"));
      assert.ok(Array.isArray(body.harnesses));
    } finally {
      await s.close();
    }
  });

  it("POST /run returns the engine result (200)", async () => {
    const s = await listen(okRun);
    try {
      const res = await fetch(`${s.url}/run`, { method: "POST", body: JSON.stringify({ backend: "pi" }) });
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
      const res = await fetch(`${s.url}/run`, { method: "POST", body: "{not json" });
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

  it("NDJSON stream: events first, then exactly one terminal result with no echoed events", async () => {
    const streamRun: RunAgent = async (_req, emit) => {
      emit?.({ type: "message", text: "a" });
      emit?.({ type: "message", text: "b" });
      return { ok: true, output: "ab", events: [{ type: "message", text: "a" }] };
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
        .map((line) => JSON.parse(line) as { kind: string; result?: { events: unknown[] } });
      assert.deepEqual(records.map((r) => r.kind), ["event", "event", "result"]);
      assert.deepEqual(records[2].result!.events, [], "terminal result does not echo events");
    } finally {
      await s.close();
    }
  });
});

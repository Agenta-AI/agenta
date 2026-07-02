/**
 * Unit tests for the E2B idle-refresh keepalive (D3).
 *
 * `startE2BKeepalive` takes an injectable `extend` function so this never touches the real
 * `@e2b/code-interpreter` SDK (no E2B_API_KEY / network needed) — see `extendE2BSandboxTimeout`
 * in e2b-keepalive.ts for the real wiring.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-e2b-keepalive.test.ts)
 */
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";

import {
  e2bKeepaliveIntervalMs,
  startE2BKeepalive,
} from "../../src/engines/sandbox_agent/e2b-keepalive.ts";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("e2bKeepaliveIntervalMs", () => {
  it("divides the timeout by 3", () => {
    assert.equal(e2bKeepaliveIntervalMs(30 * 60 * 1000), 10 * 60 * 1000);
  });

  it("clamps to a 1s floor so a tiny timeout cannot busy-loop", () => {
    assert.equal(e2bKeepaliveIntervalMs(300), 1000);
  });

  it("floors a fractional result", () => {
    assert.equal(e2bKeepaliveIntervalMs(10_000), 3333);
  });
});

describe("startE2BKeepalive", () => {
  it("does not refresh immediately on start (the sandbox already has a fresh timeout)", () => {
    const calls: Array<[string, number]> = [];
    const extend = async (sandboxId: string, timeoutMs: number) => {
      calls.push([sandboxId, timeoutMs]);
    };
    const handle = startE2BKeepalive("sbx-1", 30_000, extend);
    assert.equal(calls.length, 0);
    handle.stop();
  });

  it("refreshes on each interval tick with the sandbox id and configured timeout", async () => {
    const calls: Array<[string, number]> = [];
    const extend = async (sandboxId: string, timeoutMs: number) => {
      calls.push([sandboxId, timeoutMs]);
    };
    const handle = startE2BKeepalive("sbx-2", 30_000, extend);

    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ["sbx-2", 30_000]);

    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal(calls.length, 2);

    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal(calls.length, 3);

    handle.stop();
  });

  it("stop() halts further refreshes", async () => {
    const calls: Array<[string, number]> = [];
    const extend = async (sandboxId: string, timeoutMs: number) => {
      calls.push([sandboxId, timeoutMs]);
    };
    const handle = startE2BKeepalive("sbx-3", 30_000, extend);

    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal(calls.length, 1);

    handle.stop();

    await vi.advanceTimersByTimeAsync(60_000);
    assert.equal(calls.length, 1, "no more refreshes should fire after stop()");
  });

  it("stop() is idempotent (safe to call twice, e.g. from a finally after an early return)", () => {
    const extend = async () => {};
    const handle = startE2BKeepalive("sbx-4", 30_000, extend);
    handle.stop();
    assert.doesNotThrow(() => handle.stop());
  });

  it("swallows a rejected extend() and keeps refreshing on the next tick", async () => {
    let attempt = 0;
    const extend = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("transient e2b api error");
    };
    const logs: string[] = [];
    const handle = startE2BKeepalive("sbx-5", 30_000, extend, (m) => logs.push(m));

    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal(attempt, 1);
    assert.ok(logs.some((l) => l.includes("sbx-5")), "expected the failure to be logged");

    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal(attempt, 2, "a failed refresh must not stop the interval");

    handle.stop();
  });
});

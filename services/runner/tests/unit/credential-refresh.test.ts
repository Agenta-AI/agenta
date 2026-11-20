import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";

import {
  DEFAULT_CREDENTIAL_REFRESH_TIMEOUT_MS,
  refreshCredential,
  startPlatformCredentialLease,
} from "../../src/sessions/auth.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = realFetch;
});

/** A response whose body never arrives, and errors only when the request signal aborts. */
function stalledBody(signal: AbortSignal | null | undefined): Response {
  const body = new ReadableStream({
    start(controller) {
      signal?.addEventListener("abort", () =>
        controller.error(new DOMException("aborted", "AbortError")),
      );
    },
  });
  return new Response(body, { status: 200 });
}

describe("platform credential lease", () => {
  it("refreshes proactively and exposes the latest credential", async () => {
    vi.useFakeTimers();
    const calls: Array<{ baseUrl: string; authorization: string }> = [];
    const lease = startPlatformCredentialLease(
      "https://api.agenta.test/api",
      "Secret initial",
      {
        intervalMs: 1_000,
        refresh: async (baseUrl, authorization) => {
          calls.push({ baseUrl, authorization });
          return "Secret refreshed";
        },
      },
    );

    assert.equal(lease.credential(), "Secret initial");
    await vi.advanceTimersByTimeAsync(1_000);
    assert.deepEqual(calls, [
      {
        baseUrl: "https://api.agenta.test/api",
        authorization: "Secret initial",
      },
    ]);
    assert.equal(lease.credential(), "Secret refreshed");
    assert.equal(lease.seed, "Secret initial", "the seed stays the value the lease started from");

    lease.release();
    await vi.advanceTimersByTimeAsync(5_000);
    assert.equal(calls.length, 1);
  });

  it("keeps the last credential when refresh fails", async () => {
    vi.useFakeTimers();
    const lease = startPlatformCredentialLease(
      "https://api.agenta.test/api",
      "Secret initial",
      {
        intervalMs: 1_000,
        refresh: async () => null,
      },
    );

    await vi.advanceTimersByTimeAsync(1_000);
    assert.equal(lease.credential(), "Secret initial");
    lease.release();
  });

  it("does not start a permission exchange without a platform credential", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => "unexpected");
    const lease = startPlatformCredentialLease(
      "https://api.agenta.test/api",
      "",
      { intervalMs: 1_000, refresh },
    );

    await vi.advanceTimersByTimeAsync(5_000);
    assert.equal(refresh.mock.calls.length, 0);
    lease.release();
  });

  it("times out a refresh whose body never arrives and keeps the old credential", async () => {
    vi.useFakeTimers();
    globalThis.fetch = (async (_url: any, init?: RequestInit) =>
      stalledBody(init?.signal)) as typeof fetch;

    const pending = refreshCredential("https://api.agenta.test/api", "Secret A", 1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    assert.equal(await pending, null);
  });

  it("never overlaps a hung refresh, and the next one after the timeout succeeds", async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    globalThis.fetch = (async (_url: any, init?: RequestInit) => {
      sent.push((init?.headers as Record<string, string>).authorization);
      if (sent.length === 1) return stalledBody(init?.signal);
      return new Response(JSON.stringify({ credentials: "Secret B" }), { status: 200 });
    }) as typeof fetch;
    const lease = startPlatformCredentialLease("https://api.agenta.test/api", "Secret A", {
      intervalMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_CREDENTIAL_REFRESH_TIMEOUT_MS);
    assert.equal(sent.length, 1, "every tick while the first refresh hangs is skipped");
    assert.equal(lease.credential(), "Secret A");

    await vi.advanceTimersByTimeAsync(2_000);
    assert.deepEqual(sent, ["Secret A", "Secret A"]);
    assert.equal(lease.credential(), "Secret B");
    lease.release();
  });

  it("drops a refresh that lands after release", async () => {
    vi.useFakeTimers();
    let land: (value: string | null) => void = () => {};
    const lease = startPlatformCredentialLease("https://api.agenta.test/api", "Secret A", {
      intervalMs: 1_000,
      refresh: () => new Promise((resolve) => (land = resolve)),
    });

    await vi.advanceTimersByTimeAsync(1_000);
    lease.release();
    land("Secret B");
    await vi.advanceTimersByTimeAsync(0);

    assert.equal(lease.credential(), "Secret A");
  });
});

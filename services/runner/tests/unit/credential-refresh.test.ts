import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";

import { startPlatformCredentialLease } from "../../src/sessions/auth.ts";

afterEach(() => {
  vi.useRealTimers();
});

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
});

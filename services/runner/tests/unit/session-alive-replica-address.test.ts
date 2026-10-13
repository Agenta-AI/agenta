/**
 * Every heartbeat carries what the API needs to bind the turn to this pod and route its Stop
 * here: the runner token on its own header, and `replica_address` next to `replica_id`.
 *
 * The API stores the address only when the token validates, because a Stop later sends the
 * runner token to that address. So the token must ride EVERY beat, not only the first: the API
 * binds the turn on whichever beat names it first, and that is not always the admission beat.
 *
 * Run: pnpm exec vitest run --project unit tests/unit/session-alive-replica-address.test.ts
 */
import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";

import { runWithRequestApiBase } from "../../src/apiBase.ts";

const ADDRESS = "http://10.8.2.17:8765";

const beats: Array<{
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}> = [];

vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  if (String(url).includes("/sessions/streams/heartbeat")) {
    beats.push({
      url: String(url),
      body: init?.body ? JSON.parse(init.body as string) : {},
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
  }
  return new Response(
    JSON.stringify({ stream: { id: "stream-1" }, is_current_turn: true }),
    { status: 200 },
  );
});

// The address is read once per process, like the replica id, so it is set before the import.
process.env.AGENTA_RUNNER_REPLICA_ADDRESS = ADDRESS;
const { startAliveWatchdog, REPLICA_ID, REPLICA_ADDRESS } = await import(
  "../../src/sessions/alive.ts"
);
delete process.env.AGENTA_RUNNER_REPLICA_ADDRESS;

beforeEach(() => {
  beats.length = 0;
  process.env.AGENTA_RUNNER_TOKEN = "runner-secret";
});

afterEach(() => {
  delete process.env.AGENTA_RUNNER_TOKEN;
  vi.useRealTimers();
});

describe("the heartbeat identifies the pod", () => {
  it("reads the pod address from AGENTA_RUNNER_REPLICA_ADDRESS", () => {
    assert.equal(REPLICA_ADDRESS, ADDRESS);
  });

  it("sends the runner token and replica_address on the first, a periodic and the final beat", async () => {
    vi.useFakeTimers();
    const watchdog = await startAliveWatchdog("sess-1", "turn-1", "Bearer tok");
    await vi.advanceTimersByTimeAsync(30_000);
    await watchdog.release();

    assert.equal(beats.length, 3, "first beat, one periodic beat, final beat");
    assert.deepEqual(
      beats.map((beat) => beat.body["is_running"]),
      [true, true, false],
    );
    for (const beat of beats) {
      assert.equal(beat.headers["x-agenta-runner-token"], "runner-secret");
      assert.equal(beat.headers["authorization"], "Bearer tok");
      assert.equal(beat.body["replica_id"], REPLICA_ID);
      assert.equal(beat.body["replica_address"], ADDRESS);
      assert.equal(beat.body["turn_id"], "turn-1");
      assert.equal(
        "release_owner" in beat.body,
        false,
        "a beat carries no release_owner",
      );
    }
  });

  it("sends no runner token when the api base is inferred from the request", async () => {
    const saved = {
      internal: process.env.AGENTA_API_INTERNAL_URL,
      public: process.env.AGENTA_API_URL,
    };
    delete process.env.AGENTA_API_INTERNAL_URL;
    delete process.env.AGENTA_API_URL;
    vi.useFakeTimers();
    try {
      await runWithRequestApiBase("https://collector.example.com", async () => {
        const watchdog = await startAliveWatchdog(
          "sess-1",
          "turn-1",
          "Bearer tok",
        );
        await vi.advanceTimersByTimeAsync(30_000);
        await watchdog.release();
      });
    } finally {
      if (saved.internal !== undefined)
        process.env.AGENTA_API_INTERNAL_URL = saved.internal;
      if (saved.public !== undefined) process.env.AGENTA_API_URL = saved.public;
    }

    assert.equal(beats.length, 3, "first beat, one periodic beat, final beat");
    assert.deepEqual(
      beats.map((beat) => beat.body["is_running"]),
      [true, true, false],
    );
    for (const beat of beats) {
      assert.equal(
        beat.url,
        "https://collector.example.com/sessions/streams/heartbeat",
      );
      assert.equal("x-agenta-runner-token" in beat.headers, false);
      assert.equal(
        JSON.stringify(beat).includes("runner-secret"),
        false,
        "the token appears nowhere in the beat",
      );
      assert.equal(beat.headers["authorization"], "Bearer tok");
      assert.equal(beat.body["replica_address"], ADDRESS);
    }
  });

  it("still beats without the token header when the runner has no token", async () => {
    delete process.env.AGENTA_RUNNER_TOKEN;
    const watchdog = await startAliveWatchdog("sess-1", "turn-1", "Bearer tok");
    await watchdog.release();

    assert.equal(beats.length, 2);
    for (const beat of beats) {
      assert.equal("x-agenta-runner-token" in beat.headers, false);
      assert.equal(beat.body["replica_address"], ADDRESS);
    }
  });
});

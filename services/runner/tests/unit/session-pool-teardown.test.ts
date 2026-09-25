/**
 * A key's teardown and the next acquire on the same key never overlap (QA5A-1).
 *
 * The approval TTL fired, its eviction removed the key and began unmounting the conversation's
 * drive; the approve turn arrived while that teardown ran, found the key empty, mounted nothing
 * (the old mount still answered) and built its environment on it; the old teardown then unmounted
 * the drive underneath the new turn, whose command failed with a raw ENOENT. The pre-acquire
 * `evict` must wait for a teardown still running on the key, even when the key is already gone
 * from the map (the default pool frees the seat before the teardown ends).
 */
import { describe, expect, it } from "vitest";
import { SessionPool, type ParkInput } from "../../src/engines/sandbox_agent/session-pool.ts";
import type { AppliedStateOwner } from "../../src/engines/sandbox_agent/applied-state.ts";

type Env = AppliedStateOwner;

function parkInput(key: string, teardown: () => Promise<void>): ParkInput<Env> {
  return {
    key,
    environment: { appliedState: { configFingerprint: "fp" } } as unknown as Env,
    historyFingerprint: "h",
    credentialEpoch: {} as ParkInput<Env>["credentialEpoch"],
    teardown,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.each([
  { name: "default pool", strictCapacity: false },
  { name: "strict pool", strictCapacity: true },
])("teardown before re-acquire ($name)", ({ strictCapacity }) => {
  it("an approval TTL expiry's teardown finishes before the next acquire on the key", async () => {
    const pool = new SessionPool<Env>({ poolMax: 8 }, () => {}, { strictCapacity });
    const events: string[] = [];
    await pool.park(
      parkInput("p:s", async () => {
        events.push("teardown-start");
        await sleep(300);
        events.push("teardown-end");
      }),
      50,
      "awaiting_approval",
    );
    await sleep(80); // the TTL fired; its eviction is still tearing down
    expect(events).toEqual(["teardown-start"]);
    // What the cold path does before it builds anything on the key's drive.
    await pool.evict("p:s", "pre-acquire", "failed-turn");
    events.push("acquire");
    expect(events).toEqual(["teardown-start", "teardown-end", "acquire"]);
  });

  it("does not wait for a teardown of another key", async () => {
    const pool = new SessionPool<Env>({ poolMax: 8 }, () => {}, { strictCapacity });
    await pool.park(parkInput("p:a", () => sleep(1_000).then(() => {})), 20, "idle");
    await sleep(40);
    const t0 = Date.now();
    await pool.evict("p:b", "pre-acquire", "failed-turn");
    expect(Date.now() - t0).toBeLessThan(100);
  });

});

describe("teardown before re-acquire (default pool)", () => {
  // The default pool frees the key before its teardown ends, so a re-acquire waits on the teardown
  // by key; the strict pool keeps the key and awaits the teardown as the release did.
  it("waits a bounded time for a teardown that hangs, then refuses the turn with a sentence", async () => {
    const pool = new SessionPool<Env>({ poolMax: 8 }, () => {}, { teardownWaitMs: 200 });
    await pool.park(parkInput("p:h", () => new Promise<void>(() => {})), 20, "idle");
    await sleep(60); // the TTL fired; its teardown never ends
    const t0 = Date.now();
    await expect(pool.evict("p:h", "pre-acquire", "failed-turn")).rejects.toThrow(/still shutting down/);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it("logs a refused eviction that nobody waits for, instead of leaving an unhandled rejection", async () => {
    const logs: string[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const pool = new SessionPool<Env>({ poolMax: 8 }, (m) => logs.push(m), { teardownWaitMs: 100 });
      await pool.park(parkInput("p:h", () => new Promise<void>(() => {})), 20, "idle");
      await sleep(60); // the TTL fired; its teardown never ends
      pool.evictInBackground("p:h", "parked-prompt-rejected", "failed-turn");
      await sleep(250);
      expect(unhandled).toEqual([]);
      expect(logs.join("\n")).toMatch(/evict key=p:h reason=parked-prompt-rejected failed: The previous run/);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

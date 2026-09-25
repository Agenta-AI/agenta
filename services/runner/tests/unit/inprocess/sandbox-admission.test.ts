/**
 * Sandbox admission and the provider's capacity refusals (QA4A-1): a burst of conversations
 * queues for this runner's sandbox slots and is refused with a sentence when the wait runs out;
 * a provider quota refusal is asked once more, then reads as a plain sentence with no vendor
 * upsell or link.
 */
import { describe, expect, it } from "vitest";
import { classifyRunError, SANDBOX_CAPACITY_MESSAGE } from "../../../src/engines/sandbox_agent/errors.ts";
import { SANDBOX_SLOTS_FULL_MESSAGE, sandboxSlots, Slots } from "../../../src/engines/inprocess/sandbox/sandbox-slots.ts";
import { createTestWorkspace } from "../../utils/inprocess-workspace.ts";
import { LocalDaytona } from "../../utils/local-daytona.ts";

const QUOTA =
  "Total disk limit exceeded. Maximum allowed: 300GiB.\nConsider archiving your unused Sandboxes to free up available storage.\nTo increase concurrency limits, upgrade your organization's Tier by visiting https://app.daytona.io/dashboard/limits.";

describe("slots", () => {
  it("hands a released slot to the one waiting, and refuses after the wait", async () => {
    const slots = new Slots(1);
    const first = await slots.acquire(1_000);
    const second = slots.acquire(1_000);
    first.release();
    const release = await second;
    expect(slots.inUse).toBe(1);
    await expect(slots.acquire(50)).rejects.toThrow(SANDBOX_SLOTS_FULL_MESSAGE);
    release.release();
    expect(slots.inUse).toBe(0);
  });
});

describe("running sandboxes per runner", () => {
  it("queues a second conversation's command until the first sandbox stops, and refuses when the wait runs out", async () => {
    const slots = sandboxSlots(4, 1, 300);
    const a = createTestWorkspace({ settings: { slots }, conversationId: "a" });
    const b = createTestWorkspace({ settings: { slots }, conversationId: "b" });
    await a.bash("true");
    const refused = await b.bash("echo b").catch((err: Error) => err);
    expect(refused).toBeInstanceOf(Error);
    expect((refused as Error).message).toBe(SANDBOX_SLOTS_FULL_MESSAGE);
    expect(classifyRunError(refused, "pi").code).toBe("sandbox_capacity");
    expect(b.daytona.creates).toBe(0);
    a.registry.release(a.workspace, "park");
    await a.registry.settle(5_000);
    const r = await b.bash("echo b-ran");
    expect(r.output).toContain("b-ran");
  });
});

describe("provider capacity refusals", () => {
  it("asks once more after a quota refusal, which created nothing", async () => {
    const ws = createTestWorkspace();
    ws.daytona.createFailures.push(QUOTA);
    const r = await ws.bash("echo after-retry");
    expect(r.output).toContain("after-retry");
    expect(ws.daytona.createRequests).toHaveLength(2);
  }, 15_000);

  it("reads a repeated refusal as a plain sentence, without the vendor's upsell or link", async () => {
    const daytona = new LocalDaytona(`${createTestWorkspace().prefix}-2`);
    const ws = createTestWorkspace({ daytona });
    daytona.createFailures.push(QUOTA, QUOTA);
    const err = (await ws.bash("true").catch((e: Error) => e)) as Error;
    expect(err.message).toBe(SANDBOX_CAPACITY_MESSAGE);
    expect(err.message).not.toMatch(/daytona|upgrade|https?:/i);
    expect(classifyRunError(err, "pi")).toEqual({ message: SANDBOX_CAPACITY_MESSAGE, code: "sandbox_capacity" });
  }, 15_000);
});

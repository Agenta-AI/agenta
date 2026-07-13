import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { PendingApprovalPauseController } from "../../src/engines/sandbox_agent/pause.ts";

describe("PendingApprovalPauseController", () => {
  it("signals the pause before managed cancellation and queued updates drain", async () => {
    let finishDestroy: (() => void) | undefined;
    const queuedUpdates: string[] = [];
    const destroySession = new Promise<void>((resolve) => {
      finishDestroy = () => {
        setImmediate(() => queuedUpdates.push("session update"));
        resolve();
      };
    });
    const pause = new PendingApprovalPauseController(() => destroySession);

    pause.pause();
    await pause.signal;

    let drainFinished = false;
    const drain = pause.waitForEventDrain().then(() => {
      drainFinished = true;
    });
    await Promise.resolve();
    assert.equal(drainFinished, false);

    finishDestroy?.();
    await drain;

    assert.equal(drainFinished, true);
    assert.deepEqual(queuedUpdates, ["session update"]);
  });

  it("finishes the event drain when managed cancellation rejects", async () => {
    const pause = new PendingApprovalPauseController(() =>
      Promise.reject(new Error("session already gone")),
    );

    pause.pause();

    await assert.doesNotReject(pause.signal);
    await assert.doesNotReject(pause.waitForEventDrain());
  });

  it("finishes the event drain when managed cancellation throws", async () => {
    const pause = new PendingApprovalPauseController(() => {
      throw new Error("session already gone");
    });

    pause.pause();

    await assert.doesNotReject(pause.signal);
    await assert.doesNotReject(pause.waitForEventDrain());
  });
});

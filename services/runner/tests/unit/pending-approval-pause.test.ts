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

  it("re-arms the bounded drain when a gate is classified after the first tick", async () => {
    const pause = new PendingApprovalPauseController(() => {});
    pause.markPausedToolCall("tool-first");
    pause.pause();
    await Promise.resolve();
    await Promise.resolve();

    let lateGateClassified = false;
    setImmediate(() => {
      pause.markPausedToolCall("tool-late");
      lateGateClassified = true;
    });

    await pause.waitForEventDrain();

    assert.equal(lateGateClassified, true);
    assert.equal(pause.isPausedToolCall("tool-late"), true);
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

  it("tracks allowed execution ids independently from paused gates", () => {
    const pause = new PendingApprovalPauseController(() => {});

    assert.equal(pause.isAllowedExecution(undefined), false);
    assert.equal(pause.isAllowedExecution("tool-1"), false);

    pause.markAllowedExecution("tool-1");
    pause.markPausedToolCall("tool-2");

    assert.equal(pause.isAllowedExecution("tool-1"), true);
    assert.equal(pause.isPausedToolCall("tool-1"), false);
    assert.equal(pause.isAllowedExecution("tool-2"), false);
  });
});

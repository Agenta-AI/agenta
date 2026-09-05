import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";

import {
  LiveFramePublisher,
  type LiveFrameEnvelope,
} from "../../src/sessions/live-frames.ts";

describe("LiveFramePublisher", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AGENTA_RUNNER_LIVE_FRAMES;
  });

  it("assigns a monotonic frame index across projected progress", async () => {
    const frames: LiveFrameEnvelope[] = [];
    const publisher = new LiveFramePublisher({
      sessionId: "session-1",
      executionId: "execution-1",
      auth: () => "Secret test",
      enabled: true,
      now: () => "2026-09-04T00:00:00.000Z",
      send: async (batch) => {
        frames.push(...batch);
      },
    });

    publisher.emit({ type: "message_start", id: "message-1" });
    publisher.emit({ type: "message_delta", id: "message-1", delta: "hi" });
    publisher.emit({ type: "tool_call", id: "tool-1", name: "read", input: {} });
    publisher.emit({
      type: "tool_call",
      id: "tool-1",
      name: "read",
      input: { path: "README.md" },
    });
    publisher.emit({ type: "tool_result", id: "tool-1", output: "ok" });
    await publisher.whenIdle();

    assert.deepEqual(
      frames.map((frame) => [frame.frame_index, frame.type, frame.entity_id]),
      [
        [0, "text-start", "message-1"],
        [1, "text-delta", "message-1"],
        [2, "tool-input-start", "tool-1"],
        [3, "tool-input-available", "tool-1"],
        [4, "tool-input-available", "tool-1"],
        [5, "tool-output-available", "tool-1"],
      ],
    );
    assert.deepEqual(
      frames.map((frame) => frame.frame_or_event_id),
      [
        "execution-1:0",
        "execution-1:1",
        "execution-1:2",
        "execution-1:3",
        "execution-1:4",
        "execution-1:5",
      ],
    );
  });

  it("drops beyond the bounded queue and logs identifiers only", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstSend = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const logs: string[] = [];
    let sends = 0;
    const publisher = new LiveFramePublisher({
      sessionId: "session-drop",
      executionId: "execution-drop",
      auth: () => "Secret test",
      enabled: true,
      capacity: 1,
      flushIntervalMs: 0,
      batchCapacity: 1,
      send: async () => {
        sends += 1;
        if (sends === 1) await firstSend;
      },
      log: (message) => logs.push(message),
    });

    publisher.emit({ type: "message_delta", id: "message-1", delta: "secret-a" });
    publisher.emit({ type: "message_delta", id: "message-1", delta: "secret-b" });
    publisher.emit({ type: "message_delta", id: "message-1", delta: "secret-c" });
    releaseFirst?.();
    await publisher.whenIdle();

    assert.equal(sends, 2);
    assert.equal(publisher.reportDrops(), 1);
    assert.deepEqual(logs, [
      "DROPPED session=session-drop execution=execution-drop count=1",
    ]);
    assert.ok(!logs[0].includes("secret"));
  });

  it("coalesces a 1,000-chunk stream into tens of ordered calls", async () => {
    const calls: LiveFrameEnvelope[][] = [];
    const publisher = new LiveFramePublisher({
      sessionId: "session-batch",
      executionId: "execution-batch",
      auth: () => "Secret test",
      enabled: true,
      send: async (batch) => {
        calls.push(batch);
      },
    });

    for (let index = 0; index < 1_000; index += 1) {
      publisher.emit({
        type: "message_delta",
        id: "message-1",
        delta: `chunk-${index}`,
      });
      if ((index + 1) % 50 === 0) await Promise.resolve();
    }
    await publisher.whenIdle();

    const frames = calls.flat();
    assert.equal(calls.length, 20);
    assert.equal(frames.length, 1_000);
    assert.deepEqual(
      frames.map((frame) => frame.frame_index),
      Array.from({ length: 1_000 }, (_, index) => index),
    );
    assert.equal(publisher.reportDrops(), 0);
  });

  it("flushes on the byte bound without reordering envelopes", async () => {
    const calls: LiveFrameEnvelope[][] = [];
    const publisher = new LiveFramePublisher({
      sessionId: "session-bytes",
      executionId: "execution-bytes",
      auth: () => "Secret test",
      enabled: true,
      batchCapacity: 50,
      maxBatchBytes: 600,
      send: async (batch) => {
        calls.push(batch);
      },
    });

    publisher.emit({
      type: "message_delta",
      id: "message-1",
      delta: "a".repeat(100),
    });
    publisher.emit({
      type: "message_delta",
      id: "message-1",
      delta: "b".repeat(100),
    });
    await publisher.whenIdle();

    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.flat().map((frame) => frame.frame_index),
      [0, 1],
    );
  });

  it("sends no live frames when the feature flag is off", async () => {
    process.env.AGENTA_RUNNER_LIVE_FRAMES = "false";
    let calls = 0;
    const publisher = new LiveFramePublisher({
      sessionId: "session-off",
      executionId: "execution-off",
      auth: () => "Secret test",
      send: async () => {
        calls += 1;
      },
    });

    publisher.emit({ type: "message_start", id: "message-1" });
    publisher.emit({ type: "message_delta", id: "message-1", delta: "secret" });
    publisher.emit({ type: "message_end", id: "message-1" });
    await publisher.whenIdle();

    assert.equal(calls, 0);
  });
});

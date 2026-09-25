/**
 * The silence watchdog (R3-7): every Pi event is a sign of life, a running tool or an open dialog
 * suspends the clock, and a model request in flight gets the longer limit.
 */
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnWatchdog, type TurnSilenceError } from "../../../src/engines/inprocess/pi/turn-watchdog.ts";

const event = (e: Record<string, unknown>) => e as unknown as AgentSessionEvent;
const assistant = { role: "assistant" };

describe("TurnWatchdog", () => {
  let tripped: TurnSilenceError[];
  let dog: TurnWatchdog;
  beforeEach(() => {
    vi.useFakeTimers();
    tripped = [];
    dog = new TurnWatchdog({ idleMs: 1_000, modelMs: 10_000 }, (err) => tripped.push(err));
    dog.start();
  });
  afterEach(() => vi.useRealTimers());

  it("trips after the idle limit of true silence", () => {
    vi.advanceTimersByTime(999);
    expect(tripped).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(tripped).toHaveLength(1);
    expect(tripped[0]!.message).toMatch(/no progress for 1 seconds/);
  });

  it("gives a model request in flight the longer limit, and any delta resets it", () => {
    dog.observe(event({ type: "message_start", message: assistant }));
    vi.advanceTimersByTime(9_000);
    dog.observe(event({ type: "message_update", message: assistant, assistantMessageEvent: { type: "thinking_delta" } }));
    vi.advanceTimersByTime(9_000);
    expect(tripped).toHaveLength(0);
    dog.observe(event({ type: "message_end", message: assistant }));
    vi.advanceTimersByTime(1_000);
    expect(tripped).toHaveLength(1);
  });

  it("gives compaction and a retry back-off the longer limit", () => {
    dog.observe(event({ type: "compaction_start", reason: "threshold" }));
    vi.advanceTimersByTime(5_000);
    dog.observe(event({ type: "compaction_end", reason: "threshold", aborted: false, willRetry: false }));
    dog.observe(event({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 4_000 }));
    vi.advanceTimersByTime(5_000);
    expect(tripped).toHaveLength(0);
  });

  it("stands still while a tool runs or a person is asked", () => {
    dog.observe(event({ type: "tool_execution_start", toolCallId: "t1" }));
    vi.advanceTimersByTime(60_000);
    dog.observe(event({ type: "tool_execution_end", toolCallId: "t1" }));
    dog.dialogOpened();
    vi.advanceTimersByTime(60_000);
    expect(tripped).toHaveLength(0);
    dog.dialogClosed();
    vi.advanceTimersByTime(1_000);
    expect(tripped).toHaveLength(1);
  });

  it("does nothing once stopped", () => {
    dog.stop();
    vi.advanceTimersByTime(60_000);
    expect(tripped).toHaveLength(0);
  });
});

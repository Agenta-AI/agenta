/**
 * The silence watchdog (R3-7): every Pi event is a sign of life, a running tool or an open dialog
 * suspends the clock, and a model request in flight gets the longer limit.
 */
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnSilenceError, TurnWatchdog } from "../../../src/engines/inprocess/pi/turn-watchdog.ts";
import { classifyRunError } from "../../../src/engines/sandbox_agent/errors.ts";

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

  it("gives the wait for the provider's first response the longer limit, after a tool result", () => {
    // Pi emits the assistant message_start only once the provider answered with headers, and it
    // retries a failed provider call silently before that (EU prod, reference 1d06e6bb).
    dog.observe(event({ type: "tool_execution_start", toolCallId: "t1" }));
    dog.observe(event({ type: "tool_execution_end", toolCallId: "t1" }));
    dog.observe(event({ type: "message_start", message: { role: "toolResult" } }));
    dog.observe(event({ type: "message_end", message: { role: "toolResult" } }));
    dog.observe(event({ type: "turn_end", message: assistant, toolResults: [] }));
    dog.observe(event({ type: "turn_start" }));
    vi.advanceTimersByTime(9_000);
    expect(tripped).toHaveLength(0);
    dog.observe(event({ type: "message_start", message: assistant }));
    vi.advanceTimersByTime(9_000);
    expect(tripped).toHaveLength(0);
    dog.observe(event({ type: "message_end", message: assistant }));
    vi.advanceTimersByTime(1_000);
    expect(tripped).toHaveLength(1);
  });

  it("still trips when the provider never answers within the model limit", () => {
    dog.observe(event({ type: "turn_start" }));
    vi.advanceTimersByTime(10_000);
    expect(tripped).toHaveLength(1);
    expect(tripped[0]!.message).toMatch(/no progress for 10 seconds/);
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

describe("TurnSilenceError", () => {
  it("reaches the chat as its own sentence, not the generic hidden failure", () => {
    const classified = classifyRunError(new TurnSilenceError(120_000), "pi", "anthropic", { unknownText: "hidden" });
    expect(classified.code).toBe("run_idle_time_limit");
    expect(classified.message).toMatch(/^The agent stopped responding: no progress for 120 seconds/);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutputBudget } from "../../src/tracing/output-budget.ts";
import { createSandboxAgentOtel } from "../../src/tracing/otel.ts";
import type { AgentEvent } from "../../src/protocol.ts";

afterEach(() => vi.unstubAllEnvs());

const chunk = (text: string) => ({
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text },
});

describe("turn output budget", () => {
  it("counts UTF-8 bytes, rejects the crossing update, and stays closed", () => {
    vi.stubEnv("AGENTA_RUNNER_OUTPUT_MAX_BYTES", "1024");
    const exceeded = vi.fn();
    const budget = createOutputBudget(exceeded);
    expect(budget.accept("a".repeat(500))).toBe(true);
    expect(budget.accept("€".repeat(200))).toBe(false);
    for (let i = 0; i < 1000; i++) expect(budget.accept("x")).toBe(false);
    expect(exceeded).toHaveBeenCalledTimes(1);
  });

  it("bounds small-update floods independently of bytes", () => {
    vi.stubEnv("AGENTA_RUNNER_OUTPUT_MAX_EVENTS", "3");
    const exceeded = vi.fn();
    const budget = createOutputBudget(exceeded);
    for (let i = 0; i < 3; i++) expect(budget.accept({})).toBe(true);
    expect(budget.accept({})).toBe(false);
    expect(exceeded).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    "stops before text/reasoning/tool retention and fan-out (stream=%s)",
    (streaming) => {
      vi.stubEnv("AGENTA_RUNNER_OUTPUT_MAX_BYTES", "1024");
      const live: AgentEvent[] = [];
      const exceeded = vi.fn();
      const run = createSandboxAgentOtel({
        emitSpans: false,
        emit: streaming ? (event) => live.push(event) : undefined,
        onOutputLimit: exceeded,
      });
      run.start({ prompt: "test" });
      run.handleUpdate(chunk("safe prefix"));
      run.handleUpdate({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "r".repeat(2000) },
      });
      for (let i = 0; i < 2000; i++) {
        run.handleUpdate(chunk("x".repeat(1000)));
        run.handleUpdate({
          sessionUpdate: "tool_call",
          toolCallId: `call-${i}`,
          rawInput: { text: "x".repeat(1000) },
        });
      }
      expect(run.output()).toBe("safe prefix");
      expect(run.openToolCallIds()).toEqual([]);
      expect(exceeded).toHaveBeenCalledTimes(1);
      run.emitEvent({
        type: "error",
        message: "output limit",
        code: "output_limit_exceeded",
      });
      run.finish("error");
      expect(run.events().filter((e) => e.type === "done")).toHaveLength(1);
      expect(run.events().filter((e) => e.type === "error")).toHaveLength(1);
      expect(JSON.stringify(run.events()).length).toBeLessThan(1024);
      if (streaming) expect(live).toEqual(run.events());
    },
  );

  it("bounds tool results and externally emitted events as well as text", () => {
    vi.stubEnv("AGENTA_RUNNER_OUTPUT_MAX_BYTES", "1024");
    const exceeded = vi.fn();
    const run = createSandboxAgentOtel({
      emitSpans: false,
      onOutputLimit: exceeded,
    });
    run.handleUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "call",
      title: "read",
    });
    run.handleUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "call",
      status: "completed",
      rawOutput: "x".repeat(2000),
    });
    run.emitEvent({ type: "message", text: "late" });
    expect(run.events()).toHaveLength(1);
    expect(exceeded).toHaveBeenCalledTimes(1);
  });
});

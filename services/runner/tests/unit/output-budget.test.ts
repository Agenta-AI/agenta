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
  it("owns streamed deltas without changing split UTF-16 surrogate pairs", () => {
    const live: AgentEvent[] = [];
    const run = createSandboxAgentOtel({
      emitSpans: false,
      emit: (event) => live.push(event),
    });
    run.handleUpdate(chunk("prefix \ud83d"));
    run.handleUpdate(chunk("\ude00 end"));
    run.finish();
    expect(
      live
        .filter((event) => event.type === "message_delta")
        .map((event) => event.delta)
        .join(""),
    ).toBe("prefix 😀 end");
  });

  it("processes an admitted buffered update without charging it twice", () => {
    vi.stubEnv("AGENTA_RUNNER_OUTPUT_MAX_EVENTS", "1");
    const exceeded = vi.fn();
    const run = createSandboxAgentOtel({
      emitSpans: false,
      onOutputLimit: exceeded,
    });
    const update = chunk("buffered completion");
    expect(run.admitUpdate(update)).toBe(true);
    run.handleUpdate(update, true);
    expect(run.finish()).toBe("buffered completion");
    expect(exceeded).not.toHaveBeenCalled();
  });
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

describe("per-step output budget", () => {
  const toolCall = (id: string) => ({
    sessionUpdate: "tool_call",
    toolCallId: id,
    title: "bash",
    rawInput: { command: "pnpm test" },
  });
  const progress = (id: string, text: string) => ({
    sessionUpdate: "tool_call_update",
    toolCallId: id,
    status: "in_progress",
    content: [{ type: "content", content: { type: "text", text } }],
    rawOutput: { content: [{ type: "text", text }] },
  });

  it("charges a running tool's repeated output copies only for their growth", () => {
    vi.stubEnv("AGENTA_RUNNER_OUTPUT_MAX_BYTES", "16384");
    const exceeded = vi.fn();
    const budget = createOutputBudget(exceeded, () => {});
    expect(budget.accept(toolCall("bash-1"))).toBe(true);
    // 300 copies of up to ~6 KB each: ~1 MB on the wire, ~13 KB kept.
    for (let i = 1; i <= 300; i++) {
      expect(budget.accept(progress("bash-1", "x".repeat(i * 20)))).toBe(true);
    }
    expect(exceeded).not.toHaveBeenCalled();
  });

  it("lets a long turn of normal steps finish", () => {
    vi.stubEnv("AGENTA_RUNNER_OUTPUT_MAX_BYTES", "4096");
    const exceeded = vi.fn();
    const budget = createOutputBudget(exceeded, () => {});
    for (let i = 0; i < 500; i++) {
      expect(budget.accept(chunk("t".repeat(3000)))).toBe(true);
      expect(budget.accept(toolCall(`call-${i}`))).toBe(true);
      expect(budget.accept(progress(`call-${i}`, "o".repeat(1500)))).toBe(true);
    }
    expect(exceeded).not.toHaveBeenCalled();
  });

  it("still stops one runaway model reply", () => {
    vi.stubEnv("AGENTA_RUNNER_OUTPUT_MAX_BYTES", "4096");
    const exceeded = vi.fn();
    const budget = createOutputBudget(exceeded, () => {});
    let accepted = 0;
    while (budget.accept(chunk("x".repeat(500)))) accepted++;
    expect(accepted).toBeLessThan(10);
    expect(exceeded).toHaveBeenCalledTimes(1);
    expect(budget.accept(toolCall("after"))).toBe(false);
  });

  it("stops a tool that keeps resending same-size output at the step update limit", () => {
    vi.stubEnv("AGENTA_RUNNER_OUTPUT_MAX_EVENTS", "20");
    const exceeded = vi.fn();
    const budget = createOutputBudget(exceeded, () => {});
    expect(budget.accept(toolCall("tail"))).toBe(true);
    let accepted = 0;
    while (budget.accept(progress("tail", String(accepted % 10).repeat(1000))))
      accepted++;
    expect(accepted).toBe(19);
    expect(exceeded).toHaveBeenCalledTimes(1);
  });

  it("stops the turn at the turn backstop", () => {
    vi.stubEnv("AGENTA_RUNNER_OUTPUT_MAX_TURN_BYTES", "8192");
    const exceeded = vi.fn();
    const budget = createOutputBudget(exceeded, () => {});
    let accepted = 0;
    for (let i = 0; i < 100; i++) {
      if (!budget.accept(toolCall(`call-${i}`))) break;
      if (!budget.accept(progress(`call-${i}`, "o".repeat(1000)))) break;
      accepted++;
    }
    expect(accepted).toBeLessThan(10);
    expect(exceeded).toHaveBeenCalledTimes(1);
  });

  it("logs which limit tripped and keeps the user message unchanged", () => {
    vi.stubEnv("AGENTA_RUNNER_OUTPUT_MAX_BYTES", "1024");
    const lines: string[] = [];
    const exceeded = vi.fn();
    const budget = createOutputBudget(exceeded, (line) => lines.push(line));
    expect(budget.accept(toolCall("big"))).toBe(true);
    expect(budget.accept(progress("big", "x".repeat(2000)))).toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/step bytes > 1024 step=tool:big/);
    expect(exceeded.mock.calls[0]![0]).toBe(
      "Agent output exceeded the turn limit (1024 bytes or 50000 updates). " +
        "The turn was stopped to protect the runner. Check the model or provider before retrying.",
    );
  });

  it("records the final result of a tool that streamed many progress copies", () => {
    vi.stubEnv("AGENTA_RUNNER_OUTPUT_MAX_BYTES", "65536");
    const exceeded = vi.fn();
    const run = createSandboxAgentOtel({
      emitSpans: false,
      onOutputLimit: exceeded,
    });
    run.handleUpdate(toolCall("suite"));
    for (let i = 1; i <= 400; i++) {
      run.handleUpdate(progress("suite", "line\n".repeat(i * 10)));
    }
    run.handleUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "suite",
      status: "completed",
      rawOutput: "all tests passed",
    });
    expect(exceeded).not.toHaveBeenCalled();
    expect(
      run.events().filter((event) => event.type === "tool_result"),
    ).toHaveLength(1);
  });
});

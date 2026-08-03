/**
 * Unit tests for how the sandbox-agent ACP tracer treats `usage_update`.
 *
 * ACP's `usage_update.used` is the agent's context-window occupancy, not the tokens a run
 * spent. Reporting it as a token total produced runs shaped `input 0 / output 0 / total
 * <context size>` with no cost — a number a reader cannot tell apart from a real total. These
 * tests pin that the context size never reaches a `usage` event, `usage()`, or a span, while
 * the harness-reported split (delivered through `setUsage`) still does.
 *
 * Spans export over OTLP from a module-level provider, so we spy on the OTel API tracer and
 * capture what each span records (same approach as otel-skills-error.test.ts).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/otel-usage-context-size.test.ts)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { trace, type Span } from "@opentelemetry/api";

import { createSandboxAgentOtel } from "../../src/tracing/otel.ts";
import type { AgentEvent } from "../../src/protocol.ts";

interface FakeSpan {
  name: string;
  attributes: Record<string, unknown>;
}

/** Replace the OTel tracer so every span built records into a captured array. */
function spyTracer(): FakeSpan[] {
  const spans: FakeSpan[] = [];
  const makeSpan = (name: string): Span => {
    const span: FakeSpan = { name, attributes: {} };
    spans.push(span);
    const api = {
      setAttribute(key: string, value: unknown) {
        span.attributes[key] = value;
        return api;
      },
      setAttributes(attrs: Record<string, unknown>) {
        Object.assign(span.attributes, attrs);
        return api;
      },
      recordException() {},
      setStatus() {
        return api;
      },
      end() {},
      spanContext() {
        return {
          traceId: "0".repeat(32),
          spanId: "0".repeat(16),
          traceFlags: 1,
        };
      },
      isRecording: () => true,
      addEvent: () => api,
      updateName: () => api,
    };
    return api as unknown as Span;
  };
  vi.spyOn(trace, "getTracer").mockReturnValue({
    startSpan: (name: string) => makeSpan(name),
    startActiveSpan: ((name: string, fn: (s: Span) => unknown) =>
      fn(makeSpan(name))) as any,
  } as any);
  return spans;
}

const contextSizeUpdate = (used: number, cost?: number) => ({
  sessionUpdate: "usage_update",
  used,
  ...(cost === undefined ? {} : { cost: { amount: cost } }),
});

const usageKeys = (span: FakeSpan | undefined) =>
  Object.keys(span?.attributes ?? {}).filter((k) =>
    k.startsWith("gen_ai.usage."),
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usage_update carries context size, not tokens", () => {
  it("reports nothing when the stream knows only the context size", () => {
    const spans = spyTracer();
    const emitted: AgentEvent[] = [];
    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emit: (e) => emitted.push(e),
    });
    otel.start({ prompt: "hi" });
    otel.handleUpdate(contextSizeUpdate(63369));

    expect(otel.usage()).toBeUndefined();
    expect(emitted.filter((e) => e.type === "usage")).toEqual([]);

    // The engine finds no harness split either, so nothing overrides the stream before finish.
    otel.setUsage(undefined);
    otel.finish();
    expect(usageKeys(spans.find((s) => s.name === "invoke_agent"))).toEqual([]);
    expect(
      emitted.some((e) => e.type === "usage"),
      "no usage event anywhere in the run",
    ).toBe(false);
  });

  it("keeps the stream cost, without inventing a token total from the context size", () => {
    const spans = spyTracer();
    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
    });
    otel.start({ prompt: "hi" });
    otel.handleUpdate(contextSizeUpdate(63369, 0.04));

    expect(otel.usage()).toEqual({ input: 0, output: 0, total: 0, cost: 0.04 });
    otel.finish();
    const agentSpan = spans.find((s) => s.name === "invoke_agent");
    expect(agentSpan?.attributes["gen_ai.usage.cost"]).toBe(0.04);
    // Cost is the only usage a parent reports; tokens belong to the `chat` leaf.
    expect(usageKeys(agentSpan)).toEqual(["gen_ai.usage.cost"]);
    const chatSpan = spans.find((s) => s.name.startsWith("chat"));
    expect(chatSpan?.attributes["gen_ai.usage.total_tokens"]).toBe(0);
  });

  it("emits a token-only usage event with no cost key when the harness priced nothing", () => {
    const spans = spyTracer();
    const emitted: AgentEvent[] = [];
    const otel = createSandboxAgentOtel({
      harness: "codex",
      model: "openai-codex/gpt-5.5",
      emit: (e) => emitted.push(e),
      emitSpans: true,
    });
    otel.start({ prompt: "hi" });
    // No `usage_update` at all — codex reports a token split but never a cost.
    otel.setUsage({ input: 12, output: 3, total: 15 });
    otel.finish();

    const usageEvent = emitted.find((e) => e.type === "usage") as Record<
      string,
      unknown
    >;
    expect(usageEvent).toEqual({
      type: "usage",
      input: 12,
      output: 3,
      total: 15,
    });
    expect("cost" in usageEvent).toBe(false);

    // Nothing downstream may see a zero: the agent span carries no cost either.
    const agentSpan = spans.find((s) => s.name === "invoke_agent");
    expect(agentSpan?.attributes["gen_ai.usage.cost"]).toBeUndefined();
    const chatSpan = spans.find((s) => s.name.startsWith("chat"));
    expect(chatSpan?.attributes["gen_ai.usage.total_tokens"]).toBe(15);
    expect(chatSpan?.attributes["gen_ai.usage.cost"]).toBeUndefined();
  });

  it("stamps the harness-reported split, which arrives through setUsage", () => {
    const spans = spyTracer();
    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
    });
    otel.start({ prompt: "hi" });
    otel.handleUpdate(contextSizeUpdate(63369, 0.04));
    otel.setUsage({ input: 12, output: 3, total: 15, cost: 0.04 });
    otel.finish();

    // The split lands on the model span that owns it (see otel-usage-ownership.test.ts).
    const chatSpan = spans.find((s) => s.name.startsWith("chat"));
    expect(chatSpan?.attributes["gen_ai.usage.input_tokens"]).toBe(12);
    expect(chatSpan?.attributes["gen_ai.usage.output_tokens"]).toBe(3);
    expect(chatSpan?.attributes["gen_ai.usage.total_tokens"]).toBe(15);
    expect(chatSpan?.attributes["gen_ai.usage.cost"]).toBe(0.04);

    const agentSpan = spans.find((s) => s.name === "invoke_agent");
    expect(agentSpan?.attributes["gen_ai.usage.cost"]).toBe(0.04);
  });
});

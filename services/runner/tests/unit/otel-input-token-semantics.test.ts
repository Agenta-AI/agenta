/**
 * The runner declares the token contract its spans follow.
 *
 * `gen_ai.usage.input_tokens` is EXCLUSIVE here — uncached input only, with the cache read and
 * cache creation counts reported beside it. The OpenTelemetry GenAI contract means the opposite,
 * and Agenta ingests OTLP from third-party instrumentation too, so a consumer that assumes either
 * contract misprices the other. `agenta.usage.input_tokens_includes_cache = false` says which one
 * this span follows; an absent marker means the OpenTelemetry (inclusive) meaning.
 *
 * INVARIANT these tests pin, for both tracers: every span that carries an input token count also
 * carries the marker, as a boolean `false`.
 *
 * Run: pnpm exec vitest run tests/unit/otel-input-token-semantics.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { trace, type Span } from "@opentelemetry/api";

import {
  createAgentaOtel,
  createSandboxAgentOtel,
} from "../../src/tracing/otel.ts";

const MARKER = "agenta.usage.input_tokens_includes_cache";
const INPUT_TOKENS = "gen_ai.usage.input_tokens";

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

/**
 * The declaration invariant: a span carries the marker if and only if it carries an input token
 * count, and the marker is the boolean `false` (not the string "false", which would land as a
 * different attribute type on the wire). Returns how many spans declared it, so a caller can
 * assert the run produced any at all.
 */
function assertEveryTokenSpanDeclaresExclusiveInput(spans: FakeSpan[]): number {
  let declared = 0;
  for (const span of spans) {
    const hasTokens = span.attributes[INPUT_TOKENS] !== undefined;
    if (!hasTokens) {
      expect(
        span.attributes[MARKER],
        `${span.name} reports no input tokens, so it must not declare their contract`,
      ).toBeUndefined();
      continue;
    }
    expect(
      span.attributes[MARKER],
      `${span.name} reports input tokens and must declare they exclude cache`,
    ).toBe(false);
    expect(typeof span.attributes[MARKER]).toBe("boolean");
    declared += 1;
  }
  return declared;
}

/** Drive the Pi extension lifecycle by capturing the handlers it registers. */
function piHandlers(otel: ReturnType<typeof createAgentaOtel>) {
  const handlers: Record<string, (e: any, ctx?: any) => Promise<void>> = {};
  otel.register({
    on: (name: string, fn: (e: any, ctx?: any) => Promise<void>) => {
      handlers[name] = fn;
    },
  } as any);
  return handlers;
}

const assistantMessage = (usage: Record<string, unknown>) => ({
  role: "assistant",
  model: "claude-haiku-9",
  provider: "anthropic",
  content: "ok",
  usage,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the ACP tracer declares its input token contract", () => {
  it("marks the chat leaf that carries the token split", () => {
    const spans = spyTracer();
    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
    });
    otel.start({ prompt: "hi" });
    otel.setUsage({ input: 3595, output: 248, total: 3843, cost: 0.0219 });
    otel.finish();

    const chatSpan = spans.find((s) => s.name.startsWith("chat"));
    expect(chatSpan?.attributes[INPUT_TOKENS]).toBe(3595);
    expect(chatSpan?.attributes[MARKER]).toBe(false);
    expect(assertEveryTokenSpanDeclaresExclusiveInput(spans)).toBe(1);
  });

  it("leaves the parent spans undeclared, since they report no input tokens", () => {
    const spans = spyTracer();
    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
    });
    otel.start({ prompt: "hi" });
    otel.setUsage({ input: 100, output: 20, total: 120, cost: 0.01 });
    otel.finish();

    const agentSpan = spans.find((s) => s.name === "invoke_agent");
    expect(agentSpan?.attributes["gen_ai.usage.cost"]).toBe(0.01);
    expect(agentSpan?.attributes[MARKER]).toBeUndefined();
    assertEveryTokenSpanDeclaresExclusiveInput(spans);
  });

  it("declares the contract even when the run reported cost without a token split", () => {
    const spans = spyTracer();
    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
    });
    otel.start({ prompt: "hi" });
    otel.setUsage({ input: 0, output: 0, total: 0, cost: 0.04 });
    otel.finish();

    const chatSpan = spans.find((s) => s.name.startsWith("chat"));
    expect(chatSpan?.attributes[INPUT_TOKENS]).toBe(0);
    expect(assertEveryTokenSpanDeclaresExclusiveInput(spans)).toBe(1);
  });
});

describe("the Pi tracer declares its input token contract", () => {
  it("marks every turn's chat span, alongside the cache counts it reports separately", async () => {
    const spans = spyTracer();
    const otel = createAgentaOtel({
      captureContent: false,
      requestModel: "claude-haiku-9",
    });
    const handlers = piHandlers(otel);

    await handlers["before_agent_start"]?.({ prompt: "hi" });
    await handlers["agent_start"]?.({});
    for (const index of [0, 1]) {
      await handlers["turn_start"]?.({ turnIndex: index });
      await handlers["before_provider_request"]?.({}, {});
      await handlers["message_end"]?.({
        message: assistantMessage({
          input: 120,
          output: 30,
          totalTokens: 150,
          cacheRead: 900,
          cacheWrite: 40,
          cost: { total: 0.002 },
        }),
      });
      await handlers["turn_end"]?.({});
    }
    await handlers["agent_end"]?.({ messages: [] });

    const chatSpans = spans.filter((s) => s.name.startsWith("chat"));
    expect(chatSpans).toHaveLength(2);
    for (const span of chatSpans) {
      // The cache counts sit BESIDE the input count: that is what the marker declares.
      expect(span.attributes[INPUT_TOKENS]).toBe(120);
      expect(span.attributes["gen_ai.usage.cache_read.input_tokens"]).toBe(900);
      expect(span.attributes["gen_ai.usage.cache_creation.input_tokens"]).toBe(
        40,
      );
      expect(span.attributes[MARKER]).toBe(false);
    }
    expect(assertEveryTokenSpanDeclaresExclusiveInput(spans)).toBe(2);
  });

  it("marks a turn that reported no cache counts at all", async () => {
    const spans = spyTracer();
    const otel = createAgentaOtel({
      captureContent: false,
      requestModel: "gpt-5.6-luna",
    });
    const handlers = piHandlers(otel);

    await handlers["before_agent_start"]?.({ prompt: "hi" });
    await handlers["agent_start"]?.({});
    await handlers["turn_start"]?.({ turnIndex: 0 });
    await handlers["before_provider_request"]?.({}, {});
    await handlers["message_end"]?.({
      message: assistantMessage({ input: 10, output: 5, totalTokens: 15 }),
    });
    await handlers["turn_end"]?.({});
    await handlers["agent_end"]?.({ messages: [] });

    const chatSpan = spans.find((s) => s.name.startsWith("chat"));
    expect(chatSpan?.attributes[INPUT_TOKENS]).toBe(10);
    expect(
      chatSpan?.attributes["gen_ai.usage.cache_read.input_tokens"],
    ).toBeUndefined();
    expect(assertEveryTokenSpanDeclaresExclusiveInput(spans)).toBe(1);
  });
});

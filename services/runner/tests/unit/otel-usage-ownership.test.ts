/**
 * Who owns a token observation in the span trees `tracing/otel.ts` builds.
 *
 * Agenta ingests `gen_ai.usage.*_tokens` as an INCREMENTAL measurement and rolls each span's
 * cumulative total up from its children. A whole run ships in ONE OTLP batch, so a parent that
 * repeats its children's totals gets them counted twice: `invoke_agent` used to report the run
 * total that its own `chat` spans had already reported, and every agent run showed exactly
 * twice its real token count (measured live: 3,843 real read as 7,686).
 *
 * INVARIANT these tests pin, for both tracers: a span that has children never carries a
 * `gen_ai.usage.*_tokens` attribute. Only the leaf model spans do, and their sum is the run
 * total. Cost is the deliberate exception — `gen_ai.usage.cost` ingests as an explicitly
 * CUMULATIVE subtree total, so a parent may carry it and `invoke_agent` still does.
 *
 * Run: pnpm exec vitest run tests/unit/otel-usage-ownership.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { trace, type Span } from "@opentelemetry/api";

import {
  createAgentaOtel,
  createSandboxAgentOtel,
} from "../../src/tracing/otel.ts";

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

const TOKEN_KEYS = [
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
  "gen_ai.usage.prompt_tokens",
  "gen_ai.usage.completion_tokens",
  "gen_ai.usage.total_tokens",
];

const isLeafModelSpan = (span: FakeSpan) => span.name.startsWith("chat");

const tokenTotal = (span: FakeSpan) =>
  Number(span.attributes["gen_ai.usage.total_tokens"] ?? 0);

/**
 * The producer's half of the roll-up invariant: no span that has children reports a token
 * measurement, so a parent's cumulative can only ever be the sum of its leaves. Returns that
 * sum so a caller can compare it against the run total the harness reported.
 */
function assertOnlyLeavesOwnTokens(spans: FakeSpan[]): number {
  for (const span of spans) {
    if (isLeafModelSpan(span)) continue;
    for (const key of TOKEN_KEYS) {
      expect(
        span.attributes[key],
        `${span.name} must not report ${key}: its children already do`,
      ).toBeUndefined();
    }
  }
  return spans
    .filter(isLeafModelSpan)
    .reduce((sum, s) => sum + tokenTotal(s), 0);
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

const assistantMessage = (input: number, output: number, cost: number) => ({
  role: "assistant",
  model: "gpt-5.6-luna",
  provider: "openai",
  content: "ok",
  usage: {
    input,
    output,
    totalTokens: input + output,
    cost: { total: cost },
  },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the ACP tracer stamps the run's tokens on one span only", () => {
  it("gives the chat leaf the token split and the agent span only the cost", () => {
    const spans = spyTracer();
    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
    });
    otel.start({ prompt: "hi" });
    otel.setUsage({ input: 3595, output: 248, total: 3843, cost: 0.0219 });
    otel.finish();

    const agentSpan = spans.find((s) => s.name === "invoke_agent");
    const chatSpan = spans.find(isLeafModelSpan);

    expect(chatSpan?.attributes["gen_ai.usage.total_tokens"]).toBe(3843);
    expect(agentSpan?.attributes["gen_ai.usage.cost"]).toBe(0.0219);

    // The roll-up over this batch yields 3,843 — the real total, not 7,686.
    expect(assertOnlyLeavesOwnTokens(spans)).toBe(3843);
  });

  it("keeps the turn span free of usage so an intermediate level cannot repeat it", () => {
    const spans = spyTracer();
    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
    });
    otel.start({ prompt: "hi" });
    otel.setUsage({ input: 100, output: 20, total: 120, cost: 0.01 });
    otel.finish();

    const turnSpan = spans.find((s) => s.name === "turn 0");
    expect(turnSpan).toBeDefined();
    expect(
      Object.keys(turnSpan?.attributes ?? {}).filter((k) =>
        k.startsWith("gen_ai.usage."),
      ),
    ).toEqual([]);
  });
});

describe("the Pi tracer stamps each turn's tokens on that turn's chat span", () => {
  it("rolls a multi-turn run up to the real total exactly once", async () => {
    const spans = spyTracer();
    const otel = createAgentaOtel({
      captureContent: false,
      requestModel: "gpt-5.6-luna",
    });
    const handlers = piHandlers(otel);
    const turns = [
      [1600, 250],
      [1700, 226],
      [1750, 233],
      [1800, 217],
    ];

    await handlers["before_agent_start"]?.({ prompt: "hi" });
    await handlers["agent_start"]?.({});
    for (const [index, [input, output]] of turns.entries()) {
      await handlers["turn_start"]?.({ turnIndex: index });
      await handlers["before_provider_request"]?.({}, {});
      await handlers["message_end"]?.({
        message: assistantMessage(input, output, 0.001),
      });
      await handlers["turn_end"]?.({});
    }
    await handlers["agent_end"]?.({ messages: [] });

    const expectedTotal = turns.reduce((sum, [i, o]) => sum + i + o, 0);
    expect(otel.usage().total).toBe(expectedTotal);

    const chatSpans = spans.filter(isLeafModelSpan);
    expect(chatSpans).toHaveLength(turns.length);
    expect(assertOnlyLeavesOwnTokens(spans)).toBe(expectedTotal);

    const agentSpan = spans.find((s) => s.name === "invoke_agent");
    expect(agentSpan?.attributes["gen_ai.usage.cost"]).toBeCloseTo(0.004, 10);
  });

  it("still reports the run's cost on the agent span when a turn reported none", async () => {
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
      message: {
        role: "assistant",
        model: "gpt-5.6-luna",
        usage: { input: 10, output: 5, totalTokens: 15 },
      },
    });
    await handlers["turn_end"]?.({});
    await handlers["agent_end"]?.({ messages: [] });

    const agentSpan = spans.find((s) => s.name === "invoke_agent");
    expect(agentSpan?.attributes["gen_ai.usage.cost"]).toBeUndefined();
    expect(assertOnlyLeavesOwnTokens(spans)).toBe(15);

    // The same record is serialized to the usage writeback the engine reads back and returns
    // on the wire. An unpriced run must omit the key: a `0` there reads as "measured, free".
    const usage = otel.usage();
    expect(usage).toEqual({ input: 10, output: 5, total: 15 });
    expect("cost" in usage).toBe(false);
  });

  it("reports a cost of zero when a turn actually priced the run at zero", async () => {
    spyTracer();
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
      message: assistantMessage(10, 5, 0),
    });
    await handlers["turn_end"]?.({});
    await handlers["agent_end"]?.({ messages: [] });

    // A free model is a measurement, not an absence — it survives as the 0 it is.
    expect(otel.usage()).toEqual({ input: 10, output: 5, total: 15, cost: 0 });
  });
});

/**
 * Per-turn harness usage for the ACP harnesses (Claude, Codex).
 *
 * Claude Code reports `total_cost_usd` as a running total for the whole session, and one pooled
 * session serves many turns, so the runner reports each turn's share. The model spans carry
 * tokens only (with cache reads and writes), one span per model, so the platform prices each at
 * its own rate.
 *
 * Run: pnpm exec vitest run tests/unit/harness-turn-usage.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { trace, type Span } from "@opentelemetry/api";

import {
  promptTokenDetail,
  turnCostFromRunningTotal,
} from "../../src/engines/sandbox_agent/usage.ts";
import { createSandboxAgentOtel } from "../../src/tracing/otel.ts";

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

afterEach(() => {
  vi.restoreAllMocks();
});

const claudeResponse = {
  stopReason: "end_turn",
  usage: {
    inputTokens: 10,
    outputTokens: 200,
    cachedReadTokens: 5000,
    cachedWriteTokens: 1200,
    totalTokens: 6410,
  },
  _meta: {
    quota: {
      token_count: {},
      model_usage: [
        {
          model: "claude-sonnet-4-5",
          token_count: {
            inputTokens: 10,
            outputTokens: 200,
            cachedInputTokens: 5000,
            cachedWriteTokens: 1200,
          },
        },
        {
          model: "claude-haiku-4-5",
          token_count: {
            inputTokens: 300,
            outputTokens: 40,
            cachedInputTokens: 0,
            cachedWriteTokens: 0,
          },
        },
      ],
    },
  },
};

describe("turnCostFromRunningTotal", () => {
  it("reports the whole reading on the first turn of a new session", () => {
    expect(turnCostFromRunningTotal(0.12, undefined, false)).toBe(0.12);
  });

  it("reports only the increase on a later turn of the same session", () => {
    expect(turnCostFromRunningTotal(0.3, 0.12, false)).toBeCloseTo(0.18, 10);
  });

  it("reports nothing on the first turn of a loaded session, whose earlier total it never saw", () => {
    expect(turnCostFromRunningTotal(4.5, undefined, true)).toBeUndefined();
  });

  it("takes the reading itself when the running total restarted", () => {
    expect(turnCostFromRunningTotal(0.05, 0.3, false)).toBe(0.05);
  });

  it("reports nothing when the harness reported no cost", () => {
    expect(turnCostFromRunningTotal(undefined, 0.3, false)).toBeUndefined();
  });
});

describe("promptTokenDetail", () => {
  it("reads one row per model, with cache reads and writes, when asked", () => {
    expect(promptTokenDetail(claudeResponse, { perModel: true })).toEqual([
      {
        model: "claude-sonnet-4-5",
        input: 10,
        output: 200,
        cacheRead: 5000,
        cacheWrite: 1200,
      },
      {
        model: "claude-haiku-4-5",
        input: 300,
        output: 40,
        cacheRead: 0,
        cacheWrite: 0,
      },
    ]);
  });

  it("reads the response usage, cache included, when per-model rows are not trusted", () => {
    // Codex fills model_usage with its LAST model call only.
    expect(promptTokenDetail(claudeResponse, { perModel: false })).toEqual([
      { input: 10, output: 200, cacheRead: 5000, cacheWrite: 1200 },
    ]);
  });

  it("returns nothing when the harness reported no usage", () => {
    expect(
      promptTokenDetail({ stopReason: "end_turn" }, { perModel: true }),
    ).toBeUndefined();
  });
});

describe("the ACP tracer stamps per-model token detail", () => {
  it("gives each model its own chat span with cache counts and no harness cost", () => {
    const spans = spyTracer();
    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-sonnet-4-5",
      emitSpans: true,
    });
    otel.start({ prompt: "hi" });
    otel.setUsage({ input: 10, output: 200, total: 210, cost: 0.02 });
    otel.setTokenDetail(promptTokenDetail(claudeResponse, { perModel: true }));
    otel.finish();

    const main = spans.find((s) => s.name === "chat claude-sonnet-4-5")!;
    expect(main.attributes["gen_ai.response.model"]).toBe("claude-sonnet-4-5");
    expect(main.attributes["gen_ai.usage.input_tokens"]).toBe(10);
    expect(main.attributes["gen_ai.usage.cache_read.input_tokens"]).toBe(5000);
    expect(main.attributes["gen_ai.usage.cache_creation.input_tokens"]).toBe(
      1200,
    );
    expect(main.attributes["gen_ai.usage.total_tokens"]).toBe(6410);
    expect(main.attributes["agenta.usage.input_tokens_includes_cache"]).toBe(
      false,
    );
    expect(main.attributes["gen_ai.usage.cost"]).toBeUndefined();

    const extra = spans.find((s) => s.name === "chat claude-haiku-4-5")!;
    expect(extra.attributes["gen_ai.request.model"]).toBe("claude-haiku-4-5");
    expect(extra.attributes["gen_ai.usage.input_tokens"]).toBe(300);
    expect(extra.attributes["gen_ai.usage.total_tokens"]).toBe(340);

    const agent = spans.find((s) => s.name === "invoke_agent")!;
    expect(agent.attributes["gen_ai.usage.total_tokens"]).toBeUndefined();
    expect(agent.attributes["gen_ai.usage.cost"]).toBeUndefined();
  });

  it("stamps the Codex response usage with its cache reads on the one chat span", () => {
    const spans = spyTracer();
    const otel = createSandboxAgentOtel({
      harness: "codex",
      model: "openai/gpt-5.3-codex",
      emitSpans: true,
    });
    otel.start({ prompt: "hi" });
    otel.setUsage({ input: 800, output: 90, total: 890 });
    otel.setTokenDetail([
      { input: 800, output: 90, cacheRead: 7000, cacheWrite: 0 },
    ]);
    otel.finish();

    const chats = spans.filter((s) => s.name.startsWith("chat"));
    expect(chats).toHaveLength(1);
    expect(chats[0]!.attributes["gen_ai.usage.cache_read.input_tokens"]).toBe(
      7000,
    );
    expect(chats[0]!.attributes["gen_ai.usage.input_tokens"]).toBe(800);
    expect(chats[0]!.attributes["gen_ai.response.model"]).toBe("gpt-5.3-codex");
  });
});

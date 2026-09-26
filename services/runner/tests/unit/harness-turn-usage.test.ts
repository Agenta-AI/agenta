/**
 * Per-turn harness usage for the ACP harnesses (Claude, Codex).
 *
 * Claude Code reports `total_cost_usd` as a running total for the whole session, and one pooled
 * session serves many turns, so the runner reports each turn's share. The turn's one chat span
 * carries the tokens of every model call (with cache reads and writes) and that share, and the
 * run's usage reports the same token counts.
 *
 * Run: pnpm exec vitest run tests/unit/harness-turn-usage.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { trace, type Span } from "@opentelemetry/api";

import {
  awaitEndingPrompt,
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
  it("sums the per-model rows, subagents and cache included, when asked", () => {
    expect(promptTokenDetail(claudeResponse, { perModel: true })).toEqual({
      input: 310,
      output: 240,
      cacheRead: 5000,
      cacheWrite: 1200,
    });
  });

  it("reads the response usage, cache included, when per-model rows are not trusted", () => {
    // Codex fills model_usage with its LAST model call only.
    expect(promptTokenDetail(claudeResponse, { perModel: false })).toEqual({
      input: 10,
      output: 200,
      cacheRead: 5000,
      cacheWrite: 1200,
    });
  });

  it("returns nothing when the harness reported no usage", () => {
    expect(
      promptTokenDetail({ stopReason: "end_turn" }, { perModel: true }),
    ).toBeUndefined();
  });
});

describe("the ACP tracer stamps the turn's usage on one chat span", () => {
  it("sums every model's tokens on the chat span and carries Claude's turn cost", () => {
    const spans = spyTracer();
    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-sonnet-4-5",
      emitSpans: true,
    });
    otel.start({ prompt: "hi" });
    otel.setTokenDetail(promptTokenDetail(claudeResponse, { perModel: true }));
    otel.setUsage({ input: 310, output: 240, total: 6750, cost: 0.02 });
    otel.finish();

    const chats = spans.filter((s) => s.name.startsWith("chat"));
    expect(chats).toHaveLength(1);
    const chat = chats[0]!;
    expect(chat.attributes["gen_ai.usage.input_tokens"]).toBe(310);
    expect(chat.attributes["gen_ai.usage.output_tokens"]).toBe(240);
    expect(chat.attributes["gen_ai.usage.cache_read.input_tokens"]).toBe(5000);
    expect(chat.attributes["gen_ai.usage.cache_creation.input_tokens"]).toBe(
      1200,
    );
    expect(chat.attributes["gen_ai.usage.total_tokens"]).toBe(6750);
    expect(chat.attributes["agenta.usage.input_tokens_includes_cache"]).toBe(
      false,
    );
    expect(chat.attributes["gen_ai.usage.cost"]).toBe(0.02);

    const agent = spans.find((s) => s.name === "invoke_agent")!;
    expect(agent.attributes["gen_ai.usage.total_tokens"]).toBeUndefined();
    expect(agent.attributes["gen_ai.usage.cost"]).toBeUndefined();
  });

  it("reports the chat span's counts as the run's usage, cache and subagents included", () => {
    spyTracer();
    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-sonnet-4-5",
      emitSpans: true,
    });
    otel.start({ prompt: "hi" });
    otel.setTokenDetail(promptTokenDetail(claudeResponse, { perModel: true }));
    // The prompt response's own usage: the main agent only, cache left out of the total.
    otel.setUsage({ input: 10, output: 200, total: 210, cost: 0.02 });

    expect(otel.usage()).toEqual({
      input: 310,
      output: 240,
      total: 6750,
      cost: 0.02,
    });
  });

  it("keeps the usage a self-tracing harness reported", () => {
    spyTracer();
    const otel = createSandboxAgentOtel({
      harness: "pi",
      model: "anthropic/claude-sonnet-4-5",
      emitSpans: false,
    });
    otel.start({ prompt: "hi" });
    otel.setTokenDetail({ input: 1, output: 1, cacheRead: 1, cacheWrite: 1 });
    otel.setUsage({ input: 40, output: 8, total: 48, cost: 0.01 });

    expect(otel.usage()).toEqual({
      input: 40,
      output: 8,
      total: 48,
      cost: 0.01,
    });
  });

  it("stamps the Codex response usage with its cache reads and no cost", () => {
    const spans = spyTracer();
    const otel = createSandboxAgentOtel({
      harness: "codex",
      model: "openai/gpt-5.3-codex",
      emitSpans: true,
    });
    otel.start({ prompt: "hi" });
    otel.setTokenDetail({
      input: 800,
      output: 90,
      cacheRead: 7000,
      cacheWrite: 0,
    });
    otel.setUsage({ input: 800, output: 90, total: 7890 });
    otel.finish();

    const chats = spans.filter((s) => s.name.startsWith("chat"));
    expect(chats).toHaveLength(1);
    expect(chats[0]!.attributes["gen_ai.usage.cache_read.input_tokens"]).toBe(
      7000,
    );
    expect(chats[0]!.attributes["gen_ai.usage.input_tokens"]).toBe(800);
    expect(chats[0]!.attributes["gen_ai.usage.cost"]).toBeUndefined();
    expect(chats[0]!.attributes["gen_ai.response.model"]).toBe("gpt-5.3-codex");
  });
});

describe("awaitEndingPrompt (the cancelled prompt of a cold pause)", () => {
  it("returns the prompt's answer when it arrives in time", async () => {
    const answer = { stopReason: "cancelled", usage: { inputTokens: 5 } };
    await expect(
      awaitEndingPrompt(Promise.resolve(answer), 1000),
    ).resolves.toBe(answer);
  });

  it("returns nothing when the prompt rejects or never ends", async () => {
    const rejected = Promise.reject(new Error("transport closed"));
    await expect(awaitEndingPrompt(rejected, 1000)).resolves.toBeUndefined();
    await expect(
      awaitEndingPrompt(new Promise(() => {}), 10),
    ).resolves.toBeUndefined();
  });
});

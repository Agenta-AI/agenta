/**
 * Pi's tracer stamps the provider's billed cost on the chat span (harness cost issue H1).
 *
 * The runner's pi-ai build patch (`src/tools/pi-provider-cost-patch.ts`) keeps OpenRouter's
 * `usage.cost` in `usage.cost.total` and marks it `usage.cost.source = "provider"`. The tracer
 * must carry that total as `gen_ai.usage.cost` and name the source with
 * `agenta.usage.cost_source`. A message without the marker keeps Pi's own cost and gets no source
 * attribute.
 *
 * Run: pnpm exec vitest run tests/unit/otel-provider-cost.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { trace, type Span } from "@opentelemetry/api";

import { createAgentaOtel } from "../../src/tracing/otel.ts";
import { PROVIDER_COST_SOURCE } from "../../src/tools/pi-provider-cost-patch.ts";

interface FakeSpan {
  name: string;
  attributes: Record<string, unknown>;
}

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
        return { traceId: "0".repeat(32), spanId: "0".repeat(16), traceFlags: 1 };
      },
      isRecording() {
        return true;
      },
      addEvent() {
        return api;
      },
      updateName() {
        return api;
      },
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

/** An assistant message as the patched pi-ai returns it for one OpenRouter call. */
function assistant(cost: Record<string, unknown>) {
  return {
    role: "assistant",
    provider: "openrouter",
    model: "openai/gpt-4o-mini",
    stopReason: "stop",
    content: [{ type: "text", text: "hi" }],
    usage: {
      input: 1000,
      output: 200,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 1200,
      cost,
    },
  };
}

/** Drive one Pi chat call through the tracer and return the chat span. */
async function traceOneChat(message: unknown): Promise<FakeSpan[]> {
  const spans = spyTracer();
  const otel = createAgentaOtel({ captureContent: false });
  const handlers: Record<string, (e: any, ctx?: any) => Promise<void>> = {};
  otel.register({
    on: (name: string, fn: (e: any, ctx?: any) => Promise<void>) => {
      handlers[name] = fn;
    },
  } as any);
  await handlers["before_agent_start"]?.({ prompt: "hi" });
  await handlers["agent_start"]?.({});
  await handlers["turn_start"]?.({ turnIndex: 0 });
  await handlers["before_provider_request"]?.(
    {},
    { model: { id: "openai/gpt-4o-mini", provider: "openrouter" } },
  );
  await handlers["message_end"]?.({ message });
  await handlers["turn_end"]?.({});
  await handlers["agent_end"]?.({ messages: [message] });
  return spans;
}

describe("Pi chat span cost source", () => {
  it("stamps the provider's billed cost and marks its source", async () => {
    const spans = await traceOneChat(
      assistant({
        input: 0.0068,
        output: 0.0055,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0.0123,
        source: PROVIDER_COST_SOURCE,
      }),
    );

    const chat = spans.find((s) => s.name.startsWith("chat"));
    expect(chat?.attributes["gen_ai.usage.cost"]).toBe(0.0123);
    expect(chat?.attributes["agenta.usage.cost_source"]).toBe("provider");
    // The marker belongs to the leaf chat span that owns the cost, not to its ancestors.
    for (const span of spans.filter((s) => s !== chat)) {
      expect(span.attributes["agenta.usage.cost_source"]).toBeUndefined();
    }
  });

  it("keeps Pi's own cost and adds no source when the provider billed none", async () => {
    const spans = await traceOneChat(
      assistant({
        input: 0.00015,
        output: 0.00012,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0.00027,
      }),
    );

    const chat = spans.find((s) => s.name.startsWith("chat"));
    expect(chat?.attributes["gen_ai.usage.cost"]).toBe(0.00027);
    expect(chat?.attributes["agenta.usage.cost_source"]).toBeUndefined();
  });

  it("ignores an unknown source value", async () => {
    const spans = await traceOneChat(
      assistant({ total: 0.5, source: "somewhere-else" }),
    );

    const chat = spans.find((s) => s.name.startsWith("chat"));
    expect(chat?.attributes["gen_ai.usage.cost"]).toBe(0.5);
    expect(chat?.attributes["agenta.usage.cost_source"]).toBeUndefined();
  });
});

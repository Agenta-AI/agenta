/**
 * A model served by a custom model connection must not be priced at the public provider rate.
 *
 * The ACP tracer stamps the bare model id (`gpt-5.3-codex`) on its model spans, which the
 * platform prices from its public table. A custom connection is the user's own gateway or
 * OpenAI-compatible deployment and charges what it charges, so its model spans carry
 * `agenta.model.custom_connection = true`. A standard provider route carries no marker.
 *
 * Run: pnpm exec vitest run tests/unit/otel-custom-connection.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { trace, type Span } from "@opentelemetry/api";

import {
  CUSTOM_CONNECTION,
  createSandboxAgentOtel,
} from "../../src/tracing/otel.ts";

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

function runOnce(connectionDeployment: string | undefined): FakeSpan[] {
  const spans = spyTracer();
  const otel = createSandboxAgentOtel({
    harness: "claude",
    model: "anthropic/claude-sonnet",
    connectionDeployment,
    emitSpans: true,
  });
  otel.start({ prompt: "hi" });
  // Two models: the main chat span and one sibling span for a subagent's model.
  otel.setTokenDetail([
    {
      model: "claude-sonnet",
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
    },
    { model: "claude-haiku", input: 4, output: 2, cacheRead: 0, cacheWrite: 0 },
  ]);
  otel.setUsage({ input: 14, output: 7, total: 21 });
  otel.finish();
  return spans;
}

const modelSpans = (spans: FakeSpan[]) =>
  spans.filter((span) => span.name.startsWith("chat"));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("custom model connection marker on model spans", () => {
  it("marks every model span of a custom connection, and no other span", () => {
    const spans = runOnce("custom");
    const models = modelSpans(spans);
    expect(models).toHaveLength(2);
    for (const span of models) {
      expect(span.attributes[CUSTOM_CONNECTION]).toBe(true);
    }
    for (const span of spans.filter((s) => !s.name.startsWith("chat"))) {
      expect(span.attributes[CUSTOM_CONNECTION]).toBeUndefined();
    }
    expect(CUSTOM_CONNECTION).toBe("agenta.model.custom_connection");
  });

  it.each([["direct"], ["bedrock"], [undefined]])(
    "leaves a standard route (%s) unmarked",
    (deployment) => {
      for (const span of modelSpans(runOnce(deployment))) {
        expect(span.attributes[CUSTOM_CONNECTION]).toBeUndefined();
      }
    },
  );
});

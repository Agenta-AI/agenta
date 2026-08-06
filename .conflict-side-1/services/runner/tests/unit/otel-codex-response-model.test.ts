import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExportResult } from "@opentelemetry/core";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

interface FakeExport {
  url: string;
  spans: ReadableSpan[];
}

const fakeExports: FakeExport[] = [];

vi.mock("@opentelemetry/exporter-trace-otlp-proto", () => {
  class FakeOTLPTraceExporter {
    url: string;
    constructor(config: { url: string }) {
      this.url = config.url;
    }
    export(spans: ReadableSpan[], cb: (result: ExportResult) => void): void {
      fakeExports.push({ url: this.url, spans });
      cb({ code: 0 /* ExportResultCode.SUCCESS */ });
    }
    async shutdown(): Promise<void> {}
  }
  return { OTLPTraceExporter: FakeOTLPTraceExporter };
});

const { createSandboxAgentOtel } = await import("../../src/tracing/otel.ts");

function chatSpanAt(endpoint: string): ReadableSpan {
  const span = fakeExports
    .filter((entry) => entry.url === endpoint)
    .flatMap((entry) => entry.spans)
    .find((entry) => entry.name.startsWith("chat"));
  expect(span).toBeDefined();
  return span!;
}

afterEach(() => {
  fakeExports.length = 0;
  vi.restoreAllMocks();
});

describe("Codex LLM response model attribution", () => {
  it("stamps the resolved Codex model as both request and response model", async () => {
    const endpoint = "http://codex-model.example/v1/traces";
    const run = createSandboxAgentOtel({
      harness: "codex",
      model: "gpt-5.6-luna",
      emitSpans: true,
      endpoint,
    });

    run.start({ prompt: "hello" });
    run.finish();
    await run.flush();

    const span = chatSpanAt(endpoint);
    expect(span.attributes["gen_ai.request.model"]).toBe("gpt-5.6-luna");
    expect(span.attributes["gen_ai.response.model"]).toBe("gpt-5.6-luna");
  });

  it("does not stamp a response model for Claude", async () => {
    const endpoint = "http://claude-model.example/v1/traces";
    const run = createSandboxAgentOtel({
      harness: "claude",
      model: "claude-fable-5",
      emitSpans: true,
      endpoint,
    });

    run.start({ prompt: "hello" });
    run.finish();
    await run.flush();

    const span = chatSpanAt(endpoint);
    expect(span.attributes["gen_ai.request.model"]).toBe("claude-fable-5");
    expect(span.attributes).not.toHaveProperty("gen_ai.response.model");
  });
});

/**
 * The runner registers its tracer provider globally, so every library that traces through the
 * OpenTelemetry API writes into it. The Daytona SDK wraps each call in a span from
 * `trace.getTracer("")`, and the in-process engine polls a running command about once a second.
 * Each poll became a one-span trace that belonged to no run, fell back to the env default target,
 * and, with no `AGENTA_CREDENTIALS` in production, logged "trace export skipped, no credential"
 * at ERROR once a second (issue #7481).
 *
 * This pins that the processor exports only the runner's own spans: a foreign span is neither
 * exported nor logged, and a runner span next to it still exports.
 *
 * Run: pnpm exec vitest run tests/unit/otel-foreign-spans.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trace } from "@opentelemetry/api";
import type { ExportResult } from "@opentelemetry/core";

const fakeExports: Array<{ url: string; spanNames: string[] }> = [];

vi.mock("@opentelemetry/exporter-trace-otlp-proto", () => {
  class FakeOTLPTraceExporter {
    url: string;
    constructor(config: { url: string }) {
      this.url = config.url;
    }
    export(
      spans: Array<{ name: string }>,
      cb: (r: ExportResult) => void,
    ): void {
      fakeExports.push({ url: this.url, spanNames: spans.map((s) => s.name) });
      cb({ code: 0 /* ExportResultCode.SUCCESS */ });
    }
    async shutdown(): Promise<void> {}
  }
  return { OTLPTraceExporter: FakeOTLPTraceExporter };
});

// Imported AFTER the mock so `otel.ts` picks up the fake OTLPTraceExporter.
const { createSandboxAgentOtel } = await import("../../src/tracing/otel.ts");

beforeEach(() => {
  vi.stubEnv("AGENTA_API_INTERNAL_URL", "");
  vi.stubEnv("AGENTA_API_URL", "");
});

afterEach(() => {
  fakeExports.length = 0;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Start and end one root span the way the Daytona SDK's `@WithSpan` decorator does. */
function emitForeignRootSpan(): void {
  trace.getTracer("").startSpan("Process.executeCommand").end();
}

describe("TraceBatchProcessor and spans from other libraries", () => {
  it("does not export or log a foreign span when no credential is configured", async () => {
    vi.stubEnv("AGENTA_CREDENTIALS", "");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Creating a run registers the runner's provider globally, as in production.
    createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
    });

    emitForeignRootSpan();
    await Promise.resolve();

    expect(fakeExports).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not export a foreign span to the default target even when a credential is configured", async () => {
    vi.stubEnv("AGENTA_CREDENTIALS", "Secret fallback-credential");
    const endpoint = "http://collector.example/v1/traces";
    const run = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
      endpoint,
    });

    emitForeignRootSpan();
    run.start({ prompt: "hi" });
    run.finish();
    await run.flush();

    const exportedNames = fakeExports.flatMap((e) => e.spanNames);
    expect(exportedNames).not.toContain("Process.executeCommand");
    expect(fakeExports.every((e) => e.url === endpoint)).toBe(true);
    expect(exportedNames).toContain("invoke_agent");
  });
});

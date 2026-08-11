/**
 * `TraceBatchProcessor.flush` previously discarded the exporter's `ExportResult`, so an OTLP
 * export FAILURE resolved as success and was invisible. This pins that a failing export is
 * logged rather than silently swallowed.
 *
 * We spy on `OTLPExporterBase.prototype.export` (reached via any exporter instance's prototype
 * chain, since the package only exports the concrete `OTLPTraceExporter`) to force a FAILED
 * `ExportResult` through the real `TraceBatchProcessor` created by `createSandboxAgentOtel`.
 *
 * Run: pnpm exec vitest run tests/unit/otel-flush-export.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";

import { createSandboxAgentOtel } from "../../src/tracing/otel.ts";

/** The shared base prototype real exporters inherit `export` from, typed as `SpanExporter`. */
function exportProtoOf(exporter: OTLPTraceExporter): SpanExporter {
  return Object.getPrototypeOf(Object.getPrototypeOf(exporter));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("otel TraceBatchProcessor.flush", () => {
  it("logs a FAILED ExportResult instead of silently resolving", async () => {
    // Reach the shared base prototype that actually owns `export` (OTLPTraceExporter itself
    // declares no own methods) so the spy applies to every exporter instance the module builds.
    const exportProto = exportProtoOf(
      new OTLPTraceExporter({ url: "http://127.0.0.1:1/v1/traces" }),
    );
    const exportSpy = vi
      .spyOn(exportProto, "export")
      .mockImplementation((_spans, cb: (r: ExportResult) => void) => {
        cb({ code: ExportResultCode.FAILED, error: new Error("boom") });
      });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
      endpoint: "http://127.0.0.1:1/v1/traces",
    });
    otel.start({ prompt: "hi" });
    otel.finish();
    await otel.flush();

    expect(exportSpy).toHaveBeenCalled();
    // The failure must surface via a log, not vanish.
    expect(errorSpy).toHaveBeenCalled();
    const loggedFailure = errorSpy.mock.calls.some((args) =>
      args.some((a) => typeof a === "string" && a.includes("export failed")),
    );
    expect(loggedFailure).toBe(true);
  });

  it("does not log on a SUCCESS ExportResult", async () => {
    const exportProto = exportProtoOf(
      new OTLPTraceExporter({ url: "http://127.0.0.1:1/v1/traces" }),
    );
    vi.spyOn(exportProto, "export").mockImplementation(
      (_spans, cb: (r: ExportResult) => void) => {
        cb({ code: ExportResultCode.SUCCESS });
      },
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const otel = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/claude-haiku",
      emitSpans: true,
      endpoint: "http://127.0.0.1:1/v1/traces",
    });
    otel.start({ prompt: "hi" });
    otel.finish();
    await otel.flush();

    expect(errorSpy).not.toHaveBeenCalled();
  });
});

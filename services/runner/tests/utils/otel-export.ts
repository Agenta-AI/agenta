/**
 * Drive one agent run through the real `TraceBatchProcessor` with a stubbed OTLP transport, and
 * return what the export path logged.
 *
 * The stub goes on the shared base prototype exporters inherit `export` from, because the
 * package only exports the concrete `OTLPTraceExporter` and the module builds its own instances
 * from an internal cache — a spy on any one instance would not be reached.
 */
import { vi } from "vitest";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import type { ExportResult } from "@opentelemetry/core";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";

import { createSandboxAgentOtel } from "../../src/tracing/otel.ts";

/** A third-party collector: not an Agenta host, so a credential-less batch is still sent. */
export const TEST_EXPORT_ENDPOINT = "http://127.0.0.1:1/otlp/v1/traces";

/** Agenta's own ingest, which never accepts an unauthenticated export. */
export const AGENTA_INGEST_ENDPOINT =
  "https://cloud.agenta.ai/api/otlp/v1/traces";

function exportPrototype(): SpanExporter {
  const exporter = new OTLPTraceExporter({ url: TEST_EXPORT_ENDPOINT });
  return Object.getPrototypeOf(Object.getPrototypeOf(exporter));
}

/** Run one prompt to completion and flush it. Call inside a test that restores mocks after. */
export async function runExportCapture(options: {
  /** Omit to run a batch with no credential. */
  authorization?: string;
  result: ExportResult;
  endpoint?: string;
}): Promise<{ logs: string[]; exportCalled: boolean }> {
  const endpoint = options.endpoint ?? TEST_EXPORT_ENDPOINT;
  const exportSpy = vi
    .spyOn(exportPrototype(), "export")
    .mockImplementation((_spans, cb: (r: ExportResult) => void) =>
      cb(options.result),
    );
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  const otel = createSandboxAgentOtel({
    harness: "claude",
    model: "anthropic/claude-haiku",
    emitSpans: true,
    endpoint,
    authorization: options.authorization,
  });
  otel.start({ prompt: "hi" });
  otel.finish();
  await otel.flush();

  return {
    logs: errorSpy.mock.calls.map((args) => args.join(" ")),
    exportCalled: exportSpy.mock.calls.length > 0,
  };
}

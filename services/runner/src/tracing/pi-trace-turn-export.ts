import type { Redactor } from "../redaction.ts";
import type { AuthorizationProvider } from "./otel.ts";
import { exportOtlpBytes } from "./otlp-bytes-export.ts";
import {
  createPiTraceSpoolConsumer,
  type PiTraceSpoolConsumer,
} from "./pi-spool-consumer.ts";
import type { PiTurnTraceControl } from "./pi-spool-protocol.ts";
import type { TelemetryFileHost } from "./telemetry-file-host.ts";

interface ExportContext {
  endpoint: string;
  authorization: AuthorizationProvider;
  authorizationSource: "platform" | "exporter";
  redactor: Redactor;
  traceId?: string;
  placement: "local" | "daytona";
  turnId?: string;
  onMissingBatch?: (message: string) => void | Promise<void>;
}

export interface PiTraceTurnExport {
  publishControl(control: PiTurnTraceControl): Promise<boolean>;
  updatePlatformAuthorization(authorization: AuthorizationProvider): void;
  traceId(): string | undefined;
  emitMissingBatchFallback(message: string): Promise<void>;
  finish(): Promise<{ validBatches: number }>;
  teardown(): Promise<void>;
}

export function createPiTraceTurnExport(options: {
  host: TelemetryFileHost;
  dir: string;
  channelId: string;
  context: ExportContext;
  log?: (message: string) => void;
}): PiTraceTurnExport {
  const context = options.context;
  let authorization = context.authorization;
  let closed = false;
  let fallbackEmitted = false;
  let consumer: PiTraceSpoolConsumer;
  const createdAtMs = Date.now();

  consumer = createPiTraceSpoolConsumer({
    host: options.host,
    dir: options.dir,
    channelId: options.channelId,
    log: options.log,
    onBatch: async ({ bytes }) => {
      const pickupLatencyMs = Date.now() - createdAtMs;
      const outcome = await exportOtlpBytes({
        body: bytes,
        target: {
          endpoint: context.endpoint,
          authorization,
        },
        diagnostics: {
          traceId: context.traceId ?? "unknown",
          source: "pi-spool",
          placement: context.placement,
          turnId: context.turnId,
          batchBytes: bytes.byteLength,
          redactors: [context.redactor],
        },
      });
      options.log?.(
        "stage=pi_trace_spool_export source=pi-spool placement=" +
          context.placement +
          " turn=" +
          (context.turnId || "<none>") +
          " trace=" +
          (context.traceId || "unknown").slice(-8) +
          " bytes=" +
          bytes.byteLength +
          " pickup_ms=" +
          pickupLatencyMs +
          " export_ms=" +
          outcome.durationMs +
          " outcome=" +
          outcome.outcome +
          " status=" +
          (outcome.status || "<none>"),
      );
    },
  });

  const teardown = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await consumer.teardown();
  };

  return {
    publishControl: async (control) => {
      if (closed) return false;
      return consumer.publishControl(JSON.stringify(control));
    },
    updatePlatformAuthorization: (next) => {
      if (context.authorizationSource === "platform") authorization = next;
    },
    traceId: () => context.traceId,
    emitMissingBatchFallback: async (message) => {
      if (fallbackEmitted) return;
      fallbackEmitted = true;
      await context.onMissingBatch?.(message);
    },
    finish: async () => {
      if (closed) return { validBatches: 0 };
      try {
        const result = await consumer.drain();
        return { validBatches: result.forwarded };
      } finally {
        await teardown();
      }
    },
    teardown,
  };
}

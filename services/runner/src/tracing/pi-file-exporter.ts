import { randomBytes } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type {
  SerializedTraceBatch,
  SerializedTraceBatchTransport,
} from "./otel.ts";
import {
  PI_TRACE_MAX_BATCH_BYTES,
  PI_TRACE_MAX_FILES,
  piTraceFileName,
} from "./pi-spool-protocol.ts";

export interface PiFileSpanExporterOptions {
  directory: string;
  channelId: string;
  maxBatchBytes?: number;
  maxFiles?: number;
  log?: (message: string) => void;
}

/** Pi-side transport: publish exact OTLP protobuf bytes through an atomic sibling rename. */
export function createPiFileSpanExporter(
  options: PiFileSpanExporterOptions,
): SerializedTraceBatchTransport {
  const log = options.log ?? (() => {});
  const maxBatchBytes = Math.min(
    PI_TRACE_MAX_BATCH_BYTES,
    Math.max(1, options.maxBatchBytes ?? PI_TRACE_MAX_BATCH_BYTES),
  );
  const maxFiles = Math.min(
    PI_TRACE_MAX_FILES,
    Math.max(1, options.maxFiles ?? PI_TRACE_MAX_FILES),
  );
  let sequence = 0;

  return {
    async export(batch: SerializedTraceBatch): Promise<void> {
      if (sequence >= maxFiles) {
        log(
          `stage=pi_trace_publish skipped=true reason=file_limit limit=${maxFiles}`,
        );
        return;
      }
      if (batch.body.byteLength > maxBatchBytes) {
        log(
          `stage=pi_trace_publish skipped=true reason=oversized bytes=${batch.body.byteLength} limit=${maxBatchBytes}`,
        );
        return;
      }

      const finalPath = join(
        options.directory,
        piTraceFileName(options.channelId, sequence),
      );
      const temporaryPath = `${finalPath}.tmp.${randomBytes(8).toString("hex")}`;
      try {
        mkdirSync(options.directory, { recursive: true });
        writeFileSync(temporaryPath, batch.body, { mode: 0o600 });
        renameSync(temporaryPath, finalPath);
        sequence += 1;
        log(
          `stage=pi_trace_publish sequence=${sequence - 1} bytes=${batch.body.byteLength} spans=${batch.spanCount}`,
        );
      } catch (error) {
        try {
          rmSync(temporaryPath, { force: true });
        } catch {
          // best-effort temporary-file cleanup
        }
        log(
          `stage=pi_trace_publish failed=true sequence=${sequence} error=${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  };
}

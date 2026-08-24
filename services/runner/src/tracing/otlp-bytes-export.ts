/**
 * Runner-only HTTP transport for an already-serialized OTLP trace request.
 *
 * Pi can produce the standard protobuf bytes inside its extension bundle, then hand them to
 * the runner through a transport seam. Keeping this POST helper outside `otel.ts` prevents
 * runner networking code from being pulled into that extension bundle.
 */
import type { Redactor } from "../redaction.ts";
import { logExportProblem } from "./export-diagnostics.ts";
import { isAgentaIngest, type AuthorizationProvider } from "./otel.ts";

const OTLP_BYTES_EXPORT_TIMEOUT_MS = 10_000;

export interface OtlpBytesExportTarget {
  endpoint: string;
  /** Read immediately before the request. Platform credentials may rotate between turns. */
  authorization: AuthorizationProvider;
}

export interface OtlpBytesExportDiagnostics {
  traceId: string;
  spanCount?: number;
  source?: "pi-spool" | "runner";
  placement?: "local" | "daytona";
  turnId?: string;
  batchBytes?: number;
  redactors?: Iterable<Redactor>;
}

export interface OtlpBytesExportOutcome {
  outcome: "exported" | "failed" | "skipped";
  status?: number;
  durationMs: number;
}

export interface OtlpBytesExportRequest {
  body: Uint8Array;
  target: OtlpBytesExportTarget;
  diagnostics: OtlpBytesExportDiagnostics;
}

/**
 * POST one protobuf OTLP request with the credential owned by the export target.
 *
 * Export remains best effort: a missing Agenta credential, an HTTP rejection, or a thrown
 * transport error is diagnosed and resolves normally. Third-party collectors may intentionally
 * be unauthenticated, so only Agenta's own ingest is skipped when the credential is absent.
 */
export async function exportOtlpBytes(
  request: OtlpBytesExportRequest,
): Promise<OtlpBytesExportOutcome> {
  const { body, target, diagnostics } = request;
  const startedAt = Date.now();
  let authorization: string | undefined;

  try {
    authorization = target.authorization();
  } catch (error) {
    logExportProblem({
      outcome: "threw",
      traceId: diagnostics.traceId,
      endpoint: target.endpoint,
      authorization,
      spans: diagnostics.spanCount,
      source: diagnostics.source,
      placement: diagnostics.placement,
      turnId: diagnostics.turnId,
      bytes: diagnostics.batchBytes,
      error,
      redactors: diagnostics.redactors,
    });
    return { outcome: "failed", durationMs: Date.now() - startedAt };
  }

  const problem = {
    traceId: diagnostics.traceId,
    endpoint: target.endpoint,
    authorization,
    spans: diagnostics.spanCount,
    source: diagnostics.source,
    placement: diagnostics.placement,
    turnId: diagnostics.turnId,
    bytes: diagnostics.batchBytes,
    redactors: diagnostics.redactors,
  };

  if (!authorization?.trim() && isAgentaIngest(target.endpoint)) {
    logExportProblem({ outcome: "skipped", ...problem });
    return { outcome: "skipped", durationMs: Date.now() - startedAt };
  }

  try {
    const response = await fetch(target.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-protobuf",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      // Preserve the exact view when `body` is a slice of a larger ArrayBuffer.
      body: Buffer.from(body.buffer, body.byteOffset, body.byteLength),
      signal: AbortSignal.timeout(OTLP_BYTES_EXPORT_TIMEOUT_MS),
      redirect: "manual",
    });

    if (response.ok) {
      return {
        outcome: "exported",
        status: response.status,
        durationMs: Date.now() - startedAt,
      };
    }

    const error = Object.assign(
      new Error(`OTLP export returned HTTP ${response.status}`),
      {
        code: response.status,
      },
    );
    logExportProblem({ outcome: "failed", ...problem, error });
    return {
      outcome: "failed",
      status: response.status,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    logExportProblem({ outcome: "threw", ...problem, error });
    return { outcome: "failed", durationMs: Date.now() - startedAt };
  }
}

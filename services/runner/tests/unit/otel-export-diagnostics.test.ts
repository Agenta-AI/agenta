/**
 * Trace exports from the cloud runner failed with a bare
 * `otel: trace export failed <traceId> OTLPExporterError: Unauthorized` for a week. The line
 * named neither the HTTP status, nor the endpoint, nor the age of the credential — so an
 * expired export credential (the actual cause) was indistinguishable from a wrong one, and a
 * batch with NO credential was sent anyway and reported the same 401.
 *
 * This pins the diagnostics that close that gap: the failure log carries status + endpoint host
 * + credential age without the token, and a credential-less batch is skipped with its own line.
 *
 * Run: pnpm exec vitest run tests/unit/otel-export-diagnostics.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportResultCode } from "@opentelemetry/core";

import {
  describeCredential,
  endpointHost,
  logExportProblem,
} from "../../src/tracing/export-diagnostics.ts";
import { Redactor } from "../../src/redaction.ts";
import {
  AGENTA_INGEST_ENDPOINT,
  TEST_EXPORT_ENDPOINT,
  runExportCapture,
} from "../utils/otel-export.ts";

const SKIPPED = "trace export skipped, no credential";
const INTERNAL_API_ORIGIN = ["http://agenta-api.internal", "8000"].join(":");

/** A JWT with the given claims and a junk signature — nothing here verifies signatures. */
function jwt(claims: Record<string, unknown>): string {
  const segment = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${segment({ alg: "HS256", typ: "JWT" })}.${segment(claims)}.c2lnbmF0dXJl`;
}

function secondsFromNow(offset: number): number {
  return Math.floor(Date.now() / 1000) + offset;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("endpointHost", () => {
  it("keeps the host and port, and drops the path a log has no business carrying", () => {
    expect(endpointHost("https://cloud.agenta.ai/api/otlp/v1/traces")).toBe(
      "cloud.agenta.ai",
    );
    expect(endpointHost(`${INTERNAL_API_ORIGIN}/otlp/v1/traces`)).toBe(
      "agenta-api.internal:8000",
    );
  });

  it("says so rather than throwing when the endpoint is not a url", () => {
    // The endpoint is caller-supplied, and this runs on a path that is already failing.
    expect(endpointHost("not a url")).toBe("unparseable");
    expect(endpointHost("")).toBe("unparseable");
  });
});

describe("describeCredential", () => {
  it("reports an expired credential as expired, without the token", () => {
    const token = jwt({
      exp: secondsFromNow(-3600),
      iat: secondsFromNow(-4500),
    });
    const age = describeCredential(`Secret ${token}`);

    expect(age.scheme).toBe("Secret");
    expect(age.expired).toBe(true);
    expect(age.expiresInSeconds).toBeLessThan(0);
    expect(age.ageSeconds).toBeGreaterThan(4000);
    expect(JSON.stringify(age)).not.toContain(token);
  });

  it("reports a live credential as not expired", () => {
    const age = describeCredential(
      `Secret ${jwt({ exp: secondsFromNow(600) })}`,
    );

    expect(age.expired).toBe(false);
    expect(age.expiresInSeconds).toBeGreaterThan(0);
  });

  it("reports a missing credential as scheme none", () => {
    expect(describeCredential(undefined)).toEqual({ scheme: "none" });
    expect(describeCredential("  ")).toEqual({ scheme: "none" });
  });

  it("reads the token from a schemed credential, not the scheme word", () => {
    // The token is the LAST whitespace-separated part, so a scheme never reaches the decoder
    // and a bare token still does.
    const token = jwt({ exp: secondsFromNow(-60) });

    expect(describeCredential(`Secret ${token}`).expired).toBe(true);
    expect(describeCredential(token).expired).toBe(true);
    expect(describeCredential(`  Secret   ${token}  `).expired).toBe(true);
  });

  it("keeps an opaque or unknown-scheme credential out of the log", () => {
    // An unrecognized scheme reports as "other" and an undecodable token yields no claims, so
    // no byte of a non-JWT credential can reach a log line.
    expect(describeCredential("Weird sk-live-abcdef")).toEqual({
      scheme: "other",
    });
    expect(describeCredential("sk-live-abcdef")).toEqual({ scheme: "other" });
    expect(describeCredential("ApiKey not.a.jwt")).toEqual({
      scheme: "ApiKey",
    });
  });
});

describe("otel export diagnostics", () => {
  it("names the status, endpoint and credential age when an export fails", async () => {
    const token = jwt({ exp: secondsFromNow(-1800) });
    const error = Object.assign(new Error("Unauthorized"), {
      name: "OTLPExporterError",
      code: 401,
      data: '{"message":"Unauthorized"}',
    });

    const { logs, exportCalled } = await runExportCapture({
      authorization: `Secret ${token}`,
      result: { code: ExportResultCode.FAILED, error },
    });

    expect(exportCalled).toBe(true);
    const failure = logs.find((line) => line.includes("trace export failed"));
    expect(failure).toBeDefined();
    expect(failure).toContain('"status":401');
    expect(failure).toContain('"endpoint":"127.0.0.1:1"');
    expect(failure).toContain('"expired":true');
    expect(failure).toContain('"scheme":"Secret"');
    expect(failure).toContain("Unauthorized");
    expect(failure).not.toContain(token);
  });

  it("skips a credential-less export to Agenta's own ingest", async () => {
    const { logs, exportCalled } = await runExportCapture({
      endpoint: AGENTA_INGEST_ENDPOINT,
      result: { code: ExportResultCode.SUCCESS },
    });

    expect(exportCalled).toBe(false);
    expect(logs.some((line) => line.includes(SKIPPED))).toBe(true);
  });

  it("skips a credential-less export to the configured Agenta host, not just the cloud one", async () => {
    vi.stubEnv("AGENTA_API_URL", INTERNAL_API_ORIGIN);

    const { logs, exportCalled } = await runExportCapture({
      endpoint: `${INTERNAL_API_ORIGIN}/otlp/v1/traces`,
      result: { code: ExportResultCode.SUCCESS },
    });

    expect(exportCalled).toBe(false);
    expect(logs.some((line) => line.includes(SKIPPED))).toBe(true);
  });
  it("exports to a credential-less collector on the Agenta host under another path", async () => {
    vi.stubEnv("AGENTA_API_URL", `${INTERNAL_API_ORIGIN}/api`);

    const { logs, exportCalled } = await runExportCapture({
      endpoint: `${INTERNAL_API_ORIGIN}/collector/v1/traces`,
      result: { code: ExportResultCode.SUCCESS },
    });

    expect(exportCalled).toBe(true);
    expect(logs).toEqual([]);
  });

  it("exports to Agenta ingest once the env credential is present", async () => {
    // The fallback credential is what keeps a run that carries none of its own exporting, which
    // is what otel-trace-target-attribution.test.ts leans on to keep its fallback guard alive.
    vi.stubEnv("AGENTA_CREDENTIALS", "Secret env-credential");

    const { logs, exportCalled } = await runExportCapture({
      endpoint: AGENTA_INGEST_ENDPOINT,
      result: { code: ExportResultCode.SUCCESS },
    });

    expect(exportCalled).toBe(true);
    expect(logs).toEqual([]);
  });

  it("still exports a credential-less batch to a third-party collector", async () => {
    // A caller can aim a run at its own OTel collector or Jaeger, which take unauthenticated
    // spans. Skipping there would drop every batch the collector was meant to receive.
    const { logs, exportCalled } = await runExportCapture({
      endpoint: TEST_EXPORT_ENDPOINT,
      result: { code: ExportResultCode.SUCCESS },
    });

    expect(exportCalled).toBe(true);
    expect(logs).toEqual([]);
  });
});

describe("logExportProblem", () => {
  function captureProblem(
    problem: Parameters<typeof logExportProblem>[0],
  ): string {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logExportProblem(problem);
    return errorSpy.mock.calls.map((args) => args.join(" ")).join("\n");
  }

  const base = {
    traceId: "t",
    endpoint: AGENTA_INGEST_ENDPOINT,
    authorization: "Secret x",
    spans: 1,
  };

  it("reports a thrown non-Error by its string form", () => {
    const line = captureProblem({
      ...base,
      outcome: "threw",
      error: "exporter blew up",
    });

    expect(line).toContain("trace export threw");
    expect(line).toContain("exporter blew up");
  });

  it("reports a thrown plain object rather than nothing at all", () => {
    const line = captureProblem({
      ...base,
      outcome: "threw",
      error: { errno: -111, syscall: "connect" },
    });

    expect(line).toContain("connect");
  });

  it("carries the stack of a thrown Error, which names the misconfigured exporter", () => {
    const line = captureProblem({
      ...base,
      outcome: "threw",
      error: new Error("bad exporter config"),
    });

    expect(line).toContain("bad exporter config");
    expect(line).toContain('"stack":"Error: bad exporter config');
  });

  it("names the retryable class, which the exporter reports without a status", () => {
    // 408/429/5xx exhaust their retries and surface with no code and no body, so a throttled
    // or quota-rejected export would otherwise show no status at all.
    const line = captureProblem({
      ...base,
      outcome: "failed",
      error: new Error("Export failed with retryable status"),
    });

    expect(line).toContain('"statusClass":"retryable (408/429/5xx)"');
  });

  it("redacts the response body before truncating it, so no secret survives the cut", () => {
    const secret = ["sk", "live", "0123456789abcdef"].join("-");
    const redactor = new Redactor().withKnownSecrets([secret]);
    // Straddle the 200-char cut: truncating first would leave the secret's prefix in the log.
    const body = `${"x".repeat(190)}${secret}${"y".repeat(50)}`;

    const line = captureProblem({
      ...base,
      outcome: "failed",
      error: Object.assign(new Error("Forbidden"), { code: 403, data: body }),
      redactors: [redactor],
    });

    expect(line).not.toContain(secret.slice(0, 10));
    expect(line).toContain('"status":403');
  });
});

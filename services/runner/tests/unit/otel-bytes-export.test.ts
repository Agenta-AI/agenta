import { afterEach, describe, expect, it, vi } from "vitest";

import { exportOtlpBytes } from "../../src/tracing/otlp-bytes-export.ts";

const AGENTA_ENDPOINT = "https://cloud.agenta.ai/api/otlp/v1/traces";
const THIRD_PARTY_ENDPOINT = "https://collector.example/v1/traces";
const TRACE_ID = "a".repeat(32);

function request(
  endpoint: string,
  authorization: () => string | undefined,
  body = new Uint8Array([1, 2, 3]),
) {
  return {
    body,
    target: { endpoint, authorization },
    diagnostics: { traceId: TRACE_ID, spanCount: 3 },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("raw OTLP byte export", () => {
  it("posts the exact protobuf view with the live credential and a 10 second timeout", async () => {
    let credential = "Secret stale";
    const fetchMock = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const timeoutSignal = new AbortController().signal;
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutSignal);
    const storage = new Uint8Array([9, 1, 2, 3, 8]);
    const body = storage.subarray(1, 4);
    const exportRequest = request(AGENTA_ENDPOINT, () => credential, body);

    credential = "Secret refreshed";
    await exportOtlpBytes(exportRequest);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(init).toBeDefined();
    expect(url).toBe(AGENTA_ENDPOINT);
    expect(init).toMatchObject({
      method: "POST",
      redirect: "manual",
      signal: timeoutSignal,
    });
    expect(new Headers(init!.headers).get("content-type")).toBe(
      "application/x-protobuf",
    );
    expect(new Headers(init!.headers).get("authorization")).toBe(
      "Secret refreshed",
    );
    expect(Buffer.from(init!.body as Buffer)).toEqual(Buffer.from([1, 2, 3]));
    expect(timeout).toHaveBeenCalledWith(10_000);
  });

  it("sends an unauthenticated batch to a third-party collector", async () => {
    const fetchMock = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await exportOtlpBytes(request(THIRD_PARTY_ENDPOINT, () => undefined));

    expect(fetchMock).toHaveBeenCalledOnce();
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.has("authorization")).toBe(false);
  });

  it("skips Agenta ingest without a credential and diagnoses the resolved value", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      exportOtlpBytes(request(AGENTA_ENDPOINT, () => "   ")),
    ).resolves.toMatchObject({ outcome: "skipped" });

    expect(fetchMock).not.toHaveBeenCalled();
    const line = log.mock.calls.flat().join(" ");
    expect(line).toContain("trace export skipped, no credential");
    expect(line).toContain('"scheme":"none"');
    expect(line).toContain('"spans":3');
  });

  it("reports a rejecting endpoint with existing export diagnostics and resolves", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"message":"denied"}', { status: 401 })),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      exportOtlpBytes(request(AGENTA_ENDPOINT, () => "ApiKey live-token")),
    ).resolves.toMatchObject({ outcome: "failed", status: 401 });

    const line = log.mock.calls.flat().join(" ");
    expect(line).toContain("trace export failed");
    expect(line).toContain('"status":401');
    expect(line).toContain('"endpoint":"cloud.agenta.ai"');
    expect(line).toContain('"scheme":"ApiKey"');
    expect(line).not.toContain("denied");
    expect(line).not.toContain("live-token");
  });

  it("keeps credential-provider and fetch throws best effort", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("connection refused");
    });
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      exportOtlpBytes(
        request(THIRD_PARTY_ENDPOINT, () => {
          throw new Error("credential store unavailable");
        }),
      ),
    ).resolves.toMatchObject({ outcome: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(
      exportOtlpBytes(request(THIRD_PARTY_ENDPOINT, () => "Bearer current")),
    ).resolves.toMatchObject({ outcome: "failed" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const lines = log.mock.calls.flat().join(" ");
    expect(lines).toContain("credential store unavailable");
    expect(lines).toContain("connection refused");
    expect(lines).not.toContain("current");
  });
});

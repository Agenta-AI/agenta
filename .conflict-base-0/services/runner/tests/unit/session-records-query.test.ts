/**
 * The read side of the record log (sessions/records-query.ts): it sits on the turn's critical
 * path, so it must be bounded — and, just as importantly, the bound must never collapse to
 * "abort now" under a bad env override, which would pin reconstruction to the inbound-history
 * fallback silently and permanently.
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

const seenInits: RequestInit[] = [];

vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
  seenInits.push(init ?? {});
  return new Response(JSON.stringify({ records: [] }), { status: 200 });
});

const { fetchSessionRecords } = await import("../../src/sessions/records-query.ts");
const { resetEnvWarnings } = await import("../../src/env.ts");

const TIMEOUT_ENV = "AGENTA_SESSIONS_RECORDS_QUERY_TIMEOUT_MS";

beforeEach(() => {
  seenInits.length = 0;
  vi.unstubAllEnvs();
  resetEnvWarnings();
});

describe("fetchSessionRecords", () => {
  it("bounds the request with a timeout signal", async () => {
    const rows = await fetchSessionRecords("sess-1", () => "ApiKey t");
    assert.deepEqual(rows, []);
    const signal = seenInits[0]?.signal;
    assert.ok(signal, "the fetch must carry an abort signal");
    assert.equal(signal.aborted, false);
  });

  it("a sub-millisecond override cannot turn the bound into an instant abort", async () => {
    vi.stubEnv(TIMEOUT_ENV, "0.5");
    const rows = await fetchSessionRecords("sess-2", () => "ApiKey t");
    // Truncating 0.5 to a 0 ms AbortSignal.timeout would abort before the response landed.
    assert.deepEqual(rows, [], "the query must still complete");
    assert.equal(seenInits[0]?.signal?.aborted, false);
  });

  it("an out-of-range override is clamped, not thrown on", async () => {
    // Past 2^32-1 AbortSignal.timeout throws ERR_OUT_OF_RANGE; between 2^31 and that it
    // silently overflows to a 1 ms delay. Either way the query would never really run.
    vi.stubEnv(TIMEOUT_ENV, "99999999999");
    const rows = await fetchSessionRecords("sess-3", () => "ApiKey t");
    assert.deepEqual(rows, []);
    assert.equal(seenInits.length, 1, "the request must have been issued");
    assert.equal(seenInits[0]?.signal?.aborted, false);
  });
});

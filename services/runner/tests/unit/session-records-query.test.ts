/**
 * The read side of the record log (sessions/records-query.ts): it sits on the turn's critical
 * path, so it must be bounded — and, just as importantly, the bound must never collapse to
 * "abort now" under a bad env override, which would pin reconstruction to the inbound-history
 * fallback silently and permanently.
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

// The hermetic setup stubs this module for the engine suites; this file tests the real one.
vi.unmock("../../src/sessions/records-query.ts");

const seenInits: RequestInit[] = [];
let responseBody: Record<string, unknown> = { records: [] };

vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
  seenInits.push(init ?? {});
  return new Response(JSON.stringify(responseBody), { status: 200 });
});

const { fetchSessionRecords } = await import("../../src/sessions/records-query.ts");
const { resetEnvWarnings } = await import("../../src/env.ts");

const TIMEOUT_ENV = "AGENTA_SESSIONS_RECORDS_QUERY_TIMEOUT_MS";

beforeEach(() => {
  seenInits.length = 0;
  responseBody = { records: [] };
  vi.unstubAllEnvs();
  resetEnvWarnings();
});

describe("fetchSessionRecords", () => {
  it("reads the records-incomplete flag next to the records", async () => {
    responseBody = { count: 0, records: [], records_incomplete: true };
    const flagged = await fetchSessionRecords("sess-4", () => "ApiKey t");
    assert.deepEqual(flagged, { records: [], recordsIncomplete: true });

    responseBody = { count: 0, records: [], records_incomplete: false };
    const clean = await fetchSessionRecords("sess-4", () => "ApiKey t");
    assert.equal(clean?.recordsIncomplete, false);
  });

  it("bounds the request with a timeout signal", async () => {
    const rows = await fetchSessionRecords("sess-1", () => "ApiKey t");
    assert.deepEqual(rows, { records: [], recordsIncomplete: false });
    const signal = seenInits[0]?.signal;
    assert.ok(signal, "the fetch must carry an abort signal");
    assert.equal(signal.aborted, false);
  });

  it("a sub-millisecond override cannot turn the bound into an instant abort", async () => {
    vi.stubEnv(TIMEOUT_ENV, "0.5");
    const rows = await fetchSessionRecords("sess-2", () => "ApiKey t");
    // Truncating 0.5 to a 0 ms AbortSignal.timeout would abort before the response landed.
    assert.deepEqual(
      rows,
      { records: [], recordsIncomplete: false },
      "the query must still complete",
    );
    assert.equal(seenInits[0]?.signal?.aborted, false);
  });

  it("an out-of-range override is clamped, not thrown on", async () => {
    // Past 2^32-1 AbortSignal.timeout throws ERR_OUT_OF_RANGE; between 2^31 and that it
    // silently overflows to a 1 ms delay. Either way the query would never really run.
    vi.stubEnv(TIMEOUT_ENV, "99999999999");
    const rows = await fetchSessionRecords("sess-3", () => "ApiKey t");
    assert.deepEqual(rows, { records: [], recordsIncomplete: false });
    assert.equal(seenInits.length, 1, "the request must have been issued");
    assert.equal(seenInits[0]?.signal?.aborted, false);
  });
});

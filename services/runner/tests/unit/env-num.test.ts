/**
 * The numeric-env reader (src/env.ts). Each case here is a way a hand-rolled
 * `Number(process.env.X ?? d)` read used to fail open — silently producing a value that
 * disables the protection the env var exists to tune.
 */
import { describe, it, beforeEach, assert, vi } from "vitest";

import {
  clampTimerMs,
  envInt,
  envTimerMs,
  resetEnvWarnings,
  TIMER_MAX_MS,
} from "../../src/env.ts";

const NAME = "AGENTA_TEST_ENV_NUM";

describe("envInt", () => {
  beforeEach(() => {
    resetEnvWarnings();
  });

  it("unset or blank falls back silently (the normal case)", () => {
    const warns: string[] = [];
    assert.equal(envInt(NAME, 500, { log: (m) => warns.push(m) }), 500);
    vi.stubEnv(NAME, "");
    assert.equal(envInt(NAME, 500, { log: (m) => warns.push(m) }), 500);
    vi.stubEnv(NAME, "   ");
    assert.equal(envInt(NAME, 500, { log: (m) => warns.push(m) }), 500);
    assert.deepEqual(warns, []);
  });

  it("a usable value wins", () => {
    vi.stubEnv(NAME, "250");
    assert.equal(envInt(NAME, 500), 250);
  });

  it("unparseable falls back and says so once", () => {
    const warns: string[] = [];
    vi.stubEnv(NAME, "30s");
    assert.equal(envInt(NAME, 500, { log: (m) => warns.push(m) }), 500);
    assert.equal(envInt(NAME, 500, { log: (m) => warns.push(m) }), 500);
    assert.equal(warns.length, 1, "a per-turn read must warn once, not every call");
    assert.match(warns[0], /unparseable value '30s'/);
  });

  // The CodeRabbit finding on #5501, at the root: 0.5 truncates to 0, and a 0 ms
  // AbortSignal.timeout aborts the request on the spot.
  it("a sub-unit value clamps to the minimum instead of truncating to zero", () => {
    vi.stubEnv(NAME, "0.5");
    assert.equal(envInt(NAME, 500, { min: 1 }), 1);
  });

  it("zero and negatives clamp to the minimum", () => {
    vi.stubEnv(NAME, "0");
    assert.equal(envInt(NAME, 500, { min: 1 }), 1);
    vi.stubEnv(NAME, "-7");
    assert.equal(envInt(NAME, 500, { min: 1 }), 1);
  });

  it("fractions above the minimum truncate", () => {
    vi.stubEnv(NAME, "42.9");
    assert.equal(envInt(NAME, 500), 42);
  });

  it("clamps down to an explicit maximum", () => {
    const warns: string[] = [];
    vi.stubEnv(NAME, "99");
    assert.equal(envInt(NAME, 6, { min: 1, max: 12, log: (m) => warns.push(m) }), 12);
    assert.match(warns[0], /above maximum 12/);
  });
});

describe("envTimerMs", () => {
  beforeEach(() => {
    resetEnvWarnings();
  });

  it("clamps to the 32-bit timer ceiling rather than overflowing to 1ms", () => {
    vi.stubEnv(NAME, String(TIMER_MAX_MS + 1));
    assert.equal(envTimerMs(NAME, 5_000), TIMER_MAX_MS);
    // Past 2^32-1 AbortSignal.timeout throws outright; the clamp keeps it constructible.
    vi.stubEnv(NAME, "1e12");
    resetEnvWarnings();
    const ms = envTimerMs(NAME, 5_000);
    assert.equal(ms, TIMER_MAX_MS);
    assert.doesNotThrow(() => AbortSignal.timeout(ms));
  });

  it("keeps a caller's own maximum when it is tighter than the timer ceiling", () => {
    vi.stubEnv(NAME, "60000");
    assert.equal(envTimerMs(NAME, 5_000, { max: 10_000 }), 10_000);
  });

  it("never yields a delay that aborts immediately", () => {
    for (const raw of ["0", "0.9", "-1", "abc", ""]) {
      vi.stubEnv(NAME, raw);
      resetEnvWarnings();
      assert.isAtLeast(envTimerMs(NAME, 5_000), 1, `raw=${raw}`);
    }
  });
});

describe("clampTimerMs", () => {
  // Guards delays the code DERIVES: arithmetic on two in-domain values can still leave the
  // domain, and the result is armed just like a value read straight from env.
  it("keeps a derived fraction off zero", () => {
    assert.equal(clampTimerMs(Math.floor(1 / 2)), 1);
    assert.equal(clampTimerMs(0.5), 1);
    assert.equal(clampTimerMs(-100), 1);
  });

  it("passes usable delays through, truncated", () => {
    assert.equal(clampTimerMs(30_000), 30_000);
    assert.equal(clampTimerMs(1_500.75), 1_500);
  });

  it("caps at the timer ceiling; ±Infinity lands on the matching end, NaN on the floor", () => {
    assert.equal(clampTimerMs(Number.MAX_SAFE_INTEGER), TIMER_MAX_MS);
    assert.equal(clampTimerMs(Number.POSITIVE_INFINITY), TIMER_MAX_MS);
    assert.equal(clampTimerMs(Number.NEGATIVE_INFINITY), 1);
    assert.equal(clampTimerMs(NaN), 1);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createStreamTrace,
  STREAM_TRACE_ENV,
} from "../../src/tracing/stream-trace.ts";

/**
 * The inter-arrival trace answers one question — how far apart do deltas actually arrive — so
 * the parts that matter are that it stays silent by default and that the FIRST delta of a block
 * is not reported as a gap (it is time-to-first-token, a different measurement).
 */

const withFlag = (value: string | undefined) => {
  if (value === undefined) delete process.env[STREAM_TRACE_ENV];
  else process.env[STREAM_TRACE_ENV] = value;
};

// The flag is a real environment variable, so an operator running the suite with it already set
// would otherwise flip the off-by-default assertion. Clear it going in, restore it going out.
const inherited = process.env[STREAM_TRACE_ENV];

beforeEach(() => withFlag(undefined));

afterEach(() => withFlag(inherited));

describe("createStreamTrace", () => {
  it("is off unless the flag is set", () => {
    expect(createStreamTrace({})).toBeNull();
    withFlag("");
    expect(createStreamTrace({})).toBeNull();
    withFlag("false");
    expect(createStreamTrace({})).toBeNull();
  });

  it("turns on for any value that is not an explicit off word", () => {
    for (const value of ["1", "true", "yes", "on", "please"]) {
      withFlag(value);
      expect(createStreamTrace({})).not.toBeNull();
    }
  });

  it("reports gaps between deltas, and none for the first of a kind", () => {
    withFlag("1");
    const lines: string[] = [];
    let clock = 0;
    const trace = createStreamTrace({
      harness: "pi",
      write: (line) => lines.push(line.trim()),
      now: () => clock,
    });

    trace?.record("thought", 8);
    clock = 400;
    trace?.record("thought", 7);

    expect(lines[0]).toBe(
      "[stream-trace] harness=pi kind=thought gap_ms=- chars=8",
    );
    expect(lines[1]).toBe(
      "[stream-trace] harness=pi kind=thought gap_ms=400 chars=7",
    );
  });

  /**
   * A tool call closes the open block and can run for minutes. Counting that as a token gap
   * would report a multi-minute cadence for a stream that never slowed down.
   */
  it("does not carry a gap across a closed block", () => {
    withFlag("1");
    const lines: string[] = [];
    let clock = 0;
    const trace = createStreamTrace({
      write: (line) => lines.push(line.trim()),
      now: () => clock,
    });

    trace?.record("message", 5);
    clock = 60_000; // a tool ran here
    trace?.closeBlock("message");
    trace?.record("message", 5);

    expect(lines[1]).toContain("gap_ms=-");
  });

  it("keeps message and thought cadence separate", () => {
    withFlag("1");
    const lines: string[] = [];
    let clock = 0;
    const trace = createStreamTrace({
      write: (line) => lines.push(line.trim()),
      now: () => clock,
    });

    trace?.record("message", 3);
    clock = 100;
    trace?.record("thought", 3);
    clock = 250;
    trace?.record("message", 3);

    // The second `message` is measured against the first, not against the interleaved thought.
    expect(lines[2]).toContain("kind=message gap_ms=250");
  });
});

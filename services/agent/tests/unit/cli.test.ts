/**
 * Unit tests for the stdin/stdout CLI transport via the `runCli(raw, stream, io)` seam.
 *
 * Injects a FAKE engine and a collecting `write`, so no stdin/stdout/process.exit mocking is
 * needed. Covers the one-shot happy path, invalid JSON, a failing result, and the streaming
 * order (event lines then exactly one terminal result line). No harness, no process exit.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/cli.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { runCli, type RunAgent } from "../../src/cli.ts";

const okRun: RunAgent = async () => ({ ok: true, output: "hi" });

function collector() {
  const chunks: string[] = [];
  return { chunks, write: (s: string) => chunks.push(s), text: () => chunks.join("") };
}

describe("runCli", () => {
  it("one-shot: writes the result JSON and returns exit 0", async () => {
    const out = collector();
    const code = await runCli(JSON.stringify({ backend: "pi" }), false, { run: okRun, write: out.write });
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(out.text()), { ok: true, output: "hi" });
  });

  it("invalid JSON: returns exit 1 with an error result", async () => {
    const out = collector();
    const code = await runCli("{not json", false, { run: okRun, write: out.write });
    assert.equal(code, 1);
    const res = JSON.parse(out.text()) as { ok: boolean; error: string };
    assert.equal(res.ok, false);
    assert.match(res.error, /Invalid JSON on stdin/);
  });

  it("a failing result returns exit 1", async () => {
    const out = collector();
    const code = await runCli("{}", false, {
      run: async () => ({ ok: false, error: "boom" }),
      write: out.write,
    });
    assert.equal(code, 1);
    assert.equal((JSON.parse(out.text()) as { error: string }).error, "boom");
  });

  it("stream: event lines then exactly one terminal result line", async () => {
    const out = collector();
    const streamRun: RunAgent = async (_req, emit) => {
      emit?.({ type: "message", text: "a" });
      emit?.({ type: "message", text: "b" });
      return { ok: true, output: "ab", events: [{ type: "message", text: "a" }] };
    };
    const code = await runCli("{}", true, { run: streamRun, write: out.write });
    assert.equal(code, 0);
    const records = out
      .text()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { kind: string; result?: { events: unknown[] } });
    assert.deepEqual(records.map((r) => r.kind), ["event", "event", "result"]);
    assert.deepEqual(records[2].result!.events, [], "terminal result does not echo events");
  });
});

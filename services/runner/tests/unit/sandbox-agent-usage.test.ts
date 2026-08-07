/**
 * Unit tests for sandbox-agent usage collection helpers.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-usage.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  mergePromptAndStreamUsage,
  readRunUsage,
  resolveRunUsage,
} from "../../src/engines/sandbox_agent/usage.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readRunUsage", () => {
  it("reads local Pi usage writeback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenta-usage-test-"));
    dirs.push(dir);
    const file = join(dir, "usage.json");
    writeFileSync(file, JSON.stringify({ input: 2, output: 3, total: 5, cost: 0.01 }), "utf-8");

    assert.deepEqual(await readRunUsage({}, file, false), { input: 2, output: 3, total: 5, cost: 0.01 });
  });

  it("reads Daytona Pi usage writeback through the sandbox fs API", async () => {
    const sandbox = {
      readFsFile: async () => JSON.stringify({ input: 1, output: 4, total: 5, cost: 0 }),
    };

    assert.deepEqual(await readRunUsage(sandbox, "/tmp/usage.json", true), {
      input: 1,
      output: 4,
      total: 5,
      cost: 0,
    });
  });
});

describe("mergePromptAndStreamUsage", () => {
  it("combines prompt token split with stream cost", () => {
    assert.deepEqual(
      mergePromptAndStreamUsage(
        { usage: { inputTokens: 7, outputTokens: 11 } },
        { input: 0, output: 0, total: 0, cost: 0.02 },
      ),
      { input: 7, output: 11, total: 18, cost: 0.02 },
    );
  });

  it("returns undefined when no usage was reported", () => {
    assert.equal(mergePromptAndStreamUsage({}, undefined), undefined);
  });

  it("reports no usage when only the ACP context size is known", () => {
    // `usage_update.used` is context-window occupancy, not tokens spent: with no harness
    // split there is nothing honest to report, so the caller writes no usage attributes.
    assert.equal(
      mergePromptAndStreamUsage({ stopReason: "end_turn" }, { input: 0, output: 0, total: 63369 }),
      undefined,
    );
  });

  it("keeps a stream cost even when the harness reported no token split", () => {
    assert.deepEqual(
      mergePromptAndStreamUsage({}, { input: 0, output: 0, total: 63369, cost: 0.04 }),
      { input: 0, output: 0, total: 0, cost: 0.04 },
    );
  });

  it("uses the harness split unchanged, never the stream total", () => {
    assert.deepEqual(
      mergePromptAndStreamUsage(
        { usage: { inputTokens: 12, outputTokens: 3 } },
        { input: 0, output: 0, total: 63369 },
      ),
      { input: 12, output: 3, total: 15 },
    );
  });

  it("keeps a half-reported split (output only) as the total", () => {
    assert.deepEqual(
      mergePromptAndStreamUsage({ usage: { outputTokens: 5 } }, undefined),
      { input: 0, output: 5, total: 5 },
    );
  });

  it("omits cost entirely when the harness reported none", () => {
    // A substituted `0` would say the run was measured and free. Consumers (the SDK's
    // `record_usage`, the Vercel projection) read the key's PRESENCE as the measurement, so
    // an unpriced harness — codex among them — has to leave it off.
    const merged = mergePromptAndStreamUsage(
      { usage: { inputTokens: 12, outputTokens: 3 } },
      undefined,
    );
    assert.deepEqual(merged, { input: 12, output: 3, total: 15 });
    assert.equal("cost" in merged!, false);
  });

  it("keeps a reported zero cost, which is a measurement", () => {
    // A free model or a fully cached turn really does cost 0. Now that absence is expressible,
    // a reported zero must survive as the number it is.
    const merged = mergePromptAndStreamUsage(
      { usage: { inputTokens: 12, outputTokens: 3 } },
      { input: 0, output: 0, total: 0, cost: 0 },
    );
    assert.deepEqual(merged, { input: 12, output: 3, total: 15, cost: 0 });
  });

  it("keeps a reported zero cost even with no token split at all", () => {
    assert.deepEqual(
      mergePromptAndStreamUsage({}, { input: 0, output: 0, total: 0, cost: 0 }),
      { input: 0, output: 0, total: 0, cost: 0 },
    );
  });

  it("falls back to already-known stream tokens, which only a prior setUsage can set", () => {
    assert.deepEqual(
      mergePromptAndStreamUsage({}, { input: 8, output: 2, total: 10, cost: 0.01 }),
      { input: 8, output: 2, total: 10, cost: 0.01 },
    );
  });
});

describe("resolveRunUsage", () => {
  it("prefers Pi usage writeback over prompt/stream fallback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenta-usage-test-"));
    dirs.push(dir);
    const file = join(dir, "usage.json");
    writeFileSync(file, JSON.stringify({ input: 3, output: 4, total: 7, cost: 0.03 }), "utf-8");

    assert.deepEqual(
      await resolveRunUsage({
        sandbox: {},
        usageOutPath: file,
        isDaytona: false,
        promptResult: { usage: { inputTokens: 99, outputTokens: 99 } },
        streamUsage: { input: 0, output: 0, total: 0, cost: 1 },
      }),
      { input: 3, output: 4, total: 7, cost: 0.03 },
    );
  });

  it("resolves to no usage when neither the writeback nor the harness reported a split", async () => {
    assert.equal(
      await resolveRunUsage({
        sandbox: {},
        usageOutPath: undefined,
        isDaytona: false,
        promptResult: { stopReason: "end_turn" },
        streamUsage: { input: 0, output: 0, total: 63369 },
      }),
      undefined,
    );
  });
});

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
});

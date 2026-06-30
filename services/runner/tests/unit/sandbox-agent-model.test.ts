/**
 * Unit tests for sandbox-agent model selection helpers.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-model.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  allowedFromError,
  applyModel,
  pickModel,
} from "../../src/engines/sandbox_agent/model.ts";

describe("pickModel", () => {
  it("matches exact ids first", () => {
    assert.equal(pickModel(["openai-codex/gpt-5.5", "anthropic/sonnet"], "anthropic/sonnet"), "anthropic/sonnet");
  });

  it("matches by provider suffix", () => {
    assert.equal(pickModel(["openai-codex/gpt-5.5"], "gpt-5.5"), "openai-codex/gpt-5.5");
    assert.equal(pickModel(["openai-codex/gpt-5.5"], "other/gpt-5.5"), "openai-codex/gpt-5.5");
  });

  it("returns undefined when no model matches", () => {
    assert.equal(pickModel(["anthropic/sonnet"], "gpt-5.5"), undefined);
  });
});

describe("allowedFromError", () => {
  it("parses allowed values from harness errors", () => {
    assert.deepEqual(
      allowedFromError(new Error("Unsupported value. Allowed values: openai-codex/gpt-5.5, anthropic/sonnet")),
      ["openai-codex/gpt-5.5", "anthropic/sonnet"],
    );
  });
});

describe("applyModel", () => {
  it("uses the requested model when the harness accepts it", async () => {
    const calls: string[] = [];
    const session = { setModel: async (id: string) => void calls.push(id) };

    assert.equal(await applyModel(session, "anthropic/sonnet"), "anthropic/sonnet");
    assert.deepEqual(calls, ["anthropic/sonnet"]);
  });

  it("retries with an allowed suffix match from the harness error", async () => {
    const calls: string[] = [];
    const session = {
      setModel: async (id: string) => {
        calls.push(id);
        if (id === "gpt-5.5") {
          throw new Error("Unsupported value. Allowed values: openai-codex/gpt-5.5");
        }
      },
    };

    assert.equal(await applyModel(session, "gpt-5.5"), "openai-codex/gpt-5.5");
    assert.deepEqual(calls, ["gpt-5.5", "openai-codex/gpt-5.5"]);
  });

  it("falls back to harness default when no match exists", async () => {
    const logs: string[] = [];
    const session = {
      setModel: async () => {
        throw new Error("Unsupported value. Allowed values: anthropic/sonnet");
      },
    };

    assert.equal(await applyModel(session, "gpt-5.5", (m) => logs.push(m)), undefined);
    assert.match(logs[0], /using harness default/);
  });
});

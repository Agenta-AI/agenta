/**
 * Unit tests for sandbox-agent model selection helpers.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-model.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  allowedFromError,
  allowedModels,
  applyModel,
  ModelNotSettableError,
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

describe("allowedModels", () => {
  it("reads the pi-acp choice `value` (not `id`), so the allowed set is not silently empty", async () => {
    // pi-acp builds each choice as `{ value: model.modelId, ... }`; reading `id` returned [].
    const session = {
      getConfigOptions: async () => [
        {
          id: "model",
          category: "model",
          options: [
            { value: "openai-codex/gpt-5.5", name: "GPT-5.5" },
            { value: "anthropic/sonnet", name: "Sonnet" },
          ],
        },
      ],
    };
    assert.deepEqual(await allowedModels(session), ["openai-codex/gpt-5.5", "anthropic/sonnet"]);
  });
});

describe("applyModel", () => {
  it("uses the requested model when the harness accepts it", async () => {
    const calls: string[] = [];
    const session = { setModel: async (id: string) => void calls.push(id) };

    assert.equal(await applyModel(session, "anthropic/sonnet"), "anthropic/sonnet");
    assert.deepEqual(calls, ["anthropic/sonnet"]);
  });

  it("keeps the harness default when no model is requested (default strict)", async () => {
    let called = false;
    const session = { setModel: async () => void (called = true) };

    assert.equal(await applyModel(session, undefined), undefined);
    assert.equal(called, false);
  });

  it("selects a Pi model by resolving a bare id to the harness's own id (strict default)", async () => {
    // Pi exposes "openai-codex/gpt-5.5"; a caller passes a bare "gpt-5.5". Strict-by-default must
    // still resolve via the suffix match, not fail — this is the Pi selection pass-through.
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

  it("fails loudly (strict default) when the requested model cannot be resolved", async () => {
    const session = {
      setModel: async () => {
        throw new Error("Unsupported value. Allowed values: anthropic/sonnet");
      },
    };

    await assert.rejects(
      () => applyModel(session, "gpt-bogus-xyz"),
      (err: unknown) => {
        assert.ok(err instanceof ModelNotSettableError);
        // The message names the requested id and the valid options source.
        assert.match(err.message, /gpt-bogus-xyz/);
        assert.match(err.message, /Valid models for this harness/);
        assert.match(err.message, /anthropic\/sonnet/);
        assert.equal(err.requested, "gpt-bogus-xyz");
        assert.deepEqual(err.allowed, ["anthropic/sonnet"]);
        return true;
      },
    );
  });

  it("falls back to the harness default only under the explicit opt-out (strict: false)", async () => {
    const logs: string[] = [];
    const session = {
      setModel: async () => {
        throw new Error("Unsupported value. Allowed values: anthropic/sonnet");
      },
    };

    assert.equal(
      await applyModel(session, "gpt-5.5", (m) => logs.push(m), { strict: false }),
      undefined,
    );
    assert.match(logs[0], /using harness default/);
  });
});

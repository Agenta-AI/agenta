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
import {
  CODEX_CONFIG_PATH,
  codexConfigPinnedModel,
} from "../../src/engines/sandbox_agent/codex-assets.ts";
import { runSandboxAgent } from "../../src/engines/sandbox_agent.ts";
import { fakeHarness } from "../utils/sandbox-agent-harness.ts";

describe("pickModel", () => {
  it("matches exact ids first", () => {
    assert.equal(
      pickModel(
        ["openai-codex/gpt-5.5", "anthropic/sonnet"],
        "anthropic/sonnet",
      ),
      "anthropic/sonnet",
    );
  });

  it("matches by provider suffix", () => {
    assert.equal(
      pickModel(["openai-codex/gpt-5.5"], "gpt-5.5"),
      "openai-codex/gpt-5.5",
    );
    assert.equal(
      pickModel(["openai-codex/gpt-5.5"], "other/gpt-5.5"),
      "openai-codex/gpt-5.5",
    );
  });

  it("returns undefined when no model matches", () => {
    assert.equal(pickModel(["anthropic/sonnet"], "gpt-5.5"), undefined);
  });

  it("matches a bare Claude alias to its harness-reported [1m] variant", () => {
    // The Claude harness's live alias set is not symmetric: "opus"/"haiku" are offered bare
    // alongside "opus[1m]"/"haiku[1m]", but the current Sonnet generation ships in only its
    // 1M-context variant, so the harness reports "sonnet[1m]" with no bare "sonnet" sibling.
    const allowed = ["default", "sonnet[1m]", "opus", "opus[1m]", "haiku"];
    assert.equal(pickModel(allowed, "sonnet"), "sonnet[1m]");
    // Aliases the harness already exposes bare still match exactly, unaffected by the new tier.
    assert.equal(pickModel(allowed, "opus"), "opus");
    assert.equal(pickModel(allowed, "haiku"), "haiku");
  });

  it("does not fall back from a hinted request to a bare id (never shrinks context)", () => {
    // Only "sonnet" is offered (no "[1m]" sibling): a caller that explicitly asked for the
    // long-context variant must not be silently downgraded to the short-context one.
    assert.equal(
      pickModel(["default", "sonnet", "opus"], "sonnet[1m]"),
      undefined,
    );
  });

  it("maps a custom connection's bare model id to Pi's advertised <slug>/<model-id>", () => {
    // After models.json, pi-acp advertises the custom provider as `<connection-slug>/<model-id>`.
    // The wire carries the bare model id; the existing suffix match resolves it (design Decision 7).
    assert.equal(
      pickModel(["my-ollama/qwen2.5-coder:7b"], "qwen2.5-coder:7b"),
      "my-ollama/qwen2.5-coder:7b",
    );
    // A model id that the custom provider does not advertise does not resolve, so the run fails
    // loud (ModelNotSettableError) instead of continuing on a default.
    assert.equal(
      pickModel(["my-ollama/qwen2.5-coder:7b"], "llama3:70b"),
      undefined,
    );
  });

  it("bare-suffix matching is order-dependent and can pick a built-in over the custom provider", () => {
    // Collision (design Decision 7 hazard): the vault key rides into Pi as OPENAI_API_KEY, so Pi
    // keeps advertising its built-in `openai/<model>` (pointing at api.openai.com) ALONGSIDE the
    // custom `my-conn/<model>`. When the custom model id equals a built-in one (e.g. "gpt-4o"),
    // bare-suffix matching returns the FIRST advertised id with that suffix — the built-in — which
    // would silently route to the wrong provider/endpoint. This proves why the runner must request
    // the fully qualified id (below) instead of the bare wire id for a managed custom run.
    assert.equal(
      pickModel(["openai/gpt-4o", "my-conn/gpt-4o"], "gpt-4o"),
      "openai/gpt-4o",
    );
    // The fully qualified `<slug>/<model>` is an EXACT match, so it wins regardless of order and
    // regardless of a colliding built-in — this is the id the runner now passes when a
    // PiModelConfigPlan exists.
    assert.equal(
      pickModel(["openai/gpt-4o", "my-conn/gpt-4o"], "my-conn/gpt-4o"),
      "my-conn/gpt-4o",
    );
  });
});

describe("allowedFromError", () => {
  it("parses allowed values from harness errors", () => {
    assert.deepEqual(
      allowedFromError(
        new Error(
          "Unsupported value. Allowed values: openai-codex/gpt-5.5, anthropic/sonnet",
        ),
      ),
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
    assert.deepEqual(await allowedModels(session), [
      "openai-codex/gpt-5.5",
      "anthropic/sonnet",
    ]);
  });
});

describe("applyModel", () => {
  it("uses the requested model when the harness accepts it", async () => {
    const calls: string[] = [];
    const session = { setModel: async (id: string) => void calls.push(id) };

    assert.equal(
      await applyModel(session, "anthropic/sonnet"),
      "anthropic/sonnet",
    );
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
          throw new Error(
            "Unsupported value. Allowed values: openai-codex/gpt-5.5",
          );
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
      await applyModel(session, "gpt-5.5", (m) => logs.push(m), {
        strict: false,
      }),
      undefined,
    );
    assert.match(logs[0], /using harness default/);
  });
});

describe("codexConfigPinnedModel", () => {
  // OR31d. A Codex run whose config DECLARES the model has already selected it, so the model
  // change the runner would ask for is both redundant and the only thing that can still fail
  // against the baked catalogue. The runner reads the rendered file rather than re-deriving
  // the condition, so it cannot believe a model was pinned on a run where it was not.
  const gatewayConfig = [
    {
      path: CODEX_CONFIG_PATH,
      content:
        'model_provider = "agenta-openai"\n' +
        'model = "acme/openai/echo"\n' +
        "\n[model_providers.agenta-openai]\n" +
        'name = "Agenta"\n',
    },
  ];

  it("reads the declared model id", () => {
    assert.equal(codexConfigPinnedModel(gatewayConfig), "acme/openai/echo");
  });

  it("does not mistake model_provider for the model", () => {
    assert.equal(
      codexConfigPinnedModel([
        {
          path: CODEX_CONFIG_PATH,
          content:
            'model_provider = "agenta-openai"\napproval_policy = "never"\n',
        },
      ]),
      undefined,
    );
  });

  it("ignores a model key nested inside the provider table", () => {
    assert.equal(
      codexConfigPinnedModel([
        {
          path: CODEX_CONFIG_PATH,
          content:
            'model_provider = "agenta-openai"\n\n[model_providers.agenta-openai]\n' +
            '  model = "indented, not top level"\n',
        },
      ]),
      undefined,
    );
  });

  it("says nothing for a run with no harness files, or none of Codex's", () => {
    assert.equal(codexConfigPinnedModel(undefined), undefined);
    assert.equal(codexConfigPinnedModel([]), undefined);
    assert.equal(
      codexConfigPinnedModel([
        { path: ".claude/settings.json", content: '{"model": "sonnet"}' },
      ]),
      undefined,
    );
  });

  it("treats an empty declaration as no declaration", () => {
    assert.equal(
      codexConfigPinnedModel([
        { path: CODEX_CONFIG_PATH, content: 'model = ""\n' },
      ]),
      undefined,
    );
  });
});

describe("a Codex run whose config declares the model", () => {
  const pinnedConfig = [
    {
      path: CODEX_CONFIG_PATH,
      content:
        'model_provider = "agenta-openai"\nmodel = "acme/openai/echo"\n' +
        '\n[model_providers.agenta-openai]\nname = "Agenta"\n',
    },
  ];

  it("does not ask the session to change model, and labels the span with the pin", async () => {
    const { calls, deps, logs } = fakeHarness();

    const result = await runSandboxAgent(
      {
        harness: "codex",
        messages: [{ role: "user", content: "hello" }],
        model: "acme/openai/echo",
        harnessFiles: pinnedConfig,
      },
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    // The change is what the catalogue check refuses; the declaration already selected it.
    assert.deepEqual(calls.applyModelArgs, []);
    assert.equal(result.model, "acme/openai/echo");
    assert.ok(
      logs.some((line) => line.includes("model pinned by config")),
      logs.join("\n"),
    );
  });

  it("still applies the model when the config declares none", async () => {
    const { calls, deps } = fakeHarness();

    const result = await runSandboxAgent(
      {
        harness: "codex",
        messages: [{ role: "user", content: "hello" }],
        model: "gpt-5.5",
      },
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    assert.deepEqual(
      calls.applyModelArgs.map((call) => call.model),
      ["gpt-5.5"],
    );
  });
});

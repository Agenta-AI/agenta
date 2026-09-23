/**
 * Unit tests for sandbox-agent model selection helpers.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-model.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  allowedFromError,
  allowedModels,
  applyModel,
  CLAUDE_TIER_ALIASES,
  harnessModelId,
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

  it("resolves claude-fable-5-1 against both option sets the pinned Claude build reports", () => {
    // Captured from @anthropic-ai/claude-agent-sdk 0.3.280 supportedModels(): an API-key session
    // offers the bare id, a subscription session only the [1m] variant.
    const apiKey = ["default", "opus[1m]", "claude-fable-5-1", "sonnet", "haiku"];
    const subscription = ["default", "opus[1m]", "claude-fable-5-1[1m]", "sonnet", "haiku"];
    assert.equal(pickModel(apiKey, "claude-fable-5-1"), "claude-fable-5-1");
    assert.equal(pickModel(subscription, "claude-fable-5-1"), "claude-fable-5-1[1m]");
  });

  it("upgrades a saved claude-fable-5 to Fable 5.1, which the pinned build offers instead", () => {
    const apiKey = ["default", "opus[1m]", "claude-fable-5-1", "sonnet", "haiku"];
    const subscription = ["default", "opus[1m]", "claude-fable-5-1[1m]", "sonnet", "haiku"];
    for (const saved of ["claude-fable-5", "anthropic/claude-fable-5", "claude-fable-5[1m]"]) {
      assert.equal(pickModel(apiKey, saved), "claude-fable-5-1", saved);
      assert.equal(pickModel(subscription, saved), "claude-fable-5-1[1m]", saved);
    }
    // A build that still offers Fable 5 keeps it: the upgrade applies only once nothing matched.
    assert.equal(pickModel(["claude-fable-5", "claude-fable-5-1"], "claude-fable-5"), "claude-fable-5");
    // No successor on offer: still no match, so the strict path fails loud.
    assert.equal(pickModel(["default", "sonnet"], "claude-fable-5"), undefined);
  });

  it("runs a concrete Claude id on its tier alias when the build does not offer the id", () => {
    // Captured from the pinned build on staging: an API-key session offers `opus[1m]` but not
    // `claude-opus-5-5`, so a saved concrete id failed with ModelNotSettableError.
    const apiKey = ["default", "opus[1m]", "claude-fable-5-1", "sonnet", "haiku"];
    const subscription = ["default", "opus[1m]", "claude-fable-5-1[1m]", "sonnet", "haiku"];
    const cases: Array<[string, string]> = [
      ["claude-opus-5-5", "opus[1m]"],
      ["anthropic/claude-opus-5-5", "opus[1m]"],
      ["claude-opus-5-5[1m]", "opus[1m]"],
      ["anthropic/claude-opus-5-5[1m]", "opus[1m]"],
      ["claude-sonnet-5", "sonnet"],
      ["anthropic/claude-sonnet-5", "sonnet"],
      ["claude-sonnet-5[1m]", "sonnet"],
      ["claude-haiku-4-5", "haiku"],
      ["anthropic/claude-haiku-4-5", "haiku"],
      ["claude-haiku-4-5[1m]", "haiku"],
    ];
    for (const [saved, alias] of cases) {
      assert.equal(pickModel(apiKey, saved), alias, `api key: ${saved}`);
      assert.equal(pickModel(subscription, saved), alias, `subscription: ${saved}`);
    }
  });

  it("prefers the requested context variant, then the bare alias, within a tier", () => {
    const both = ["default", "opus", "opus[1m]", "sonnet"];
    assert.equal(pickModel(both, "claude-opus-5-5"), "opus");
    assert.equal(pickModel(both, "claude-opus-5-5[1m]"), "opus[1m]");
    assert.equal(pickModel(["default", "opus", "sonnet"], "anthropic/claude-opus-5-5"), "opus");
  });

  it("keeps an exact offered id over its tier alias", () => {
    const offered = ["default", "opus[1m]", "claude-opus-5-5", "sonnet", "haiku"];
    assert.equal(pickModel(offered, "claude-opus-5-5"), "claude-opus-5-5");
    assert.equal(pickModel(offered, "anthropic/claude-opus-5-5"), "claude-opus-5-5");
    assert.equal(
      pickModel(["default", "claude-opus-5-5[1m]", "opus[1m]"], "claude-opus-5-5"),
      "claude-opus-5-5[1m]",
    );
  });

  it("finds no tier alias when the build offers nothing in that tier", () => {
    assert.equal(pickModel(["default", "sonnet", "haiku"], "claude-opus-5-5"), undefined);
    // Pi's provider-prefixed ids are never a tier alias.
    assert.equal(pickModel(["anthropic/opus", "anthropic/claude-opus-5"], "claude-opus-5-5"), undefined);
  });

  it("mirrors the tier entries of the SDK's MODEL_ID_ALIASES", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../../../../sdks/python/agenta/sdk/agents/capabilities.py"),
      "utf8",
    );
    const block = /^MODEL_ID_ALIASES[^{]*\{([^}]*)\}/m.exec(source)?.[1];
    assert.ok(block, "MODEL_ID_ALIASES not found in capabilities.py");
    const sdkTiers: Record<string, string> = {};
    for (const [, prefix, alias] of block.matchAll(/"anthropic\/([^"]+)":\s*"([^"]+)"/g)) {
      // Tier entries are open prefixes (`claude-opus-`); the rest name one retired model.
      if (prefix.endsWith("-")) sdkTiers[prefix] = alias.replace(/\[[^[\]]*\]$/, "");
    }
    assert.deepEqual(sdkTiers, CLAUDE_TIER_ALIASES);
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

  it("runs a saved claude-fable-5 config on Fable 5.1 instead of failing (strict default)", async () => {
    const calls: string[] = [];
    const session = {
      setModel: async (id: string) => {
        calls.push(id);
        if (id !== "claude-fable-5-1[1m]") {
          throw new Error(
            "Unsupported value. Allowed values: default, opus[1m], claude-fable-5-1[1m], sonnet, haiku",
          );
        }
      },
    };

    const logs: string[] = [];
    assert.equal(
      await applyModel(session, "claude-fable-5", (m) => logs.push(m)),
      "claude-fable-5-1[1m]",
    );
    assert.deepEqual(calls, ["claude-fable-5", "claude-fable-5-1[1m]"]);
    assert.deepEqual(logs, [
      "model 'claude-fable-5' is retired by this harness; upgraded to 'claude-fable-5-1[1m]'",
    ]);
  });

  it("runs a saved claude-opus-5-5 on the API-key build's opus[1m] and logs it", async () => {
    const calls: string[] = [];
    const session = {
      setModel: async (id: string) => {
        calls.push(id);
        if (id !== "opus[1m]") {
          throw new Error(
            "Unsupported value. Allowed values: default, opus[1m], claude-fable-5-1, sonnet, haiku",
          );
        }
      },
    };

    const logs: string[] = [];
    assert.equal(
      await applyModel(session, "anthropic/claude-opus-5-5", (m) => logs.push(m)),
      "opus[1m]",
    );
    assert.deepEqual(calls, ["anthropic/claude-opus-5-5", "opus[1m]"]);
    assert.deepEqual(logs, [
      "model 'anthropic/claude-opus-5-5' is not offered by this harness; running its tier alias 'opus[1m]'",
    ]);
  });

  it("strips anthropic/ for Claude before the first setModel, even when setModel accepts anything", async () => {
    // Some Claude builds (local sandbox, subscription) take any string in setModel, so the
    // prefixed id used to reach the Anthropic API verbatim and fail there.
    for (const [requested, expected] of [
      ["anthropic/claude-opus-5-5", "claude-opus-5-5"],
      ["anthropic/claude-opus-5-5[1m]", "claude-opus-5-5[1m]"],
      ["anthropic/opus[1m]", "opus[1m]"],
      ["claude-opus-5-5", "claude-opus-5-5"],
    ]) {
      const calls: string[] = [];
      const permissive = { setModel: async (id: string) => void calls.push(id) };
      assert.equal(
        await applyModel(permissive, requested, () => {}, { harness: "claude" }),
        expected,
      );
      assert.deepEqual(calls, [expected], requested);
    }
  });

  it("runs the tier fallback on the stripped id when the Claude build rejects it", async () => {
    const calls: string[] = [];
    const session = {
      setModel: async (id: string) => {
        calls.push(id);
        if (id !== "opus[1m]") {
          throw new Error(
            "Unsupported value. Allowed values: default, opus[1m], claude-fable-5-1, sonnet, haiku",
          );
        }
      },
    };
    assert.equal(
      await applyModel(session, "anthropic/claude-opus-5-5", () => {}, { harness: "claude" }),
      "opus[1m]",
    );
    assert.deepEqual(calls, ["claude-opus-5-5", "opus[1m]"]);
  });

  it("keeps the provider prefix for harnesses that name models by provider", async () => {
    for (const harness of ["pi", "codex", undefined]) {
      const calls: string[] = [];
      const permissive = { setModel: async (id: string) => void calls.push(id) };
      await applyModel(permissive, "anthropic/claude-opus-5-5", () => {}, { harness });
      assert.deepEqual(calls, ["anthropic/claude-opus-5-5"], String(harness));
    }
    assert.equal(harnessModelId("claude", "openai/gpt-5.5"), "openai/gpt-5.5");
    assert.equal(harnessModelId("claude", undefined), undefined);
  });

  it("does not log an upgrade for a plain context-hint widening", async () => {
    const session = {
      setModel: async (id: string) => {
        if (id !== "sonnet[1m]") {
          throw new Error("Unsupported value. Allowed values: default, sonnet[1m]");
        }
      },
    };
    const logs: string[] = [];
    assert.equal(await applyModel(session, "sonnet", (m) => logs.push(m)), "sonnet[1m]");
    assert.deepEqual(logs, []);
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

  it("tells the model applier which harness it is selecting for", async () => {
    const { calls, deps } = fakeHarness();

    const result = await runSandboxAgent(
      {
        harness: "claude",
        messages: [{ role: "user", content: "hello" }],
        model: "anthropic/claude-opus-5-5",
      },
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    assert.equal(calls.applyModelArgs.length, 1);
    assert.equal(calls.applyModelArgs[0].options?.harness, "claude");
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

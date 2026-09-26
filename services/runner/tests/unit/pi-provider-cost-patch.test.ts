import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  applyPiProviderCostPatch,
  INJECTED_PROVIDER_COST_SOURCE,
  PARSE_CHUNK_USAGE_START,
  PATCHED_USAGE_TAIL,
  PROVIDER_COST_MARKER,
  PROVIDER_COST_SOURCE,
  STOCK_USAGE_TAIL,
} from "../../src/tools/pi-provider-cost-patch.ts";

/**
 * Verbatim from the installed bundle (`@earendil-works/pi-ai` 0.87.1,
 * `dist/api/openai-completions.js`), from the function before `parseChunkUsage` to the header of
 * the one after it. Keep it byte-exact: the patch's only job is to rewrite this shape, so a fixture
 * that drifts from the real bundle proves nothing.
 */
const COMPLETIONS_SECTION = `            },
        };
    });
}
function parseChunkUsage(rawUsage, model) {
    const promptTokens = rawUsage.prompt_tokens || 0;
    const cacheReadTokens = rawUsage.prompt_tokens_details?.cached_tokens ?? rawUsage.prompt_cache_hit_tokens ?? rawUsage.cached_tokens ?? 0;
    const cacheWriteTokens = rawUsage.prompt_tokens_details?.cache_write_tokens || 0;
    // Follow documented OpenAI/OpenRouter semantics: cached_tokens is cache-read
    // tokens (hits). Providers disagree on placement: OpenAI/OpenRouter use
    // prompt_tokens_details.cached_tokens, DeepSeek uses prompt_cache_hit_tokens,
    // and Kimi documents top-level usage.cached_tokens on the final usage chunk.
    // OpenAI does not document or emit cache_write_tokens, but
    // OpenRouter-compatible providers can include it as a separate write count.
    // OpenRouter's own provider/tests affirm the separate mapping:
    // https://github.com/OpenRouterTeam/ai-sdk-provider/pull/409
    // Do not subtract writes from cached_tokens, otherwise spec-compliant
    // providers are under-reported. DS4 mirrors this contract too:
    // https://github.com/antirez/ds4/pull/29
    const input = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
    // OpenAI completion_tokens already includes reasoning_tokens.
    const outputTokens = rawUsage.completion_tokens || 0;
    const usage = {
        input,
        output: outputTokens,
        cacheRead: cacheReadTokens,
        cacheWrite: cacheWriteTokens,
        reasoning: rawUsage.completion_tokens_details?.reasoning_tokens || 0,
        totalTokens: input + outputTokens + cacheReadTokens + cacheWriteTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    calculateCost(model, usage);
    return usage;
}
function mapStopReason(reason) {
    if (reason === null)
        return { stopReason: "stop" };
`;

/** The section from `parseChunkUsage` up to, not including, the next function. */
function parseChunkUsageSource(source: string): string {
  const start = source.indexOf(
    source.includes(PROVIDER_COST_MARKER)
      ? `function ${PROVIDER_COST_MARKER}`
      : PARSE_CHUNK_USAGE_START,
  );
  return source.slice(start, source.indexOf("function mapStopReason"));
}

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
    source?: string;
  };
}

/**
 * `parseChunkUsage` as it runs inside Pi, evaluated from the (patched) section. `calculateCost`
 * stands in for Pi's: $1 per million input tokens, $4 per million output tokens.
 */
function loadParseChunkUsage(source: string): (rawUsage: unknown) => Usage {
  const calculateCost = (_model: unknown, usage: Usage) => {
    usage.cost.input = usage.input / 1e6;
    usage.cost.output = (4 * usage.output) / 1e6;
    usage.cost.cacheRead = 0;
    usage.cost.cacheWrite = 0;
    usage.cost.total = usage.cost.input + usage.cost.output;
  };
  const factory = new Function(
    "calculateCost",
    `${parseChunkUsageSource(source)}\nreturn (raw) => parseChunkUsage(raw, {});`,
  ) as (cc: typeof calculateCost) => (rawUsage: unknown) => Usage;
  return factory(calculateCost);
}

function patched(): string {
  const outcome = applyPiProviderCostPatch(COMPLETIONS_SECTION);
  assert.equal(outcome.kind, "patched");
  return (outcome as { source: string }).source;
}

const OPENROUTER_USAGE = {
  prompt_tokens: 1000,
  completion_tokens: 200,
  total_tokens: 1200,
  cost: 0.0123,
};

describe("the patched parseChunkUsage", () => {
  it("keeps OpenRouter's billed usage.cost as the total and marks its source", () => {
    const usage = loadParseChunkUsage(patched())(OPENROUTER_USAGE);

    assert.equal(usage.cost.total, 0.0123);
    assert.equal(usage.cost.source, PROVIDER_COST_SOURCE);
    // Tokens are Pi's, untouched.
    assert.equal(usage.input, 1000);
    assert.equal(usage.output, 200);
  });

  it("scales Pi's split so it keeps Pi's proportions and still sums to the billed total", () => {
    const usage = loadParseChunkUsage(patched())(OPENROUTER_USAGE);
    const stock = loadParseChunkUsage(COMPLETIONS_SECTION)(OPENROUTER_USAGE);

    const sum =
      usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
    assert.ok(Math.abs(sum - 0.0123) < 1e-12);
    assert.ok(
      Math.abs(
        usage.cost.input / usage.cost.output - stock.cost.input / stock.cost.output,
      ) < 1e-9,
    );
  });

  it("leaves the split at 0 when Pi has no price for the model", () => {
    const zeroPriced = patched().replace(
      "calculateCost(model, usage);\n    __agentaProviderCost",
      "__agentaProviderCost",
    );
    const usage = loadParseChunkUsage(zeroPriced)(OPENROUTER_USAGE);

    assert.equal(usage.cost.total, 0.0123);
    assert.equal(usage.cost.input, 0);
    assert.equal(usage.cost.output, 0);
    assert.equal(usage.cost.source, PROVIDER_COST_SOURCE);
  });

  it("keeps Pi's own cost when the provider reports none", () => {
    const raw = { prompt_tokens: 1000, completion_tokens: 200 };
    const usage = loadParseChunkUsage(patched())(raw);
    const stock = loadParseChunkUsage(COMPLETIONS_SECTION)(raw);

    assert.deepEqual(usage, stock);
    assert.equal(usage.cost.source, undefined);
  });

  it("ignores a cost that is not a finite, non-negative number", () => {
    const parse = loadParseChunkUsage(patched());
    const stock = loadParseChunkUsage(COMPLETIONS_SECTION);
    for (const cost of ["0.01", null, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const raw = { prompt_tokens: 10, completion_tokens: 2, cost };
      assert.deepEqual(parse(raw), stock(raw), `cost=${String(cost)}`);
    }
  });

  it("keeps a billed cost of 0 (a free model is still a billed charge)", () => {
    const usage = loadParseChunkUsage(patched())({ ...OPENROUTER_USAGE, cost: 0 });

    assert.equal(usage.cost.total, 0);
    assert.equal(usage.cost.source, PROVIDER_COST_SOURCE);
  });
});

describe("applyPiProviderCostPatch", () => {
  it("defines the helper before parseChunkUsage and calls it after Pi prices the usage", () => {
    const source = patched();

    assert.ok(source.includes(INJECTED_PROVIDER_COST_SOURCE));
    assert.ok(source.includes(PATCHED_USAGE_TAIL));
    assert.ok(
      source.indexOf(`function ${PROVIDER_COST_MARKER}`) <
        source.indexOf(PARSE_CHUNK_USAGE_START),
    );
  });

  it("changes nothing else in the bundle", () => {
    const restored = patched()
      .replace(INJECTED_PROVIDER_COST_SOURCE, "")
      .replace(PATCHED_USAGE_TAIL, STOCK_USAGE_TAIL);

    assert.equal(restored, COMPLETIONS_SECTION);
  });

  it("is idempotent, so a rebuilt or already-baked image is a no-op", () => {
    assert.equal(applyPiProviderCostPatch(patched()).kind, "already-patched");
  });

  it("reports anchor-missing when Pi rewrites the tail of parseChunkUsage", () => {
    assert.equal(
      applyPiProviderCostPatch(
        COMPLETIONS_SECTION.replace(
          "    calculateCost(model, usage);\n    return usage;",
          "    return withCost(model, usage);",
        ),
      ).kind,
      "anchor-missing",
    );
  });

  it("reports anchor-missing when parseChunkUsage is renamed or gone", () => {
    assert.equal(
      applyPiProviderCostPatch(
        COMPLETIONS_SECTION.replace(PARSE_CHUNK_USAGE_START, "function parseUsage(raw, model) {"),
      ).kind,
      "anchor-missing",
    );
  });

  it("does not bind to a look-alike tail outside parseChunkUsage", () => {
    // The tail is generic enough to appear in another function. Only the one inside
    // parseChunkUsage may be rewritten.
    const moved = COMPLETIONS_SECTION.replace(
      "    calculateCost(model, usage);\n    return usage;\n}\nfunction mapStopReason",
      "    return usage;\n}\nfunction other(model, usage) {\n    calculateCost(model, usage);\n    return usage;\n}\nfunction mapStopReason",
    );
    assert.equal(applyPiProviderCostPatch(moved).kind, "anchor-missing");
  });

  it("reports anchor-missing when parseChunkUsage appears twice", () => {
    assert.equal(
      applyPiProviderCostPatch(COMPLETIONS_SECTION + COMPLETIONS_SECTION).kind,
      "anchor-missing",
    );
  });
});

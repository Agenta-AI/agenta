// Generate the Pi model-catalog data file from the pinned `@earendil-works/pi-ai`
// `models.generated` catalog. This is job 1 of the `sync-model-catalog` skill.
//
// It reads the pi-ai model definitions for the providers Agenta reaches (the vault-mapped
// providers plus the `openai-codex` subscription) and emits one `ModelCatalogEntry` per model
// with `source: "pi_generated"` and the objective facts filled from pi-ai (name / pricing /
// context_window / modalities). The curated fields (label / description / ratings) are left
// absent — a human adds those in the sibling `pi_models.curated.json` overlay, which the SDK
// loader merges on top of this file. Regeneration only ever rewrites this generated file, so the
// overlay survives a bump.
//
// Run from the runner package (so `@earendil-works/pi-ai` resolves):
//   node .agents/skills/sync-model-catalog/generate_pi_models.mjs \
//     services/runner/node_modules/@earendil-works/pi-ai/dist/models.generated.js \
//     sdks/python/agenta/sdk/agents/data/pi_models.generated.json
//
// The output JSON carries no inline comments (JSON forbids them); the "generated, do not
// hand-edit" notice lives in the `_generator` envelope field and in the skill README.

import {readFileSync, writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";

// pi-ai provider name -> Agenta vault provider vocabulary. Agenta's capability table, vault, and
// FE reachability filter speak `gemini`/`together_ai`; pi-ai's catalog keys them `google`/
// `together`. The catalog entry's `provider` (and the `provider/` prefix on its `id`) uses the
// Agenta vocabulary so it lines up with the rest of the system. The exact `provider/id` string the
// live Pi harness accepts is verified by the skill's live-probe job, not asserted here.
const PROVIDER_MAP = {
  openai: "openai",
  anthropic: "anthropic",
  google: "gemini",
  mistral: "mistral",
  groq: "groq",
  minimax: "minimax",
  together: "together_ai",
  openrouter: "openrouter",
  "openai-codex": "openai-codex",
};

// The pi-ai provider blocks Agenta reaches: the vault-mapped providers plus the codex subscription.
const PI_PROVIDERS = Object.keys(PROVIDER_MAP);

function piVersion(modelsPath) {
  // dist/models.generated.js -> ../package.json (the pi-ai package root).
  try {
    const pkgUrl = new URL("../package.json", pathToFileURL(modelsPath));
    const pkg = JSON.parse(readFileSync(pkgUrl, "utf8"));
    return `@earendil-works/pi-ai@${pkg.version}`;
  } catch {
    return "@earendil-works/pi-ai@unknown";
  }
}

function pricing(cost) {
  if (!cost) return null;
  const out = {
    input_per_mtok: cost.input ?? null,
    output_per_mtok: cost.output ?? null,
    currency: "USD",
  };
  if (cost.cacheRead != null) out.cache_read_per_mtok = cost.cacheRead;
  if (cost.cacheWrite != null) out.cache_write_per_mtok = cost.cacheWrite;
  return out;
}

function entryFor(agentaProvider, model) {
  return {
    id: `${agentaProvider}/${model.id}`,
    provider: agentaProvider,
    source: "pi_generated",
    name: model.name ?? null,
    pricing: pricing(model.cost),
    context_window: model.contextWindow ?? null,
    modalities: Array.isArray(model.input) ? model.input : null,
    label: null,
    description: null,
    ratings: null,
  };
}

async function main() {
  const modelsPath = process.argv[2];
  const outPath = process.argv[3];
  if (!modelsPath || !outPath) {
    console.error("usage: generate_pi_models.mjs <models.generated.js> <out.json>");
    process.exit(2);
  }

  const {MODELS} = await import(pathToFileURL(modelsPath).href);

  const models = [];
  for (const piProvider of PI_PROVIDERS) {
    const block = MODELS[piProvider];
    if (!block) continue;
    const agentaProvider = PROVIDER_MAP[piProvider];
    for (const model of Object.values(block)) {
      models.push(entryFor(agentaProvider, model));
    }
  }

  const doc = {
    schema_version: "1",
    _generator: {
      source: piVersion(modelsPath),
      generated_by: ".agents/skills/sync-model-catalog/generate_pi_models.mjs",
      generated_at: new Date().toISOString(),
      note: "Generated file. Do not hand-edit. Curated fields live in pi_models.curated.json.",
    },
    models,
  };

  writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");
  console.error(`wrote ${models.length} models to ${outPath} from ${doc._generator.source}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Keep the provider's billed cost (OpenRouter `usage.cost`) in Pi's usage.
 *
 * Runs in the runner image build, after `pnpm install`, so the baked copy of
 * `@earendil-works/pi-ai` stops replacing OpenRouter's billed charge with Pi's price-table
 * estimate. The `local` provider's `pi` subprocess and the in-process engine both load this copy.
 * See `src/tools/pi-provider-cost-patch.ts` for why, for the scope, and for how the patch retires.
 * The Daytona snapshot applies the same spec in `images/sandbox/daytona/build_snapshot.py`.
 *
 * Exits non-zero when the package is missing or `parseChunkUsage` no longer matches the anchor,
 * so a Pi version bump breaks the image build instead of silently dropping the billed cost again.
 *
 *   tsx scripts/patch-pi-provider-cost.ts
 */
import { readFileSync } from "node:fs";

import {
  applyPiProviderCostPatch,
  PI_PROVIDER_COST_BUNDLE_PATH,
  PROVIDER_COST_MARKER,
} from "../src/tools/pi-provider-cost-patch.ts";
import { piAiBundlePaths, writeBundle } from "./pi-ai-bundles.ts";

const bundles = piAiBundlePaths(PI_PROVIDER_COST_BUNDLE_PATH);
if (bundles.length === 0) {
  console.error(
    "patch-pi-provider-cost: no installed @earendil-works/pi-ai openai-completions bundle found. " +
      "Run `pnpm install` first, or drop this step if Pi is no longer a dependency.",
  );
  process.exit(1);
}

for (const bundle of bundles) {
  const outcome = applyPiProviderCostPatch(readFileSync(bundle, "utf8"));
  if (outcome.kind === "anchor-missing") {
    console.error(
      `patch-pi-provider-cost: the parseChunkUsage anchor is missing in ${bundle}. ` +
        "pi-ai changed how it parses OpenAI-completions usage: re-read parseChunkUsage and update " +
        "src/tools/pi-provider-cost-patch.json (or drop the patch if upstream now keeps usage.cost).",
    );
    process.exit(1);
  }
  if (outcome.kind === "already-patched") {
    console.log(`patch-pi-provider-cost: already keeping the billed cost in ${bundle}`);
    continue;
  }
  writeBundle(bundle, outcome.source);
  // Re-read and assert, so the image can never ship without the patch on a silent write failure.
  if (!readFileSync(bundle, "utf8").includes(PROVIDER_COST_MARKER)) {
    console.error(`patch-pi-provider-cost: the patch did not take in ${bundle}`);
    process.exit(1);
  }
  console.log(`patch-pi-provider-cost: OpenRouter usage.cost now wins in ${bundle}`);
}

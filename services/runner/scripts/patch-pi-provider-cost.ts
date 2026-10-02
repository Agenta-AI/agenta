/**
 * Keep the provider's billed cost (OpenRouter `usage.cost`) in Pi's usage.
 *
 * Runs in the runner image build, after `pnpm install`, so the baked copy of
 * `@earendil-works/pi-ai` (the in-process engine) and the pi CLI's bundled copy of it (the `local`
 * provider's `pi` subprocess) stop replacing OpenRouter's billed charge with Pi's price-table
 * estimate.
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
  PI_AI_ANCHOR,
  PI_CLI_ANCHOR,
  PI_CLI_PROVIDER_COST_BUNDLE_PATH,
  PI_PROVIDER_COST_BUNDLE_PATH,
  type PiProviderCostAnchor,
  PROVIDER_COST_MARKER,
} from "../src/tools/pi-provider-cost-patch.ts";
import { piAiBundlePaths, piCliBundlePaths, writeBundle } from "./pi-ai-bundles.ts";

// The pi-ai package (the in-process engine) and the pi CLI's bundled copy (every `pi` subprocess).
const targets: Array<[string, string[], PiProviderCostAnchor]> = [
  ["@earendil-works/pi-ai", piAiBundlePaths(PI_PROVIDER_COST_BUNDLE_PATH), PI_AI_ANCHOR],
  [
    "@earendil-works/pi-coding-agent",
    piCliBundlePaths(PI_CLI_PROVIDER_COST_BUNDLE_PATH),
    PI_CLI_ANCHOR,
  ],
];

for (const [pkg, bundles, anchor] of targets) {
  if (bundles.length === 0) {
    console.error(
      `patch-pi-provider-cost: no installed ${pkg} openai-completions bundle found. ` +
        "Run `pnpm install` first; after a Pi bump, update the bundle path in " +
        "src/tools/pi-provider-cost-patch.json.",
    );
    process.exit(1);
  }
  for (const bundle of bundles) {
    const outcome = applyPiProviderCostPatch(readFileSync(bundle, "utf8"), anchor);
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
}

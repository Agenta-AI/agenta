/**
 * Build-time patch that keeps the provider's billed cost in Pi's usage (`@earendil-works/pi-ai`).
 *
 * WHY THIS EXISTS. OpenRouter returns the real charge for every request in `usage.cost` (credits,
 * which are USD), in the last SSE chunk of a streamed response. pi-ai's OpenAI-completions client
 * (`parseChunkUsage` in `dist/api/openai-completions.js`) builds a fresh usage object from the
 * token counts, prices it with `calculateCost(model, usage)` from Pi's own price table, and drops
 * `rawUsage.cost`. So a Pi chat span carries Pi's estimate, not what OpenRouter billed. The platform
 * rule is: use an outside cost only when it is the real billed charge. OpenRouter `usage.cost` is
 * that case, so this patch keeps it.
 *
 * WHAT IT DOES. After Pi prices the usage, and only when `rawUsage.cost` is a finite, non-negative
 * number, the injected `__agentaProviderCost` sets `usage.cost.total` to the billed charge and
 * marks it `usage.cost.source = "provider"`. The tracer (`src/tracing/otel.ts`) reads that marker
 * and stamps `agenta.usage.cost_source = "provider"` on the chat span. A response without
 * `usage.cost` (OpenAI, DeepSeek, every other OpenAI-compatible provider) is left exactly as Pi
 * priced it.
 *
 * THE SPLIT FIELDS ARE SCALED, NOT KEPT. Pi's `cost.input/output/cacheRead/cacheWrite` are its own
 * estimate. OpenRouter bills one number and does not split it. When Pi's estimate is positive, each
 * split field is scaled by `billed / estimated`, so the split keeps Pi's proportions and still sums
 * to `total`. Anything that adds the split fields (Pi's own stats, a future consumer) then agrees
 * with the total. When Pi has no price for the model (estimate 0), the split stays 0 and only the
 * total carries the charge: there is no honest split to invent.
 *
 * SCOPE. Only the OpenAI-completions client needs this. In pi-ai 0.87.1 the OpenRouter provider
 * serves most models through `openai-completions`, but its `anthropic/*` models go through
 * `anthropic-messages`, which this patch does not touch: whether OpenRouter's Anthropic-compatible
 * endpoint reports `usage.cost` is not verified, so those spans keep Pi's estimate. The Responses
 * and native Anthropic/Google/Bedrock clients talk to first-party APIs that report no billed cost.
 *
 * WHERE IT RUNS. The anchor lives in `pi-provider-cost-patch.json`, not here, because TWO installs
 * must patch identically: the runner image (`scripts/patch-pi-provider-cost.ts`, which covers both
 * the `local` provider's `pi` subprocess and the in-process engine, since both load the runner's
 * `node_modules`) and the Daytona sandbox snapshot (`images/sandbox/daytona/build_snapshot.py`,
 * which installs Pi from npm and embeds the same spec).
 *
 * VERSION-PIN FRICTION, ACCEPTED. The anchor is the exact tail of `parseChunkUsage` pi-ai 0.87.1
 * ships (also in 0.80.6). A Pi upgrade that rewrites it breaks the image build until someone
 * re-reads the function and updates the JSON. That is deliberate: a loose pattern that keeps
 * matching after the code moved is how a patch silently rewrites the wrong line.
 *
 * RETIREMENT. If upstream Pi starts keeping `rawUsage.cost`, drop this patch. Until then,
 * `applyPiProviderCostPatch` reports `already-patched` for a source that carries the marker, so a
 * rebuild over a patched install is a no-op.
 *
 * FAILING LOUDLY IS THE POINT. The build exits non-zero on `anchor-missing`.
 */
import patchSpec from "./pi-provider-cost-patch.json" with { type: "json" };

/** The file inside the pi-ai package that parses OpenAI-completions usage. */
export const PI_PROVIDER_COST_BUNDLE_PATH = patchSpec.bundlePath;

/** The name the injected function takes inside Pi's module scope. Also the idempotence marker. */
export const PROVIDER_COST_MARKER = patchSpec.marker;

/** The value of `usage.cost.source` when the cost is the provider's billed charge. */
export const PROVIDER_COST_SOURCE = "provider";

/** Pi's function header. The patch only binds inside this function. */
export const PARSE_CHUNK_USAGE_START = patchSpec.functionStart;

/** The exact tail of `parseChunkUsage` that the patch rewrites. */
export const STOCK_USAGE_TAIL = patchSpec.anchor;

export const PATCHED_USAGE_TAIL = patchSpec.replacement;

/** The function text the patch writes into Pi, immediately before `parseChunkUsage`. */
export const INJECTED_PROVIDER_COST_SOURCE = patchSpec.injected;

export type PiProviderCostPatchOutcome =
  | { kind: "patched"; source: string }
  | { kind: "already-patched" }
  | { kind: "anchor-missing" };

/**
 * Apply the patch to one `openai-completions.js` source.
 *
 * Pure and idempotent. The anchor must sit inside `parseChunkUsage` (between its header and the
 * next top-level `function`), and the header must occur exactly once, so the patch cannot bind to
 * a look-alike tail somewhere else in the bundle.
 *
 * `build_snapshot.py` embeds the same steps in JavaScript for the Daytona image; keep them in step.
 */
export function applyPiProviderCostPatch(
  source: string,
): PiProviderCostPatchOutcome {
  if (source.includes(PROVIDER_COST_MARKER)) return { kind: "already-patched" };
  const start = source.indexOf(PARSE_CHUNK_USAGE_START);
  if (start < 0) return { kind: "anchor-missing" };
  if (source.indexOf(PARSE_CHUNK_USAGE_START, start + 1) >= 0) {
    return { kind: "anchor-missing" };
  }
  const nextFunction = source.indexOf(
    "\nfunction ",
    start + PARSE_CHUNK_USAGE_START.length,
  );
  const end = nextFunction < 0 ? source.length : nextFunction;
  const at = source.indexOf(STOCK_USAGE_TAIL, start);
  if (at < 0 || at + STOCK_USAGE_TAIL.length > end) {
    return { kind: "anchor-missing" };
  }
  const patched =
    source.slice(0, start) +
    INJECTED_PROVIDER_COST_SOURCE +
    source.slice(start, at) +
    PATCHED_USAGE_TAIL +
    source.slice(at + STOCK_USAGE_TAIL.length);
  return { kind: "patched", source: patched };
}

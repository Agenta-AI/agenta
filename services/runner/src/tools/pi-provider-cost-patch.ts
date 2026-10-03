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
 * SCOPE. Only the OpenAI-completions client needs this. In pi-ai 0.99.1 the OpenRouter provider
 * serves most models through `openai-completions`, but its `anthropic/*` models go through
 * `anthropic-messages`, which this patch does not touch: whether OpenRouter's Anthropic-compatible
 * endpoint reports `usage.cost` is not verified, so those spans keep Pi's estimate. The Responses
 * and native Anthropic/Google/Bedrock clients talk to first-party APIs that report no billed cost.
 *
 * TWO COPIES OF PI-AI. The `pi` CLI (`dist/bundle/cli.js`) does not load the `pi-ai` package: it
 * runs a minified copy bundled into `pi-coding-agent` (`cli.bundlePath` in the spec). The
 * in-process engine imports `pi-coding-agent`'s unbundled entry, which loads the `pi-ai` package.
 * So the runner image patches both, and a Daytona sandbox, which only runs the CLI, patches the
 * bundled copy.
 *
 * WHERE IT RUNS. The anchors live in `pi-provider-cost-patch.json`, not here, because every install
 * must patch identically: the runner image (`scripts/patch-pi-provider-cost.ts`), the Daytona
 * sandbox snapshot (`images/sandbox/daytona/build_snapshot.py`, which installs Pi from npm and
 * embeds the same spec), and a runtime Pi install in a Daytona sandbox (`ensurePiInSandbox`).
 *
 * VERSION-PIN FRICTION, ACCEPTED. The anchors are the exact tail of `parseChunkUsage` pi-ai 0.87.1
 * ships, and the CLI chunk's file name carries the bundle's content hash. A Pi upgrade that changes
 * either breaks the image build until someone re-reads the function and updates the JSON. That is deliberate: a loose pattern that keeps
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

/** The pi CLI's bundled copy of that file, inside the pi-coding-agent package. */
export const PI_CLI_PROVIDER_COST_BUNDLE_PATH = patchSpec.cli.bundlePath;

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

/** Where the patch binds in one copy of `parseChunkUsage`. */
export interface PiProviderCostAnchor {
  functionStart: string;
  anchor: string;
  replacement: string;
}

/** The pi-ai package's `parseChunkUsage`. */
export const PI_AI_ANCHOR: PiProviderCostAnchor = patchSpec;

/** The minified `parseChunkUsage` the pi CLI bundles. */
export const PI_CLI_ANCHOR: PiProviderCostAnchor = patchSpec.cli;

export type PiProviderCostPatchOutcome =
  | { kind: "patched"; source: string }
  | { kind: "already-patched" }
  | { kind: "anchor-missing" };

/**
 * Apply the patch to one copy of `parseChunkUsage`: the pi-ai package's (default) or the pi CLI's
 * bundled chunk (`PI_CLI_ANCHOR`).
 *
 * Pure and idempotent. The anchor must sit inside `parseChunkUsage` (between its header and the
 * next `function`), and the header must occur exactly once, so the patch cannot bind to a
 * look-alike tail somewhere else in the bundle.
 *
 * `build_snapshot.py` embeds the same steps in JavaScript for the Daytona image; keep them in step.
 */
export function applyPiProviderCostPatch(
  source: string,
  { functionStart, anchor, replacement }: PiProviderCostAnchor = PI_AI_ANCHOR,
): PiProviderCostPatchOutcome {
  if (source.includes(PROVIDER_COST_MARKER)) return { kind: "already-patched" };
  const start = source.indexOf(functionStart);
  if (start < 0) return { kind: "anchor-missing" };
  if (source.indexOf(functionStart, start + 1) >= 0) {
    return { kind: "anchor-missing" };
  }
  const nextFunction = source.indexOf(
    "function ",
    start + functionStart.length,
  );
  const end = nextFunction < 0 ? source.length : nextFunction;
  const at = source.indexOf(anchor, start);
  if (at < 0 || at + anchor.length > end) {
    return { kind: "anchor-missing" };
  }
  const patched =
    source.slice(0, start) +
    INJECTED_PROVIDER_COST_SOURCE +
    source.slice(start, at) +
    replacement +
    source.slice(at + anchor.length);
  return { kind: "patched", source: patched };
}

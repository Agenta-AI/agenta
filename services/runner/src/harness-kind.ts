/**
 * THE one harness-identity normalizer (cold/warm audit findings 3 and 6).
 *
 * The wire carries `pi_core` and `pi_agenta` (a removed experiment's spelling, still read for
 * old stored configs), `claude`, and `codex`; an empty or absent harness defaults to `pi_core`.
 * Three call sites used to re-derive that mapping with their own inline literals, and one of
 * them (`reconciliation-router.harnessKind`) matched the bare "pi" the wire never carries — so
 * every playground Pi run fell into the fail-closed all-rebuild capability row (#6364). A second
 * drift (finding 3): the config fingerprint normalized the Codex harness mode while the facet
 * digest took it raw, so the two views could disagree about whether anything changed.
 *
 * This module exists so that class of drift is unrepresentable: everything that asks "which
 * harness family is this?" or "what is the effective harness mode?" asks HERE, and a round-trip
 * test pins every wire spelling. Keep it dependency-light (one pure import) so any layer —
 * engines, lifecycle, tracing — can use it without cycles.
 */
import { resolveCodexMode } from "./engines/sandbox_agent/codex-mode.ts";

/** The harness FAMILY a wire spelling resolves to. `unknown` must always fail closed. */
export type NormalizedHarnessKind = "pi" | "claude" | "codex" | "unknown";

/** Every wire spelling this runner accepts, mapped to its family. */
export function harnessKindOf(
  harness: string | undefined,
): NormalizedHarnessKind {
  // Only an ABSENT or EMPTY harness takes the `pi_core` default. `/stream` decodes its body
  // with an unchecked `JSON.parse(raw) as AgentRunRequest`, so a malformed payload can put
  // `null`, `0`, or `false` in this field, and a bare `||` would hand each of them Pi's live
  // routes. A non-string is not a harness spelling we recognize, so it fails closed. The real
  // client always sends a string (`wire.py` writes `harness.value`), so this costs a wasted
  // rebuild only on input that should not exist.
  if (harness !== undefined && typeof harness !== "string") return "unknown";
  const resolved = harness || "pi_core";
  if (resolved === "pi" || resolved === "pi_core" || resolved === "pi_agenta")
    return "pi";
  if (resolved === "claude" || resolved === "codex") return resolved;
  return "unknown";
}

/**
 * The EFFECTIVE harness mode: what session acquire will actually apply.
 *
 * Codex normalizes through `resolveCodexMode` (an invalid or absent value becomes the default),
 * and every other harness has no mode at all — so an explicitly-sent default, an absent field,
 * and a mode on a harness that ignores it all normalize to the same value, and only a change
 * the session would OBSERVE can move a fingerprint or a facet.
 */
export function normalizedHarnessMode(
  harness: string | undefined,
  harnessMode: string | undefined,
): string | null {
  return harnessKindOf(harness) === "codex"
    ? resolveCodexMode(harnessMode)
    : null;
}

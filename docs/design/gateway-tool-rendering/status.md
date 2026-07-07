# Status

**State:** Design approved with Mahmoud's review round folded in. Both open questions are
closed. Ready to implement on Mahmoud's go. Design only — no code changes yet.

**Date:** 2026-07-07
**Session:** https://claude.ai/code/session_01EcGku1uKvh1Yo48ZU2xN5e
**Branch / PR:** `docs/gateway-tool-rendering` → draft PR #5140 against `big-agents`.

## What's decided

- **Root cause confirmed** (all citations verified, see [research.md](research.md)): every
  FE consumer keys connected-app tools off the legacy `function.name` slug via
  `parseGatewayFunctionName`. The canonical `type:"gateway"` object has no `function`, so
  it falls through to the built-in fallback — misrendered as "gateway · built-in" under
  the BUILT-IN header with a raw JSON drill-in.
- **Fix shape:** one shared `parseGatewayTool` + `gatewayToolIdentity` helper in
  `toolUtils.ts` that normalizes both encodings; every consumer reads through it.
- **Frontend read-path only.** No backend, no SDK wire changes. Both encodings are already
  equivalent server-side.
- **Disjoint from the uncommitted secret-isolation edits** — none of the in-scope files
  overlap with `connectionUtils.ts` / `ProviderCredentialsSection.tsx` /
  `useModelHarness.tsx` etc.
- **Phasing:** Phase 1 (rendering + grouping) fixes the reported symptom and ships alone;
  Phase 2 (drill-in through the existing view + fail-safe) and Phase 3 (add-path identity)
  follow. Convergence (write canonical) is deferred, not phased.

## Review round folded in (2026-07-07, Mahmoud)

Five decisions from PR #5140, now recorded in [context.md](context.md) and reflected in
[plan.md](plan.md):

1. **Product invariant leads.** The tool UI looks identical before/after and across
   authoring sources; the shared parser is a simplification, not a product change.
2. **Drill-in = Option B (open question #1 CLOSED).** Fetch catalog detail and populate the
   existing view. Same appearance for UI-created and agent-created tools, in the list and the
   drill-in.
3. **No frontend dedupe.** Identity serves only the drawer's add path (added-state,
   double-add prevention, toggle-off of the matched entry).
4. **Reuse the existing drill-in view; no new component.** Plus a new fail-safe: an
   unresolvable canonical tool falls back to raw JSON with a warning.
5. **Convergence deferred (open question #2 CLOSED).** The drawer keeps writing the legacy
   shape on add; read-side canonical support is unaffected.

## Next actions (on Mahmoud's go)

- Implement Phase 1 behind the shared helper; add the `toolUtils` unit tests.
- Widen `itemKinds` routing so resolvable canonical tools open the existing gateway view via
  the Option-B fetch; add the fail-safe (raw JSON + warning) with its own test.
- Add identity-based `selectedGatewayIds` for the drawer's added-state / double-add /
  toggle-off. No dedupe.
- Verify on the `:8280` repro revision.

# Status

**State:** Design complete. Awaiting Mahmoud's answers on two open questions before
implementation. Design only — no code changes.

**Date:** 2026-07-07
**Session:** https://claude.ai/code/session_01EcGku1uKvh1Yo48ZU2xN5e
**Branch / PR:** `docs/gateway-tool-rendering` → draft PR against `big-agents`.

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
  Phases 2–3 (drill-in, add/remove/dedupe) follow; Phase 4 (write canonical) is gated on
  Open question #2.

## Blocked on Mahmoud

1. **Drill-in richness (Q2):** humanize-only vs. fetch catalog action detail for a
   description + schema preview.
2. **Convergence (Q4):** should the drawer start writing the canonical shape on add?

## Next actions (post-answers)

- Implement Phase 1 behind the shared helper; add the `toolUtils` unit tests.
- Build `GatewayToolDetailView` per the chosen Option A/B.
- Switch the drawer dedupe/removal to identity keys.
- Verify on the `:8280` repro revision.

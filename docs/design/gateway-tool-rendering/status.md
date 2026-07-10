# Status

**State:** Implemented and live-QA'd on `:8280` (PR #5140, lane `docs/gateway-tool-rendering`).
Design approved with Mahmoud's review round, a codex xhigh design review, and Mahmoud's
mid-implementation 1-to-1 constraint round all folded in (2026-07-07) — see
[context.md](context.md).

## Implemented

- **Shared helper** `parseGatewayTool` + `gatewayToolIdentity` in `toolUtils.ts`
  (`parseGatewayFunctionName` now aliases the shared `parseGatewayToolSlug`).
- **Phase 1 rendering:** `describeTool` + `ToolManagementList` grouping read through
  `parseGatewayTool`; canonical tools render identically to legacy.
- **Phase 2 drill-in:** `ToolFormView` body extracted to `FunctionToolForm` (legacy
  untouched); `CanonicalGatewayToolForm` resolves the catalog (Option B) and feeds
  `FunctionToolForm` the synthesized legacy shape — canonical drill-in is pixel-identical to
  legacy. Fail-safe = warning + read-only JSON. `editView`/`jsonOnly` widened for canonical.
- **Phase 3 add-path:** `selectedGatewayIds` + `removeGatewayToolByIdentity` (both derived
  from the same `tools` memo); the drawer matches added-state by identity, counts canonical
  tools, and toggles off exactly one match.
- **Tests:** `tests/unit/gatewayTool.test.ts` — parser/identity, `describeTool`, `editView`
  routing, add-path identity. Package `lint` / `types:check` / `test` (158) / `build` green.

## Live QA (repro app `019f3d51-1f93-7452-8133-dff2f0d91385`, rev `019f3d56-…`)

1. **List** — the three canonical Slack tools render under a **Slack** card in **Connected
   apps** with humanized names ("Open dm", "Send message", "Retrieve message permalink URL").
   PASS.
2. **Drill-in** — canonical opens the same `ToolFormView` a legacy tool gets: catalog-resolved
   PARAMETERS, slug Name, catalog Description, Permission = Allow. The JSON view shows the
   **untouched canonical object** (read-path only, no shape mutation). PASS.
3. **Fail-safe** — verified by code review (Opus) and logic; not live-crafted (the Lexical
   JSON editor rejects synthetic edits and the package has no jsdom/testing-library render
   harness). Low risk (a terminal `!isLoading && !action` → warning + read-only JSON).
4. **Add-path** — the drawer preselected to Slack shows the canonical actions as selected,
   footer "3 app tools added"; toggle-off removes exactly one (3→2); re-add restores (2→3,
   as a legacy entry — cross-encoding identity match). PASS.
5. **Dark theme** — list and canonical drill-in render correctly in dark. PASS.

Legacy parity: a re-added legacy OPEN_DM rendered identically to the canonical entries in
both the list and the drawer; legacy code paths are unchanged.

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

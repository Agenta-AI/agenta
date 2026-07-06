# Status

**Phase: planned — awaiting owner review of the open decisions. No product code changed.**

Last updated: 2026-07-06 (planning session; workspace created).

## Done

- Codebase research verified against the working tree (research.md). Key finding: the
  unreadable selection is a missing theme token (`--ag-colorPrimaryBg` is never
  generated), not a design choice.
- Design prototype extracted and every hex mapped to existing `--ag-*` tokens; no
  palette change needed (research.md §8-9).
- Component design, contracts, copy strings, and gating matrix written (design.md).
- Implementation sliced for Sonnet subagents with a verification plan (plan.md).

## Open decisions (for the product owner)

- **D1 — Section order.** Default (recommended): Harness → Model → Provider
  credentials, with the model pick auto-highlighting its provider. The prototype
  orders it Harness → Credentials → Model. Approve the default or flip it.
- **D2 — SectionRail restyle scope.** Recommended: global restyle (all five consumers
  share the same semantic and the same broken token; list in research.md §4).
  Alternative: a `selectionStyle` variant prop defaulting to the new recipe.
- **D3 — Drawer width and side panel.** Recommended: keep the current 880px drawer and
  the 240px version-history skeleton (minimal churn; the credentials card fits).
  Alternative: the prototype's 640px single column, which drops the side panel.
- **D4 — Named-connection select.** Recommended: keep it, moved into the "Use API key"
  pane below the key form (it is the only UI for named vault connections). Alternative:
  drop it from this drawer entirely.
- **D5 — CustomProviderForm package home.** Recommended: `@agenta/entity-ui`
  (`secretProvider/`), with the prerequisite moves (constants →
  `@agenta/entities/secret`, `isSlugInputValid` → `@agenta/shared`, `LabelInput` →
  `@agenta/ui` or replaced). No alternative that satisfies both reuse and layering.
- **D6 — Cloud-gating seam.** Recommended: extend `DrillInUIContext` with
  `deployment: {isCloud, selfHostingGuideUrl?}` wired from `isDemo()` in the OSS
  provider. Alternative: a shared-state atom hydrated by the app layer.

## Locked decisions (owner, final — do not reopen)

- Harness section layout and behavior unchanged; only the selection styling.
- Toggle labels "Use API key" / "Use subscription"; card heading "Self-managed".
- Key saves are immediate (vault write on the per-provider Save); the drawer footer
  Save commits only the agent config draft.
- Custom-provider form renders inline in the right pane; no nested drawer; the form
  logic is extracted into a reusable component shared with the old drawer.
- Mode selection moves out of Advanced completely.
- Unsaved-changes confirm on scrim/X close when dirty; footer Cancel stays immediate.
- Out of scope: key validation, other drawer sections, ConnectModelBanner, harness
  layout changes.

## Blockers

None. The plan builds on uncommitted in-flight changes in the same files (chat gate,
creation prefs, `providerKeySetupDoneAtom`, self-managed pill fix); implementers must
not revert them (context.md "Constraints").

## Next steps

1. Owner reviews D1-D6 (defaults are safe to proceed with).
2. Run the slices in plan.md order (1-3 can run in parallel; 4 needs 1+3; 5 needs 4;
   6 last).
3. Verify on the dev stack (`144.76.237.122:8280`), light and dark, per plan.md.

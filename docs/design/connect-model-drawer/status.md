# Status

**Phase: slices 1-6 implemented 2026-07-06. PR #5096 is the feature PR. Pending review
and live-stack verification (plan.md's verification plan, light + dark).**

Last updated: 2026-07-06 (slice 6 — copy sweep + docs sync — landed, completing the
plan. All six slices are in the working tree: SectionRail restyle, the unsaved-changes
guard, the extracted `CustomProviderForm`, `ProviderCredentialsSection`, the drawer
restructure with Advanced auth removed, and this slice's copy/docs sweep).

## Done

- Codebase research verified against the working tree (research.md). Key finding: the
  unreadable selection is a missing theme token (`--ag-colorPrimaryBg` is never
  generated), not a design choice.
- Design prototype extracted and every hex mapped to existing `--ag-*` tokens; no
  palette change needed (research.md §8-9).
- Component design, contracts, copy strings, and gating matrix written (design.md).
- Implementation sliced for Sonnet subagents with a verification plan (plan.md).

## Decisions D1-D6 (locked, owner answered on PR #5096, 2026-07-06)

All six landed on the plan's recommended default — no alternative was chosen.

- **D1 — Section order: Harness → Model → Provider credentials.** The model pick
  auto-highlights its provider in the credentials rail below it (design.md §1). The
  prototype's Harness → Credentials → Model order is NOT used.
- **D2 — SectionRail restyle scope: GLOBAL.** All five consumers restyle together
  (harness list, workflow-reference selector, trigger run-version field, commit modal,
  agent-home templates gallery; research.md §4). No `selectionStyle` variant prop.
- **D3 — Drawer width and side panel: keep as is.** 880px drawer width and the 240px
  version-history skeleton stay; the prototype's 640px single-column layout is not
  adopted.
- **D4 — Named-connection select: keep it**, moved into the "Use API key" pane below
  the key form (design.md §3.2). It stays the only UI for named vault connections.
- **D5 — CustomProviderForm package home: `@agenta/entity-ui` (`secretProvider/`)**,
  per the plan's recommendation and consistent with the `agenta-package-practices`
  placement rule (entity-specific UI → `@agenta/entity-ui`). Prerequisite moves:
  `PROVIDER_FIELDS`/`PROVIDER_AUTH_REQUIREMENTS` → `@agenta/entities/secret/core`,
  `isSlugInputValid` → `@agenta/shared` (re-export shim left in place),
  `LabelInput` → `@agenta/ui` or replaced (design.md §4).
- **D6 — Cloud-gating seam: extend `DrillInUIContext`** with
  `deployment: {isCloud, selfHostingGuideUrl?}`, wired from `isDemo()` in
  `OSSdrillInUIProvider.tsx` (design.md §8). No shared-state-atom alternative.

## Other locked decisions (pre-existing, not open for redesign)

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

## Slice 6 — copy sweep + docs sync (done, 2026-07-06)

- Fixed a real `react-hooks/static-components` eslint error in
  `ProviderCredentialsSection.tsx`: `ProviderTile` called `getProviderIcon()` inline and
  rendered the result as `<Icon />`, which recreates the component every render. Extracted
  a `renderProviderIcon()` helper (returns a `ReactNode`, not a component — the same
  pattern already used in `PromptSchemaControl.tsx` / `ToolSelectorPopover.tsx` /
  `ToolItemControl.tsx`) so the icon lookup happens outside JSX-component position.
- Copy sweep found the toggle labels, key-form copy, and self-managed card copy in
  `ProviderCredentialsSection.tsx` / `ProviderKeyField.tsx` already matched design.md §7
  (slice 4 applied them correctly). Two real leftovers fixed:
  - `SectionDrawer.tsx`'s unsaved-changes modal still had the pre-design copy — title
    "Unsaved changes" → "You have unsaved changes"; body "You have unsaved changes in
    this section." → "Save your changes to this agent draft, or discard them?" (design.md
    §7 modal copy row). The three button labels already matched.
  - `useModelHarness.tsx` had one stale "Agenta-managed" comment (on the named-connection
    options) reworded to "the 'Use API key' mode".
  - `sdks/python/agenta/sdk/agents/capabilities.py`: broadened the `PI_SUBSCRIPTION_MODELS`
    comment block, which parenthetically equated `self_managed` with "the subscription
    OAuth" for `openai-codex`, to state `self_managed` is broader (any way a harness signs
    itself in without an Agenta-stored key, including env vars) and that this provider's
    on-ramp happens to be OAuth. Docstrings/prose only; no keys, values, or logic changed.
    `ruff format` + `ruff check --fix` clean.
- Docs sync: see the "Docs touched / deferred" section below.
- Verification for this slice: `npx eslint` clean on the touched TS files, `npx prettier
  --check` clean, `pnpm --filter @agenta/entity-ui run types:check` clean, `npx vitest run`
  in `agenta-entity-ui` — 133/133 passing (no test changes needed; no helper logic
  changed).

## Docs touched / deferred (slice 6)

Searched `docs/docs/` (the public Docusaurus site), `docs/design/agent-workflows/documentation/`,
and `docs/design/agent-workflows/interfaces/` (the interface inventory) for pages describing the
drawer's connection-mode UI location, "Agenta-managed"/"Self-managed" toggle wording, or
subscription-only self-managed phrasing.

- **Touched**: `docs/design/agent-workflows/documentation/agent-configuration.md` (the
  `AgentConfigControl` "Layer 1" walkthrough, `model` bullet). It described an **Authentication**
  toggle nested "below the picker" with *Agenta-managed* vs *Self-managed* wording and a
  subscription-only self-managed description. Rewrote that bullet only: the connection mode now
  lives in its own **Provider credentials** section (not nested under the model picker), toggle
  labels are *Use API key* / *Use subscription*, and the self-managed description covers a
  subscription or any credentials the harness reads from its own environment (env vars), not
  subscription alone. The `ModelRef`/`model_ref.connection` wire-shape sentences were left
  unchanged (the data contract didn't change, only the UI).
- **Not stale, left as-is**:
  `docs/design/agent-workflows/interfaces/in-service/model-connection-resolution.md` and
  `docs/design/agent-workflows/interfaces/public-edge/agent-config-schema.md` document the
  `ModelRef`/`Connection` data contract (`mode: "agenta" | "self_managed"`), which this project
  did not change — only the UI's structure and copy moved. `docs/docs/` (the public site) has no
  page documenting this drawer's auth UI at all, so nothing there needed a fix.
- **Deferred (not fixed, historical record, out of scope for this slice)**:
  `docs/design/agent-workflows/projects/agent-model-picker/status.md` (lines ~30-46) and
  `docs/design/agent-workflows/projects/provider-model-auth/explainer.md` (line ~77) still use
  "Agenta-managed"/old "Provider key" wording. Both are project status/explainer docs recording a
  point-in-time decision history, not living documentation of current behavior, so they were left
  untouched rather than rewritten as if the redesign had been true all along. If a future reader
  finds these confusing, add a one-line "superseded by connect-model-drawer" pointer at the top of
  each rather than rewriting the historical narrative.

## Next steps

1. Full plan verification on the dev stack (`144.76.237.122:8280`), light and dark, per
   plan.md's 9-point verification plan (rail styling, drawer happy path, custom-provider
   inline, subscription mode + cloud gating, gating matrix, unsaved guard, seams,
   tabs-layout regression, package checks).
2. Review PR #5096 and address feedback.

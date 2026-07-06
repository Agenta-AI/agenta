# Plan: implementation slices and verification

Slices are sized for one Sonnet subagent each, in dependency order. Every slice ends
with `pnpm lint-fix` in `web/`, a package build check
(`pnpm turbo run build --filter=@agenta/entity-ui` when packages changed), and a visual
pass on the dev stack in light AND dark mode. No slice reverts the uncommitted in-flight
changes already in these files (see context.md).

## Slice 1 — SectionRail selection restyle (small, independent)

Decisions implemented: D2 (global restyle, all five consumers).

Goal: fix the confirmed root cause of "selection is unreadable" — the active row uses
`var(--ag-colorPrimaryBg)`, a token the theme generator never emits, so it renders
transparent. Replace it with the filled-pill recipe the owner picked, in the one shared
component all five consumers render through.

Files/symbols: `web/packages/agenta-entity-ui/src/drawers/shared/SectionRail.tsx`, the
active-row class string at line ~72 (`!bg-[var(--ag-colorPrimaryBg)] !font-medium
!text-[var(--ag-colorPrimary)]` → `!bg-[var(--ag-colorFillSecondary)] !font-semibold
!text-[var(--ag-colorText)]`).

- Keep inactive/hover styles and `rounded-md` unchanged.
- Do NOT introduce `--ag-colorPrimaryBg` or touch `palette.ts`; the chosen tokens exist.
- Verify all five consumers (research.md §4 table) in light and dark: harness list in
  the Model & harness drawer, Model/Provider-key tabs (until slice 4 removes them),
  Advanced auth rail (until slice 5 removes it), workflow-reference selector
  (`WorkflowReferenceSelector.tsx`), trigger run-version field (`RunVersionField.tsx`),
  commit modal (`EntityCommitContent.tsx`), agent-home templates gallery
  (`web/oss/.../TemplatesGallery/index.tsx`, imports `SectionRail` from
  `@agenta/entity-ui`).

Acceptance check: selected rows read as a filled pill in light mode; dark mode unchanged
in feel; no other SectionRail behavior regresses.

Dependencies: none. Touches only `SectionRail.tsx`; safe to run in parallel with slices
2 and 3.

## Slice 2 — Unsaved-changes guard (small, independent)

Decisions implemented: locked decision "unsaved-changes confirm on scrim/X close when
dirty; footer Cancel stays immediate" (context.md, item 4; design.md §5). Not one of
D1-D6 — this was never open for redesign.

Goal: today `SectionDrawer`'s `onClose` (antd mask click, header X, Escape) calls
`onCancel` directly, silently discarding the draft. Add a `dirty` prop so a dirty close
opens a confirm modal instead, while the footer Cancel button keeps discarding
immediately (unchanged, out of scope of this guard).

Files/symbols: `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/SectionDrawer.tsx`
(currently `onClose={onCancel}` at line ~43, `closeOnLayoutClick={false}` already set —
the mask and the header X are the only two leak paths); `AgentTemplateControl.tsx`
(already computes `sectionDirty`, lines ~239-243; pass it as `dirty={sectionDirty}` to
both `SectionDrawer` instances at lines ~866 and ~878).

- Add the `dirty` prop and the confirm modal per design.md §5 (`EnhancedModal` from
  `@agenta/ui` — never raw antd `Modal`; buttons "Save changes" (primary) / "Discard" /
  "Keep editing").
- Watch the mounted-while-animating pattern: the drawer stays mounted during the close
  transition; make sure the modal state resets when the drawer reopens.

Acceptance check: with a dirty draft, scrim click and header X show the modal; "Keep
editing" only closes the modal; "Discard" calls `onCancel`; "Save changes" calls
`onSave`; a clean draft still closes silently; the footer Cancel button still discards
immediately without the modal.

Dependencies: none functionally, but it touches `AgentTemplateControl.tsx`, the same
file slice 5 touches ("only if summaries shift"). Safe to run in parallel with slices 1
and 3; do NOT run concurrently with slice 5 — sequence them (this slice first, since it
has no dependency on slice 4).

## Slice 3 — Extract CustomProviderForm (medium, independent)

Decisions implemented: D5 (package home `@agenta/entity-ui/secretProvider/`), and the
locked decision that the custom-provider form logic is extracted into a component
shared with the old drawer (context.md, item 2).

Goal: today the custom-provider form lives entirely inside
`ConfigureProviderDrawerContent.tsx` in `web/oss`, which `@agenta/entity-ui` cannot
import (package layering). Extract the form verbatim into the package so slice 4's
inline pane and the existing model-registry drawer both render the same component, with
no behavior change to the existing surface.

Files/symbols: new `web/packages/agenta-entity-ui/src/secretProvider/CustomProviderForm.tsx`
(props: `initialValue?: LlmProvider | null`, `layout?: "drawer" | "inline"`, `onSaved`,
`onCancel`, `disabled?`; design.md §4) + `ModelNameInput.tsx` (moves with the form).
Source to move from: `web/oss/src/components/ModelRegistry/Drawers/ConfigureProviderDrawer/assets/ConfigureProviderDrawerContent.tsx`
(the real form: provider-kind select, per-kind fields, either/or auth validation,
submit via `useVaultSecret.handleModifyCustomVaultSecret`). Moves required by the
layering rule:
  - `PROVIDER_FIELDS`, `PROVIDER_AUTH_REQUIREMENTS` (`.../ConfigureProviderDrawer/assets/constants.ts`)
    → `@agenta/entities/secret/core`.
  - `isSlugInputValid` (`web/oss/src/lib/helpers/utils.ts` line ~47) → `@agenta/shared/utils`,
    with a re-export shim left at the old import site.
  - `LabelInput` (`web/oss/src/components/ModelRegistry/assets/LabelInput/`) → `@agenta/ui`,
    or replace with the form's existing plain label+Input pattern.
- Rewire `web/oss/src/components/ModelRegistry/Drawers/ConfigureProviderDrawer/index.tsx`
  to a thin shell (`EnhancedDrawer` + footer buttons) around the extracted form.
- Do NOT touch `web/oss/src/components/ModelRegistry/Modals/ConfigureProviderModal/`
  (a sibling directory under `ModelRegistry/Modals/`, NOT nested inside
  `Drawers/ConfigureProviderDrawer/` — research.md §6 mis-locates it one level down).
  It is a separate standard-key modal and stays untouched.
- Export the form from the `@agenta/entity-ui` index.
- Respect the import hierarchy (`shared ← ui ← entities ← entity-ui`); no `web/oss`
  imports inside packages.

Acceptance check: the model-registry page's add/edit custom provider flow works exactly
as before (create, edit, either/or auth validation, JSON field validation, model list);
`ConfigureProviderModal` (standard keys) is unaffected.

Dependencies: none. New files + moves only; no overlap with slices 1 or 2. Safe to run
in parallel with them. Slice 4 needs this slice done first (it embeds the extracted
form).

## Slice 4 — ProviderCredentialsSection (large; needs slices 1 and 3)

Decisions implemented: D4 (keep named-connection select, moved into "Use API key"
pane), D6 (cloud gating via `DrillInUIContext.deployment`), plus the locked toggle
labels/copy and "key saves stay immediate" decisions (context.md, item 2).

Goal: build the new two-pane "Provider credentials" section — a segmented "Use API
key" / "Use subscription" toggle, a provider rail + key form + named-connection select
on the API-key side, and a Self-managed info card on the subscription side, gated by
the harness's allowed connection modes and (new) a cloud-deployment flag.

Files/symbols: new
`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ProviderCredentialsSection.tsx`
(props per design.md §3.1: `mode`, `connectionSlug`, `onModeChange`,
`onConnectionSlugChange`, `selectedProviderFamily`, `modeOptions`, `isCloud`,
`disabled?`); `ProviderKeyField.tsx` (evolves into the right-pane form, or is
superseded by it — same immediate-save semantics via
`useVaultSecret.handleModifyVaultSecret`); `useModelHarness.tsx` (extract
`selectedProviderFamily` from the existing `providerVaultEntry` computation at lines
~188-202 — the same `providerForModel(capabilities, harnessValue, modelId) ??
connection.provider` expression — and pass it down; wire the new section into
`writeModel({mode})` / `writeModel({slug})`, reusing the mode auto-reset effect at
lines ~292-296 and `connectionOptions` at lines ~299-302 unchanged);
`web/packages/agenta-ui/src/drill-in/context/DrillInUIContext.tsx` (add
`deployment?: {isCloud, selfHostingGuideUrl?}` next to the existing
`llmProviderConfig` field at line ~305); `web/oss/src/components/DrillInView/OSSdrillInUIProvider.tsx`
(wire `deployment.isCloud` from `isDemo()`, `web/oss/src/lib/helpers/utils.ts` line ~22).

- Build the section per design.md §3: header + `Segmented` toggle (antd, theme-aware —
  do not hand-roll a navy fill; dark mode's primary flips to yellow), two-pane API-key
  card (provider rail from `standardSecretsAtom` + `customSecretsAtom`, icons via
  `getProviderIcon`/`LLMIconMap` from `@agenta/ui`'s `SelectLLMProvider/utils.ts` and
  `LLMIcons`), key form, named connection select, inline custom form (renders the
  slice-3 `CustomProviderForm` with `layout="inline"`), self-managed info card, gating
  matrix (design.md §8 table).
- Key saves stay immediate through `useVaultSecret`; confirm `providerKeySetupDoneAtom`
  still gets set on a successful save (it flows through `handleModifyVaultSecret`,
  which the form must keep calling).
- Map every color to the tokens in research.md §9.

Acceptance check: in the drawer, "Use API key" shows rail + form; keys save
immediately and the "Connect key" badge clears; "+ Custom provider" swaps the pane
inline with no drawer; "Use subscription" shows the Self-managed card; gating follows
the design.md §8 matrix (no `self_managed` in `modeOptions` → toggle hidden; cloud +
`self_managed` allowed → toggle visible but disabled with tooltip).

Dependencies: needs slice 1 (reuses the SectionRail selection recipe for the provider
rail) and slice 3 (embeds `CustomProviderForm`). Touches `useModelHarness.tsx`, which
slice 5 also touches — do NOT run slice 5 concurrently with this slice.

## Slice 5 — Drawer restructure + Advanced removal (medium; needs slice 4)

Decisions implemented: D1 (section order Harness → Model → Provider credentials), plus
the locked decision "mode selection moves out of Advanced completely" (context.md,
item 2).

Goal: reorder the Model & harness drawer into three independent sections (Harness,
Model, Provider credentials — replacing the old two-tab "Model & credentials" combo
section built in slice 4), and delete the Advanced drawer's entire Authentication
group now that the credentials section owns the mode UI.

Files/symbols: `useModelHarness.tsx` (mostly) — delete `modelTab` state and its
auto-forcing effect (currently lines ~217-220); split `modelControl` into its own
`ConfigAccordionSection` ("Model"); render the slice-4 `ProviderCredentialsSection` as
the third section, passing it `selectedProviderFamily` (design.md §3.3); delete
`authControls`, `authDescription`, `authConnectionField` (currently lines ~652-701) and
the "Authentication" `ConfigAccordionSection` block inside `advancedControls`
(currently lines ~725-745); `hasAdvanced` (currently lines ~355-363) drops the
`props.llm` condition; `advancedSummary` (currently lines ~704-710) drops the mode
segment, keeps the sandbox segment. KEEP the mode auto-reset effect (lines ~292-296)
and `connectionOptions`/`namedConnectionOptions` (lines ~299-302) — they now feed the
credentials section instead of Advanced. `AgentTemplateControl.tsx` only if the section
summaries it reads change shape.
Note: exact line numbers drift by a few lines run-to-run in this file (GitButler's
background WIP autocommit touches it during editing sessions) — search by symbol name,
treat cited numbers as approximate.

- Update the tabs-layout `modelHarnessInline` / `advancedInline` bodies to match (they
  render the same shared controls, so they inherit the restructure automatically).
- Do not touch the creation-prefs capture in `AgentTemplateControl.saveSection` (reads
  `connectionFromConfig(draftConfig.llm)`); the mode still lives at
  `config.llm.connection.mode`, so it needs no change.

Acceptance check: Advanced shows no mode UI anywhere (drawer, inline tab); the
model-harness drawer shows Harness → Model → Provider credentials in order; saving the
drawer still records creation prefs (verify `agentCreationPrefsAtom` in localStorage
after a save that changes the mode).

Dependencies: needs slice 4 (renders `ProviderCredentialsSection`). Touches
`useModelHarness.tsx`, which slice 4 also touches — run these two sequentially, not in
parallel. Also touches `AgentTemplateControl.tsx` if summaries shift, the same file
slice 2 touches — do not run concurrently with slice 2 either.

## Slice 6 — Copy sweep + docs sync (small; needs slices 4 AND 5)

Decisions implemented: the locked "copy alignment" decision (context.md, item 5) — the
self-managed framing must replace subscription-only wording everywhere it appears.

Goal: apply the final copy strings and sweep stale "subscription"-only wording to the
"self-managed" framing (harness signs itself in; a subscription is one case; requires
self-hosting) everywhere it appears, not just in the new component.

Files/symbols: the new `ProviderCredentialsSection.tsx` (apply the design.md §7 copy
table: toggle labels, key form labels/footnote, self-managed card copy, unsaved-modal
copy); the harness capability descriptions the drawer renders; `sdks/python/agenta/sdk/agents/capabilities.py`
docstrings if they say "subscription" where they mean self-managed (docs-only, no wire
change); any docs pages this project touches (run the `keep-docs-in-sync` skill).

- Depends on BOTH slice 4 (introduces the new copy strings) and slice 5 (deletes the
  old Advanced `authDescription`/`authControls` wording this project would otherwise
  need to sweep and then immediately discard).
- Writing style: no em dashes, active voice, short sentences.

Acceptance check: no drawer surface uses "Agenta-managed"/"subscription-only" wording
where "self-managed" is meant; `capabilities.py` docstrings and touched docs pages match;
`keep-docs-in-sync` reports no drift.

Dependencies: needs slices 4 and 5 both done. Last slice; nothing depends on it.

## Verification plan (after slice 5, again after slice 6)

Environment: dev stack `http://144.76.237.122:8280` (EE dev). Use the
debug-local-deployment skill for login and logs. Run every check in light AND dark.

1. **Rail styling**: open each SectionRail consumer; selected rows show the filled pill;
   hover states work; disabled rails look right.
2. **Drawer flow (happy path)**: new agent → open Model & harness → pick harness →
   pick model → provider auto-highlights → enter API key → Save (immediate) → key
   configured state → footer Save → section summary updates → chat gate clears.
3. **Custom provider inline**: + Custom provider → Bedrock form inline (no drawer) →
   save → entry appears in the rail and its models in the model picker. Old surface:
   model-registry page add/edit still works.
4. **Subscription mode**: harness with `self_managed` in `connection_modes` → toggle
   appears → switch → card shows Self-managed copy → footer Save → Advanced shows no
   mode UI → reopen drawer, mode persisted. On a cloud-flagged deployment the option is
   disabled with the tooltip.
5. **Gating**: harness without `self_managed` → no toggle. Switching to such a harness
   with mode `self_managed` set → auto-reset to `agenta` still fires.
6. **Unsaved guard**: dirty draft + scrim click → modal; Keep editing keeps the drawer;
   Discard drops the draft; Save changes applies it. Clean draft closes silently.
   Footer Cancel discards without the modal. Advanced drawer gets the same guard.
7. **Seams**: creation prefs (`agentCreationPrefsAtom` in localStorage) capture
   harness/model/provider/connectionMode on save; `providerKeySetupDoneAtom` set after
   a key save; the chat banner's remote-open still lands on the drawer.
8. **Regression**: tabs layout (`agentTemplateLayoutAtom`) renders the inline bodies
   without drawer chrome; the no-capabilities fallback branch (older agents) still
   renders the flat harness select + model picker + key field.
9. **Package checks**: `pnpm turbo run build --filter=@agenta/entity-ui --filter=@agenta/entities --filter=@agenta/ui --filter=@agenta/shared`,
   `pnpm lint-fix`, and the package unit tests
   (`connectionUtils` tests must still pass; add cases only if helpers changed).

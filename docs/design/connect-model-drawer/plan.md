# Plan: implementation slices and verification

Slices are sized for one Sonnet subagent each, in dependency order. Every slice ends
with `pnpm lint-fix` in `web/`, a package build check
(`pnpm turbo run build --filter=@agenta/entity-ui` when packages changed), and a visual
pass on the dev stack in light AND dark mode. No slice reverts the uncommitted in-flight
changes already in these files (see context.md).

## Slice 1 — SectionRail selection restyle (small, independent)

Files: `web/packages/agenta-entity-ui/src/drawers/shared/SectionRail.tsx`.

- Swap the active-row classes per design.md §2 (filled `--ag-colorFillSecondary` pill,
  `font-semibold`, `--ag-colorText`). Keep inactive/hover styles and `rounded-md`.
- Do NOT introduce `--ag-colorPrimaryBg` or touch `palette.ts`; the chosen tokens exist.
- Verify all five consumers (research.md §4 table) in light and dark: harness list in
  the Model & harness drawer, Model/Provider-key tabs (until slice 4 removes them),
  Advanced auth rail (until slice 5 removes it), workflow-reference selector, trigger
  run-version field, commit modal, agent-home templates gallery.

Exit: selected rows read as a filled pill in light mode; dark mode unchanged in feel.

## Slice 2 — Unsaved-changes guard (small, independent)

Files: `SectionDrawer.tsx`, `AgentTemplateControl.tsx` (same folder tree).

- Add the `dirty` prop and the confirm modal per design.md §5 (EnhancedModal; Save
  changes / Discard / Keep editing; footer Cancel stays an immediate discard).
- Pass `dirty={sectionDirty}` from `AgentTemplateControl` to both `SectionDrawer`s.
- Watch the mounted-while-animating pattern: the drawer stays mounted during the close
  transition; make sure the modal state resets when the drawer reopens.

Exit: with a dirty draft, scrim click and X show the modal; all three buttons behave;
a clean draft closes silently as before.

## Slice 3 — Extract CustomProviderForm (medium, independent)

Files: new `web/packages/agenta-entity-ui/src/secretProvider/CustomProviderForm.tsx`
(+ `ModelNameInput`); moves listed in design.md §4 (constants →
`@agenta/entities/secret/core`, `isSlugInputValid` → `@agenta/shared/utils` with a
re-export shim, `LabelInput` → `@agenta/ui` or replaced); rewire
`web/oss/src/components/ModelRegistry/Drawers/ConfigureProviderDrawer/` to render the
extracted form.

- Move logic verbatim; no behavior change. The old drawer keeps its 480px shell,
  title, and footer buttons.
- Export the form from the `@agenta/entity-ui` index.
- Respect the import hierarchy (`shared ← ui ← entities ← entity-ui`); no `web/oss`
  imports inside packages.

Exit: the model-registry page's add/edit custom provider flow works exactly as before
(create, edit, either/or auth validation, JSON field validation, model list).

## Slice 4 — ProviderCredentialsSection (large; needs slices 1 and 3)

Files: new `.../agentTemplate/ProviderCredentialsSection.tsx`; `ProviderKeyField.tsx`
(evolves into the right-pane form or gets replaced by it); `useModelHarness.tsx`
(render the new section); `DrillInUIContext.tsx` + `OSSdrillInUIProvider.tsx` (the
`deployment.isCloud` seam, design.md §8).

- Build the section per design.md §3: header + segmented toggle, two-pane API-key card
  (provider rail from `standardSecretsAtom` + `customSecretsAtom`, key form, named
  connection select, inline custom form), self-managed info card, gating matrix.
- Key saves stay immediate through `useVaultSecret`; confirm `providerKeySetupDoneAtom`
  still gets set on a successful save.
- Wire mode/slug through `writeModel` so the draft, the auto-reset effect, and the
  creation-prefs capture keep working.
- Map every color to the tokens in research.md §9; use antd `Segmented` for the toggle.

Exit: in the drawer, "Use API key" shows rail + form; keys save immediately and the
"Connect key" badge clears; "+ Custom provider" swaps the pane inline with no drawer;
"Use subscription" shows the Self-managed card; gating follows the matrix.

## Slice 5 — Drawer restructure + Advanced removal (medium; needs slice 4)

Files: `useModelHarness.tsx` (mostly), `AgentTemplateControl.tsx` (only if summaries
shift).

- Reorder the drawer body to Harness → Model → Provider credentials (design.md §1).
  Split the old "Model & credentials" tabs: Model becomes its own section; delete
  `modelTab` and its auto-forcing effect.
- Auto-highlight the picked model's provider in the credentials rail
  (`selectedProviderFamily`, design.md §3.3).
- Remove Authentication from Advanced (design.md §6): `authControls` and its section
  gone, `hasAdvanced` drops `props.llm`, `advancedSummary` drops the mode. Keep the
  auto-reset effect and `connectionOptions`.
- Update the tabs-layout `modelHarnessInline` / `advancedInline` bodies to match (they
  render the same shared controls).

Exit: Advanced shows no mode UI anywhere (drawer, inline tab); the model-harness drawer
shows the three sections in order; saving the drawer still records creation prefs
(verify `agentCreationPrefsAtom` in localStorage after a save that changes the mode).

## Slice 6 — Copy sweep + docs sync (small; needs slice 4)

- Apply the copy table (design.md §7) everywhere the section renders.
- Sweep "subscription"-only wording where self-managed is meant: the drawer, the
  harness capability descriptions it renders, `capabilities.py` docstrings (docs-only),
  and any docs pages touched. Run the keep-docs-in-sync skill.
- Writing style: no em dashes, active voice, short sentences.

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

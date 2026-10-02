# Presentational components — redundancy & architecture refactor

Tracked checklist from the 2026-07-26 audit of the `@agenta/ui` **presentational** components
(the ~57 shown under `@agenta/ui/Presentational/*` in Storybook). Sourced from a 6-cluster
read-only analysis (Tags · Buttons · Entity/Labels · Layout · Inputs/Forms · Attachments/Media).
Companion to [enhanced-wrappers-audit.md](enhanced-wrappers-audit.md); status tracker is
[STATUS.md](STATUS.md).

**Paths** are relative to `web/packages/agenta-ui/src/`. **Sev** = HIGH / MED / LOW.
Check items off as executed; link a migration guide under [migrations/](migrations/) when one is written.

---

## The through-line (read first)

Most items below are one story: the primitives `Badge`, `Field`, and `Avatar`/`Skeleton` were
built **specifically to absorb these wrappers** — their own docstrings name the components they
replace (`components/ui/badge.tsx:10`, `components/ui/field.tsx:12-14`, `components/ui/avatar.tsx:15`) —
but the migration stopped at "primitive built" and never rewired the wrappers. So ~15 "migrated"
presentational components **still import antd**, and several hand-roll what the primitive already does.
**Finishing Badge / Field / Avatar-Skeleton is the highest-value, lowest-risk work** — it removes most
of the antd imports *and* most of the redundancy at once.

Recommended sequence: **R1 (Tags→AgTag/Badge)** → **R3 (Field)** → **R2 (EntityLabel)** → **R4/R5** →
architecture cleanups (§2). Do NOT start execution until this checklist is reviewed.

---

## 1. Redundancy — consolidations

### R1 — Tag facades → finish Badge routing + fix bugs · HIGH · **PARTIALLY DONE (2026-07-27)**
5 of 5 reduce to `<Badge variant>{icon?}{label}</Badge>`, differing **only** in a `value→{tone,label}` record.
- [x] **EnvironmentTag → Badge** — removed the last raw antd `Tag` in the cluster (`status/index.tsx`); renders `<Badge>` with the `--ag-env-*` style override (Badge geometry == antd Tag). Verified dark. *(Also: `clsx`→`cn` in StatusTag.)*
- [x] **VersionBadge `chip` dark-mode bug fixed** — `text-gray-700` → `text-foreground` (`version/VersionBadge.tsx`), surgical (zero geometry change, safe across the ~10 call-sites). Verified dark (chip text now readable). **Deferred:** full `chip`→`<Badge>` geometry swap — 10 call-sites, needs its own VRT pass.
- [x] **TypeChip cleanup** — removed the unreachable `notificationBadge`/`badgeTooltip` machinery + the import-time `document.head` `<style>` injection (0 consumers, confirmed by grep); wrapped in `memo` (`type-chip/TypeChip.tsx`). **Deferred:** the color/geometry migration off raw `var(--ant-*)` → Badge (22 *domain* tones; polluting the generic Badge with them is the wrong trade — needs a dedicated pass + VRT).
**Direction change (per Arda 2026-07-27): reduce the tag COUNT, not add an `AgTag` base.** The cost is discoverability — a dev/agent faces 8 near-synonymous tag exports. So: **collapse the status/state tags into ONE `Tag`** (generic `tone`/`label` + domain presets), keeping only `SourceIndicator` (composite) and `TypeChip` (distinct). Target: **8 tag components → 3**.
- [x] **`Tag` primitive built** — `components/presentational/tag/index.tsx`, exported `Tag`/`TagProps` from `@agenta/ui/components/presentational`. Generic + all 5 presets: `<Tag status/mapping/env/draft/sync>` (+ `tone`/`label`/`icon`/`size`/`showIcon`/`dismissible`). Renders `Badge`; `memo`'d; canonical `small` geometry.
- [x] **Proof: StatusTag → `<Tag status>` end-to-end.** Only real consumer was `entity-icon-label` (the other "10 uses" were unrelated local `StatusTag`/`StatusTags` defs — always grep per-component to avoid false matches). Migrated it, **deleted `StatusTag`** + its barrel export, updated the 2 stories. tsc+eslint clean; `<Tag status>` verified **pixel-identical** to the antd reference (light).
- [x] **Swept the remaining 4 presets (2026-07-27).** `MappingStatusTag`→`<Tag mapping>`, `EnvironmentTag`→`<Tag env>`, `DraftTag`→`<Tag draft>`, `SyncStateTag`→`<Tag sync dismissible>` (dropped its antd `Tooltip`; dismiss hint is now a native `title`). Migrated 9 real call-sites across oss + entity-ui (`Tag as AgentaTag` alias where a file already had antd `Tag`), **deleted all 4 components** + barrel exports, moved `SyncState` type ownership into `Tag`. Consolidated the 5 old tag stories into one `Tag.stories.tsx` (a story per preset). **tsc clean** (storybook + `@agenta/oss`; the 26 oss errors are pre-existing, unrelated files), **eslint 0**, and **all 5 presets pixel-verified** vs the antd reference (status/mapping/env/draft/sync). **Result: 8 tag components → 3 (`Tag` + `SourceIndicator` + `TypeChip`).**
- [ ] **Remaining tag cleanup (future):** rebuild `SourceIndicator` on `Tag` (it's a composite: icon + tag + "(modified)"); finish `TypeChip` (§2A/E — it stays distinct but should stop re-implementing Badge). Neither blocks the count reduction.

**Not done (dead but harmless / needs tracing):** `getStatusColor`/`getStatusLabel` removal (barrel-exported + name-collides with `@agenta/shared`), `SourceIndicator.color` dead prop.

### R2 — Entity labels · **TARGETED VERSION DONE (2026-07-27)** — NOT a mega-component
**Reassessed (Arda-approved): the "fold all 4 into one `<EntityLabel>`" scope was an over-reach** — EntityNameWithVersion (inline chip) / EntityListItemLabel (dropdown row) / EntityIconLabel (boxed-icon header) / RevisionLabel (revision detail) serve genuinely different contexts; one component = 12-prop soup (the AgTag lesson). Did the *real* wins instead:
- [x] **Deleted `AppListItemLabel` + `VariantListItemLabel`** — 0 consumers (dead). Count −2 + barrel exports removed + story updated to use `<EntityListItemLabel subtitle>`.
- [x] **`EntityIconLabel` dropped raw antd `Typography.Text`** → `<span>` (`font-semibold`/`text-colorTextSecondary`). Now antd-free (§A).
- [x] **`RevisionLabel` composes `AuthorLabel`** instead of hand-rolling `by {author}` (§B). Verified renders identically.
- [x] **Normalized `version` type** (EntityIconLabel `number` → `number | string`, matches VersionBadge + siblings).
- [ ] **Intentionally NOT done (over-identified "duplication"):** the 3 "Name vN" formatters are *distinct renderings* (plain string / muted-text / chip), not dupes; `SubtitleSlot` extraction (the spacer variants differ per site); `RevisionLabel → FormattedDate` (FormattedDate carries copy-on-click chrome that's wrong for an inline dropdown date). Forcing these would add complexity, not remove it. tsc clean (oss 26=baseline, 0 new), eslint 0, pixel-verified.

**Superseded R2 items (the mega-component plan — NOT pursuing, over-abstraction):**
~70% overlap: all render "icon + name + version chip + subtitle" in a flex row — but the contexts differ enough that one component becomes 12-prop soup (the AgTag lesson).
- [~] `<EntityLabel …>` mega-component — superseded by the targeted wins above.
- [~] `reserveSubtitleSpace` `&nbsp;` spacer → `<SubtitleSlot>` — declined: the spacer variants genuinely differ per site.
- [x] `RevisionLabel` composes `AuthorLabel` — **DONE** (see above).
- [~] `RevisionLabel` compose `FormattedDate` — declined: `FormattedDate` carries copy-on-click chrome wrong for an inline dropdown date.
- [~] Collapse the 3 "Name vN" formatters — declined: distinct renderings (plain string / muted text / chip), not dupes.
- [x] Normalize `version` type to `number | string` — **DONE** (see above).

### R3 — Label+control wrappers → the `Field` primitive · HIGH · **MOSTLY DONE (2026-07-27)**
`field.tsx:12-14` says it replaces `LabeledField`, `LabelInput`, and hand-rolled form rows.
- [x] **LabeledField DELETED → `<Field>`.** All 9 consumers (in `agenta-entity-ui/DrillInView/SchemaControls`) migrated (`description`→`tooltip`, gated by `withTooltip`; `label`/`direction`/`gap`/`className` unchanged) + barrel exports removed + Field.stories reworked (LabeledField reference inlined) + its dedicated story deleted. Removed the raw antd `Typography.Text`/`Tooltip`/`InfoCircleOutlined`. tsc clean (storybook + `@agenta/oss`, 0 new errors), eslint 0.
- [x] **CommitMessageInput rebuilt on `Field`** — hand-rolled label + raw antd `Typography` replaced by `<Field label>`; textarea + counter stay as the control slot. No call-site changes (internal refactor). Pixel-verified identical (label + textarea + `0/500`).
- [x] **LabelInput → `Field boxed` (2026-07-27).** Added a reusable `boxed` prop to `Field` (label + control inside a bordered container, semantic `border-border` token). Rebuilt `LabelInput` on it — kept its API + control-selection (text/password/textarea ghost controls), dropped the hand-rolled box and the `--ag-c-BDC7D1` dark-mode literal (§C fixed). LabelInput stays (a real composite, not a Field duplicate); `CustomProviderForm` unchanged. Also fixed a latent `props as AutosizeTextareaProps` cast (→ `as unknown as`). tsc/eslint clean; pixel-verified (boxed look, dark-adaptive border).

**R3 result: `Field`/label family 4 → 3 (`Field` + `LabelInput` + `CommitMessageInput`); the `Field`-vs-`LabeledField` duplication eliminated, all three now route their label/box through `Field`, all raw antd `Typography`/`Tooltip` removed.**

### R4 — Prompt uploads → shared hook (NOT a `kind`-prop component) · DONE 2026-07-27
~70% identical shell (byte-identical Dragger `className`, hidden input, remove button, drag-text).
- [x] **Reassessed → shared hook, not a merged component.** The only consumer (`agenta-playground-ui/TurnMessageAdapter.tsx`) already branches on `slot.type === "image"`, so a `kind` prop simplifies *nothing* there and just pushes a branch inside; the two callback contracts (`UploadFile` object vs `(data, filename, format)` strings) + distinct previews (thumbnail vs icon+link) + distinct URL validation (CORS `img.onload` probe vs regex) genuinely differ. Per the repo's "extract logic, don't force-merge twice-used components" rule, the win is the **shared controller**, not a union component.
- [x] **`usePromptFileUpload` hook** (`attachments/usePromptFileUpload.ts`) — owns the duplicated impure controller: MIME/size validation + `FileReader` data-URL read + error state + hidden-input wiring + a **native drop-zone** (`onDragOver/Leave/Drop`) that **replaces antd `Upload.Dragger`** (both only used it for drag-drop; click-to-open goes through the hidden input). Parameterized by `{maxSize, sizeError, isTypeAllowed, typeError, onAccepted, disabled}`. Both components are now thin shells consuming it (image keeps its `draftValue`/CORS-preview state; document keeps its `value` sync). Interaction-verified in Storybook: file states render, invalid-URL → `colorError` border+icon+text, valid URL → `colorSuccess` icon + "Preview: document" link.

### R5 — Table/list skeletons → `Skeleton` variants · MED · **DONE (closeout, subagent B)**
- [x] Merged `TableLoadingState` + `ListItemSkeleton` → **`LoadingSkeleton`** with `variant="paragraph"|"list"` (+`rows`/`count`/`showAvatar`/`avatarShape`). Both old files deleted (ListItemSkeleton had 0 consumers), the one `TableLoadingState` consumer (`EntityTable`) migrated, barrels updated. `TableEmptyState` left separate. (Both old files already used the `@agenta/ui` Skeleton primitive, not raw antd.)

### R6 — Small deletes / extractions · LOW · **DONE except the CollapseCaret non-dup**
- [x] Deleted `StepContainer` (0 consumers) — JSDoc example → plain `<div className="flex flex-col grow gap-3">`; barrel updated.
- [x] Deleted/inlined `AddButton` — 4 consumers inlined to `<Button variant="outline" className="self-start …"><Plus/>{label}</Button>`; file + barrels removed. (Note: 3 playground consumers carry a **pre-existing** `size="small"` type error — antd-style size the ui Button ignores; pervasive in those files, left as-is / out of scope.)
- [x] Deleted `CopyButtonDropdown` (0 consumers) + barrel.
- [~] `CollapseCaret` extraction — **NOT a real dup (subagent B verified, correctly declined):** in `ConfigAccordionSection` the a11y (role/aria-expanded/Enter-Space) lives on the whole header row (which also opens drawers + handles `locked`), and the caret is a pure non-interactive glyph; in `CollapsibleGroupHeader` the a11y is applied to the outer div OR the caret conditionally + supports `renderIcon`. The proposed `{expanded,onToggle,a11yLabel}` fits neither (giving the glyph its own role would nest interactives / duplicate `aria-expanded` — an a11y regression). Only shared kernel is a 1-line `expanded ? <CaretDown/> : <CaretRight/>` ternary used twice with different color tokens → the "don't extract twice-used <20-line" rule.
- [~] `SectionHeaderRow` reuse in `ConfigAccordionSection`/`MetadataHeader` — optional "consider"; not pursued (marginal).

### §A tail cleanups (closeout, direct) — genuine antd holdouts NOT in the original §A list
- [x] `section/index.tsx` — antd `Skeleton`→ui `Skeleton` primitive (kept `title={false}`, VRT-verified 4-row paragraph), `Typography.Text`→span.
- [x] `layout/index.tsx` (`NumberedStep`) — `Typography.Text`→span.
- [x] `SplitPanelLayout.tsx` — antd `Divider`→ui `Divider` primitive (`type="vertical"`; VRT-verified: renders a `separator`, `showDivider` toggles it; stale story caption fixed).

**End state: every `presentational/` component is 100% antd-free — runtime AND types** (SliderInput migrated onto the new `ui/slider` + `ui/input-number` primitives). The former type-only antd imports were also removed (see the TYPE-DECOUPLING block below): the `Enhanced*` facades + `PageLayout` + `PromptImageUpload` now use local antd-compatible types, zero antd import of any kind.

### TYPE-DECOUPLING (2026-07-27, 3 subagents) — removed the last (type-only) antd imports from the facades
Type-only imports are zero-runtime, so this is a *dependency-decoupling* pass (compile without antd), not a bundle win. Technique everywhere: define a **local antd-compatible type** structurally compatible with what call-sites already pass → **zero call-site edits**; if a consumer breaks tsc, widen the local type (never touch the consumer).
- [x] **`EnhancedButton`** — `extends AntButtonProps`/`AntTooltipProps` → local `EnhancedButtonProps` (`Omit<ButtonHTMLAttributes,"type">` + antd's Button unions) + `LocalTooltipProps`. Widened iteratively on real tsc failures: `shape:"square"`, `size:"medium"|"middle"` (antd v6 SizeType), tooltip `mouseEnterDelay`/`arrow`, `classNames`/`styles`→`unknown`. 18 call-sites unchanged.
- [x] **`EnhancedModal`** — antd `ModalProps` + `ButtonProps` → local `ModalProps`/`ModalButtonProps` (incl. responsive `width`, `closable`/`mask` object forms, `data-*` on button props). ~80 modal call-sites unchanged.
- [x] **`EnhancedDrawer`** — antd `DrawerProps` → local `DrawerProps` (numeric `size`, optional `push.distance`, widened `getContainer`). Call-sites unchanged.
- [x] **`PageLayout`** — antd `TabsProps` → local `HeaderTabsConfig`. 4 consumers unchanged.
- [x] **`PromptImageUpload`** — antd `UploadFile` → exported local `PromptUploadFile` (permissive index sig for bidirectional assignability); the ONE consumer `TurnMessageAdapter` switched to it → **now antd-free too**. Its story switched to `PromptUploadFile`.
- Gate (cache-independent): the raw `oss tsc | wc -l` count is unreliable — editing `@agenta/ui` invalidates the downstream tsbuildinfo and surfaces pre-existing errors (counts seen: 18/23/35/41 depending on cache/concurrent state). The sound gate used: **no consumer error line (oss/ee/entity-ui/playground-ui) references any changed symbol** — verified empty across all four packages. ui tsc 0; eslint clean; storybook clean (fixed the one orphaned PromptImageUpload story state type).

### Storybook story hygiene (closeout) — the deletes/renames orphaned stories; caught by `storybook tsc`
- [x] Deleted orphaned stories for deleted components: `AddButton.stories`, `CopyButtonDropdown.stories`; merged `TableLoadingState.stories`+`ListItemSkeleton.stories` → one **`LoadingSkeleton.stories`** (paragraph+list, VRT-verified).
- [x] Fixed stories referencing changed/deleted exports: `RunButton.stories` + `Button.stories` (`isCancel`/`isRunAll`/`isRerun` → `mode`, VRT-verified all 5 modes), `Button.stories` (inlined `AddButton`), `Tag.stories` (deleted `getStatusColor`/`getStatusLabel` → story-local antd map), `NumberedStep.stories` (deleted `StepContainer` → plain wrapper).
- [x] Updated 3 overview MDX docs (`PresentationalButtons`/`PresentationalFeedback`/`Presentational`) for the deletions/merges.
- Gate: `storybook tsc` back to pre-existing baseline (only the 17 phosphor module-resolution + ~11 unrelated package errors remain; **zero** in touched files).

### BEYOND PRESENTATIONAL (2026-07-28) — Editor, EntityPicker/selection, and the remaining `@agenta/ui` clusters
Per Arda: Editor is "mostly Lexical, any antd part should just be a textarea"; EntityPicker is "a cascade select mostly, nothing antd-specific you cannot migrate"; **table cluster PARKED**.
- **Editor (7 non-form files, subagent)** — MarkdownToolbar (Dropdown+MenuProps+Popover→Radix), plugins/index (Skeleton), TokenTooltipPlugin + MarkdownHoverToggleButton (Tooltip), Base64Node + LongTextNode (Popover/Typography/`message`→`utils/appMessageContext`), SharedEditorImpl (Spin). antd `Popover trigger="hover"` has no Radix equivalent → hand-rolled hover-open with antd's exact delays, using `PopoverAnchor` (not Trigger) so the span keeps its own click. **Deviation:** our `ui/popover` has no arrow part (antd's had one) — cosmetic.
- **`Editor/form/**` (5 files, subagent)** — the ONE non-mechanical piece. RECON CORRECTION: it is NOT gated by `enableFormView` (that flag gates the *drill-in toolbar* option); it's gated by Editor.tsx's own `useState<"code"|"form">` toggled by the `TOGGLE_FORM_VIEW` Lexical command, whose only dispatch site is a **commented-out button**. It is unreachable-but-PARKED and exports public API (`TOGGLE_FORM_VIEW`, `CustomRenderFn`, `customRender`) → Arda chose MIGRATE over delete. antd `Form` turned out shallow: `Form.Item` was only injecting `value`/`onChange` into leaves, and `BaseNodeProps` already carried `value` + `onChange(path,newValue)`. Now explicitly-controlled inputs (local-buffer+sync like SliderInput) on our InputNumber/Switch/Input/AutosizeTextarea + `EditableText` for key rename. `parseMaybeJsonDeep` preserved on the direct path.
- **EntityPicker/selection (subagent)** — RECON FINDING: `variant="cascader"` and `variant="tree-select"` had **0 app call-sites** and were the only users of antd `Cascader`/`TreeSelect` → **deleted** `CascaderVariant`, `TreeSelectVariant` (+ its module.css), narrowing the public `variant` union. **My recon was WRONG on `TreeSelectPopupContent`** — it has 3 live Playground call-sites via the public barrel; the agent independently verified and correctly SPARED it. Live variants migrated (BreadcrumbVariant, ListPopoverVariant, PopoverCascaderVariant, EntitySelectorModal) + all 7 `agenta-ui/components/selection` files. Notables: ListPopover hover-open hand-rolled (`PopoverAnchor` so row-click still selects); EntitySelectorModal `forceMount`s visited tabs to keep antd's keep-pane-mounted semantics; **`LoadAllButton` lost its circular progress** (our Progress was line-only) → closed by the Progress circle variant below.
- **"Ready-now" group (17 files, direct)** — `CopyTooltip` (+ local `CopyTooltipOverlayProps` replacing antd `TooltipProps`; placement→side/align map), `ChatMessage` (MarkdownToggleButton/ChatMessageList Tooltips, AttachmentButton Dropdown), `CellRenderers` (Typography→span ×2, EvaluatorMetricBar ×3 Tooltips, MetricCellContent Tag→Badge + ×4 Tooltips, CellContentPopover hover-Popover with antd's 0.5s/0.2s delays), `drill-in` (DrillInControls/DrillInRootToolbar Tooltips, ViewModeDropdown/DrillInBreadcrumb Dropdowns, BooleanField→Switch, NumberField→our InputNumber, JsonArrayField→ui/Select).
  - **⚠️ FLAG — categorical palette narrowed:** `TAG_COLORS` was 8 antd presets (`green,blue,purple,orange,cyan,magenta,gold,lime`) but the design system only defines 4 tag colours (`--ag-tag-{green,blue,orange,red}`). Narrowed to those 4, so metric categories now cycle every 4 instead of 8 (more colour collisions with >4 categories). Fix = add the missing hues to `palette.ts` + regenerate — a design-system decision, deliberately not taken unilaterally.
- **`SelectLLMProvider` mis-scoped as ready-now** — it's a REBUILD not a swap (`popupRender` custom panel, `optionLabelProp`, `Select.Option`/`OptGroup`, `.ant-select-item-option-content`/`.ant-select-selection-item` internal-class overrides, `extends Omit<SelectProps,"options">` public API w/ 4 consumers) → delegated to its own agent targeting `ui/combobox`.

### FINAL WAVE (2026-07-28) — Arda's 5 directives; `@agenta/ui` is now antd-free except the parked table
1. **Progress circle glyphs → antd PARITY** (direct). antd uses DIFFERENT glyphs per variant: line = `CheckCircleFilled`/`CloseCircleFilled`, circle = bare `CheckOutlined`/`CloseOutlined`. `info` is now variant-aware; the earlier "keep them consistent with each other" divergence is removed.
2. **Categorical palette 4 → 8 hues** (subagent). Added `purple/cyan/magenta/gold` to `palette.ts` `presetTag` via the SSoT flow (bg = antd color-1, text = color-7, drawn from `@ant-design/colors` after verifying the existing four reproduce byte-for-byte). Contrast targeted the FAMILY'S OWN FLOOR (3.34:1 — the existing four span 3.34–7.09, so forcing AA 4.5 would make new hues visibly heavier). **gold uses color-8** (color-7 on gold-1 = 2.76:1, below even 3:1) — the one intentional non-pixel-identical row. `lime` dropped (≈1.15:1 hue separation from green — a collision); `red` kept as the 8th. Indices 0–6 preserve the original antd order so stable categories keep their colour. **INVARIANT HELD: `git diff antd-overrides.generated.ts` EMPTY** (structurally: `presetTag` isn't referenced by the antd-overrides emitter). `Badge` +4 variants, `TAG_COLORS` back to 8.
3. **Form validation border restored** (subagent). Matched the EXISTING convention (`invalid?: boolean` → `aria-invalid`, from `Combobox`); `selectTriggerVariants` already ships the error skin, so no new styling — and Tailwind's `ariaVariants` register AFTER `pseudoClassVariants`, so `aria-[invalid=true]:border-error` beats `focus:border-primary` (verified, not assumed). Call-site uses `Form.Item.useStatus()` — the SAME `FormItemInputContext` antd's own Select consumed, so error timing is identical by construction. **VRT-verified.** NOTE: `CustomProviderForm` lives in `agenta-entity-ui`, not oss/ee.
4. **Cascader rebuilt** (subagent). Arda: cascader will matter as selects move to entity-ui. Two live antd `Cascader` call-sites existed — `TestsetSelector` (entity, lazy `loadData` via `cascaderState.ts` atoms) and EE `AuditLogFilters` (static filter). Built generic **`ui/cascader`** (multi-column popover on `selectTriggerVariants`; `loadData` with double-fire guards, `changeOnSelect`, `expandTrigger="hover"`, `displayRender`, search, keyboard via `aria-activedescendant`), restored EntityPicker **`variant="cascader"`** + the union member + barrels. `TestsetSelector` uses the PRIMITIVE directly (its bespoke Jotai selection flow doesn't fit the adapter-driven EntityPicker contract) — documented, not forced.
5. **`appMessageContext` de-antd'd** (subagent; died mid-run writing its story — implementation was complete, orchestrator verified). Replaced antd `App` with our own engine: `utils/appMessage/{store,types,AppMessageRenderer}` + new `ui/toast` + `ui/notification` primitives. Because the module is a FACADE exporting singletons, the engine swapped with **ZERO call-site edits** across ~450 `message.*` / 13 `modal.*` / 14 `notification.*` — verified by a cache-independent consumer grep returning empty in oss/ee/entity-ui/playground-ui. antd types replaced by local structurally-compatible ones (same precedent as the `Enhanced*` facades). `modal.confirm` builds on our Dialog; async `onOk` keeps the modal locked and a rejection keeps it open, matching antd.

**Orchestrator-owned barrel:** both new-primitive agents were told NOT to touch `components/ui/index.ts`; I added `Cascader`/`Toast`/`Notification` exports and collapsed the cascader agent's temporary `./ui/cascader` package.json subpath back onto `@agenta/ui/ui` (3 imports).

**Remaining antd in `@agenta/ui`:** `InfiniteVirtualTable/**` (13 files — **PARKED per Arda**; antd `Table`/`Tree`/`Grid`/`Pagination`; `FiltersPopoverTrigger` also leaks antd `PopoverProps`/`placement` into its public prop types — untangle that first) + ONE deliberate keep: `ui/progress.tsx`'s `@ant-design/icons` import, which IS the glyph-parity Arda chose.

### CLEANUP (2026-07-28) — the three follow-ups, all closed
- [x] **`CategoryTags.tsx` de-duplicated** (`oss/.../EvaluationRunsTablePOC/.../RunMetricCell/`). It kept a PRIVATE copy of the 8-hue list (still including `lime`) on raw antd `Tag`, which would have drifted from the restored shared palette. Now imports `getTagColor` from `@agenta/ui/cell-renderers` (already re-exported via `export * from "./metricUtils"`) and renders `Badge`. antd-free; oss tsc clean; eslint clean.
- [x] **NUL separator removed from `cascader.tsx`.** The original defect (a LITERAL NUL byte written into the source, making `file` report it binary and silently breaking `grep`) had already been fixed to the escape `" "`, so the file was plain UTF-8. But the RUNTIME value was still a NUL used as a path-key join separator — exotic, and the root of the earlier confusion. Verified `keyOf()` only feeds React keys + comparisons (DOM ids come from a separate index-based `optionId()`), so it was safe but not worth keeping: replaced with `keyOfValues = (values) => JSON.stringify(values)` — collision-proof, printable, debuggable. `PATH_SEP` deleted; zero NUL bytes in the tree.
- [x] **`FiltersPopoverTrigger` antd leak untangled** — the blocker before the parked table cluster: it re-exported antd `PopoverProps`/`placement` in its own public prop types, so all 3 consumers transitively depended on antd types. Now antd-free in runtime AND types via local `PopoverPlacement` / `FiltersPopoverOverlayProps` / resolvable `PopoverStyles` (object-or-function arm — both OSS call-sites cast `as PopoverProps["styles"]`, whose type includes it). ONE file changed; zero call-site edits.
  - **⚠️ MY BRIEF'S PREMISE WAS INVERTED — recorded so nobody repeats it.** I told the agent the 3 consumers "strip antd's chrome so their content draws its own card". The agent checked antd 6.3.7 source instead of taking it: `overlayStyle` is deprecated-aliased to `styles.root`, and `.ant-popover` (root) is **position-only** — bg / `borderRadiusLG` / `boxShadowSecondary` / `padding:12` all live on `.ant-popover-container`. So those `{backgroundColor:transparent, boxShadow:none, padding:0}` props are **visually inert today**; the call-sites render a NORMAL antd card, and the filter-content components draw no chrome of their own. Following my premise literally would have DELETED the visible card. Fix: reproduce antd's two-node DOM — `PopoverContent` = chrome-less root (neutralized via inline style, since tailwind-merge doesn't reliably group `rounded-control-lg`/`shadow-overlay`), inner `div` = the card (`bg-popover shadow-overlay rounded-control-lg p-3`). `overlayStyle`/`styles.root` therefore land on the same node antd puts them on and stay no-ops, exactly as before.
  - **Nested-antd-portal guard (real regression prevented):** `TestsetsFiltersContent` embeds `Sort`, which portals an antd `Popover`/`DatePicker` to `<body>`. Radix would read clicks there as "outside" and close the filter popover — `onInteractOutside` now `preventDefault()`s for targets inside `.ant-popover/.ant-picker-dropdown/.ant-select-dropdown/…`. Same portal-coexistence trap will hit any Radix overlay wrapping still-antd content while the table cluster stays parked.
  - Also cleared a **pre-existing** OSS tsc failure: commit `e29e3f8586` renamed `buttonType`→`buttonVariant` and broke 2 call-sites (TS2322). `buttonType` restored as documented-inert (the trigger has hardcoded its button since before that commit), and the previously-dead `buttonVariant` wired with default `"outline"`.
  - [x] **`FilterCountBadge` decided + fixed** — it used raw `--ag-c-E5E7EB`/`--ag-c-374151` compat vars, which are theme-STATIC (identical in both themes), so the chip read wrong in dark. DECISION: semantic tokens win; a neutral count chip is exactly `Badge`'s `default` variant, so it now uses `bg-chip text-foreground` (already proven + theme-aware). Light-mode shift is imperceptible; dark goes from broken to correct. That file now has ZERO raw `--ag-c-*`.

### VRT COVERAGE (2026-07-28) — gate widened from 38 → 142 stories
Arda: "everything you did so far HAS TO BE VRT COVERED." Audited `parity/vrt.mjs` `DEFAULT_STORIES` against every `export const X: Story` on disk: **152 story ids existed, only 38 were gated** — none of this session's work (Slider, InputNumber, Cascader, Tag presets, LoadingSkeleton, CopyTooltip, SelectLLMProvider incl. the new `--invalid`, PageLayout, the uploads, the whole presentational/domain surface) was in the gate.
- **Gotcha when auditing this:** Storybook slugs an export by SPLITTING camelCase — `AntdVsAgenta` → `antd-vs-agenta`, NOT `antdvsagenta`. A naive slugger reports every id as missing. Split on `([a-z0-9])([A-Z])` before slugifying.
- `DEFAULT_STORIES` is now GENERATED from the story files (142 ids), with documented exclusions: the five `<overlay>--antd-vs-agenta` rows (tooltip/dialog/alertdialog/sheet/dropdown — those cells are CLOSED triggers, so the pair is two buttons; `--open-state` is the real gate), `*--playground` (interactive arg playgrounds, not pairs), and `run-name--*` (not an `@agenta/ui` component). 0 stale entries.
**Widening the gate exposed that the harness itself was broken in 3 ways** — this is why coverage had been stuck at 38 stories, and why the first VRT numbers were meaningless:
1. **`subjectIn()` threw on any non-triple `.grid`.** It assumed every `.grid` is `[label|antd|agenta]`; showcase grids and `--agenta-only` stories have no `children[2]`, so `undefined.querySelector` killed the whole story's run (19 stories). Now nullish-safe — the existing `.filter(p => p.antd && p.agenta)` drops those rows cleanly.
2. **Caption rows were diffed as content.** A composite with no antd equivalent puts an italic caption ("no single antd counterpart …") in the antd cell; the harness compared that TEXT against a real component → guaranteed ~95% false positives (ConfigAccordionSection, EntityCard, ScrollToTopButton, NumberedStep, MetadataHeader, SplitPanelLayout…). Added `isCaptionOnly()` keyed off the caption convention the stories already use. 864 → 810 comparisons.
3. **`SUBJECT` had no entry for any primitive built this session.** Slider/InputNumber/Cascader/Toast/Notification were missing, so the harness fell through to the generic `input` fallback and compared antd's full widget against our bare inner `<input>`. Added both sides (`.ant-input-number`/`[data-slot=input-number]`, `.ant-slider`/`[data-slot=slider]`, `.ant-cascader`/`[data-slot=cascader-trigger]`, toast, notification) BEFORE the `input` fallback — `querySelector` is DOM-first, so the wrapper must win over its own inner input.
- **Also fixed a build breakage of mine:** collapsing the cascader agent's temporary `./ui/cascader` subpath, I updated the 3 app consumers but missed `stories/Cascader.stories.tsx`, which broke the Storybook bundle. Two VRT runs executed against a non-compiling build — the exact false-pass trap this repo already documents. **RULE: confirm Storybook actually compiles (load a story in the browser) before trusting ANY VRT output; a package `tsc` does not validate the Storybook bundle.**

**Result: 142 stories / 810 comparisons, 279 pairs >0.5%.** Triaged so far:
- **`InputNumber` ~58% uniformly across every row = a REAL API divergence, not noise.** Crops confirm identical dimensions; our InputNumber defaults to FULL-WIDTH, antd's has an intrinsic ~90px width, so the diff is the harness's size-gap padding. **Zero live impact**: 16 files still use antd's InputNumber (out of scope), and all 3 consumers of ours (`SliderInput`, `NumberField`, `PrimitiveNode`) set an explicit width. Document in the primitive's docblock; do not change the default without checking those 3.
- `checkbox --checked·hover` etc. = the documented forced-hover artifact (antd's runtime cssinjs hover doesn't respond to the pseudo-states addon) — judge via computed-style, not pixels.
- **NOT yet triaged: the remaining flagged pairs** (Tag 27, Cascader 18, Tabs 14, Radio 13, Button 13, Collapse 10, RunButton 10, Badge 9, Slider 8, Avatar 8 …). Several are known noise bands; they need per-row crop review, not a blanket claim.
- **43 stories still error** with `waitForSelector` timeouts: they have no `.grid` at all (`sheet--sides`, `combobox--grouped`, `button--used-in-app`, and notably `field--antd-vs-agenta` + `pagelayout--antd-vs-agenta`, which SHOULD be pairable and need their stories restructured into the triple layout).
- **Structural limit:** a component with no antd counterpart cannot have an antd-PARITY VRT — this harness diffs a story's antd half against its agenta half. Covering composites would need golden-image snapshots, which this harness does not implement. Do not claim those are pixel-gated.

**LESSON (keep):** never write a control character into a source file. It renders the file binary to `file`/`grep`, so later searches silently return nothing and you conclude code is absent when it isn't. Use a printable, collision-proof encoding (`JSON.stringify`) instead.

---

## 2. Architecture fixes

> **Compound-migration batch DONE (2026-07-27, 3 subagents, tsc-clean + oss 26=baseline/0-new, 10 files now fully antd-free):**
> **Tooltip → `ui/tooltip`** (Radix): CollapseToggleButton, FileAttachment, FieldHeader, ExecutionMetricsDisplay (3 tips, Badge wrapped in span for `asChild`), MetadataHeader, EditableText, ConfigAccordionSection (conditional no-title→no-tooltip preserved), FormattedDate. **Dropdown → `ui/dropdown-menu`** (Radix): `DropdownButton` (interaction-verified: click opens, items render; **behavior change: hover→click** since Radix menu is click-only — conventional for a split-button, `trigger` prop kept accepted-but-ignored), `SimpleDropdownSelect`. Also folded in Typography→span + Tag→Badge where those files still had them. *(Minor residual: FormattedDate keeps one `--ag-c-*` bg literal on its Badge — cosmetic, deferrable.)*
>
> **ImagePreview → `Dialog`** + **PageLayout → `ui/Tabs`+heading** (2026-07-27): ImagePreview's antd `Modal`→Radix `Dialog` (sr-only title, interaction-verified: opens/overlay/close). PageLayout (high-traffic, storybook-verified per Arda — no app needed): antd `Tabs`+`Typography.Title` → `@agenta/ui` `Tabs` + themed `<h*>` (sized off `--ant-font-size-heading-*`). Contract bounded/kept — the 5 pages pass antd `TabsProps` with only `{items:[{key,label}],activeKey,onChange}` (grep-confirmed), translated to Radix internally; `headerTabsProps` stays typed `TabsProps` (type-only import) so **all 17 consumers unchanged**. Tabs kept 14px/medium via overrides. **VRT-verified**: rebuilt the story with an antd-header reference — title + 14px tabs + active ink bar pixel-identical.
>
> **Parallel batch DONE (2026-07-27, 3 subagents, all tsc-clean + eslint 0, oss 26=baseline/0-new):**
> **§A antd→primitive** — `InitialsAvatar`→AvatarBox, `TableEmptyState`→EmptyState, `TableLoadingState`+`ListItemSkeleton`→Skeleton, `ExecutionMetricsDisplay` Tag→Badge (pixel-verified, no diff). **§C dark-mode colors** — `SectionCard` (`--ag-c-FFFFFF`/zinc→`colorBgContainer`/`colorBorderSecondary`), `EditableText` (blue/gray→semantic + `text-sm`→`text-xs`), `EntityCard` (clsx→cn + `--ag-*`→semantic), `EntityTypeIcon` (blue/purple→`colorPrimary`/`colorInfo`), `PathSelectorDropdown` (palette→semantic). **§D bug** — `AttachmentGrid` `gap-${gap}` → static lookup (was silently broken). **§E** — `FieldHeader.hideMarkdownToggle` removed; `id`/`SimpleDropdownSelect.description`/`withTooltip` KEPT (live call-sites still pass them — removing needs the consumer edited too; flagged, not dead).
>
> **CLOSEOUT WAVE DONE (2026-07-27, 2 subagents + direct, all ui-tsc 0 / eslint clean / oss 26=baseline):**
> **§D bug** — `ImageAttachment` raw `<img>` branch (bypassed `isSafeImageSrc` XSS guard + broken-image fallback) → always renders the package `ImagePreview`; **dropped the `ImagePreview`-injection prop** and migrated its only consumers (`MessageAttachments`, `ChatMessageList`). **§E dead code** — deleted `status/index.tsx` `getStatusColor`+`getStatusLabel` (0 real consumers, name-collided with `@agenta/shared/statusInference`); removed `SourceIndicator.color` (never passed); `ImagePreview.height` was already absent (no-op). **§G** — `RunButton` 3 stringly-typed flags → one `mode="run"|"rerun"|"cancel"|"runAll"` (2 real consumers migrated; only `cancel`+default were ever used), `memo` added to `RunButton`+`CopyButton`; `MetadataHeader` dual export → named-only. **De-antd tail** — `DropdownButton` chevron (`DownOutlined`→lucide `ChevronDown`, now fully antd-free), `PathSelectorDropdown` `Typography`→span, `FormattedDate` `--ag-c-0517290F` badge bg → `bg-colorFillTertiary`. **R5/R6 (subagent B):** see its own entry once merged.
>
> **`SliderInput` — DONE (2026-07-27, 2 subagents + direct). The former holdout is migrated; `presentational/` is now 100% runtime-antd-free.**
> Built two new `@agenta/ui` primitives (parallel subagents; barrel wiring + SliderInput migration + VRT by me):
> - **`ui/slider`** — Radix `@radix-ui/react-slider` (NEW dep `@radix-ui/react-slider@^1.4.7`) + cva, shadcn-native API (`value: number[]`/`onValueChange`), token-matched to antd's Slider (4px rail `colorFillTertiary`, 10px handle + 2px `colorPrimaryBorder` box-shadow ring — antd's *resting* look, hover→`colorPrimary`). VRT-verified pixel-close vs antd across default/step/disabled/full-range.
> - **`ui/input-number`** — from-scratch cva numeric input (Radix has no equivalent): `value: number|null`/`onChange`, min/max/step/size/disabled, hover-revealed up/down steppers, keyboard ±step, clamp-on-blur, float-precision rounding, `type="text" inputMode="decimal"` (owns its steppers). Reuses the `Input` primitive's border/focus recipe. VRT-verified vs antd (rest + stepper reveal + a live 3→4 increment).
> - **`SliderInput.tsx`** now imports both primitives (Slider via `value={[n]}`/`onValueChange={([v])=>…}`; InputNumber 1:1) — VRT-verified pixel-faithful to antd (temperature/integer/disabled). ui tsc 0, eslint clean.
>
> (`selection/*` — Breadcrumb/VirtualList/SearchableList/etc. — is the separate EntityPicker cluster, out of this presentational audit's scope, and still uses antd by design.)

### A — Finish antd → primitive migration · HIGH · **DONE (incl. SliderInput → new Slider + InputNumber primitives)**
All raw antd in `presentational/` migrated to `@agenta/ui` primitives. (`selection/*` EntityPicker cluster is out of scope and still uses antd by design.)
- [x] `Dropdown` → **DropdownButton** (also chevron `DownOutlined`→lucide, now fully antd-free), **SimpleDropdownSelect** → `ui/dropdown-menu`/`ui/select`.
- [x] `Tooltip` → **CollapseToggleButton**, **FileAttachment**, **EditableText** (+ others) → `ui/tooltip`. (LabeledField, SyncStateTag: moot — deleted in R3/R1.)
- [x] `Tabs`+`Typography` → **PageLayout** (VRT-verified; 17 consumers unchanged).
- [x] `Typography` → **CommitMessageInput**, **entity-icon-label**, **FormattedDate**, **PathSelectorDropdown** (closeout) → spans.
- [x] `Avatar` → **InitialsAvatar** via `AvatarBox` (kept `getColorPairFromStr`).
- [x] `Empty` → **TableEmptyState** → `EmptyState`.
- [x] `Skeleton` → **TableLoadingState** / **ListItemSkeleton** (raw antd removed; merged into one primitive-backed component in R5), **ExecutionMetricsDisplay**.
- [x] `Modal` → **ImagePreview** → `Dialog` (interaction-verified).
- [x] `Tag` → **ExecutionMetricsDisplay**, **FormattedDate** → `Badge`.

### B — Impurity (business/side-effects in "presentational" components) · HIGH → EVALUATED 2026-07-27
Otherwise the purity rule holds — entity + layout clusters are clean. Three were flagged; on close read only one was genuine:
- [x] **Prompt\*Upload — DONE.** File-handling (`FileReader`, MIME/size validation, drop-zone) extracted into the `usePromptFileUpload` hook; the CORS `img.onload` probe stays in the image shell (it's image-specific + entangled with `isValidPreview`/emit). Components are now dumb shells. Also fully de-antd'd (Upload/Spin/Progress/Typography → native dropzone + `Spinner`/`Progress`/spans) and §C colors fixed. See R4 above.
- [x] **EditableText — NOT impurity, left as-is.** The `isEditing` + draft-value + Enter/Escape/blur is exactly an inline-edit component's *own local UI state* (the convention keeps that local); `allowEmpty` already makes validation configurable. Nothing to lift.
- [x] **DropdownButton — sanctioned, left as-is.** `atomWithStorage` persistence is opt-in (`storageKey`) and explicitly sanctioned for UI prefs. The `__noop__` fallback is **benign** (its setter is guarded by `if (storageKey)`, so no stray localStorage write — just one null read on mount); a cleanup attempt fought jotai's atom-type unions (TS2554→TS2349→TS2741) for zero real gain → reverted. Not worth the added complexity.

### C — Dark-mode-breaking hardcoded colors · MED (real bugs)
Won't adapt in dark; replace with antd semantic tokens.
- [x] `SectionCard` `bg-[var(--ag-c-FFFFFF)]` + `border-zinc-2` → `bg-colorBgContainer`/`border-colorBorderSecondary` (done).
- [x] `VersionBadge` chip `text-gray-700` → `text-foreground` (done in R1, verified dark).
- [x] `EditableText` `text-blue-600`/`text-gray-400` + `text-sm` → semantic tokens + `text-xs` (done).
- [x] `LabelInput` `--ag-c-BDC7D1` border → **gone** (rebuilt on `Field boxed`, which uses a semantic border token; R3).
- [x] `environmentColors` hex (`status/index.tsx`) → CSS vars (`var(--ag-env-*-bg/-text)`); fixes the `DeploymentCard/skeleton.tsx:15` light-only `.textColor` read (done in R1).
- [x] `EntityCard` `--ag-colorFill*`/`--ag-colorTextSecondary` literals + `clsx` → semantic + `cn` (done).
- [x] `EntityTypeIcon` blue/purple → `colorPrimary`/`colorInfo`; `PathSelectorDropdown` palette → tokens (done; PathSelectorDropdown also Typography→span in closeout).

### D — Genuine bugs · MED
- [x] **`AttachmentGrid`** — `gap-${gap}` → static `GAP={2:"gap-2",…}` lookup (done; the residual `gap-${` is only in a code comment).
- [x] **`ImageAttachment.tsx` — DONE (closeout wave).** Raw `<img>` branch removed → always renders the package `ImagePreview` (routes through `isSafeImageSrc` + `ImageWithFallback` fallback); `ImagePreview`-injection prop dropped; consumers `MessageAttachments` + `ChatMessageList` migrated.
- [x] **`TypeChip.tsx`** — removed the import-time `document.head` `<style>` injection (it only fed the now-deleted notification dot; done in R1).

### E — Dead code / prop rot · MED
- [x] TypeChip notification-dot machinery deleted — `notificationBadge`/`badgeTooltip` had 0 consumers (grep-confirmed); removed props + dot + keyframes; component now `memo`'d (done in R1).
- [~] `FieldHeader` — `hideMarkdownToggle` dead prop already removed; `id` KEPT (live consumers pass it). **RENAME deliberately DEFERRED:** "it's a copy button not a field header" is a clarity-only rename with an **18-file blast radius across the DrillIn subsystem** (drill-in + entity-ui + oss). Not worth destabilizing DrillIn for a name; do it as a focused rename PR if desired.
- [~] `SimpleDropdownSelect` `description`/`withTooltip` — **NOT dead:** live call-sites still pass them (verified in the earlier §E pass). Removing needs the consumers edited too; left as-is.
- [x] `status/index.tsx` `getStatusColor`/`getStatusLabel` — **DONE (closeout wave):** both were 0-import dead code (name-collided with `@agenta/shared/statusInference`), deleted + removed from barrel; kept `QueryStatus`/`ExecutionStatus`/`EnvironmentName`/`environmentColors`.
- [x] `SourceIndicator.color` — **DONE (closeout wave):** removed (0 JSX call-sites pass it); `color ?? computed` collapsed. `ImagePreview.height` — already absent (no-op). `StatusTag.size` — moot (StatusTag deleted in R1).
- [x] `RunButton` — **DONE (closeout wave):** 3 flags → one `mode="run"|"rerun"|"cancel"|"runAll"`; `label` now explicitly honored only in `mode="run"`. Only `cancel`+default were ever used → 2 consumers migrated. Also stale "Wraps Ant Design Button" docstring fixed.

### F — Cohesion · MED · **deferred (deliberate)**
- [~] `ConfigAccordionSection` (~340 lines) kitchen-sink split — **DEFERRED:** high-risk restructure of a working, heavily-used component for modest cohesion gain; repo guidance is "no big-bang refactors, adopt structure progressively." The clean sub-win (the duplicated caret block) is extracted as `CollapseCaret` in R6.
- [~] `CollapseToggleButton` 7-export move to a `collapse/` util module — **DEFERRED:** pure file-org churn with a **13-import-site blast radius** and zero behavior change; low ROI vs review cost. Safe to do as a standalone mechanical PR.

### G — API consistency · LOW
- [~] **4 `onChange` signatures across 6 input wrappers** — standardize to value-based `onChange(value)`. **DEFERRED:** an invasive, cross-package contract change on sensitive controlled-input state; the risk/reward doesn't fit a cleanup pass. Worth a dedicated, consumer-by-consumer PR.
- [x] `size` defaults + `label`/`showIcon`/`icon` naming — normalized by the `Tag` consolidation (R1) + `Field` (R3); remaining drift is cosmetic.
- [x] `memo` added to `CopyButton` + `RunButton` (leaf buttons in lists). `AddButton` `forwardRef` — moot (AddButton deleted in R6).
- [x] `MetadataHeader` dual export → **named-only** (default export + dead `MetadataHeaderDefault` barrel alias removed).

---

## What's already fine (no action)
- **Entity/Label + Layout clusters are pure** — no data-fetching, no jotai atoms, no molecule/selector calls, scalar props not whole entity objects. Impurity is isolated to Prompt\*Upload / EditableText / DropdownButton (§B).
- Image-render **layering is correct**: `ImageWithFallback` (leaf) → `ImagePreview` (zoom) — preserve it.
- `SliderInput`'s antd `Slider` is the one **defensible** holdout (no primitive yet); its `InputNumber` is the second (flag when a number primitive lands).

## Legend
`- [ ]` open · `- [x]` done · link a [migrations/](migrations/) guide when written · keep this file in sync with [STATUS.md](STATUS.md).

---

## VRT harness — gate hardening (closeout wave 2)

The harness had been reporting, not gating. Four further defects fixed on top of the
earlier seven:

- **Preflight `goto` was capped at 30s.** The first story load pays a cold Vite compile
  of the whole story graph and routinely exceeds that, so the *entire suite* aborted
  before measuring anything (`✗ page.goto: Timeout 30000ms exceeded`). This was also the
  source of the 7 mid-run "goto timeout" rows. Now 120s × 2 attempts, with an error that
  names the probe story and says to restart Storybook.
- **Per-story nav had no retry.** "No `.grid` found" is indistinguishable from "the dev
  server was too slow", and it resolved as the benign `(no pairs — not a parity layout)`.
  That is exactly how a run reported 56 stories as non-parity — `checkbox`, `radio`,
  `splitpanellayout` among them — that demonstrably *do* have parity grids. Nav + layout
  detection now retries once at a 60s timeout.
- **The zero-pairs gate only covered two ID suffixes.** It failed on
  `--antd-vs-agenta`/`--open-state` only, so every `--interaction-states` story could
  measure nothing and still pass — and no suffix rule can classify the parity stories
  with arbitrary names (`tag--status`, `badge--status-collapse`). **Inverted: the gate now
  fails by default.** A story that measures zero pairs is a failure unless it is listed in
  `NO_PAIR_EXPECTED` with a written reason. Verified negatively —
  `button--primary` alone now exits 1.
- **9 stories were exported as `AntdVsAgenta` while importing no antd at all.** The name
  asserted a comparison that could never happen. Renamed to `AgentaOnly` (→ `--agenta-only`)
  and moved into `NO_PAIR_EXPECTED`: `EntityCard`, `AuthorLabel`, `RevisionLabel`,
  `TypeChip`, `VersionBadge`, `CollapsibleGroupHeader`, `HeightCollapse`, `PanelFooter`,
  `ScrollSentinel`.

`NO_PAIR_EXPECTED` seeds at 48 entries, each verified by reading the story (zero
`from "antd"` imports **and** zero `>antd<` captions). Adding an entry is a claim that has
to be justified; omitting one only ever costs a failed run. Gate coverage cross-checked
against Storybook's served `index.json`: 142 gated IDs, **0 stale**, and the only
parity-suffixed stories outside the gate are the 5 documented closed-trigger overlays
(`tooltip|dialog|alertdialog|sheet|dropdown --antd-vs-agenta`), which `--open-state` covers.

### Component fix that VRT structurally could not catch
`border-solid` was missing on `NumberedStep` (`layout/index.tsx`) and `PanelFooter`, so
with preflight off **their borders never rendered** — in the real app, not just the story.
VRT was blind to it because the story's antd baseline reproduced the same missing class,
so both halves matched. Fixed in the component; the story's antd cell was updated in step
so the pair stays about antd-vs-agenta rather than about our own fix.

### The `border-solid` bug was bigger than two components — and the naive fix makes it worse

Sweeping the package turned up **21 sites**, not the 2 originally known. More importantly the
prescribed fix was wrong for single-side borders: preflight off also means there is no
`border-width: 0` reset, so adding bare `border-solid` to a `border-b` makes the **other
three sides** paint at the UA default width. The correct forms are:

- all sides → `border border-solid`
- one side  → `border-0 border-<side> border-solid`

This convention was already documented in-repo at `ui/divider.tsx:14-17` and followed by
`accordion.tsx`, `sheet.tsx`, `MarkdownPreview.tsx`. Dismissed (verified, not
pattern-matched): anything whose style comes from a cva base, an inline `style.border`
shorthand, or an explicit `border-dashed`.

Three follow-ups from the same family, fixed here:
- `drill-in/core/DrillInRootToolbar.tsx:116` — the **inverse** bug: `border-b border-solid`
  with no `border-0`, leaking a border onto three sides. The only such case in the package.
- `section/ConfigAccordionSection.tsx:232` — the indicator dot's newly-visible 1.5px ring
  grew its box 8px → 11px under `content-box`; added `box-border`.
- `components/selection/ListItem.tsx` — the selected state's 2px rail widened the row
  relative to its neighbours, so selecting a row shifted layout; `box-border` on the base.

A sweep for the inverse bug across the package now returns exactly one hit, and it is
intentional: `ui/checkbox.tsx:60`'s `border-2 border-l-0 border-t-0` is the L-shaped tick.

Known-and-left: ~80 story `Row` wrappers use `border-b` with no `border-solid`, so the
Storybook row dividers don't render. Identical on both halves → no VRT divergence, cosmetic
only.

### The 5 Storybook-only tsc errors were real bugs, not config noise
All five were masked by `strict: false` in the Storybook tsconfig versus `strict: true` in
`packages/tsconfig.base.json` — so the package's own clean `tsc` was not evidence of
correctness. Notably `ColumnVisibilityTrigger` was leaking React 19's experimental
`unique symbol` key type into a `ReactNode`, and `SharedEditorImpl` was spreading a
textarea's `onChange` onto an `<Input>` because a discriminated union failed to narrow
through an aliased `||`. Fixed with real narrowing (a type predicate), which also let one
pre-existing `as` cast be deleted. No `any`, no `@ts-ignore`.

Storybook tsc: **12 → 6**, and all 6 remaining are pre-existing and outside the migration
(`agenta-shared/state/recipes/*`, `oss/tailwind.config.ts`).

### The repo lint gate never covered Storybook
`web/storybook/package.json` had **no `lint` script**, so turbo skipped the package entirely
and `pnpm lint-fix` — the documented pre-commit gate for all frontend work — never saw a
single story file. Every parity story written during this migration was unlinted by the gate
that was supposed to cover it. Added `lint` mirroring `agenta-ui`/`agenta-shared`
(`eslint --config ../eslint.config.mjs stories/ .storybook/ parity/ --max-warnings 0`);
the first run surfaces ~150 findings, all auto-fixable formatting.

This is the same shape of problem as the VRT gate exiting 0: a check that appears to run,
reports nothing, and is trusted — while covering none of the code in question.

### Two stories were not testing what their captions claimed
- **`badge--*-collapse`** feeds `<AgentaTag>` into the cell captioned "antd", so those rows
  compare the consolidated facade against the raw `Badge` primitive — a useful consistency
  check, but **not** antd parity. Documented in the story; the caption text itself has to stay
  literal because `vrt.mjs` keys pair detection on it. Real antd-vs-`AgTag` coverage for all
  five variants is in `Tag.stories.tsx`.
- **`tabs`/`segmented` `--interaction-states` focus rows** can never be fair: antd gates its
  focus ring on a JS-applied class (`.ant-tabs-tab-focus`, `.ant-segmented-item-focused`) that
  the pseudo-states addon cannot force, so the antd half draws no ring while ours draws one.
  Relabelled `not reproduced` (which the harness drops); the hover/active rows stay gated.

### Two component values were wrong for a reason worth remembering
Both came from copying an antd rule that applies to a *different variant* than the one we render:
- `ui/tabs.tsx:47` used `outline-offset-[-3px]`, citing `genFocusOutline(token, -3)` — that is
  antd's **`type="card"`** rule. The line tab we actually render uses offset **+1**.
- `ui/segmented.tsx:82` used `outline-offset-[-1px]`; antd's real value is **+1**.

The lesson generalises: quoting an antd token in a comment is not verification. The rule has to
be traced to the variant actually in use.

## Closeout: two systemic causes, and a harness bug that manufactured "bugs"

### The token layer had a light-only floor
`web/oss/tailwind.config.ts` spreads `antd-tailwind.json` — a **light-only hex dump** — then
overrides selected names with var-backed ones. Any name *not* in that override list compiles to
a literal light hex and is **frozen in dark**. That is why `ui/slider.tsx` named the correct
antd tokens and still rendered a wrong dark track: the Tailwind layer discarded them silently.

Audited: **69 names have no var-backed override**, but only **3 are actually used** —
`colorInfo`, `colorInfoBorder` (both wired to existing vars) and `colorBgTextHover`, which has
no `--ag-` var at all. For that one the fix came from comparing *values*, not names: antd's
`colorBgTextHover` is `rgba(5,23,41,0.06)`, byte-identical to `colorFillSecondary`, which is
already var-backed. A comment now sits at the override list marking the trap.

### The harness was screenshotting antd mid-transition
antd styles via cssinjs, which injects the forced `.pseudo-*` rules **after** the existing
`getAnimations().finish()` freeze ran. So on `--interaction-states` stories the antd half was
captured partway through its 0.2s `motionDurationMid` transition while our static Tailwind half
already showed 100%. The tell was decisive: every "wrong" colour was an **exact linear
interpolation between two real antd tokens** (71% of `colorPrimary`→`colorPrimaryHover` for
button, 74% for checkbox), and none of those hexes exists as a token — a stopwatch reading, not
a colour. Fixed declaratively (`transition-duration:0s !important` etc.), because CSS applies to
rules injected later; the imperative freeze stays for WAAPI animations.

**Two "confirmed real bugs" evaporated**: `button` dark outline·hover (8.07%) and `checkbox`
unchecked·hover (14.75%). One of them had been reported as crop-confirmed twice.

### Where a forced state genuinely cannot be reproduced
The pseudo-states addon rewrites `:hover`/`:focus-visible` into classes on the element. It
cannot reach a rule antd paints on a **pseudo-element**. `segmented` hover/active is exactly
that: antd fills via `::after`, so the antd half shows no state at all, while our Tailwind
`hover:` IS forced — and forced on *every* inactive item at once, not just one. Light passed at
0.15% only because `colorFillSecondary` is `rgba(5,23,41,0.06)` over white (invisible); dark is
`rgba(255,255,255,0.12)` over near-black and read 54%. **Light passing was luck, not
correctness.** Both rows relabelled `not reproduced`, joining the focus rows.

### Result — 1% ceiling, clean

| | start | final |
|---|---|---|
| comparisons | 617 (90 unmeasured) | **706** (62 no-pair, all allowlisted with reasons) |
| passing | 341 | **642** |
| **unexpected diffs** | 186 | **0** |
| declared-expected (reported, ungated) | — | 2, each with its measurement |
| worst row | 85.07% | — |
| `FLAG` | 0.5% | **1%** |
| runtime | 34:14 | ~13 min (≈25 min with pseudo-state retries) |

**Final state: `✓ PASS`, exit 0** — 733 comparisons, 142 stories, **0 unexpected diffs**,
13 declared-expected (each carrying its measurement), 0 errors, 0 unmeasured.

The two ungated rows are `tooltip--open-state` (sub-pixel: floating-ui snaps Radix to the
device grid via `roundByDPR`, rc-trigger does not — **199 absolute px**, the smallest count in
the overlay set; 1.97% is purely its 10,112px denominator) and `select--open-state` (the
selected-check we keep deliberately; antd v6 has none).

One story reported a `page.goto` timeout in the final run and re-ran clean in isolation — a
transient nav failure at host load average 30–56, not a diff.

### Read ratios with care
Three separate "failures" this session were **crop-area arithmetic, not defects**: the same
~146 differing pixels reads 4.66% on a 3136px crop and 1.55% on a 9408px one, and RunButton's
four non-cancel rows were literally *the same 93 pixels* with four different denominators.
Re-aligning two crops by 2 device px collapsed one story to **zero** differing pixels. Rank by
absolute pixel count; a ratio only means something within a fixed crop size.

### Bugs found by insisting on measurement before relabelling
Every one of these was found while *verifying* a diff that had already been written off:
- icon-only buttons sized `@ant-design/icons` glyphs from the text ramp (12px) instead of
  antd's `onlyIconSize` (14px) — invisible on phosphor icons, which take an explicit `size`.
- solid/outlined/dashed buttons were missing antd's `primaryShadow`/`dangerShadow`/`defaultShadow`.
- a solid split button had **no visible split**: antd's `Space.Compact` connector was dropped.
- `Combobox invalid` tinted the placeholder and arrow `colorError`; antd colours only the value.
- `Input allowClear` dark used `text-placeholder` where antd uses `colorTextQuaternary` —
  identical in light, divergent in dark.
- `shadow-dialog` was a literal equal to the LIGHT `boxShadowSecondary`, so Dialog, AlertDialog,
  Toast and Notification rendered a light shadow in dark and lost dark's 1px elevation ring.

### `size="small"` on a migrated Button emits NO size classes
cva's `defaultVariants` applies only when the prop is `undefined`; a *wrong* string still does a
lookup and yields nothing — verified directly: `v({size:"small"})` → `"base"`. Such a button loses
height, padding, radius and font-size. **Do not detect this by import path** — `@agenta/ui/ui`
also exports antd-compatible facades typed `AntButtonSize`, where `"small"` is correct. Use tsc:
it took `@agenta/playground-ui` from 10 errors to 0 and surfaced a second family, antd's `type`
prop leaking onto a native `<button>` (`type="text"`/`"primary"`), plus a dead `isRunAll` that
rendered "Run" while running all.


Every remaining flagged row is in the 0.5–2% band. `FLAG` is 0.5%, which is deliberately
tight; a 1–2% residual on antialiased icon glyphs and overlay shadows is ordinary VRT noise.

**Two open policy calls, both deliberately left to the owner rather than decided ad hoc:**
1. **antd's 0.75px icon lift.** `.ant-btn-icon > svg` gets `vertical-align: -0.125em` and
   `.ant-btn` never calls `resetComponent`, so the icon's line box is 15.5px (a 14px strut
   plus 1.5px of descent) and the glyph lands at 6.25px against a geometric centre of 7.00 —
   measured by server-rendering a real antd Button with `extractStyle`. **antd is off-centre;
   we are correct.** It explains ~15 rows across `button--circle`, `enhanced-button`,
   `dropdownbutton`, `scrolltotopbutton`, `runbutton`, `segmented--icon-only`. Relabel them
   all as a set, or accept the band — but decide once.
2. **Gold tag text.** Reverted from hue-8 to hue-7 for family consistency. The hue-8 value was
   a deliberate a11y choice that reached only 4.24:1 (AA wants 4.5) while cyan-7/orange-7 sit
   at ~3.3–3.5:1 untouched, so it bought inconsistency without compliance. If contrast is to be
   fixed, it should be a palette-wide pass over all 8 hues.

### A measurement lesson worth keeping
"~5%" on the icon buttons was **crop-area arithmetic, not a large offset**: the same ~146
differing pixels reads 4.66% on a 3136px crop and 1.55% on a 9408px one. Re-aligning the crops
by 2 device px collapsed `collapsetogglebutton` to **0** differing pixels. Ratios are only
comparable within a fixed crop size — rank by absolute pixel count when comparing across rows.

### The forced-state race — root cause found and fixed in the harness
`storybook-addon-pseudo-states` rewrites `:hover`/`:focus-visible` rules into `.pseudo-*` classes
**once per page load**, walking `document.styleSheets`. antd styles via cssinjs and injects
asynchronously, so that walk intermittently runs before antd's sheet exists — the antd half then
renders its **RESTING** state and the row reports a large, entirely bogus diff.

What proved it was a race rather than a bug: **the failure moved between components across runs.**
`radio` failed in one pass while `checkbox` measured 0.00; the very next pass, radio was clean and
`checkbox` failed on the same three row types. An agent had already shown antd's compiled radio CSS
is byte-identical in light and dark (same cssinjs hash, verified via `extractStyle` under the app's
own ThemeContextProvider), and that the light rows measure 0px — so identical stylesheets cannot
behave differently by theme.

`vrt.mjs` now detects it directly: forced-state DOM present **and** antd-styled elements present,
but no stylesheet rule whose selector contains both `pseudo-` and `.ant-` ⇒ the rewrite missed, so
reload. Verified: `checkbox --interaction-states` went 15.43% → clean.

**This replaced the earlier workaround.** Three radio rows had been given `data-vrt-expected`, which
was honest about the cause but ungated them — and would have masked a genuine future regression.
With the race fixed, those declarations were removed and all rows are gated again. Treating the
symptom would have meant re-declaring rows on every component the flake happened to land on next.


## Composite-crop closure (final)
The gate's crops used to cover only the FIRST subject-matching element per cell
(`querySelector` document order) — DropdownButton read 0.00% while its chevrons visibly
differed. Fixes, in order: (1) harness now REFUSES cells with >1 candidate and no
`data-vrt-subject`; (2) 18 story files pinned whole-widget subjects; (3) that exposed and
fixed: chevron half-sized (`size={10}`→`15`, measured ink), Radio+Checkbox story baselines
(antd's 20px `::after`-nbsp wrapper box, label padding both sides, disabled grey),
and a REAL app bug — `Textarea` missing `vertical-align:bottom` (phantom 6px below every
block-flow textarea). (4) The pseudo-state race was made impossible instead of detected
(4 failed heuristics): vrt.mjs re-injects all forced-state rules LAST in <head> every load,
so cascade order beats antd's cssinjs re-injection. 6/6 stress runs green.
Final: 737 comparisons, 142 stories, 0 unexpected/broken/errors/unmeasured, exit 0.

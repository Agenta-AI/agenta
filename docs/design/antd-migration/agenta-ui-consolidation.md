# `@agenta/ui` — component set & consolidation map

> **Purpose.** The antd→`@agenta/ui` migration is also the moment to collapse the wrapper sprawl.
> This map defines the **`@agenta/ui` primitive set** (the design-system target) and sorts every
> current component into: **Primitive** (the `@agenta/ui` one), **Collapse** (delete → becomes a
> variant/usage), **Rebase** (keep behavior, strip styling, build on a primitive), or
> **Domain (defer)** (composed/feature component — separate later track, only its underlying
> primitives get swapped now).
> **Scope decision:** primitives now, domain later. Constraint: **no visual change** — the
> `@agenta/ui` component must reproduce every variant currently in use (variant data:
> [`variants.py`](variants.py) output, [`agenta-ui.json`](agenta-ui.json)).
> **Date:** 2026-07-24. Package: `web/packages/agenta-ui` (~55 wrapper components over 33 antd primitives).

## Classification legend
- **Primitive** — one `@agenta/ui` styled component + a consolidated variant API. Radix + cva base, re-skinned to the app theme, following shadcn conventions (verified via Storybook parity gate).
- **Collapse** — pure preset (a primitive + default props, no real logic: `hooks:0 handlers:0`). **Delete**; becomes `<Primitive variant/prop>`.
- **Rebase** — carries real behavior (state/effects/handlers). **Keep**, but render through the `@agenta/ui` primitive and delete the duplicated styling.
- **Domain (defer)** — feature/entity component. Not consolidated now; only swap the primitives it renders. Revisit in a domain track.

---

## 1. `@agenta/ui` primitive set (the target)

Each row: the `@agenta/ui` component, the variants it must cover (from real usage), what it **absorbs** (collapse) and what **rebases** onto it, and the story it gets.

### Button  → `@agenta/ui` `Button`
- **Variants to cover** (usage): `type` text(27)/primary(7)/default(22)/link(2); `size` small(37)/middle/large; `shape` circle(8); `danger`. ✅ done.
- **NOT props** (stock shadcn keeps Button minimal): `icon` → children; `loading` → `LoadingButton`; `tooltip` → compose `Tooltip` + `TooltipTrigger asChild` (that is what Radix `asChild` is for) rather than adding a prop.
- **Absorbs (collapse):** `EnhancedButton` (→ Tooltip composition), `AddButton` (→ `<Button><Plus/>…`), `RunButton` (→ `<Button><Play/>…` + conditional destructive variant).
- **Rebases onto it:** `CopyButton` (clipboard+copied state), `DropdownButton`/`CopyButtonDropdown` (split-button → shadcn split pattern), `LoadMoreButton`/`LoadMoreInline`/`EndOfList` (pagination+spinner), `CollapseToggleButton` (keep `useCollapseToggle`/overflow hooks; button part trivial), `ScrollToTopButton`.
- **Story:** `Button` — `AntdVsAgenta` parity matrix (variant × size × state) + `AbsorbedPresets`.

### Badge (Tag)  → `@agenta/ui` `Badge`
- **Variants to cover:** semantic color families (default/success/warning/error/info via `--ag-c-*`), `filled`/`outlined`, closeable, with-icon.
- **Absorbs (collapse):** `DraftTag`, `SyncStateTag`, `MappingStatusTag`, `status`, `source-indicator`, `VersionBadge` — all become `<Badge variant="draft|sync|status|source|version">` (all `hooks:0 handlers:0`).
- **Rebases onto it:** `TypeChip` (205L; keep the logical-type inference, render via Badge — note: doesn't use antd Tag today, uses custom divs).
- **Story:** `Badge` — semantic-variant gallery + the 6 absorbed presets as named stories.

### Input / Textarea  → `@agenta/ui` `Input` / `Textarea`
- **Variants to cover:** `variant` borderless(7)/filled/outlined; `size`; `prefix`/`suffix`; `allowClear`; TextArea `autoSize`; Password toggle; Search.
- **Absorbs (collapse):** `LabelInput`, `CommitMessageInput` (specialized Textarea).
- **Rebases onto it:** `SearchInput` (debounce), `EditableText` (8 hooks — inline edit), `SliderInput` (slider+input).
- **Story:** `Input`, `Textarea` — variant gallery incl. borderless (editor-cell case).

### Field (label + control)  → new `@agenta/ui` primitive (`@agenta/ui` `Label` + slot)
- **Rationale:** `LabeledField`, `LabelInput`, `FieldHeader` all reimplement "label (+tooltip/description/actions) above a control". Consolidate into one `Field`.
- **Absorbs (collapse):** `LabeledField`, label part of `LabelInput`.
- **Rebases onto it:** `FieldHeader` (has actions/copy hooks).
- **Story:** `Field` — label + description + tooltip + required + control slot.

### Select / Combobox  → `@agenta/ui` `Select` (+ `Combobox` when searchable)
- **Variants to cover:** plain options; `showSearch`→Combobox; `size`; `variant` borderless; multiple.
- **Rebases onto it:** `SimpleDropdownSelect` (today a **Dropdown faking a Select** → make it a real Select), `PathSelectorDropdown`, `HierarchyLevelSelect` (337L, keep hierarchy logic).
- **Story:** `Select` + `Combobox` — options, search, borderless.

### Dialog (Modal)  → `@agenta/ui` `Dialog` (+ `AlertDialog` for confirm)
- **Variants to cover:** lazy mount, max-height + internal scroll, header/body/footer/mask style slots, `centered` (always), imperative confirm.
- **Primitive source:** `EnhancedModal` (4 hooks — lazy/height/style-merge) becomes the `@agenta/ui` Dialog wrapper.
- **Absorbs (collapse):** `ModalContent`, `ModalFooter`, `ModalContentLayout`, `PanelFooter` → `@agenta/ui` `DialogContent`/`DialogFooter` layout.
- **Rebases onto it:** `SelectionModalShell` (selection-specific shell on Dialog).
- **Story:** `Dialog` — with header/body/footer slots + confirm variant.

### Sheet (Drawer)  → `@agenta/ui` `Sheet` (side) / `Drawer` (bottom, vaul)
- **Primitive source:** `EnhancedDrawer` (6 hooks — lazy/width/mask-blur) → `@agenta/ui` Sheet.
- **Story:** `Sheet` — side + width + mask.

### Spinner / Skeleton / EmptyState  → `@agenta/ui` `Spinner`(custom) / `Skeleton` / custom `EmptyState`
- **Variants to cover:** Spinner size small(8)/default(3), indicator; Skeleton `.Input/.Avatar/.Button`, `paragraph rows`; Empty image+description.
- **Absorbs (collapse):** `ListItemSkeleton`, `TableLoadingState` (Skeleton compositions), `TableEmptyState` (→ EmptyState). Plus the 12 raw `<Spin>` sites → `Spinner`.
- **Story:** `Spinner`, `Skeleton`, `EmptyState`.

### Direct-swap primitives (thin, mostly no wrappers to consolidate)
`Tooltip` (+`TooltipProvider`; `CopyTooltip` **rebases** — 6 hooks copy logic), `Popover`/`HoverCard` (hover trigger), `DropdownMenu`, `Switch`, `Checkbox`, `Slider`, `Tabs`, `Progress` (+circular custom), `Avatar` (`InitialsAvatar` **collapses**), `Divider`→`Separator`, `Breadcrumb` (`selection/Breadcrumb` **rebases**), `Pagination`, `Space`→flex utils, `Grid.useBreakpoint`→hook.

### Engines (not swaps — separate budget)
`InfiniteVirtualTable` (antd Table types → TanStack Table), `Form` (→ react-hook-form + zod). `Upload` primitive underneath the attachment domain components.

---

## 2. Full disposition (every wrapper)

| Wrapper | Signals | Disposition | `@agenta/ui` target |
|---|---|---|---|
| EnhancedButton | 0/0 | **Collapse** | Tooltip + `<Button asChild>` composition |
| AddButton | 0/0 | **Collapse** | Button + icon as child |
| RunButton | 0/0 | **Collapse** | Button + icon as child |
| CopyButton | behavior | **Rebase** | Button |
| CopyButtonDropdown | behavior | **Rebase** | Button (split) |
| DropdownButton | behavior | **Rebase** | Button (split) |
| CollapseToggleButton | 264L hooks | **Rebase** | Button + keep hooks |
| LoadMoreButton (+Inline/EndOfList) | behavior | **Rebase** | Button + Spinner |
| ScrollToTopButton | behavior | **Rebase** | Button |
| DraftTag | 0/0 | **Collapse** | Badge |
| SyncStateTag | 0/0 | **Collapse** | Badge |
| MappingStatusTag | 0/0 | **Collapse** | Badge |
| status | 0/0 | **Collapse** | Badge |
| source-indicator | 0/0 | **Collapse** | Badge |
| VersionBadge | 0/0 | **Collapse** | Badge |
| TypeChip | 205L, type-infer | **Rebase** | Badge |
| SimpleDropdownSelect | hooks | **Rebase** | Select (real) |
| PathSelectorDropdown | — | **Rebase** | Select |
| HierarchyLevelSelect | 337L hooks | **Rebase** | Select |
| SearchInput | hooks | **Rebase** | Input |
| LabelInput | 0/0 | **Collapse** | Input / Field |
| LabeledField | 0/0 | **Collapse** | Field |
| CommitMessageInput | 0/0 | **Collapse** | Textarea |
| FieldHeader | hooks | **Rebase** | Field |
| EditableText | 8 hooks | **Rebase** | Input |
| SliderInput | hooks | **Rebase** | Slider + Input |
| EnhancedModal | 4 hooks | **Primitive** | Dialog |
| ModalContent | 0/0 | **Collapse** | DialogContent |
| ModalFooter | 0/0 | **Collapse** | DialogFooter |
| ModalContentLayout | 0/0 | **Collapse** | DialogContent |
| PanelFooter | 0/0 | **Collapse** | DialogFooter |
| SelectionModalShell | behavior | **Rebase** | Dialog |
| EnhancedDrawer | 6 hooks | **Primitive** | Sheet |
| ListItemSkeleton | 0/0 | **Collapse** | Skeleton |
| TableLoadingState | 0/0 | **Collapse** | Skeleton |
| TableEmptyState | 0/0 | **Collapse** | EmptyState |
| CopyTooltip | 6 hooks | **Rebase** | Tooltip |
| InitialsAvatar | 0/0 | **Collapse** | Avatar |
| selection/Breadcrumb | behavior | **Rebase** | Breadcrumb |
| HeightCollapse | anim util | **Keep** | (utility, not antd) |
| EntityCard, PageLayout, ScrollSentinel, VirtualList, SearchableList, SearchablePopoverList, ListItem, LoadAllButton | mixed | **Domain (defer)** | swap primitives only |
| Entity labels (EntityNameWithVersion, RevisionLabel, EntityPathLabel, AuthorLabel, EntityListItemLabel, EntityTypeIcon), FormattedDate, MetadataHeader | domain | **Domain (defer)** | Badge/Avatar/text underneath |
| Attachments (AttachmentGrid, File/Image/ImagePreview/ImageWithFallback, PromptImage/DocumentUpload) | domain | **Domain (defer)** | Upload/Image underneath |
| ExecutionMetricsDisplay, ConfigAccordionSection, table-states/CollapsibleGroupHeader | domain | **Domain (defer)** | Badge/Tooltip/Skeleton underneath |

**Rough tally:** ~13 Collapse (delete), ~14 Rebase (thinner), ~2 Primitive-from-wrapper (Dialog/Sheet), the rest direct-swap primitives or deferred domain. **Net: ~55 wrappers → ~24 `@agenta/ui` primitives + ~14 behavioral composed + ~20 domain (untouched now).**

---

## 3. Cross-package duplication (hypotheses to verify per package)

These families almost certainly recur in `entity-ui` (107 antd files), `playground-ui` (32), `annotation-ui` (23), and `oss`/`ee`. When we reach each package, check whether it re-implements a family already consolidated here, and **re-point it to `@agenta/ui`** instead of porting a dup:
- **Badge/status chips** — status/type/version tags are a very common dup.
- **Button presets** — icon/add/run/toggle buttons.
- **Field (label+control)** — form-row patterns.
- **Modal/Drawer shells** — each feature tends to grow its own.
- **Empty/Loading states** — table/list states.

## 4. Story plan (feeds Phase 1)
Build Storybook stories for the **`@agenta/ui` primitives only** (§1), not per-wrapper. Each primitive
gets up to three side-by-side stories, which the **pixel VRT** (`parity/vrt.mjs`, the primary
gate — see `web/storybook/parity/README.md`) consumes:
1. `AntdVsAgenta` — antd re-skinned to theme beside the `@agenta/ui` version, every variant it must
   absorb (from usage data), incl. named absorbed presets (e.g. Badge → Draft/Sync/Status).
2. `InteractionStates` — every applicable CSS state forced statically (hover / `:active` / focus /
   `:focus-within`; for options selected + highlighted). Use the `pseudo-*-all` wrappers.
3. `OpenState` (overlays only) — forced-open, inline via a portal `container`, marked
   `[data-open-compare]`, so the VRT diffs the open panel too.

Verify with the VRT first; drop to `measure.js` only for exact tokens / antd forced-state flags.

## 5. Explicitly deferred (domain track)
Entity labels, attachments, selection lists/shells, metrics/config/table-state feature components. These get their **underlying primitives swapped** during the primitive migration but are **not consolidated** now; a later domain-consolidation pass revisits their redundancy (e.g. `EntityNameWithVersion` vs `RevisionLabel` vs `VersionBadge`).

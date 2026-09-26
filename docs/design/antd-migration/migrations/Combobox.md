# Combobox — migration guide

**antd `<Select showSearch />` → Combobox** (searchable select: Popover + a trigger input, `@agenta/ui/ui`) ·
status: **✅ built + 2 call-sites migrated, parity-verified** · no visual change.

## Why a separate component (not a Select prop)
Radix Select cannot search, so `showSearch` and multi-select do NOT belong on `Select`.
Adding them there would recreate the antd-shaped-API mistake this migration exists to undo.

## Matches antd's INTERACTION, not the shadcn command-palette
The first cut used the shadcn "Combobox" recipe (Popover + cmdk, with a search box **inside
the dropdown**). That is a different UX from antd's `showSearch`, where you type in the
**trigger itself** and the dropdown shows only the filtered options. Under the "no visual
change" mandate that was wrong. This is now a searchable select: a trigger input (overlaying
the selected label, which hides while you type) + a plain filtered option list in the popover
— **no search box in the dropdown**. cmdk was removed. The trigger reuses
`selectTriggerVariants`, so it stays dimensionally identical to Select.

## Convenience shape (matches antd)
Both call-sites use antd's `options`/`value`/`onChange`, so the Combobox does too:

```tsx
- <Select showSearch allowClear value={v} onChange={setV} options={opts}
-   optionFilterProp="label" />
+ <Combobox allowClear value={v} onChange={setV} options={opts} />
```

| antd | Combobox |
|---|---|
| `value` / `onChange` | same (`onChange` gets `string \| undefined`; undefined on clear) |
| `options={[{value,label}]}` | `options` — `label` is any ReactNode |
| `optionFilterProp` / `filterOption` / `searchLabel` | per-option **`searchValue`** (falls back to value) |
| grouped `options` / `<OptGroup>` | `{label, options}` group entries (mixed with flat is fine) |
| `showSearch` | built in |
| `allowClear` | `allowClear` |
| `loading` | `loading` (keeps normal skin, blocks opening — antd behaviour) |
| `status="error"` | `invalid` |
| `notFoundContent` | `emptyText` |
| `size` sm/default/lg | `size` on the trigger |

## Gotchas (see also GOTCHAS.md — this went through five reworks; each bullet is one of them)

**Trigger (the closed control):**
- **The trigger is a `div`** (it hosts the search input), so the variant's `disabled:` classes
  never fire — they only apply to real form controls. Apply the disabled bg/text/border skin
  explicitly, or a disabled combobox renders looking enabled.
- **Closed arrow = `ChevronDown` (single down), not `CaretUpDown`.** antd Select's closed arrow
  is a single down chevron (same as the Select trigger). The stock shadcn combobox's up/down
  caret (⇅) is wrong under "no visual change" — the pixel VRT flagged it at 7.6%.
- **Rich (ReactNode) labels can't go in an `<input>`.** The selected label is an
  absolutely-positioned overlay over the input; it hides the moment `query` is non-empty (you
  are typing), which is exactly antd's showSearch behaviour.
- **`loading` is not `disabled`.** antd keeps the control's normal colours while loading. Use
  `aria-busy` + `pointer-events-none` and guard `onOpenChange`, not the `disabled` attribute.
- **antd's error state tints the whole control red** (border + arrow + placeholder), not just
  the border — `aria-[invalid=true]:text-error` on the shared `selectTriggerVariants`.

**Dropdown (the portaled panel — invisible to the trigger-only gate):**
- **It renders in SERIF** unless you set `font-portal` on the content (portals escape the app
  font scope; preflight-off `<body>` is Times). And `font-portal` MUST be a nested `var()` —
  a comma list of `var()`s dies wholesale when the first is unset. See GOTCHAS §Portaled content.
- **Panel chrome = antd's overlay, not a bordered shadcn panel:** borderless, radius 10px
  (`rounded-control-lg`), overlay shadow (`shadow-overlay` = `--ag-boxShadowSecondary`). Stock
  shadcn's 1px border + 8px radius + `shadow-lg` (transparent under preflight-off) are all wrong.
  Lives on `PopoverContent`, which the Combobox reuses.
- **The panel width needs `box-border`.** Preflight-off = content-box, so
  `w-[var(--radix-popover-trigger-width)]` + `p-1` renders the panel **8px wider** than the
  trigger/antd. `PopoverContent` sets `box-border` to fix it (the VRT flagged the 8px as a
  right-edge strip). See GOTCHAS §Portaled content.
- **Option geometry is antd's option, not the trigger's:** `min-h-control` (28px), `4px×12px`
  padding, `rounded-control-sm`, and `box-border` (or min-height + padding double to 36px).
- **Option STATE colours are distinct antd tokens:** selected = `controlItemBgActive` (cool
  bluish `#f5f7fa` light / olive dark), hover/active = `controlItemBgHover` (= `bg-muted`),
  selected weight 600. A selected+highlighted row must keep its selected colour — gate the
  hover with a per-item `value === value ? active : hover` conditional.
- **Highlight the SELECTED row on open, not row 0.** Initialise the keyboard active index to
  the selected option's index; antd highlights the current value, not the first item. Reset to
  0 only while typing.

## Migrated call-sites
- `PathSelectorDropdown` — no consumers; `onChange` widened to `string | undefined` (antd
  already passed undefined on clear), `size` retyped to the `@agenta/ui` scale.
- `HierarchyLevelSelect` — **grouped** options (exercised the Combobox group support), generic
  over `<T>`, live consumer. Its option types now alias `ComboboxOption`/`ComboboxOptionGroup`
  and `searchLabel` → `searchValue`. Its consumer `LevelSelect` (entity-ui) maps the
  EntityPicker's antd `size` names to the `@agenta/ui` scale at that one boundary, rather than
  renaming the whole EntityPicker public API (a separate migration).

## The font bug (why "6/6 MATCH" wasn't enough)
The list items shipped in SERIF: the popover portals to `<body>`, which has no app font
(preflight off), and the parity gate only measures the closed trigger — so the dropdown was
never checked. Fixed with a `font-portal` Tailwind key (a NESTED-var font-family so it resolves
inside portals) on all portaled content, plus `measureOverlayParity()` in the gate to diff an
open list item. Same fix covers the Select dropdown. See GOTCHAS.md.

## Open-state comparison
`defaultOpen` + `container` (portal target) let the dropdown render forced-open and INLINE.
The `OpenState` story (marked `data-open-compare`) places the antd and agenta open panels side
by side for static comparison, and **`parity/vrt.mjs` pixel-diffs them** — that pass is what
found the borderless/10px/overlay-shadow chrome and the 8px width bug. Open-panel now diffs at
≤1% (AA floor) in both themes.

## Verification (VRT first)
`parity/vrt.mjs` is the primary gate. Stories: `AntdVsAgenta` (placeholder, value+clear, disabled,
loading, sm, invalid) — 6/6 light+dark; `InteractionStates` (trigger hover + focus — hover is
pixel-flaky on antd's cssinjs, so the token was confirmed via computed-style: `#e8e47e` =
`colorPrimaryHover`); `OpenState` (`data-open-compare`) — open panel diffs at ≤1% (AA). Live
interaction also sanity-checked (open → filter → select → clear round-trips the real value);
`Grouped` verifies group headings + search collapsing to the matching group.

## Pre-existing, NOT from this work
entity-ui tsc already fails on two `type="text"` Button props (`ReferenceToolFormView`,
`WorkflowReferenceSelector`) — the `@agenta/ui` Button was dropped in there earlier with a leftover antd
prop. Present with this change stashed. Belongs to the entity-ui migration.

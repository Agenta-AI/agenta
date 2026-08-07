# Select — migration guide

**antd `Select` → `@agenta/ui` `Select`** (Radix, `@agenta/ui/ui`) · status: **✅ primitive built
+ parity-verified; call-sites not yet migrated** · no visual change.

## Scope — read this first
**Single-select only, and that is deliberate.** There is no `mode="multiple"` or `mode="tags"`
anywhere in `@agenta/ui` (verified by grep), and Radix Select is single-select by design.

Two antd features do NOT belong on this component:
- **`showSearch`** → a **Combobox** (searchable select — search in the trigger), not a prop. 2 call-sites use it:
  `PathSelectorDropdown`, `HierarchyLevelSelect`.
- **multi-select** → also a Combobox, if it is ever needed.

`SelectLLMProviderBase` is a third case: it uses `Option` children, `popupRender`,
`optionLabelProp` and its own search field. It is a custom widget, not a Select — treat it
separately.

## Prop mapping (antd → `@agenta/ui`)

antd is a single component; the `@agenta/ui` Select is a composition:

```tsx
- <Select value={v} onChange={setV} options={opts} placeholder="Select" />
+ <Select value={v} onValueChange={setV}>
+     <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
+     <SelectContent>
+         {opts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
+     </SelectContent>
+ </Select>
```

| antd | `@agenta/ui` |
|---|---|
| `onChange` | `onValueChange` (value-first, no event) |
| `options={[{value,label}]}` | `<SelectItem value>` children |
| `size` small/middle/large | `size` sm/default/lg **on `SelectTrigger`** |
| `variant="borderless"` | `variant="ghost"` on `SelectTrigger` |
| `status="error"` | `aria-invalid` on `SelectTrigger` |
| `disabled` | `disabled` on the root |
| `showSearch` / `mode` | → Combobox (not this component) |
| `allowClear` | no equivalent — add an explicit "none" item, or use a Combobox |
| `Select.Option` children | `SelectItem` |

## Gotchas (see also GOTCHAS.md)
- **antd v6 renamed the Select DOM.** There is no `.ant-select-selector` (v5); the bordered
  box is `.ant-select` itself, with `.ant-select-content` inside. A parity measurement
  targeting the v5 class silently falls through to the wrong element and reports nonsense
  (16.7px tall, no border) — it looks like a catastrophic mismatch and is really a bad
  selector.
- **Select's size ramp is NOT Input's.** antd's small *Select* keeps the default height and
  12px type and only tightens padding to 7px; its small *Input* is h24/10px. So
  `sm` = `h-control px-input-sm text-field-md rounded-control-sm`. Measured, not assumed —
  this is the third component whose ramp differs (buttons, fields, now selects).
- **antd's borderless Select keeps a 1px transparent border**, so use `border-transparent`,
  not `border-0`, or the content box shifts by 2px.
- **Placeholder colour lives on the placeholder, not the control.** antd keeps the root at
  the foreground colour and greys only the placeholder text. Styling the whole trigger with
  `data-[placeholder]:text-placeholder` greys the arrow and any adornment too — scope it:
  `[&[data-placeholder]_[data-slot=select-value]]:text-placeholder`.
- **Selected option: check icon KEPT as a deliberate deviation.** antd **v6** shows no check
  (the `.ant-select-item-option-state` span is empty, width 0 — v6 dropped v5's default check),
  so there is nothing to match a check to. We keep shadcn's `Check` `ItemIndicator` anyway as an
  explicit affordance (restores v5 behaviour). The VRT flags the check (~5% dark) — the Select
  `OpenState` story declares it via `data-vrt-expected` so it reports as expected/ungated, not a
  failure; panel width/chrome are verified separately. See §Deliberate deviations.
- **The dropdown panel is antd's overlay + trigger-width.** Borderless, radius 10px
  (`rounded-control-lg`), overlay shadow (`shadow-overlay`). And in **popper** mode pin the width
  with `w-[var(--radix-select-trigger-width)]` + `box-border` on `SelectContent`, and DROP the
  Viewport's `min-w-[trigger-width]` — otherwise the `min-w` + `p-1` renders the panel 8px wider
  than the trigger (content-box, preflight-off). See GOTCHAS §Portaled content.

## Deliberate deviations
- **Selected-option check icon** — kept though antd v6 has none (see the gotcha above). The
  proper-match path (no check) was verified to dead-end, so this is a declared edge case, opted
  out of the VRT gate via `data-vrt-expected` on the `OpenState` story.

## Verification (VRT first, computed-style as fallback)
`parity/vrt.mjs` is the primary gate. Stories: `AntdVsAgenta` (placeholder, with-value, sm, lg,
disabled, ghost) — 6/6; `InteractionStates` (trigger hover + focus glow); `OpenState`
(`data-open-compare`, `position="popper"` to mirror antd's below-trigger dropdown) — panel
width/chrome/option-states match, the selected-check is the only (declared) diff. Placeholder
text colour and the focus-glow shadow value were confirmed with computed-style (`measure.js`) —
the pixel diff can't isolate the placeholder element, and the focus shadow carries transparent
Tailwind ring layers that a naive string compare mis-reads.

## Call-sites

| Site | Disposition |
|---|---|
| `DrillInControls` | ✅ migrated — plain options/value/onChange picker |
| `ChatInputs` | ✅ **deleted** — the file was `@deprecated` with zero consumers (verified: no barrel export, no subpath export, zero references to it or its `ChatInputsProps`/`ChatInputMessage`/`getDefaultNewMessage` exports). 405 lines removed; tsc clean after |
| `JsonArrayField` | ⬜ **not a Select.** `value={null}` permanently, numeric option values, `onSelect` used purely to navigate — it is a "Jump to item" action menu. Wants a **DropdownMenu** (or Combobox if arrays get long), not selection state |
| `PathSelectorDropdown` | ✅ migrated to **Combobox** |
| `HierarchyLevelSelect` | ✅ migrated to **Combobox** (grouped) |
| `SelectLLMProviderBase` | ⬜ custom widget — `Option` children, `popupRender`, `optionLabelProp`, own search field. Treat separately |

Lesson worth keeping: of the six antd `<Select>` tags, only **one** was actually a select.
The rest were a dead file, an action menu wearing a Select, and three that need a different
primitive. Grepping for the tag over-counts the work in one direction and under-counts it in
the other — read each call-site before planning.

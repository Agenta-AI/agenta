# Field / Label — migration guide

**antd label+control wrappers → `@agenta/ui` `Field`** (+ `Label` over `@radix-ui/react-label`,
`@agenta/ui/ui`) · status: **✅ primitives built / ⬜ call-sites** · consolidation primitive.

## TL;DR
`Field` is the label-over-control consolidation primitive. It replaces three hand-rolled
wrappers this package shipped — `LabeledField` (label + info-tooltip + vertical/horizontal
layout), `LabelInput` (label + a baked-in ` *` required marker), and the label side of ad-hoc
form rows. It composes the package's own `Label` + `Tooltip` (no antd), renders a label above
(vertical) or beside (horizontal) a control **slot** (`children`), and adds an optional required
asterisk, an info tooltip, a description line, and an error/help line. `Label` is a thin styled
Radix label (`data-slot="label"`, `htmlFor` association, disabled / peer-disabled styling).

Parity reference is **the current `LabeledField` rendering** (that is the app's real appearance),
not antd `Form.Item`. Label typography, gap, and asterisk colour reproduce it exactly via tokens.

## Before
```tsx
// LabeledField — label + info-tooltip (its `description` is the TOOLTIP text)
import {LabeledField} from "@agenta/ui"
<LabeledField label="Temperature" description="Controls randomness">
    <SliderInput ... />
</LabeledField>

// LabelInput / ad-hoc — required marker baked into the label string
<span className="font-medium">API key *</span>
```

## After
```tsx
import {Field} from "@agenta/ui/ui"

<Field label="Temperature" tooltip="Controls randomness">
    <SliderInput ... />
</Field>

<Field label="API key" required>
    <Input />
</Field>
```

## Usage
- **Vertical (default)**: label block above the control, 4px gap (`gap="xs"`). Order:
  label row → description → control → error.
- **Horizontal**: `direction="horizontal"` — label beside the control (`flex items-center gap-2`,
  label `flex-shrink-0`, control column `flex-1 min-w-0`). Mirrors LabeledField's horizontal mode.
- **Association is automatic.** Omit `htmlFor` and Field generates an id (`useId`) and injects it
  into the single child control, so `<label for>` matches and axe is clean. Pass `htmlFor`
  explicitly, or put an `id` on the child, to opt out of injection.
- **`tooltip`** renders a small info icon after the label with the content in a `Tooltip`
  (`tooltipPlacement` → Radix `side`, default `right`). This is LabeledField's `description`.
- **`description`** is a NEW help-subtext line under the label (`colorTextDescription`);
  **`error`** is a NEW help/error line under the control (`colorError`). Neither existed on
  LabeledField.
- `size` (`xs`/`sm`/`md`) scales the label type; `disabled` dims the label (sets `data-disabled`).
- **New code**: use `Field` for every label+control pairing; use `Label` directly only when you
  need a bare associated `<label>` without the field chrome.

## Prop mapping
| old (`LabeledField` / `LabelInput`) | `Field` |
|---|---|
| `label` | `label` |
| `description` (shown in a tooltip) | `tooltip` |
| `withTooltip` | implicit — pass `tooltip` to show it, omit to hide |
| `tooltipPlacement` | `tooltipPlacement` (→ Radix `side`) |
| `direction` (`vertical`/`horizontal`) | `direction` |
| `size` (`xs`/`sm`/`md`) | `size` |
| `gap` (`xs`/`sm`/`md`) | `gap` |
| `className` | `className` |
| `LabelInput` label string `"API key *"` | `label="API key"` + `required` |
| — (new) | `description` (help subtext), `error` (help/error line), `htmlFor`, `disabled` |

`FieldHeader` (in `presentational/field/`) is unrelated despite the name — it is a copy-button
row, not a label header, and is out of scope for this consolidation.

## Infra added
None — no palette / generator / bridge / `tailwind.config.ts` change, and no new dependency
(`@radix-ui/react-label` was already a declared dep of `@agenta/ui`). Reuses existing tokens:
- label colour `text-foreground` (`--ag-colorText`) — **byte-identical to LabeledField's
  `text-zinc-9`** (`--ag-zinc-9`) in both themes (#1c2c3d light / rgba(255,255,255,0.85) dark).
- `font-medium`; size ramp `text-xs`/`text-sm`/`text-base` (mirrors LabeledField's xs/sm/md).
- required asterisk `text-error` (`--ag-colorError`, #d61010 / #dc4446 dark).
- info icon + description `text-colorTextDescription` (#758391 / rgba(255,255,255,0.45) dark);
  error line `text-error`.
- gap `gap-1`/`gap-2`/`gap-3` (xs/sm/md), header inner `gap-0.5`. Tooltip from the package's
  own `Tooltip` (antd overlay chrome, `font-portal`).

## Gotchas
- **`font-[inherit]` on `Label`.** Preflight is off; a bare element can fall back to the UA font.
- **Asterisk position is TRAILING** (`API key *`), matching the app's `LabelInput` convention —
  NOT antd `Form.Item`'s leading `::before` asterisk. Deliberate; see Deliberate deviations.
- **`data-disabled` drives the label dim**, not a real disabled attribute — `Field` does not
  disable the control itself (the control owns its own disabled state).
- **Auto-id only fires for a single valid element child.** A fragment / multiple children /
  a child with its own `id` are left untouched, and `htmlFor` is only set when an id is
  guaranteed to exist, so the label `for` is never dangling (axe stays clean either way).
- **The tooltip trigger is a `<button type="button">`, not a bare span** — so it is focusable
  and has an accessible name (`aria-label="More information"`); a bare span tripped axe. It
  carries the button CONTROL_RESET (`bg-transparent border-0 p-0 font-[inherit] box-border`)
  because preflight is off (a UA button would leak `buttonface` bg + padding).

## Verification (live — Playwright `getComputedStyle`, light + dark)
Storybook `:6006`, story `antd/Data Entry/Field` → `AntdVsAgenta`. Measured agenta `Field`
label region vs the antd `LabeledField` reference (transitions killed first):

| property | agenta | antd (LabeledField) | light | dark |
|---|---|---|---|---|
| label font-size | 12px | 12px | ✅ | ✅ |
| label font-weight | 500 | 500 | ✅ | ✅ |
| label line-height | 16px | 16px | ✅ | ✅ |
| label colour | `#1c2c3d` / `rgba(255,255,255,.85)` | same | ✅ | ✅ |
| label→control gap | 4px | 4px | ✅ | ✅ |
| required asterisk | `#d61010` / `#dc4446` (`colorError`) | — (see deviation) | ✅ | ✅ |
| description | 12px/400, `#758391` / `rgba(255,255,255,.45)` (`colorTextDescription`) | — (new) | ✅ | ✅ |
| error line | `#d61010` / `#dc4446` (`colorError`) | — (new) | ✅ | ✅ |
| tooltip trigger | `<button>`, tabbable, name "More information" | — | ✅ | ✅ |

Label typography/colour/gap are an **exact** match to LabeledField in BOTH themes.

- **VRT compatibility**: Field is a composite, so the single-subject-per-cell crop must be
  aimed at the LABEL region on both sides. The story does this: the agenta cell naturally
  exposes `[data-slot=field-header]` (label region only, control excluded), and the antd cell
  wraps a control-less `LabeledField` in a `[data-slot=field-header]` marker (already in the
  VRT `SUBJECT` list). Only the **"label only"** row is VRT-gated (clean text parity); every
  other row ADDS or DIVERGES from LabeledField and is labelled **"not reproduced"** so the VRT
  skips it (`/not reproduced/i`), verified by computed-style above instead. (Owner runs
  `vrt.mjs`; not run here per instruction.)
- `pnpm --filter @agenta/ui exec tsc --noEmit`: clean for `field.tsx` / `label.tsx` (the only
  errors are pre-existing antd-v6 drift in `EnhancedModal.tsx`). eslint `--fix`: clean.

## Deliberate deviations
- **Required asterisk is a RED `colorError` mark, trailing the label.** `LabelInput` baked a
  plain-text `" *"` into the label string (so its asterisk was the label's dark colour); antd
  `Form.Item` renders a red asterisk but LEADING (`::before`). `Field` follows antd's red
  convention (`#d61010`/`#dc4446`, measured) but keeps the trailing position from `LabelInput`.
  The parity-story "required" row is therefore marked **not reproduced**.
- **Info icon glyph + colour + size** (the tooltip row is marked **not reproduced** for this):
  LabeledField used antd `InfoCircleOutlined`, `text-gray-400` (`#9ca3af` / `#5c5c5c` dark),
  11×11 (measured). `Field` uses phosphor `Info` (the ui layer has no antd deps) at `size-3`
  (12×12) with the semantic token `text-colorTextDescription` (`#758391` / `rgba(255,255,255,.45)`),
  keeping the primitive free of raw hex/px. Different glyph, +1px, semantic colour.

## For agents hitting conflicts
`Field` composes `Label` (`label.tsx`) + `Tooltip` (`tooltip.tsx`) — keep those imports and the
per-part `data-slot` structure (`field`, `field-header`, `field-label-row`, `field-label`,
`field-label-text`, `field-required`, `field-tooltip-trigger`, `field-description`,
`field-control`, `field-error`). No `forwardRef`, no raw hex/px (bar the noted icon size),
colour from tokens. The auto-id/`cloneElement` block is the a11y contract — do not drop it.
`Field`/`Label` are NOT yet exported from `@agenta/ui/ui`'s `index.ts` (barrel add is a separate
step); stories import them by relative path.

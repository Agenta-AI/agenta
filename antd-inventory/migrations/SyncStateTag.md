# SyncStateTag — migration guide

**antd `Tag` (preset colors) → `@agenta/ui` `Badge` (`blue`/`green` variants)** · tactic: **facade** · status: **✅ done** · no visual change.

## TL;DR
`SyncStateTag` is now a facade over `Badge`. It used antd **preset colors** (`color="blue"`/`"green"`) and a **tighter geometry** than the default tag — both reproduced: preset colors via new `blue`/`green` Badge variants, geometry via a className. `dismissible`/`onDismiss` preserved.

## Before → After
```tsx
// BEFORE: antd Tag with color="blue"/"green" + custom padding classes
<Tag color={config.color} className={clsx("!m-0 text-xs leading-none flex items-center py-1 px-2", …)} closeIcon={…} onClose={…}>{config.label}</Tag>

// AFTER: Badge blue/green variant + geometry className + inline dismiss ×
<Badge variant={config.variant} className={clsx("text-xs leading-none py-1 px-2 select-none", showDismiss && "group cursor-pointer", className)}>
  {config.label}
  {showDismiss ? <Tooltip title="Discard changes"><X size={12} className="ml-1 cursor-pointer" onClick={onDismiss} /></Tooltip> : null}
</Badge>
```
State→variant: `modified`→`blue` ("Edited"), `new`→`green` ("New"), `unmodified`/`hidden`→`null`.

## Usage
- **Unchanged API:** `<SyncStateTag syncState={…} dismissible onDismiss={…} />`. Consumers (Playground, ConfigureEvaluator, playground-ui) unchanged.
- **New code:** prefer `<SyncStateTag/>` (it's the semantic wrapper). For a raw preset-colored chip: `<Badge variant="blue" className="text-xs leading-none py-1 px-2">…</Badge>`.

## Two reusable lessons
1. **antd preset colors ≠ semantic tokens.** `color="green"` uses green-1 bg / **green-7** text (`#6abe39` dark), while semantic `success` uses green-**6** (`#49aa19`). They diverge in dark — so preset colors get their own `blue`/`green` variants, NOT `success`/`info`. Added a `presetTag` palette family (extend with red/gold/… as needed).
2. **Geometry via className + tailwind-merge.** The Badge's default is the antd-Tag-default shape (h24.4, `px-input-sm`, `text-badge-md`). A preset with a different shape (h22, `py-1 px-2`, `leading-none`) passes those classes as `className`; `tailwind-merge` overrides the base (`px-2` beats `px-input-sm`, `leading-none` beats the ramp's line-height). No `size` prop needed.

## Infra added
| Layer | Change |
|---|---|
| `palette.ts` | `+presetTag` family: `blueBg #e6f4ff/#111a2c`, `blueText #0958d9/#3c89e8`, `greenBg #f6ffed/#162312`, `greenText #389e0d/#6abe39`. |
| generator | `+preset-blue-bg/text`, `+preset-green-bg/text` → `--ag-preset-*`. |
| `shadcnTokens` | `+"tag-blue"`, `+"tag-green"` (namespaced to NOT clobber Tailwind's `blue`/`green` — used in 16 app files). |
| `Badge` | `+blue` (`bg-tag-blue-bg text-tag-blue`), `+green`. |

## Gotchas
- **Do NOT name preset tokens `blue`/`green`** — clobbers Tailwind's default scales (`bg-blue-500` etc., used across the app). Namespaced `tag-blue`/`tag-green`.
- **Dismiss ×:** rendered inline (was antd's `closeIcon` slot). Body geometry/colors verified identical; the × glyph itself is an inline `<X size={12}>` — if a consumer relies on antd's close-icon hover/animation, verify. (Minor; the tag body is pixel-identical.)

## Verification (SyncStateTag vs Badge, both modes)
| state | light | dark | result |
|---|---|---|---|
| modified "Edited" (blue) | `#e6f4ff`/`#0958d9` | `#111a2c`/`#3c89e8` | **MATCH** |
| new "New" (green) | `#f6ffed`/`#389e0d` | `#162312`/`#6abe39` | **MATCH** |
Geometry both: h22, pad `4px 8px`, `leading-none`, radius 6. Story: `Badge (consolidation) → SyncCollapse`.

## For agents hitting conflicts
- `SyncStateTag.tsx` is a facade; the preset colors live in the `presetTag` palette family + Badge `blue`/`green` variants.
- Adding another antd preset color (`red`, `gold`, …)? Extend `presetTag` + generator + `shadcnTokens` (`tag-<color>`) + a Badge variant — same pattern.

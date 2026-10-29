# SourceIndicator — migration guide

**antd `Tag` (preset colors) → `@agenta/ui` `Badge`** · tactic: **facade** · status: **✅ done** · no visual change.

## TL;DR
`SourceIndicator` renders `<div>[icon span + Tag]`. The facade keeps the div+icon and swaps the inner `Tag` for a `Badge`, mapping its computed antd color (`green`/`orange`/`default`, override via `color`) to Badge variants. Added `orange` + `red` preset variants.

## Mapping
`connected` → `green`; `modified` → `orange`; `!connected` → `default`; `color` override → same-named preset variant (blue/green/orange/red/default), else `default`. Default tag geometry (no custom padding).

## Before → After
```tsx
// BEFORE
<Tag color={color ?? computedColor} className={cn("m-0", onClick && "cursor-pointer")} onClick={onClick}>{displayName}</Tag>
// AFTER
<Badge variant={COLOR_VARIANT[tagColor] ?? "default"} className={cn(onClick && "cursor-pointer")} onClick={onClick}>{displayName}</Badge>
```

## Usage
Unchanged API (`icon`, `name`, `connected`, `modified`, `color`, `onClick`, `className`). `color` override accepts antd preset names blue/green/orange/red/default (extend `COLOR_VARIANT` + add a preset if another color is needed).

## Infra added (shared with MappingStatusTag)
`+orange`/`+red` to the `presetTag` palette family → `--ag-preset-{orange,red}-{bg,text}` → `tag-orange`/`tag-red` bridge tokens → Badge `orange`/`red` variants. antd preset values: orange-1/7 `#fff7e6`/`#d46b08` (L) `#2b1d11`/`#e89a3c` (D); red-1/7 `#fff1f0`/`#cf1322` (L) `#2a1215`/`#e84749` (D).

## Verification
`green`/`orange`/`default` match antd exactly, both modes (story `Badge (consolidation) → PresetColors` for the raw variants; `CurrentPresets` shows the facaded component, `.ant-tag` count 0).

## For agents
Facade; the color→variant map is `COLOR_VARIANT`. Preset colors live in `presetTag` + Badge variants. `onClick` now lands on the Badge `<span>`.

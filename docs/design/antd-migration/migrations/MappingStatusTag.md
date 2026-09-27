# MappingStatusTag — migration guide

**antd `Tag` (preset colors) → `@agenta/ui` `Badge`** · tactic: **facade** · status: **✅ done** · no visual change.

## TL;DR
`MappingStatusTag` maps a `MappingStatus` to an antd `Tag` `color` + an optional icon. The facade renders `<Badge variant={getVariant(status)}>` with the same icon/label. Uses the `blue`/`green`/`red`/`orange`/`default` variants (red/orange added with SourceIndicator).

## Mapping (`getVariant`, mirrors the old `getTagColor`)
`auto`→`blue`, `manual`→`green`, `missing`/`invalid_path`→`red`, `type_mismatch`→`orange`, `optional`/default→`default`.

## Before → After
```tsx
// BEFORE
<Tag color={getTagColor(status)} className={cn("m-0", showIcon && "flex items-center gap-1", size==="small" && "text-xs py-0", className)}>{icon}{displayLabel}</Tag>
// AFTER
<Badge variant={getVariant(status)} className={cn(size==="small" && "text-xs py-0", className)}>{icon}{displayLabel}</Badge>
```
(Badge base is already `inline-flex items-center gap-1`, so the `flex items-center gap-1` icon classes are no longer needed.)

## Usage
Unchanged API (`status`, `showIcon`, `size`, `label`, `className`). Icon (`MagicWand`/`Warning`) still rendered as the first child. `getMappingStatusConfig` still used for the label.

## Infra
Reuses `blue`/`green`/`red`/`orange`/`default` variants (see [SourceIndicator.md](SourceIndicator.md) for the orange/red preset addition). No new tokens.

## Verification
All target variants pixel-verified vs antd (story `PresetColors`, both modes). Component itself has no dedicated story yet (statuses need valid `MappingStatus` values); the mapping is mechanical over verified variants.

## For agents
Facade; status→variant is `getVariant` in-file. Add a status → add a case (all target variants exist).

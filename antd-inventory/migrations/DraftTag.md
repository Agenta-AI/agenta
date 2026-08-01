# DraftTag — migration guide

**antd `Tag` → `@agenta/ui` `Badge` (`variant="draft"`)** · tactic: **facade** · status: **✅ done** · no visual change · no call-site changes.

## TL;DR
`DraftTag` is now a thin facade over `@agenta/ui/ui`'s `Badge`. Same public API. It renders a `<span>` (was an antd `.ant-tag`), with **no antd** and no `--ag-c-*` shim. Pixel-identical in light + dark (verified). Its 3 consumers (all passing only `className`) are unchanged.

## Before
`packages/agenta-ui/src/components/DraftTag.tsx`:
```tsx
import {PencilSimpleLine} from "@phosphor-icons/react"
import {Tag} from "antd"
import type {TagProps} from "antd"
import {cn} from "../utils/styles"

export interface DraftTagProps extends Omit<TagProps, "children"> {
    label?: string; showIcon?: boolean; iconSize?: number
}
export function DraftTag({label = "Draft", showIcon = true, iconSize = 14, className, ...tagProps}: DraftTagProps) {
    return (
        <Tag className={cn("flex items-center gap-1 font-normal bg-[var(--ag-c-FFFBE6)] text-[var(--ag-c-D48806)] border-[var(--ag-c-FFE58F)] !m-0", className)} {...tagProps}>
            {showIcon && <PencilSimpleLine size={iconSize} />}
            {label}
        </Tag>
    )
}
```

## After
```tsx
import {PencilSimpleLine} from "@phosphor-icons/react"
import {Badge, type BadgeProps} from "./ui/badge"

export interface DraftTagProps extends Omit<BadgeProps, "children" | "variant" | "icon"> {
    label?: string; showIcon?: boolean; iconSize?: number
}
export function DraftTag({label = "Draft", showIcon = true, iconSize = 14, ...rest}: DraftTagProps) {
    return (
        <Badge variant="draft" icon={showIcon ? <PencilSimpleLine size={iconSize} /> : undefined} {...rest}>
            {label}
        </Badge>
    )
}
```

## Usage
- **Existing call-sites — unchanged, keep working:** `<DraftTag />`, `<DraftTag className="cursor-pointer" />`, `<DraftTag label="Unsaved" />`, `<DraftTag showIcon={false} />`.
- **New code — either is fine:**
  - Ergonomic: `<DraftTag />` (the facade is a legitimate, stable API).
  - Direct: `<Badge variant="draft" icon={<PencilSimpleLine size={14} />}>Draft</Badge>` (import `Badge` from `@agenta/ui/ui`).
- **End state (optional, later):** migrate call-sites to `<Badge variant="draft">` and delete `DraftTag`, OR keep `DraftTag` as an ergonomic alias. Not required for the migration to be "done".

## Prop mapping (antd Tag → Badge)
| DraftTag prop | before | after |
|---|---|---|
| `label` | `<Tag>` children | `<Badge>` children |
| `showIcon` / `iconSize` | conditional `<PencilSimpleLine>` | `Badge` `icon` prop |
| `className` | `Tag` className (`.ant-tag`) | `Badge` className (`<span>`) |
| `...rest` | `TagProps` (antd) | `BadgeProps` = `HTMLAttributes<HTMLSpanElement>` |

**Dropped:** antd-only `Tag` props (`color`, `closable`, `bordered`, …) are no longer accepted. Verified none of the 3 consumers used them. If a future consumer needs one, map it in the facade or extend `Badge`.

## Infra added (the "how")
| Layer | Change |
|---|---|
| `palette.ts` | `+draftTag` family: `text {#d48806,#d48806}`, `bg {#fffbe6, var(--ag-colorBgElevated)}`, `border {#ffe58f, var(--ag-colorBgElevated)}`; added to the `palette` aggregate. |
| `generate-tailwind-tokens.ts` | 3 FEATURES rows → `--ag-draft-text` / `--ag-draft-bg` / `--ag-draft-border`. |
| `oss/tailwind.config.ts` (`shadcnTokens`) | `+draft: {DEFAULT: --ag-draft-text, bg: --ag-draft-bg, border: --ag-draft-border}`. |
| `Badge` | `+draft` variant: `"bg-draft-bg border-draft-border text-draft font-normal"`. |

Regenerate after palette/generator edits: `pnpm generate:tailwind-tokens` (writes theme-variables.css; **antd config untouched**).

## Gotchas
- **DOM changed:** `.ant-tag` → `<span>`. No repo CSS targets `.ant-tag` for DraftTag (checked). New CSS targeting the old class won't match.
- **Dark rendering is the preserved legacy-shim behavior:** neutral elevated bg (`#242424`) + gold text (`#d48806`), NOT a gold fill — because `--ag-c-FFFBE6 → colorBgElevated` in dark. The `draftTag.bg`/`border` dark values reference `var(--ag-colorBgElevated)` to mirror this exactly. ⚠️ **Candidate cleanup:** make dark gold-tinted (like `warning` `#2b2111`) — a deliberate visual change, deferred.
- `!m-0` dropped — the `Badge` span has no default margin (antd `Tag` did).

## Verification (computed styles: old antd DraftTag vs Badge `draft`)
| | light | dark |
|---|---|---|
| bg | `#fffbe6` | `#242424` |
| border | `#ffe58f` | `#242424` |
| text | `#d48806` | `#d48806` |
| height / weight / radius | 24.4px / 400 / 6px | 24.4px / 400 / 6px |
| **result** | **MATCH** | **MATCH** |
Story: `antd/Data Display/Badge (consolidation) → DraftCollapse`.

## For agents hitting conflicts
- `DraftTag.tsx` is a **facade** — do NOT reintroduce antd `<Tag>` or the `--ag-c-*` shim classes.
- The `draft` look lives in the **`draftTag` palette family + `Badge` `draft` variant**, not in `DraftTag`. Change appearance there (and regenerate), not by adding classes to `DraftTag`.
- If a merge brings back a consumer using an antd-`Tag`-only prop, map it in the facade or extend `Badge` — don't revert the facade.

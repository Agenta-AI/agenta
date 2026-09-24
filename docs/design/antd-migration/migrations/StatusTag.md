# StatusTag — migration guide

**antd `Tag` (semantic colors) → `@agenta/ui` `Badge` (existing variants)** · tactic: **facade** · status: **✅ done** · no visual change.

## TL;DR
`StatusTag` maps a status enum to antd `Tag` `color` names — all of which are **already** Badge variants. No new tokens. The facade is just a status→variant map + the `size="small"` geometry via className.

## Mapping
| status | antd color | Badge variant |
|---|---|---|
| `success` / `ready` | `success` | `success` |
| `error` | `error` | `error` |
| `loading` / `pending` | `warning` | `warning` |
| `running` | `processing` | `processing` (= `info`) |
| `idle` / default | `default` | `default` |

## Before → After
```tsx
// BEFORE
<Tag color={getStatusColor(status)} className={`m-0 ${size==="small" ? "text-[10px] leading-tight py-0" : ""} …`}>{label}</Tag>
// AFTER
<Badge variant={STATUS_VARIANT[status] ?? "default"} className={clsx(size==="small" && "text-[10px] leading-tight py-0", className)}>{label}</Badge>
```

## Usage
- **Unchanged:** `<StatusTag status="running" />`, `<StatusTag status="success" size="small" />`.
- Helpers `getStatusColor` / `getStatusLabel` kept (still exported). `getStatusColor` (returns antd color strings) is now unused internally but preserved for external callers.
- **`EnvironmentTag`** (same file) is NOT migrated yet — still antd `Tag` + `--ag-env-*` style vars. Follow-up (a domain tag; would become `<Badge style={{…}}>`).

## Infra added
**None.** Maps to existing Badge variants. The only change touching the shared layer was a **precision fix**: `Badge` line-height a rounded `1.8667` ratio → the exact `1.8666666666666667` so it computes to exactly `22.4px` (antd's `lineHeightSM`) instead of `22.4004px`. Sub-pixel, but makes the parity gate byte-exact — benefits every variant.

## Gotchas
- **Line-height precision:** antd's `lineHeightSM` is `1.86666…`; a rounded `1.8667` yields `22.4004px` — measure `lineHeight` in the parity gate, not just `{h,bg,color}`, to catch this.
- `running` = antd `processing` = our `info`/`processing` variant (navy light / blue dark) — not a spinner.

## Verification (StatusTag vs mapped Badge, both modes)
All statuses MATCH (bg, color, height, line-height, padding): success `#f6ffed`/`#389e0d`, error `#fbe7e7`/`#d61010`, pending `#fffbe6`/`#faad14`, running `#f5f7fa`/`#1c2c3d` (light) / `#111a2c`/`#1668dc` (dark), idle chip fill, and `size=small` (10px/leading-tight). Story: `Badge (consolidation) → StatusCollapse`.

## For agents hitting conflicts
- `StatusTag` is a facade; the status→variant map is `STATUS_VARIANT` in the same file. Add a status → add a map entry (all target variants already exist).
- `EnvironmentTag` in this file is still antd — don't assume the whole file is migrated.

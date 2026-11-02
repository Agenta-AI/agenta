# Skeleton (antd `Skeleton` → `@agenta/ui/ui`)

## TL;DR
antd `Skeleton` is ported as a presentational cva component (plain `div`/`ul`/`li`, no Radix).
It ships a base block (`SkeletonBlock`), an avatar (`SkeletonAvatar`), and a composite
`Skeleton` that reproduces antd's default avatar + title + paragraph layout. The `active`
shimmer is antd's swept gradient driven by the shared `animate-skeleton` keyframe already in
`tailwind.config`. No visual change vs antd.

## Before
antd `<Skeleton>` / `<Skeleton active avatar>` / `<Skeleton.Avatar>`, styled by antd's cssinjs
(`skeletonLoadingBackground`, `gradientFromColor`, `gradientToColor`, `titleHeight`, etc.).

## After
`@agenta/ui/ui` `Skeleton` (composite), `SkeletonAvatar`, `SkeletonBlock`. cva variants:
- `active` — `true` = swept gradient + `animate-skeleton`; `false` = flat `bg-fill-secondary`.
- `shape` — `block` (6px) / `round` (8px) / `circle` (50%) / `square` (0).

## Usage
```tsx
import {Skeleton, SkeletonAvatar, SkeletonBlock} from "@agenta/ui/ui"

<Skeleton />                         // title + 3 paragraph rows (antd default)
<Skeleton active avatar />           // shimmer, large circle avatar + title + 2 rows
<Skeleton loading={isLoading}>...</Skeleton>  // renders children when loading === false
<SkeletonAvatar size="large" shape="circle" active />
<SkeletonBlock className="h-6 w-40" />
```

## Prop mapping (antd `<Skeleton active avatar title paragraph loading round>` → ours)
| antd | ours | notes |
|---|---|---|
| `active` | `active` | shimmer on/off — an animation; VRT compares a frozen frame |
| `loading` | `loading` | `loading===false` → render `children` (antd semantics) |
| `avatar` (`bool` \| `{size,shape}`) | `avatar` | default composite avatar = `size:"large"`, `shape:"circle"` (square when title-only) |
| `title` (`bool` \| `{width}`) | `title` | width auto: 38% (no-avatar+para), 50% (avatar+para), else 100% |
| `paragraph` (`bool` \| `{rows,width}`) | `paragraph` | rows auto: 3 (no-avatar+title) else 2; last row 61% unless avatar+title |
| `round` | `round` | blocks use 8px radius |
| `Skeleton.Avatar` | `SkeletonAvatar` | `size` small/default/large = 24/28/34 (app-overridden seed) |
| — | `SkeletonBlock` | generic block primitive (defaults to a full-width 16px bar) |

## Infra added
None. Reuses existing bridge tokens (`bg-fill-secondary`, `--ag-colorFillSecondary`,
`--ag-colorFill`), the `controlScale` radii (`rounded-control-sm/-round`), and the
pre-existing `skeleton` keyframe + `animate-skeleton` in `oss/tailwind.config.ts`.

## antd → token mappings (measured from antd v6.3.7 source `skeleton/style/index.js`)
- Base block colour = `gradientFromColor` = `colorFillContent` = `colorFillSecondary`
  → **`bg-fill-secondary`** (light `rgba(5,23,41,0.06)`).
- `active` shimmer = `linear-gradient(90deg, gradientFromColor 25%, gradientToColor 37%,
  gradientFromColor 63%)` with `gradientFromColor=colorFillSecondary` (`--ag-colorFillSecondary`)
  and `gradientToColor=colorFill` (`--ag-colorFill`, `rgba(5,23,41,0.15)`); `background-size:
  400% 100%`; `skeleton 1.4s ease infinite`.
- Radius: `blockRadius=borderRadiusSM=6px` → `rounded-control-sm`; `round`=8px →
  `rounded-control`; avatar circle=50% → `rounded-control-round`.
- Geometry (measured against the app-themed antd, whose seed is overridden so
  `controlHeight=28`, `controlHeightSM=24`, `controlHeightLG=34` — NOT antd stock 32/24/40):
  - `titleHeight = paragraphLiHeight = controlHeight/2 = 14px` → **`h-3.5`** (was wrongly `h-4`=16).
  - avatar sm/default/lg = `controlHeightSM/controlHeight/controlHeightLG` = 24/28/34 →
    **`size-6` / `size-7` / `size-[34px]`** (34 has no 4px-step scale key; arbitrary value).
  - base `Skeleton.Button` block = `controlHeight` = 28 (the base-block story uses `h-7`).
  - header pad = `padding` = 16 → `pr-4`; row gap (`li + li`) = `controlHeightXS` = 16 → `mt-4`.
  - title→paragraph gap: no-avatar = `controlHeightSM` = 24 (`mt-6`); with-avatar =
    `paragraphMarginTop = marginLG + marginXXS` = 28 (`mt-7`). avatar→title top = `marginSM` = 12
    (`mt-3`, overrides the h3 UA top margin).
  - **UA margins are part of antd's layout — match the TAGS.** antd's title is an `<h3>` and the
    paragraph a `<ul>`; under preflight-off both keep their UA `margin-block`: the h3 = 1em @ its
    14.04px font = **14.04px** top+bottom; the ul = 1em @ 12px = **12px** top+bottom. antd only
    zeroes the ul `padding` and sets the title-top / title→para overrides above. So agenta renders
    the title as `<h3>` (no margin reset) and the `<ul>` with `list-none p-0` (NOT `m-0`). This is
    the `<h3>` UA-margin trap from GOTCHAS.md: title-only root = 14 + 14.04 + 14.04 = 42px, default
    root = 138px, avatar composite = 110px — all driven by these UA margins.
- Content-driven widths (38/50/61%) are inline styles, exactly as antd does (not px/hex tokens).

## Accessibility
The placeholder is decorative, so every root (`Skeleton`, `SkeletonAvatar`, `SkeletonBlock`)
carries `aria-hidden` — screen readers skip it (matches antd, which sets no role). If a caller
needs a live-region announcement, wrap it in `role="status" aria-busy`.

## Gotchas
- `box-border` required (preflight OFF app-wide).
- The `<ul>` uses `list-none p-0` — **NOT `m-0`**. antd only zeroes the ul padding and KEEPS the
  UA `margin-block` (12px), which its layout depends on; zeroing it made the roots 12px short.
  The `<li>` gets `list-none` to drop bullets.
- **The title must be an `<h3>`** (matching antd's tag), not a `<div>`. Under preflight-off the h3
  keeps its UA 14.04px `margin-block`, which antd relies on for the title-only / default root
  heights (42 / 138px). A `<div>` title has no such margin and reads 12–28px short per row.
- `active` sets ONLY the gradient (no flat `bg-fill-secondary` under it), matching antd's
  `background:` shorthand — layering a translucent fill under a translucent gradient would
  darken the block.

## Verification
Run the VRT first: `pnpm --filter @agenta/storybook vrt antd-feedback-skeleton--antd-vs-agenta`
(light + dark). The `active` row is an animation — the VRT freezes it at one frame, so a small
residual from gradient phase is expected floor, not a defect; confirm colours with `measure.js`
if unsure. Non-interactive component → prove non-focusable (no tabindex, `aria-hidden`).

## Deferred pieces
`Skeleton.Button`, `Skeleton.Input`, `Skeleton.Image`, `Skeleton.Node` are not ported (rare in
this codebase). Add them as element variants (button/input = block with `rounded-control-sm`;
image/node = shape block) when a call-site needs them.

## For agents hitting conflicts
The single source of truth for geometry is antd's `skeleton/style/index.js`
(`prepareComponentToken` + `genBaseStyle`). Re-derive any changed value from there, keep colour
on the `--ag-*` bridge and radii/spacing on `controlScale` — never hardcode px/hex.

# Avatar (antd `Avatar` → `@agenta/ui/ui`)

## TL;DR
antd `Avatar` is ported to the Radix `@radix-ui/react-avatar` primitive (`Avatar`,
`AvatarImage`, `AvatarFallback`), following the shadcn source style (no `forwardRef`,
`data-slot` on every part, `cva`, `cn`). An antd-shaped convenience wrapper, `AvatarBox`,
keeps antd's single-tag API (`src`/`alt`/`icon`/children + `size`/`shape`) so call-sites —
and the existing `InitialsAvatar` — fold into it 1:1. No visual change vs antd, proven in
both themes across size × shape × (image / initials / icon). `size` accepts the presets
**and** a raw pixel number (call-sites pass `size={18}`).

## Before
antd `<Avatar>` / `<Avatar size="small"|"large"|18>` / `<Avatar shape="square">` /
`<Avatar src=… />` / `<Avatar icon={…} />` / `<Avatar>AE</Avatar>`, rendered as
`span.ant-avatar(.ant-avatar-sm/-lg)(.ant-avatar-circle/-square)` with an inner
`.ant-avatar-string` (JS-scaled to fit), `img`, or icon. Styled by antd's cssinjs.

Existing wrappers over antd `Avatar` (all fold into `AvatarBox`):
- `@agenta/ui` `InitialsAvatar` — `shape="square"`, hashed bg/text colour from the name,
  `getInitials(name)` as children. Consumers: Sidebar (`SidebarSelectionButton`,
  `ListOfProjects`, `ListOfOrgs`, `useDropdownItems`), settings `AvatarWithLabel`,
  `UserAuthorLabel` (`@agenta/entities`, `className="w-4 h-4 text-[9px]"`),
  `AssignmentsCell` (`@agenta/annotation-ui`, `size={18}`).
- observability `AvatarTreeContent` — `shape="square" size="small"` transparent bg + icon.
- `AgentMessage` `<Avatar size="small" icon={…} />`.

## After
`@agenta/ui/ui` `avatar.tsx`. DOM: `span[data-slot=avatar]` (Radix Root, the styled box) →
`img[data-slot=avatar-image]` (when `src`) + `span[data-slot=avatar-fallback]` (Radix
Fallback, flex-centred). String children render inside `span[data-slot=avatar-text]`, which
carries antd's shrink-to-fit `scale()`.

```tsx
<Avatar size="large" shape="square">     // primitive (compose yourself)
  <AvatarImage src={url} alt="…" />
  <AvatarFallback>AE</AvatarFallback>
</Avatar>

<AvatarBox size="small">AE</AvatarBox>                       // antd-shaped convenience
<AvatarBox size={18} shape="square">AE</AvatarBox>           // numeric size
<AvatarBox src={url} alt="Ada" />                            // image
<AvatarBox icon={<User size={16} />} alt="user" />          // icon fallback
```

## Usage
- **New code:** use `AvatarBox` for the common one-tag case; drop to the three primitives
  only when you need custom composition.
- Not yet exported from the `@agenta/ui/ui` barrel (`index.ts` was out of scope for the
  build). Add
  `export {Avatar, AvatarImage, AvatarFallback, AvatarBox, avatarVariants, type AvatarProps, type AvatarBoxProps, type AvatarSize, type AvatarShape} from "./avatar"`
  to `web/packages/agenta-ui/src/components/ui/index.ts` when wiring the first call-site.
  (The parity story imports the file by relative path for the same reason.)
- **`InitialsAvatar` end-state:** re-implement it as a thin facade over `AvatarBox`
  (`shape="square"`, hashed colours via inline `style`, `getInitials(name)` as children).
  `AvatarBox` already covers every prop it passes (`size` preset+number, `className`,
  `style`). Do this at facade time; the antd-parity proof lives here on the pre-facade
  rendering.

## Prop mapping
| antd `Avatar` | `AvatarBox` | notes |
|---|---|---|
| `src` | `src` | rendered as `AvatarImage`; root fill cleared, image `object-cover` |
| `alt` | `alt` | image `alt`; also the `aria-label` for an icon-only avatar |
| `icon` | `icon` | fallback content when no `src`/children |
| children | children | string/number → shrink-to-fit `AvatarText`; other node → as-is |
| `size` `small`/`default`/`large` | `size` same | 24 / 28 / 34 px (app-overridden seed) |
| `size={number}` | `size={number}` | inline w/h; font = string 18 / icon `size/2` |
| `shape` `circle`/`square` | `shape` same | circle 50%; square radius scales by size |
| `gap` | `gap` | min px from initials to edge (default 4); drives the fit scale |
| `srcSet`/`draggable`/`crossOrigin` | pass to `AvatarImage` (primitive) | not on `AvatarBox` |

## Infra added
**None.** No palette family, generator row, bridge token, or scale key was needed:
- box dims reuse `size-control-sm/-/-lg` (24/28/34).
- radius reuses `rounded-control-round` (50%) and `rounded-control-sm/-/-lg` (6/8/10).
- fill = `bg-colorTextPlaceholder` (antd's exact default avatar bg in **both** themes:
  `#bdc7d1` light, `rgba(255,255,255,.38)` dark), text = `text-colorTextLightSolid`
  (white in both). `font-portal` for the initials font under preflight-off.
- The 18/20 px glyph sizes have **no** control-scale font key, so they use arbitrary
  `text-[Npx]` (noted in-file). This is data, not a new scale — no `tailwind.config`
  change, so nothing to register in `cn`'s `extendTailwindMerge`.

## Gotchas
- **`text-*` collision (the classic).** The size variant first used a made-up
  `text-avatar-sm` ramp; tailwind-merge classifies any unknown `text-*` as a *colour*, so
  it silently dropped `text-colorTextLightSolid` and the initials rendered in the inherited
  (non-white) colour — invisible to tsc, caught by the computed-style read. Fix: arbitrary
  `text-[Npx]` (a real font-size to tailwind-merge) leaves the colour class intact.
- **antd's default font-size splits by content.** String default = 18 px, **icon** default
  = 16 px (small/large agree at 12/20). `AvatarBox` sets the font-size inline from a
  per-content table so both match; for icons it is cosmetic anyway (the SVG carries an
  explicit px `size`).
- **Square radius is size-dependent** (6/8/10), unlike circle (always 50%). A single
  `rounded-control` for square was 2 px off at small/large — fixed with `compoundVariants`.
  Numeric sizes have no preset → they fall back to the 8 px `square` base (matches antd).
- **Initials shrink-to-fit is antd behaviour, not shadcn.** antd measures the string and
  applies `scale = min(1, (width - gap*2)/textWidth)` (gap 4). Skipping it makes numeric/
  small avatars overflow (numeric-18 "AE" is `scale(0.4348)` in antd). `AvatarText`
  reproduces it with a `ResizeObserver`; `offsetWidth` is transform-independent so one pass
  settles.
- **Re-fit on web-font swap.** The first measure ran with the fallback font (glyph ~1 px
  wider) → the wrong scale, and the box never changed so the observer never re-fired. Fix:
  `ro.observe(el)` on the text **and** `document.fonts.ready` — a scale transform can't
  change the content-box, so there is no observer loop.
- **Image avatars clear the root fill.** antd sets the root `background: transparent` once
  an image is present (the image covers it); the fill moves to the fallback so an image
  **error** still shows a filled placeholder. `AvatarBox` mirrors this: `bg-transparent` on
  the root + `bg-colorTextPlaceholder` on the fallback when `src` is set. (Without it the
  root's computed bg diverges from antd even though the image masks it visually.)
- `box-border` is mandatory (preflight OFF) or `size-full` fallbacks double up.

## Verification
Computed-style parity (`getComputedStyle`, transitions killed) via the `.grid` comparison
story `antd/Data Display/Avatar`, **light + dark**, over 12 rows = size × shape ×
(image / initials / icon) + numeric. All match on width, height, background, colour,
border-radius, font-size and font-family:
- box 24/28/34; circle 50%; square 6/8/10; numeric 18 → 8.
- fill `#bdc7d1` / `rgba(255,255,255,.38)`; text white both themes.
- font root 12/18/20 (string), 12/16/20 (icon), image root transparent.
- initials `scale()` transform matches antd to 6 decimals (default `0.869565`, large `1`,
  numeric-18 `0.434783`); rendered glyph bounding box identical.

Screenshots (light + dark) confirm no clipping and pixel-identical columns. Icon avatars
carry `aria-label` (from `alt`), image avatars carry `alt`, initials avatars have text
content — accessible names present for axe.

Not run here (out of scope per the build brief): the pixel VRT and `parity/vrt.mjs`. The
component is display-only; interaction-state parity does not apply (see below).

## Deliberate deviations
- **Provably non-interactive.** Like Badge/Tag, the avatar is a `<span>` with no
  `tabindex` and no focus affordance — there is no hover/focus/active/disabled state to
  match. Radix `Avatar.Root` renders a plain span; it is not focusable.
- **Icon-default root font-size** is matched (16 px) even though it is visually inert (the
  icon SVG sizes itself), purely so the computed-style gate reads clean.
- **Radix `Check`/indicator affordances** — n/a (avatar has no such parts).

## For agents hitting conflicts
- The single source of truth for dims/radius/fill is `avatarVariants` (cva) in
  `avatar.tsx`; font-size lives partly in the cva size variant (string defaults) and partly
  inline in `AvatarBox` (icon/numeric precision). If you change one, re-measure both.
- Do **not** replace the `AvatarText` `ResizeObserver` with a static font-size — long or
  large-box initials will overflow exactly where antd would have shrunk them.
- When wiring the barrel export and facading `InitialsAvatar`, keep the antd-parity claims
  above pinned to the pre-facade rendering (the comparison story), not the facade.

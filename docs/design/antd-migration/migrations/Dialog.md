# Dialog (+ AlertDialog)

Migration guide: antd `Modal` → `@agenta/ui/ui` `Dialog` (Radix `@radix-ui/react-dialog`),
and antd confirm `Modal` → `@agenta/ui/ui` `AlertDialog` (Radix `@radix-ui/react-alert-dialog`).

## TL;DR
- New primitives `Dialog` and `AlertDialog` in `@agenta/ui/ui`, current shadcn source style
  (no `forwardRef`, ref-as-prop, `data-slot` on every part, `cva`, `cn` from `./utils`).
- Chrome measured against antd `Modal` via `getComputedStyle` (light + dark), not source
  constants: content `bg-colorBgElevated`, borderless, radius **16px** (`rounded-[16px]` — the
  app's `EnhancedModal` sets `style={{borderRadius:16}}`, NOT antd's raw `borderRadiusLG` 10px;
  candidate token `control-xl`), padding 20px/24px (`py-5 px-6`), `shadow-dialog`, width
  520px (`max-w-[520px]`), `font-portal`. Mask/overlay `bg-colorBgMask` (`fixed inset-0`).
  Title 16px/20px weight 600 `text-colorTextHeading`. Close X 28px at 13px/13px, radius 6px,
  `text-colorIcon`, 14px lucide `X`.
- Motion via the pre-provisioned classes: overlay `animate-overlay-in/out`, content
  `animate-dialog-in/out`.
- Parity proven with the forced-OPEN `[data-open-compare]` `OpenState` stories (both dialogs
  portaled inline via `container` / `getContainer`).

## Before (antd)
```tsx
import {Modal} from "antd"

<Modal
    open={open}
    onCancel={() => setOpen(false)}
    onOk={handleOk}
    title="Modal title"
    width={520}
>
    <p>Body content</p>
</Modal>

// Confirm:
Modal.confirm({title: "Delete item?", content: "This cannot be undone.", onOk})
```

## After (@agenta/ui)
```tsx
import {
    Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter,
    DialogTitle, DialogDescription, DialogClose, Button,
} from "@agenta/ui/ui"

<Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button>Open</Button></DialogTrigger>
    <DialogContent>
        <DialogHeader><DialogTitle>Modal title</DialogTitle></DialogHeader>
        <DialogDescription>Body content</DialogDescription>
        <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleOk}>OK</Button>
        </DialogFooter>
    </DialogContent>
</Dialog>

// Confirm → AlertDialog (no close X; dismiss only via an action):
import {
    AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
    AlertDialogFooter, AlertDialogTitle, AlertDialogDescription,
    AlertDialogAction, AlertDialogCancel,
} from "@agenta/ui/ui"

<AlertDialog>
    <AlertDialogTrigger asChild><Button variant="outline">Delete</Button></AlertDialogTrigger>
    <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Delete item?</AlertDialogTitle></AlertDialogHeader>
        <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleOk}>Delete</AlertDialogAction>
        </AlertDialogFooter>
    </AlertDialogContent>
</AlertDialog>
```

## Usage
- `DialogContent` renders Portal + Overlay + Content + a top-right close X (lucide `X`).
  Pass `showCloseButton={false}` to drop the X (antd `closable={false}`).
- `container?: HTMLElement | null` on `DialogContent`/`AlertDialogContent` is passed to the
  Portal — defaults to `document.body`; pass an element to render inline (scroll container, or
  the forced-open parity story). Mirrors antd `getContainer`.
- `DialogHeader`/`DialogFooter` are plain styled `div`s (shadcn layout helpers). The
  `DialogContent` uses a uniform `gap-3` (12px) between header/body/footer, which reproduces
  antd's rendered 12px title→body and body→footer rhythm; the footer carries no extra top
  margin (it keeps `gap-2` only for horizontal button spacing).
- `AlertDialogAction` = primary `Button` styling, `AlertDialogCancel` = `outline` Button
  styling (both via the exported `buttonVariants`); style them by passing `className`.
- Radix requires a `DialogTitle` for a11y; if a dialog has no visible title, wrap one in
  `VisuallyHidden` or pass `aria-label` on the content.
- End state: every antd `Modal` call-site becomes a `Dialog`; every `Modal.confirm` /
  force-a-choice modal becomes an `AlertDialog`. Never leave a call-site on antd `Modal`.

## Prop mapping
| antd `Modal` | `@agenta/ui` |
|---|---|
| `open` | `open` (on `Dialog`/`AlertDialog` root) |
| `onCancel` | `onOpenChange(false)` (or `DialogClose`) |
| `onOk` | `onClick` on the footer action `Button` |
| `title` | `DialogTitle` |
| `footer` | `DialogFooter` children |
| `closable={false}` | `showCloseButton={false}` (Dialog); AlertDialog has no X |
| `getContainer` | `container` (on `DialogContent`) |
| `width` (default 520) | `max-w-[520px]` default; override via `className` |
| `centered` | default (agenta always centers — see Deliberate deviations) |
| `Modal.confirm(...)` | `AlertDialog` composition |

## Infra added
None. All tokens/keyframes were pre-provisioned in `oss/tailwind.config.ts`:
- `shadow-dialog` (boxShadow), `bg-colorBgMask`, `bg-colorBgElevated`, `text-colorTextHeading`,
  `text-colorIcon`/`hover:text-colorIconHover`, `rounded-control-lg`, `font-portal`.
- keyframes/animation: `overlay-in`/`overlay-out` (mask fade) and `dialog-in`/`dialog-out`
  (zoom+fade, antd `motionEaseOutCirc`).
- `AlertDialogAction`/`Cancel` reuse the existing `buttonVariants` from `button.tsx`.

Deps `@radix-ui/react-dialog` and `@radix-ui/react-alert-dialog` are already in
`packages/agenta-ui/package.json`.

## Gotchas
- **antd v6 DOM rename.** The styled content box is `.ant-modal-container` (inside
  `.ant-modal[role=dialog]`), NOT the v5 `.ant-modal-content`. Header/body/footer keep
  `.ant-modal-header` / `.ant-modal-title` / `.ant-modal-body` / `.ant-modal-footer`; close is
  `.ant-modal-close` (icon `.ant-modal-close-icon svg`). A v5 selector reads the wrong element.
- **Radius is 16px — match the app's `EnhancedModal`, not raw antd.** `oss/.../EnhancedUIs/Modal`
  sets `style={{borderRadius:16}}`, so every app modal renders a 16px content radius. antd's raw
  `Modal` is `borderRadiusLG` = 10px, so the parity story's antd side applies
  `styles={{content:{borderRadius:16}}}` to mirror the app — otherwise you'd be matching the wrong
  reference. The content uses `rounded-[16px]` (candidate token `control-xl`).
- **Padding is 20px vertical / 24px horizontal** (`py-5 px-6`) — asymmetric; `p-5` is wrong.
- **Title/description are `<h2>`/`<p>`; preflight is OFF** so they keep UA margins (13.28px /
  12px) and the h2's bold weight. Reset with `m-0` (weight is set to `font-semibold`).
- **Close X is a native `<button>`** under preflight-off: needs `bg-transparent`, `border-0`,
  `font-[inherit]`, `p-0`, `box-border`. Size the lucide `X` with `size-3.5` (14px), not the
  `size` prop.
- **Overlay only renders in modal mode.** Radix `Dialog.Overlay` returns null when
  `modal={false}`, so keep the dialog modal to show the mask.
- **Two force-open modals fight for focus/`aria-hidden`** → "Maximum call stack size exceeded".
  Keeping both modal, the `OpenState` story tames it with `onOpenAutoFocus`/`onCloseAutoFocus`/
  `onPointerDownOutside`/`onInteractOutside` `preventDefault` on the agenta content (real Radix
  callbacks). Do NOT use `modal={false}` for the compare — it drops the overlay.
- **`position: fixed` needs a containing block for side-by-side.** The `OpenState` panel sets
  `[transform:translateZ(0)]` so both the `fixed inset-0` overlay and the centered content are
  confined to their column (else both center on the viewport and overlap).
- **The built-in close X uses `data-slot="dialog-close-x"`**; the standalone `DialogClose`
  component uses `data-slot="dialog-close"`. Distinct slots so a footer `DialogClose` and the
  corner X don't collide in selectors.

## Verification
Ground truth measured with Playwright `getComputedStyle` (deviceScaleFactor 2), light + dark,
on the `OpenState` stories (`antd-feedback-dialog--open-state`,
`antd-feedback-alertdialog--open-state`). All values match antd:

| Property | antd | agenta |
|---|---|---|
| content width | 520px | 520px |
| content radius | 16px (app EnhancedModal) | 16px |
| content padding | 20px 24px | 20px 24px |
| content bg (light/dark) | #fff / #242424 | #fff / #242424 |
| content border | none | none |
| title font | 16px/20px 600 | 16px/20px 600 |
| title color (light/dark) | #1c2c3d / rgba(255,255,255,.85) | same |
| body font/color | 12px/20px colorText | 12px/20px colorText |
| close X box | 28×28 @ 13px/13px r6 | 28×28 @ 13px/13px r6 |
| close icon | 14px colorIcon | 14px colorIcon |
| mask/overlay (light/dark) | rgba(5,23,41,.45) / rgba(0,0,0,.45) | same |

Content height 132px, body top 52px, footer top 84px — exact matches to antd (achieved via the
`gap-3` content rhythm; earlier drafts read 128/48 with a uniform `gap-2` + footer `mt-1`). The
pixel VRT + a11y gates are the orchestrator's to run; the `OpenState` `[data-open-compare]`
stories feed them (open panels portaled inline for the diff).

## Deliberate deviations
- **Centered, not top-aligned.** antd `Modal` defaults to `top: 100px`; per spec agenta always
  centers, equivalent to antd's `centered` prop. Centering is done with a flex positioner
  (`[data-slot=dialog-positioner]` = `fixed inset-0 grid/flex place-items-center`, content
  `relative`) — NOT a `-translate-*` transform. This is required: the `animate-dialog-in/out`
  keyframes animate `transform: scale(...)`, which fully replaces a static transform, so a
  translate-centered modal would drop its offset mid-zoom and jump. The positioner keeps the
  content's transform free for the scale keyframe (standard Radix/shadcn pattern).
- **Zoom origin.** antd zooms from the click origin; agenta zooms from center
  (`animate-dialog-in`). Documented, accepted.
- **Close-X offset `13px`.** No scale token maps to 13px, so the offset is an arbitrary value
  (`top-[13px] right-[13px]`) to match antd exactly — same pattern as tooltip's `max-w-[250px]`
  and accordion's `outline-offset-[-3px]` for non-control-dimension incidentals.
- **Dark modal shadow.** `shadow-dialog` is a fixed (non-theme-flipping) token that matches
  antd's LIGHT modal `boxShadow`. In dark, antd's modal shadow differs (it adds a
  `rgba(255,255,255,0.16) 0 0 0 1px` ring). This is a known, sub-perceptual divergence — if
  exact dark parity is wanted, `shadow-dialog` needs to become a theme-flipping token (like
  `shadow-overlay`). Flagged for the orchestrator.

## For agents hitting conflicts
- The overlay/content chrome is intentionally self-contained in `dialog.tsx` and
  `alert-dialog.tsx` (NOT imported from `sheet.tsx`, which is built in parallel). If you
  consolidate later, extract a shared overlay only after both land.
- If you retune control geometry, do it in `controlScale`/tokens, not here — this file carries
  no raw hex and only the two documented arbitraries (`max-w-[520px]`, `top-[13px]`/`right-[13px]`).
- The two `OpenState` stories are the parity gate for an overlay; a closed-trigger compare is
  meaningless. Keep them force-open + inline-portaled.

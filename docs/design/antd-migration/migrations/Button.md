# Button — migration guide

**antd `Button` → `@agenta/ui` `Button`** (`@agenta/ui/ui`) · status: **✅ primitive built (Radix + cva, following shadcn conventions) + all `@agenta/ui` call-sites migrated, tsc-clean** · no visual change.

## TL;DR
The `Button` is a **Radix + cva** primitive (`@agenta/ui`) — Radix `Slot` (`asChild`), `cva` variants, Tailwind
tokens, following shadcn source conventions — re-skinned to our theme so it renders pixel-identically to antd. It is **not** an
antd-prop drop-in: migrating a call-site means swapping the import *and* translating props.

```tsx
- import {Button} from "antd"
- <Button type="text" size="small">Go</Button>
+ import {Button} from "@agenta/ui/ui"
+ <Button variant="ghost" size="sm">Go</Button>
```

## Prop mapping (antd → `@agenta/ui`)

| antd | `@agenta/ui` |
|---|---|
| `type="primary"` | `variant="default"` |
| `type="default"` / bare | `variant="outline"` |
| `type="text"` | `variant="ghost"` |
| `type="link"` | `variant="link"` |
| `type="dashed"` | `variant="dashed"` |
| `danger` | `variant="destructive-outline"` |
| `type="primary" danger` | `variant="destructive"` |
| `size="small"` | `size="sm"` |
| `size="middle"` (default) | `size="default"` |
| `size="large"` | `size="lg"` |
| `shape="circle"` + `icon` | `size="icon"` + `className="rounded-full"` |
| `block` | `className="w-full"` |
| `htmlType="submit"` | `type="submit"` (native) |

**`icon` and `loading` are NOT props.** Stock shadcn's Button has neither, so neither does
ours:

| antd | `@agenta/ui` |
|---|---|
| `icon={<Plus />}` | `<Button><Plus />Add</Button>` — icons are children; the base handles svg sizing + `gap` |
| `loading` | `<LoadingButton loading>` from `@agenta/ui/ui` |

`asChild` (Radix `Slot`) renders a link/anchor as a button.

## Source style
Current shadcn source, matching what the CLI emits for React 19: **no `forwardRef`** (`ref`
is a normal prop) and a **`data-slot="button"`** attribute. Copy this shape for every new
primitive.

## Variants (cva)
- **variant**: `default | destructive | destructive-outline | outline | secondary | ghost | link | dashed`
- **size**: `sm | default | lg | icon | icon-sm`

No raw pixels: geometry and type come from the `control-*` / `btn-*` scale
(`controlScale` in `oss/tailwind.config.ts`) — `h-control`, `px-btn`, `text-btn-md`,
`rounded-control`. Retune sizing there, never in the component. Circle buttons use
`rounded-control-round` (50%, matching antd — `rounded-full`/9999px renders identically on a
square but the parity gate compares computed values).

## LoadingButton
`loading` keeps the variant's colours rather than taking the disabled skin (antd's
behaviour), so it must block activation itself: `pointer-events-none` for the mouse **plus**
a click guard, because Enter/Space on a focused button dispatch a click. The usual
`disabled={disabled || loading}` snippet would both fail parity and, on its own,
`pointer-events-none` would leave a busy submit button keyboard-activatable.

## Infra
`button` palette family → `--ag-btn-*` (primary-fg/hover/active, default-bg/hover-bg/active-bg,
text-hover-bg, **text-active-bg**, link/link-hover/**link-active**) → `btn` bridge tokens in
`oss/tailwind.config.ts`. Theme-specific:
**text-on-primary** flips (`#fff` light / `#141414` dark, since dark primary is light-yellow);
**default bg** is `#fff` light but **transparent** dark (antd `darkComponents.Button.defaultBg`).

## Gotchas (see also GOTCHAS.md)
- **`py-0`, `border-solid`, `box-border`, `font-[inherit]` required** — preflight is OFF
  (antd ships its own reset), so the native `<button>` leaks UA vertical padding, gets
  `border-style: none`, sizes as content-box, and renders in Arial instead of Inter. These
  live in the cva base as CONTROL_RESET and get deleted when antd goes and preflight comes
  back on.
- **Wrapper components that forwarded antd-typed props** (`size?: "small"|"middle"|"large"`,
  `type?: ButtonProps["type"]`) must have their **own prop types retyped** to
  `ButtonProps["size"]` / `ButtonProps["variant"]` — otherwise the antd string leaks through.
  Done for: DropdownButton, CopyButtonDropdown, CollapseToggleButton, LoadMoreButton,
  LoadAllButton, DrillInRootToolbar, FiltersPopoverTrigger.
- **Custom type ramps must be registered in `cn`** — `text-*` is shared between font-size
  and colour utilities, so tailwind-merge drops the variant's `text-foreground` unless the
  ramp is declared in `extendTailwindMerge`. See GOTCHAS.md; it renders every control black
  and type-checks fine.
- **Dynamic `danger={expr}`** has no shadcn equivalent — convert to a conditional variant:
  `variant={isCancel ? "destructive-outline" : "outline"}` (ModalFooter).
- **A bare `color` with no `variant` is INERT in antd v6 — check before "preserving" it.**
  `Button.js`'s resolution is `if (color && variant) return [color, variant]` and then, absent
  `type`/`danger`/a ConfigProvider pair, falls through to `['default', 'outlined']`. So
  `<Button color="danger">` with nothing else renders a **plain default-outlined** button; the
  `color` is discarded.
  RunButton passed exactly that (`color={isCancel ? "danger" : "default"}`), so **its Cancel
  button was never red in the app**. Migrating it to `variant="destructive-outline"` honours
  the author's evident intent but is a *deliberate new behaviour*, not parity — kept on
  purpose (Cancel is destructive; red is the right signal, and the old code was a latent bug).
  This entry previously filed that change under "Dynamic `danger={expr}`", which RunButton
  never used — i.e. the doc retro-justified a real visual change from a misreading. Verify
  what the old code *rendered*, not what it appears to say.
- **`Space.Compact` joins** target `.ant-btn` — rebase to `flex` + `-ml-px` + rounded-join
  (done for DropdownButton, ChatInputs).
- **Don't regex-rewrite JSX tags with a DOTALL `<Button[^>]*>` pattern** — it swallows nested
  JSX (`icon={<X className=.../>}`) and injects props into the wrong element. Bit us twice.
- **antd v6 `color`/`variant` API** — some call-sites used `<Button variant="outlined" color="danger">`.
  Note antd's `variant` and shadcn's `variant` are *different* props with overlapping names.

## Interaction states — hover / active / focus (all proven vs antd, both themes)
- **Keyboard focus ring** (`:focus-visible` only, no ring on mouse): `4px solid` the
  `focus-ring` token (= antd `colorPrimaryBorder` #d6dee6), `outline-offset: 1px`. This was
  dropped in the first cut (`outline-none`, no ring) — a real a11y regression — and restored.
- **Hover**: every variant's hover uses the measured antd `--ag-btn-*` token
  (`primary-hover #394857`, `text-hover-bg`, `link-hover`); danger uses `colorErrorHover`
  (which had to be added — it was undefined, so danger buttons had no hover).
- **`:active` (pressed) — a distinct state, initially missed.** antd darkens each variant to its
  `*Active` token on press. Wired: primary/danger → `active:bg` (`primary-active`/`error-active`);
  outline & dashed → `active:bg-btn-default-active-bg` **plus** `active:border/text-btn-primary-active`
  (border+text darken, not just bg); ghost → `active:bg-btn-text-active-bg`; link →
  `active:text-btn-link-active`; danger-outline → `active:border/text-error-active`. Two tokens
  were added for this (`btn-text-active-bg`, `btn-link-active`) — link goes **blue** in dark
  (`#3b8eea`), unlike primary's olive. Forced via `pseudo-active-all` in `InteractionStates`.
- **Note on the VRT + forced states:** bordered variants (outline/dashed) read ~8–11% on forced
  `:hover`/`:active` from 1px-border antialiasing, while the *same* forced state on primary/ghost
  reads <1% — the split proves it is AA, not a defect. Tokens confirmed with computed-style.

## Verification (VRT first)
`parity/vrt.mjs` is the primary gate. `AntdVsAgenta` renders each antd prop combo beside its
mapped `@agenta/ui` equivalent; `InteractionStates` forces hover / active / focus-visible per variant
(light + dark); `AbsorbedPresets` shows the facaded wrappers. Forced-state antd flags are
cross-checked with `measureForcedStates()` (antd forced states are pixel-unreliable).

## For agents
The `@agenta/ui` Button lives at `@agenta/ui/ui`. Migrate a call-site by swapping the import and
applying the mapping tables above — including moving `icon` into children and switching
`loading` to `LoadingButton`. If the file is a *wrapper* that re-exposes a `size`/`type`
prop, retype that prop to `ButtonProps["size"]` / `ButtonProps["variant"]` rather than
mapping values at the boundary. Never introduce a raw pixel value; add to `controlScale`.

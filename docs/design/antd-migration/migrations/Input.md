# Input — migration guide

**antd `Input` / `Input.TextArea` / `Input.Search` / `Input.Password` → `@agenta/ui` `Input`
+ composed components** (`@agenta/ui/ui`) · status: **✅ built (styled native input + cva, following shadcn conventions) + all `@agenta/ui`
call-sites migrated, tsc-clean, zero antd `Input` left in the package** · no visual change.

## TL;DR
shadcn's `Input` is a **styled native `<input>`** — no wrapper span, no affixes, no clear button.
antd's Input is a feature-rich composite. Rather than bolt antd's features back onto the
primitive, the dropped features live in **dedicated composed components** built *on* the
primitive.

```tsx
- import {Input} from "antd"
- <Input prefix={<Search />} allowClear size="small" />
+ import {InputAffix} from "@agenta/ui/ui"
+ <InputAffix prefix={<Search />} allowClear size="sm" />
```

## The component set

| Need | Component |
|---|---|
| plain text input | `Input` (styled native input) |
| plain textarea | `Textarea` |
| prefix / suffix / `allowClear` | `InputAffix` |
| `Input.Search` | `SearchInput` (InputAffix + search icon + clear) |
| `Input.Password` | `PasswordInput` (InputAffix + show/hide toggle) |
| `Input.TextArea autoSize` / `onPressEnter` | `AutosizeTextarea` |

`InputAffix` renders the border/background on a wrapper `<span>` and the `<input>` borderless
inside it — the same structural trick antd uses, so affixed and unaffixed inputs line up.

## Prop mapping (antd → `@agenta/ui`)

| antd | `@agenta/ui` |
|---|---|
| `variant="outlined"` / bare | `variant="default"` |
| `variant="filled"` | `variant="filled"` |
| `variant="borderless"` | `variant="ghost"` |
| `size="small"` | `size="sm"` |
| `size="middle"` (default) | `size="default"` |
| `size="large"` | `size="lg"` |
| `status="error"` | `aria-invalid` (styled via `aria-[invalid=true]:border-error`) |
| `prefix` / `suffix` / `allowClear` | → `InputAffix` |
| clearing a **controlled** input | `onValueChange={(v) => …}` (fires on typing AND clear) |
| `autoSize` / `onPressEnter` | → `AutosizeTextarea` |
| `showCount` | no equivalent — render the counter yourself (see `CommitMessageInput`) |
| `addonBefore` / `addonAfter` | no equivalent — compose with flex |

## Source style
Current shadcn source for React 19: **no `forwardRef`** (`ref` is a normal prop) and
`data-slot` on every root (`input`, `textarea`, `input-affix`, `search-input`,
`password-input`, `autosize-textarea`).

## Sizing model
Heights are **padding + line-height derived**, not fixed `h-*` — that's how antd computes
them, and a fixed height diverges as soon as font-size changes. `ghost` adds 1px of vertical
padding to compensate for its missing border.

All of it comes from the `control-*` / `input-*` scale in `oss/tailwind.config.ts`
(`text-field-*`, `px-input*`, `py-input-y*`, `rounded-control*`) — **no raw pixels in the
component**. Note fields and buttons have separate type ramps: antd's small input is 10px
where its small button is 12px.

## Gotchas (see also GOTCHAS.md)
- **`border-solid` + `box-border` + `font-[inherit]`** — preflight is OFF; without these the
  native input gets `border-style: none`, content-box sizing, and the UA font (**Arial** on
  `<input>`, **monospace** on `<textarea>`) instead of Inter.
- **Line-height must be the exact ratio**, not a rounded decimal: `1.6666666666666667`, not
  `1.6667`. Rounded values compute a few ten-thousandths off and the parity gate flags it.
  These live in `controlScale.fontSize` (`text-field-sm/md/lg`), not in the component.
- **cva `VariantProps` makes variant keys `T | null | undefined`** — a `Record<Size, string>`
  lookup then fails with *"Type 'null' cannot be used as an index type"*. Default the value
  (`const size = sizeProp ?? "default"`) before indexing.
- **Wrappers forwarding antd-typed `size`** must be retyped to `InputProps["size"]`
  (SearchInput, EditableText).
- **`InputRef.input` is gone** — antd's ref exposed `.input`; ours *is* the `HTMLInputElement`.
  `inputRef.current?.input?.focus()` → `inputRef.current?.focus()` (SelectLLMProviderBase).
- **A file importing antd `Input` only for `Input.TextArea`/`Input.Password`** still counts as
  antd — LabelInput, CommitMessageInput and useTableManager (`Input.Search`) all needed the
  composed components, not an import swap.

## Migrated in `@agenta/ui`
`SharedEditor` + `SharedEditorImpl` (the `antdInputProps` union retyped off `antd/es/input`),
`LabelInput`, `CommitMessageInput` (showCount → own counter), `useTableManager` (`Input.Search`),
`selection/SearchInput` (now a thin wrapper over `InputAffix`), `ColumnVisibilityPopoverContent`,
`PromptDocumentUpload`, `PromptImageUpload`, `PrimitiveNode`, `ArrayNode`, `MarkdownToolbar`
(`onPressEnter` → `onKeyDown`), `ChatInputs`.

> Follow-up (naming only, no behaviour): `SharedEditorProps.useAntdInput` / `antdInputProps`
> still carry "antd" in their names though they no longer render antd. Renaming them touches
> call-sites outside this package, so it's deferred to its own pass.

## Known deviation (the one real visual change)
`SearchInput` reproduces a **prefixed + clearable input**, not antd's `Input.Search`. antd's
Search renders a trailing search **button** segment; we dropped it and put a magnifier on the
left. The only call-site that used `Input.Search` is the `useTableManager` table search box, so
that one surface loses its trailing button. Everything else in this guide is pixel-identical.
Flagged rather than hidden — if the button is wanted, it needs a `Button`-in-affix composition.

## Focus (proven vs antd)
antd inputs focus to **border → primary + a 2px glow** (`box-shadow 0 0 0 2px controlOutline`,
theme-flipping: navy-tint light, yellow-tint dark). The first cut had `focus:border-primary`
but **no glow** — restored via the new `--ag-controlOutline` token on default/filled (ghost
has none, matching antd's borderless). Error state uses `--ag-errorOutline` (red glow).
- **The glow is gated on `:focus-within`, NOT `:focus`.** The affix WRAPPER is a `<span>`; a
  `focus:` on it never fires when the inner `<input>` is focused, so an affixed input would show
  no focus glow (antd uses `.ant-input-affix-wrapper:focus-within`). `focus-within:` fixes the
  wrapper and is equivalent to `:focus` on a bare `<input>` (an element matches `:focus-within`
  when it OR a descendant is focused), so both cases work from one rule. In stories force it with
  `pseudo-focus-within-all` (not `pseudo-focus-all`) — and note `pseudo-focus-all` force-focuses
  the wrapper span too, giving a FALSE PASS that hides this bug.

## Verification (VRT first)
`parity/vrt.mjs` is the primary gate. `AntdVsAgenta` renders each antd variant beside its mapped
`@agenta/ui` equivalent (`Input.Search`, `Input.Password`, `allowClear`, `prefix`, `autoSize`);
`InteractionStates` forces default/filled/error focus, the **affix focus-within**, and hover —
light + dark. (`Input.Search`'s trailing search button is a declared `not reproduced` diff.)

# Dropdown — migration guide

**antd `Dropdown` → `@agenta/ui` `DropdownMenu`** (Radix `@radix-ui/react-dropdown-menu`,
`@agenta/ui/ui`) · status: **✅ primitive built; call-sites not yet migrated** · no visual change.

## TL;DR
antd `Dropdown` takes a `menu={{items:[…]}}` array; the `@agenta/ui` `DropdownMenu` is a JSX
composition (`DropdownMenuItem` / `Separator` / `Sub…`). The overlay **chrome** is copied
token-for-token from `SelectContent` (same antd overlay: `.ant-dropdown-menu` and
`.ant-select-dropdown` share bg `colorBgElevated`, radius `borderRadiusLG`, shadow
`boxShadowSecondary`, 4px panel padding). The **item geometry is antd's dropdown item, NOT
the Select option** — a dropdown item is 30px (5px×12px padding, `min-height:0`, 20px
line-height) whereas a Select option is 28px (`min-h-control` + 4px padding). Hover/disabled
colours (`controlItemBgHover` = `bg-muted`, `text-disabled`) do match SelectItem.

## Before
```tsx
<Dropdown
    menu={{items: [
        {key: "edit", label: "Edit", icon: <EditOutlined />},
        {key: "dup", label: "Duplicate"},
        {type: "divider"},
        {key: "del", label: "Delete", danger: true, disabled: true},
        {key: "more", label: "More", children: [{key: "x", label: "Sub item"}]},
    ]}}
    trigger={["click"]}
>
    <Button>Actions</Button>
</Dropdown>
```

## After
```tsx
<DropdownMenu>
    <DropdownMenuTrigger asChild>
        <Button variant="outline">Actions</Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
        <DropdownMenuItem><EditOutlined /> Edit</DropdownMenuItem>
        <DropdownMenuItem>Duplicate</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled>Delete</DropdownMenuItem>
        <DropdownMenuSub>
            <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
                <DropdownMenuItem>Sub item</DropdownMenuItem>
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    </DropdownMenuContent>
</DropdownMenu>
```

## Usage
- Trigger uses `asChild` so any element (a Button, an icon button, a link) becomes the trigger
  without adding DOM. Radix default trigger is click, matching antd's most common usage.
- For a forced-open / inline render (modals, scroll containers, parity stories) pass
  `container` to `DropdownMenuContent` (and `DropdownMenuSubContent`) — the same pattern as
  Popover/Select.
- `DropdownMenuCheckboxItem` / `DropdownMenuRadioGroup`+`DropdownMenuRadioItem` cover stateful
  menus (check via lucide `Check`, radio via a filled `Circle` dot), `DropdownMenuLabel` for a
  group heading, `DropdownMenuShortcut` for a right-aligned key hint.

## Prop mapping (antd → `@agenta/ui`)

| antd | `@agenta/ui` |
|---|---|
| `menu={{items:[…]}}` | JSX composition (`DropdownMenuItem` etc.) — see item mapping below |
| `open` / `onOpenChange` | `open` / `onOpenChange` on `DropdownMenu` (Radix Root) |
| `getPopupContainer={() => c}` | `container={c}` on `DropdownMenuContent` / `SubContent` |
| `trigger={["click"\|"hover"]}` | Radix defaults (click); wrap trigger with `asChild` |
| `disabled` (on Dropdown) | `disabled` on `DropdownMenuTrigger` |
| `placement` | `side` / `align` on `DropdownMenuContent` |

### `menu.items[]` → components

| antd item field | `@agenta/ui` |
|---|---|
| `{key, label}` | `<DropdownMenuItem>label</DropdownMenuItem>` |
| `icon` | render inline as a child (`<Icon/> label`) — no `icon` prop |
| `disabled` | `disabled` on `DropdownMenuItem` |
| `danger` | `variant="destructive"` on `DropdownMenuItem` |
| `{type: "divider"}` | `<DropdownMenuSeparator />` |
| `{type: "group", label, children}` | `<DropdownMenuLabel>` + `<DropdownMenuGroup>` |
| `children` (submenu) | `<DropdownMenuSub><DropdownMenuSubTrigger/><DropdownMenuSubContent/></DropdownMenuSub>` |
| `onClick` (per item) | `onSelect` on `DropdownMenuItem` |

**The `menu.items` array API is replaced by JSX composition** — the shadcn way. A thin
`items`-array adapter (map the antd `items` shape to the composed parts) can be added as a
call-site helper later if a heavy `items`-array consumer needs it; **deferred** until a
call-site demands it.

## Infra added
None. Every class is an existing bridge/scale token reused from `SelectContent`/`SelectItem`:
chrome = `bg-popover shadow-overlay rounded-control-lg p-1 font-portal box-border` (no `min-w`
— antd's menu has `min-width: 0` and fits content); item =
`box-border rounded-control-sm px-3 py-input-y-ghost text-field-md` (NO `min-h`;
`py-input-y-ghost` reuses the existing 5px token to hit antd's 30px item = 5px pad + 20px
line-height), hover `bg-muted`, disabled `text-disabled`; separator `-mx-1 my-1 h-px bg-border`;
destructive `text-error` /
`bg-error-bg` (same tokens Badge/Alert/Button already use for the error family).

## Gotchas (see also GOTCHAS.md)
- **Chrome is antd's overlay, not a bordered shadcn panel** — borderless, radius 10px
  (`rounded-control-lg`), overlay shadow (`shadow-overlay`), 4px padding (`p-1`). `font-portal`
  is required because the content portals to `<body>`, outside the app font scope (serif
  otherwise). `box-border` because preflight is off. See GOTCHAS §Portaled content.
- **Content fits its content — no width pin at all.** Unlike Select (which pins
  `w-[var(--radix-select-trigger-width)]` so the dropdown matches the trigger), antd's
  `.ant-dropdown-menu` has `min-width: 0` and sizes to its content (measured 85px for the
  Edit/Duplicate/Delete set). So `DropdownMenuContent`/`SubContent` carry NO `min-w` — do NOT
  copy Select's `min-w-[8rem]` (it forced the menu to 128px, wider than antd). Just let Radix
  size the content box.
- **Item geometry is antd's DROPDOWN item, not the Select option.** Do NOT copy SelectItem's
  `min-h-control` + `py-1` (that yields a 28px row). antd `.ant-dropdown-menu-item` is 30px:
  `min-height:0`, padding 5px×12px, line-height 20px. Using `min-h-control` made rows the wrong
  height and the labels drifted vertically down the list (~9% VRT). Fix: drop `min-h`, use
  `py-input-y-ghost` (the existing 5px token) — measured 30px == antd on both sides.
- **Item icons are children, not an `icon` prop.** antd's `icon` field has no shadcn analogue;
  render the icon inline. Don't size lucide icons with the `size` prop — use `size-*` classes
  (GOTCHAS §Native-element parity).
- **`danger` → `variant="destructive"`.** antd's danger item is `colorError` text; the
  destructive variant maps to `text-error` + `bg-error-bg` on hover (existing error tokens).

## Verification (VRT first, computed-style as fallback)
`parity/vrt.mjs` is the primary gate. Stories (`antd/Navigation/Dropdown`): `OpenState` — the
KEY story, `data-open-compare`, both menus forced open and rendered inline via `container`
(antd `open`+`getPopupContainer`, agenta `open`+`DropdownMenuContent container`), same item set
(items + separator + disabled item) → the VRT diffs the antd `.ant-dropdown-menu` overlay vs
`[data-slot=dropdown-menu-content]`. `AntdVsAgenta` — trigger-driven reference. Chrome/item
parity is inherited from the already-verified Select overlay (identical tokens); confirm exact
values with `measure.js` (`measureOverlayParity()`) if a VRT row flags.

> NOTE: live measurement at build time was blocked — the shared Storybook was throwing a
> transient React-refresh error ("Should not already be working") from a parallel agent's HMR.
> The orchestrator runs the VRT; parity is not claimed here beyond the token-for-token copy.

## For agents hitting conflicts
The component is a straight copy of the canonical shadcn `dropdown-menu` with two local rules:
(1) chrome/item classes are `SelectContent`/`SelectItem`'s tokens, not stock shadcn's border+8px
radius+`shadow-lg`; (2) `DropdownMenuContent` and `DropdownMenuSubContent` take a `container`
prop for inline portal rendering (mirrors Popover/Select). Keep both when reconciling.

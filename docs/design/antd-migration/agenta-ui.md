# antd → `@agenta/ui` inventory (mapped to shadcn/ui recipes)

> **Package:** `web/packages/agenta-ui` (`@agenta/ui`, v0.75.0) · **Layer:** lowest UI layer — `shared ← **ui** ← entities ← entity-ui ← playground ← playground-ui`. `@agenta/shared` is React-free (0 antd), so this is the true base every rendered surface sits on.
> **Footprint:** 115 / 369 ts·tsx files import `antd` (peer dep `antd >=5.0.0`). 33 runtime components, ~250 JSX call-sites (every one enumerated in [`agenta-ui.json`](agenta-ui.json) → `sites`).
> **Method:** exhaustive per-call-site (regex extractor `extract.py`, then every site read). Prop-mapping tables list only props **actually used** (× = call-site frequency), not antd's full API. **Date:** 2026-07-24

---

## 1. Package summary

| Dimension | Finding |
|---|---|
| **antd role** | Building-block library wrapped into a small set of exported components (`EnhancedModal`, `EnhancedDrawer`, `DropdownButton`, `EnhancedButton`, `DraftTag`/`SyncStateTag`/`TypeChip`, selection shells) + a large custom `InfiniteVirtualTable`. |
| **Styling posture** | **Tailwind-first, clean.** 140 files `className`, 25 `clsx`/`cn`. **Zero** react-jss / styled-components / `.css` imports. No in-package `ConfigProvider` theme override. |
| **Escape hatches** | `var(--ag-c-*)` color shim in TW arbitrary values, 29 files. Inline `style={{}}`, 38 files (one-off sizing). antd `styles={{}}` slot API, 7 files (Modal/Drawer/Dropdown parts). `!`-important (`!m-0`) to defeat antd margins. |
| **Overall difficulty** | **Low–Medium.** Thin Tailwind wrappers → most swaps are contained. Hard spots: `InfiniteVirtualTable` (custom engine) and any `Form` (paradigm change). |

**Usage pattern** — **Simple** (antd primitive ~as-is) · **Composed** (2+ primitives/logic into a new exported component) · **Custom** (extended/overridden behavior or bespoke engine).
**Styling** — TW · cn/clsx · var() color shim · inline · slots (`styles={{}}`) · token.
**Effort** — **S** 1:1 swap · **M** structural / many sites / no primitive · **L** engine or paradigm change.
**Priority** — **P1** high-leverage low-risk (do first) · **P2** structural but contained · **P3** engine/paradigm (schedule separately).

---

## 2. Component inventory

### General

#### `Button` — 36 files · 60 sites · Simple→Composed · TW+cn, inline icon-size · **M · P1**
Most-used primitive. ~15 presentational wrappers compose it (`EnhancedButton` = Button+Tooltip, `AddButton`, `RunButton`, `CopyButton`, `CollapseToggleButton`, `SendButton`, `ScrollToTopButton`, `DropdownButton`). **Migrate the wrappers first** — most raw sites route through them.

| antd prop (freq) | shadcn equivalent | note |
|---|---|---|
| `size` ×73 (`small`/`middle`/`large`) | `size` (`sm`/default/`lg`) | `middle`→default. Team convention bans `size="small"` in new code. |
| `onClick` ×55 | `onClick` | same |
| `type` ×41 (`primary`/`default`/`text`/`link`/`dashed`) | `variant` (default/`outline`/`ghost`/`link`/`outline`+dashed border) | core mapping |
| `icon` ×40 | render icon as **child**; icon-only → `size="icon"` | shadcn has no `icon` prop |
| `className` ×23 | `className` | same |
| `disabled` ×15 | `disabled` | same |
| `shape` ×8 (`circle`/`round`) | `size="icon"` + `rounded-full` / `rounded-full` | className |
| `loading` ×3 | `<Loader2 className="animate-spin"/>` child + `disabled` | no `loading` prop |
| `danger` ×1 | `variant="destructive"` | |
| `block` ×2 | `className="w-full"` | |
| `color`/`variant` (v5) ×5 | `variant` + classes | antd v5 color+variant combos |
| `ref`/`aria-label`/`title` | `ref` (forwardRef) / same | `weight` ×6 is a phosphor-icon prop, not Button |

shadcn: [button](https://ui.shadcn.com/docs/components/button)

#### `Typography` (`.Text`/`.Title`/`.Paragraph`/`.Link`) — 22 files · 15 sites · Simple · TW, var() · **M · P2**
No 1:1 primitive. Sites are mostly `.Text` with Tailwind already applied. Build a tiny shared `<Text>`/`<Heading>` helper to hold the `type`/`level` variants once.

| antd (freq) | shadcn equivalent | note |
|---|---|---|
| `<Typography.Text className>` ×12 | `<span className>` | |
| `type="secondary"` ×3 | `className="text-muted-foreground"` | `danger`→`text-destructive` |
| `<Typography.Title level={n}>` ×1 | `<hN className="scroll-m-20 text-…">` | shadcn typography scale |
| `<Typography.Paragraph ellipsis>` | `<p className="line-clamp-*">` | `ellipsis`→`truncate`/`line-clamp` |
| `<Typography.Link href target rel>` | `<a>` or `<Button variant="link" asChild>` | |
| `copyable` | existing `CopyTooltip` | already in-package |

shadcn: [typography](https://ui.shadcn.com/docs/components/typography)

### Data Entry

#### `Input` (`.TextArea`/`.Password`/`.Search`) — 16 files · 20 sites · Simple→Composed · TW, slots · **M · P2**
`SharedEditor` + `SearchInput` wrap it. `variant="borderless"` is common (editor cells).

| antd prop (freq) | shadcn equivalent | note |
|---|---|---|
| `value`/`onChange`/`placeholder`/`disabled`/`type` | same | `<Input>` |
| `variant="borderless"` ×7 | `className="border-0 shadow-none focus-visible:ring-0"` | `filled`→`bg-muted` |
| `size` ×3 | `className` (`h-8 text-xs` …) | no size prop |
| `Input.TextArea` + `autoSize`/`rows` | `<Textarea>` + auto-resize hook / `rows` | shadcn `textarea` |
| `Input.Password` | `<Input type="password">` + eye toggle button | build toggle |
| `Input.Search` | `<Input>` + search icon + `onKeyDown` Enter | no Search variant |
| `prefix`/`suffix` ×1 | flex wrapper w/ sibling icon | no prop |
| `allowClear`/`onClear` ×1 | custom `X` button | no prop |
| `onPressEnter` | `onKeyDown` (`e.key==="Enter"`) | |

shadcn: [input](https://ui.shadcn.com/docs/components/input) · [textarea](https://ui.shadcn.com/docs/components/textarea)

#### `Select` — 6 files · 5 sites · Simple→Composed · TW, slots · **M–L · P2/P3**
`SimpleDropdownSelect`/`PathSelectorDropdown` wrap it. Split by feature: plain `options` → Radix Select (**M**); `showSearch`/`optionFilterProp`/`virtual` sites → Combobox (**L**).

| antd prop (freq) | shadcn equivalent | note |
|---|---|---|
| `value`+`onChange` ×6/4 | `value`+`onValueChange` | string only (multi → custom) |
| `options` ×4 | `<SelectItem>` children | map array |
| `placeholder` ×4 | `<SelectValue placeholder>` | |
| `showSearch`/`optionFilterProp`/`virtual`/`optionLabelProp`/`popupRender` ×1 | **Combobox** (Popover+Command) | no search in Radix Select |
| `allowClear` ×1 | custom clear item | |
| `size`/`variant`/`style`/`className` | `className` on trigger | |

shadcn: [select](https://ui.shadcn.com/docs/components/select) · [combobox](https://ui.shadcn.com/docs/components/combobox)

#### `InputNumber` — 3 files · 3 sites · Simple · TW · **M · P2**
No primitive. `<Input type="number">` + clamp; wrap once as `<NumberInput>`.

| antd prop | shadcn | note |
|---|---|---|
| `value`/`onChange` | `value`/`onChange(Number(e.target.value))` | |
| `min`/`max`/`step` | native `min`/`max`/`step` on `type="number"` | |
| `size`/`variant`/`disabled`/`placeholder` | `className`/`disabled`/`placeholder` | |

shadcn: [input](https://ui.shadcn.com/docs/components/input)

#### `Switch` — 2 files · 2 sites · Simple · TW · **S · P1**
`checked`→`checked`, `onChange(bool)`→`onCheckedChange(bool)`. [switch](https://ui.shadcn.com/docs/components/switch)

#### `Checkbox` — 1 file · 1 site · Simple · TW · **S · P1**
`onChange(e)`→`onCheckedChange(bool)`; no `Checkbox.Group` used. [checkbox](https://ui.shadcn.com/docs/components/checkbox)

#### `Slider` — 1 file · 1 site · Simple · TW · **S · P1**
`SliderInput` wrapper. `value:number`/`onChange`→`value:number[]`/`onValueChange` (array). [slider](https://ui.shadcn.com/docs/components/slider)

#### `Upload` — 2 files · 0 direct sites (dynamic) · Composed · TW, inline · **L · P3**
`PromptImageUpload`/`PromptDocumentUpload`. No primitive → `react-dropzone` + Button; replicate `beforeUpload`/`fileList`/`UploadFile`(T) locally. *(custom)*

#### `Form` / `FormInstance` — 2 files · 2 sites · Composed · TW · **L · P3**
antd `Form` + `Form.Item` + imperative `form` (`valuePropName`, `onValuesChange`, `initialValues`). Paradigm shift → `react-hook-form`+`zod`+`<FormField>`. Rewrite validation & imperative setters per form. [form](https://ui.shadcn.com/docs/components/form)

### Data Display

#### `Tooltip` — 27 files · 39 sites · Simple · TW, var(), inline · **M · P1**
2nd most-used; 38/39 sites are just `title="…"`. `EnhancedButton`/`CopyTooltip` wrap it. **Structural:** shadcn needs a root `TooltipProvider` + `Trigger`/`Content`. Ship a thin `<Tooltip title>` compat wrapper to avoid editing 39 sites.

| antd prop (freq) | shadcn equivalent | note |
|---|---|---|
| `title` ×38 | children of `<TooltipContent>` | |
| `placement` ×4 | `side` + `align` on `<TooltipContent>` | `topLeft`→`side=top align=start` |
| `mouseEnterDelay` ×3 | `delayDuration` on Tooltip/Provider | seconds→ms |
| `className`/`overlayInnerStyle` ×5/1 | `className` on `<TooltipContent>` | |
| `color` ×1 | `className` on content | |
| `getPopupContainer` ×1 | `<TooltipPortal container>` | |

shadcn: [tooltip](https://ui.shadcn.com/docs/components/tooltip)

#### `Tag` — 8 files · 15 sites · Simple→Custom · TW, var() · **M · P1**
Presets: `DraftTag`, `SyncStateTag`, `TypeChip`, `status`, `MappingStatusTag`, `source-indicator`. **Migrate the presets, not raw sites.** Color families ride `var(--ag-c-*)`.

| antd prop (freq) | shadcn (Badge) | note |
|---|---|---|
| `color` ×10 (preset name / hex) | `variant` or `className` | preset→map to variant; hex→arbitrary class |
| `className` ×16 | `className` | `!m-0` no longer needed (Badge has no margin) |
| `variant="filled"/"outlined"` ×1 | Badge `variant` default/`outline` | |
| `closeIcon`/`onClose` ×1 | Badge + `<button>` X | no close built-in |

shadcn: [badge](https://ui.shadcn.com/docs/components/badge)

#### `Popover` — 7 files · 9 sites · Simple→Composed · TW, slots · **M · P2**
`CellContentPopover` composes it. Watch the **hover** trigger (`Base64Node`): shadcn `Popover` is click-only → use **HoverCard** for hover sites.

| antd prop (freq) | shadcn equivalent | note |
|---|---|---|
| `content` ×9 | `<PopoverContent>` children | |
| `trigger` ×9 (`hover`/`click`) | Popover (click) / **HoverCard** (hover) | split by trigger |
| `open`+`onOpenChange` ×7 | `open`+`onOpenChange` | same |
| `placement` ×8 | `side`+`align` | |
| `title` ×3 | header node inside content | |
| `arrow` ×2 | `<PopoverArrow>` (opt-in) | |

shadcn: [popover](https://ui.shadcn.com/docs/components/popover) · [hover-card](https://ui.shadcn.com/docs/components/hover-card)

#### `Table` — 1 file value / **21 files type-only** · Custom · slots · **L · P3**
`antd/es/table` **types** (`ColumnsType` ×16, `ColumnType` ×8, `TableProps` ×6, `ColumnGroupType` ×2, `TableRef` ×1) type the bespoke `InfiniteVirtualTable` (react-virtual). Only one real `<Table>` render (`InfiniteVirtualTableInner`). **Keep the engine**; replace the type surface with **TanStack Table** column defs + shadcn table markup. Largest single effort. [data-table](https://ui.shadcn.com/docs/components/data-table) · [table](https://ui.shadcn.com/docs/components/table)

#### `Tabs` — 2 files · 2 sites · Simple · TW · **S · P1**
`items[]`→`<TabsList>`/`<TabsTrigger>`+`<TabsContent>`; `activeKey`/`onChange`→`value`/`onValueChange`. [tabs](https://ui.shadcn.com/docs/components/tabs)

#### `Skeleton` (`.Input`/`.Avatar`/`.Button`) — 6 files · 7 sites · Simple · TW, inline · **S · P1**
`active` (shimmer) is shadcn default. `.Avatar`→`<Skeleton className="rounded-full h-* w-*">`; `.Input`/`.Button`→sized `<Skeleton>`; `paragraph={{rows}}`→N line skeletons. [skeleton](https://ui.shadcn.com/docs/components/skeleton)

#### `Empty` — 3 files · 3 sites · Simple · TW · **S · P1**
`image`+`description` → small custom `<EmptyState icon title desc>` (flex + muted). *(custom, trivial)*

#### `Progress` — 2 files · 2 sites · Simple · TW · **S–M · P1**
`percent`/`showInfo`→Progress `value` + sibling label. `type="circle"` (1 site) has no primitive → SVG ring. [progress](https://ui.shadcn.com/docs/components/progress)

#### `Avatar` — 1 file · 1 site · Simple · TW · **S · P1**
`<Avatar><AvatarImage/><AvatarFallback/></Avatar>`. [avatar](https://ui.shadcn.com/docs/components/avatar)

#### `Divider` — 1 file · 1 site · Simple · TW · **S · P1**
→ `<Separator>` (`orientation` for vertical; labelled divider → custom flex). [separator](https://ui.shadcn.com/docs/components/separator)

#### `Tree` / `DataNode`(T) — 1 file · 1 site · Simple · TW · **M · P3**
No primitive → recursive `Collapsible`/`Accordion` or community tree. [collapsible](https://ui.shadcn.com/docs/components/collapsible)

### Feedback / Overlay

#### `Modal` / `ModalProps`(T) — 2 files · 2 sites · Custom · TW, slots · **M · P2**
`EnhancedModal`: lazy mount, auto max-height + internal scroll, style-merge across header/body/footer/mask/content slots. Also `antd/es/modal/confirm` (imperative). → **Dialog** (+ **AlertDialog** for confirm). Reimplement EnhancedModal behaviors on Dialog primitives; `Modal.confirm(...)` → controlled AlertDialog or a promise helper.

| antd prop (freq) | shadcn (Dialog) | note |
|---|---|---|
| `open`+`onCancel` ×2/1 | `open`+`onOpenChange` | |
| `footer` ×1 | `<DialogFooter>` children | |
| `width`/`styles`/`style` ×1 | `className` on `<DialogContent>` | slot styles → classes |
| `afterClose` ×1 | `onOpenChange` false branch | |
| lazy/maxHeight (EnhancedModal) | mount-gate + `max-h-[90vh] overflow-auto` | reimplement |

shadcn: [dialog](https://ui.shadcn.com/docs/components/dialog) · [alert-dialog](https://ui.shadcn.com/docs/components/alert-dialog)

#### `Drawer` / `DrawerProps`(T) — 1 file · 1 site · Custom · TW, slots · **M · P2**
`EnhancedDrawer`: lazy render, `width`→wrapper slot, mask-blur control.

| antd prop (freq) | shadcn (Sheet) | note |
|---|---|---|
| `open`+`afterOpenChange` ×1 | `open`+`onOpenChange` | |
| `width` ×1 | `className="w-[…]"` on `<SheetContent>` | |
| `mask` ×1 | overlay always present; blur → className | |
| `styles` slot ×1 | `className` on content/overlay | |

shadcn: [sheet](https://ui.shadcn.com/docs/components/sheet) (side) · [drawer](https://ui.shadcn.com/docs/components/drawer) (bottom, vaul)

#### `Spin` — 12 files · 12 sites · Simple · TW, inline · **M · P1**
All in selection/list loaders. No primitive (pre-`Spinner`) → `<Loader2 className="animate-spin"/>` or shadcn `Spinner`. `size="small/default"`→`h-4`/`h-6`; `indicator` (1 site) → custom icon; wrap-mode → overlay div. [spinner](https://ui.shadcn.com/docs/components/spinner)

#### `message` + `App` + interfaces(T) — 2 files · 0 sites (imperative) · Custom · — · **M · P2 (do early)**
`message.success/error(...)` imperative toasts; `App` provides theme-aware static `message`/`modal`/`notification` (see `app-message` export). → **Sonner** `toast.*` + root `<Toaster>`; replace `App` with Sonner provider + a confirm/modal context. Root-level wiring, not per-site. [sonner](https://ui.shadcn.com/docs/components/sonner)

### Navigation

#### `Dropdown` / `MenuProps`(T) — 10 files value / 10 files type · Simple→Composed · TW, slots · **M · P2**
`menu={{items}}` everywhere (`MenuProps["items"]` builders in `DropdownButton`, `CopyButtonDropdown`, table settings, editor nodes). The **item-array builders are the refactor surface**.

| antd prop (freq) | shadcn (Dropdown Menu) | note |
|---|---|---|
| `menu={{items}}` ×14 | `<DropdownMenuItem>` children | array → JSX |
| `trigger` ×14 (`click`/`hover`) | `<DropdownMenuTrigger asChild>` (click) | hover not native |
| `placement` ×5 | `side`+`align` on Content | |
| `disabled` ×5 | disable trigger / items | |
| `styles` ×3 | `className` on `<DropdownMenuContent>` | |

shadcn: [dropdown-menu](https://ui.shadcn.com/docs/components/dropdown-menu)

#### `Pagination` — 1 file · 1 site · Simple · TW · **M · P2**
`total`/`pageSize`/`current`/`onChange`/`showTotal` → shadcn Pagination is composed links/buttons (compute page range yourself; more manual than antd's all-in-one). [pagination](https://ui.shadcn.com/docs/components/pagination)

#### `Breadcrumb` — 1 file · 1 site · Simple · TW · **S · P1**
(selection module also exports its own `Breadcrumb`.) `items`→`<BreadcrumbItem>`/`<BreadcrumbSeparator>`. [breadcrumb](https://ui.shadcn.com/docs/components/breadcrumb)

### Layout

#### `Space` (`.Compact`) — 2 files · 2 sites · Composed · TW · **M · P2**
No primitive → Tailwind. `Space`→`flex gap-*`; `Space.Compact` (split buttons in `DropdownButton`)→`flex` + `[&>*:not(:first-child)]:-ml-px` + `rounded-none` joins. *(Tailwind)*

#### `Grid.useBreakpoint` — 2 files · 0 sites (hook) · Simple · — · **S · P2**
Responsive **hook**, not layout grid. Replace `useBreakpoint()` with a `useMediaQuery`/`useBreakpoint` hook + Tailwind responsive prefixes. *(custom hook)*

---

## 3. Migration order (rollup)

| Priority | Components | Why |
|---|---|---|
| **P1 — do first** | Button, Tooltip, Tag, Switch, Checkbox, Slider, Skeleton, Empty, Progress(linear), Tabs, Avatar, Divider, Breadcrumb, Spin | High-frequency and/or 1:1 swaps; unblock the shared wrappers (`EnhancedButton`, `DropdownButton`, `DraftTag`, selection loaders). |
| **P2 — structural, contained** | Typography, Input, Select(plain), InputNumber, Dropdown, Popover, Modal/EnhancedModal, Drawer/EnhancedDrawer, Pagination, Space, Grid, message/App(providers) | Need a root provider, a compat wrapper, or a small custom helper — but bounded. Providers (Tooltip, Sonner) done once. |
| **P3 — engine / paradigm** | InfiniteVirtualTable (`Table` types→TanStack), Form (→RHF+zod), Upload (→dropzone), Select(search→Combobox), Tree(→Collapsible) | Separate budget; each is a mini-project, not a swap. |

## 4. Cross-cutting notes

1. **Wrappers are the migration unit.** ~15 Button wrappers, 3 Tag presets, 2 modal/drawer wrappers, selection shells. Swap antd inside them once; downstream consumers inherit it. Prioritize wrappers over raw call-sites.
2. **Type-only imports are free.** `MenuProps`, `ButtonProps`, all `antd/es/table` types, etc. vanish with the runtime swap; the `MenuProps["items"]` / `ColumnsType` **shapes** (item/column builders) are the real work.
3. **Providers, not per-site edits:** `TooltipProvider` (unblocks 39 Tooltip sites via one compat wrapper), Sonner `<Toaster>` (replaces `message`+`App`).
4. **`var(--ag-c-*)` shim maps cleanly** onto shadcn CSS variables — no react-jss to unwind. This package is the easy case; expect `web/oss`/`web/ee` to carry react-jss + `ConfigProvider` theming.
5. **No 1:1 primitive** (needs a small shared custom, define once here): `Typography`, `InputNumber`, `Upload`, `Empty`, `Space`, `Grid`(breakpoint), `Spin`(pre-Spinner), circular `Progress`, `Tree`.

## 5. Coverage

Every runtime component's call-sites are enumerated in [`agenta-ui.json`](agenta-ui.json) (`sites`, `prop_freq`). Re-run: `python3 extract.py ../web/packages/agenta-ui/src --json agenta-ui.json`.

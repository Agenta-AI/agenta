# Agenta design system

The design system for `web/mobile` (served at `/m`), the only Agenta frontend. Read the Glossary, the Principles and the Rules before any UI change. Look up the rest when you need it. If a case is not covered, ask; do not invent a rule.

Each fact has one home:

| What | Where |
| --- | --- |
| Values: colors, text styles, sizes, radii, shadows, motion | `src/design/theme.config.ts`. The value tables below are generated from it. |
| Principles, rules with their reasons, patterns | This file. The rule tables are the only list of rules. |
| A live Do and Avoid example for each rule | `/m/design-system`. The guide reads each rule's title and reason from this file. |

## Glossary

One word for one thing. Use these words in code, comments, docs and reviews.

| Word | Means | Do not say |
| --- | --- | --- |
| Theme variable | A named value from `theme.config.ts`: `--muted`, `bg-muted`, `text-label`, `control-md`. `tokens.json` exports them for design tools. | token (the word stays only in the legacy script names and in `tokens.json`) |
| Kit | The shared components in `@agenta/ui/ui` (source `web/packages/agenta-ui/src/components/ui/`). | primitives library, shadcn folder |
| Mark | The square tile with an icon or a letter that stands for an entity. The component is `IconTile`. | avatar, letter tile, icon tile |
| Compact window | A window under 640px (`breakpoint-sm`). Medium is 640–1023px, expanded is 1024px and up. | phone, small screen, mobile |
| Touch | A coarse pointer (`pointer: coarse`). It is not a window size: a tablet is touch on a medium window. | mobile |
| Agent chat | A chat with the agent about the open item. It opens in the right pane. | agent pane |
| Alignment line | The left edge of the page title. Text, visible edges and the first Mark sit on it; only a hover fill hangs outside. | anchor line |
| Hover fill | `accent`, the one fill for hover. | hover color |

## Principles

1. **Theme variables name a job, not a look.** Write `bg-muted text-muted-foreground border-border-muted`. Never a hex value, a stock Tailwind color or an antd name.
2. **Components own their size.** A caller passes `size="sm"`. Height, padding, radius, text and icon size come from the component. `className` is for layout only.
3. **Tone separates areas, borders separate items.** An area that must stand apart gets a different surface (`muted` on `background`), not another border.
4. **One primary action per view.** Color points at one thing: the `default` (primary) button. Everything else is quiet.
5. **Hierarchy from weight and tone first, size last.** Weight shows rank, never state.
6. **Quiet, not loud.** No bold text, no thick lines, no large saturated fills, no heavy shadows. Emphasis comes from `foreground` against `muted-foreground`.
7. **The same thing looks the same everywhere.** An entity, an action or a list has one size, one label and one icon on every screen. Take it from the tables here, not from the screen you are on.
8. **Every view has four states:** loaded, empty, loading and error.

## Color

There are 23 UI colors: 12 neutrals, 7 brand colors and 4 statuses. Three small groups sit beside them, each with one narrow job: 7 data colors, 5 code colors and 3 media colors. Light and dark use the same names; only the values change.

- **Text has two levels.** `foreground` and `muted-foreground`. There is no third gray. Links use `link` and are underlined.
- **Text on a fill.** `background` on `primary` and `destructive`. `brand-foreground` on `brand`.
- **A tint is an existing color at low opacity**, never a new color: `bg-destructive/10`, `bg-brand/15`.
- **Marks are neutral.** Only the current workspace Mark takes `bg-brand/15`. An agent Mark may use a data color.
- **Disabled** controls keep their colors at 50% opacity.
- **In code**, comments and punctuation take `muted-foreground`.
- **Contrast**, in both themes (`tests/unit/designThemeContrast.test.ts`): `foreground` ≥ 12:1; `muted-foreground`, each status color and each code color ≥ 4.5:1; `border-strong` ≥ 3:1. `border` is below 3:1 on purpose; hover and focus carry the contrast.

### Color values

<!-- generated:colors:start -->

| Variable | Light | Dark | Use |
| --- | --- | --- | --- |
| `background` | `#fefdfc` | `#0f0e0d` | Main content area. The ground for every text color. |
| `foreground` | `#1f1e1c` | `#eeecea` | Primary text and icons (≥12:1). Also the tooltip fill and the inner focus ring. |
| `muted` | `#f8f6f4` | `#151412` | Sidebar, the right pane and grouped blocks. Separates an area by tone, not by a border. |
| `muted-foreground` | `#605d59` | `#9a9893` | Secondary text: descriptions, meta, timestamps, placeholders, inactive nav, icon buttons (≥4.5:1 on every surface). |
| `secondary` | `#1f1e1c0a` | `#eeecea0a` | Fill of quiet controls: secondary button, segmented control, chips, Marks, user chat turns. Ink at 4%, so it stays one step darker than any surface it sits on, hover included. |
| `accent` | `#1f1e1c0d` | `#eeecea0f` | The one hover fill: rows, nav items, menu items and ghost controls. Ink at 5% (6% in dark), so hover is one step darker than the surface under it, and fills inside the row stay visible. |
| `selected` | `#ebe9e6` | `#262422` | Selected row, active nav item, pressed state. |
| `popover` | `#fefdfc` | `#1c1b19` | Menus, popovers, dialogs, sheets, toasts. A step lighter than background in dark. |
| `overlay` | `rgba(15, 14, 13, 0.40)` | `rgba(0, 0, 0, 0.60)` | Dims the page behind a dialog or sheet. |
| `scrim` | `rgba(0, 0, 0, 0.55)` | `rgba(0, 0, 0, 0.55)` | Media only: the dark film behind captions and controls on images and video. |
| `on-scrim` | `#ffffff` | `#ffffff` | Media only: text and icons on scrim. |
| `logo-ground` | `#ffffff` | `#ffffff` | Media only: the white tile behind a third-party brand logo. |
| `data-1` | `#4f7cac` | `#7ea6d4` | Data only: first category or series. |
| `data-2` | `#5b8f68` | `#86bd93` | Data only: second category or series. |
| `data-3` | `#b07d36` | `#d8ad6b` | Data only: third category or series. |
| `data-4` | `#8a64a3` | `#b796cc` | Data only: fourth category or series. |
| `data-5` | `#b5605f` | `#dc9190` | Data only: fifth category or series. |
| `data-6` | `#3f8a8a` | `#74bcbc` | Data only: sixth category or series. |
| `on-data` | `#ffffff` | `#0f0e0d` | Data only: letters and glyphs on a data-* fill. |
| `code-keyword` | `#76518f` | `#b796cc` | Code only: keywords and operators. |
| `code-string` | `#3b6f4d` | `#86bd93` | Code only: strings. |
| `code-number` | `#855711` | `#d8ad6b` | Code only: numbers and constants. |
| `code-function` | `#386492` | `#7ea6d4` | Code only: function, class and tag names. |
| `code-property` | `#2a6d6d` | `#74bcbc` | Code only: property names and keys. |
| `border` | `#e2e0dc` | `#2f2d2a` | Card edges, inputs and outline buttons at rest. |
| `border-muted` | `#ebe9e6` | `#242220` | Dividers inside a card or list. |
| `border-strong` | `#797773` | `#7c7a76` | Edges that carry meaning: checkbox, switch, radio, hovered input (≥3:1 on every surface). |
| `primary` | `#242424` | `#f2f25c` | LOCKED. The default (primary) button. Ink in light, brand yellow in dark. |
| `primary-hover` | `#413f3f` | `#e8e47e` | LOCKED. Primary hover. |
| `brand` | `#f2f25c` | `#d1d151` | LOCKED brand yellow. The one brand action, New agent on Home. Tint: brand/15. |
| `brand-hover` | `#e7e712` | `#dcdc6b` | LOCKED. Brand hover. |
| `brand-foreground` | `#242424` | `#141414` | Text on brand. |
| `link` | `#5e5e08` | `#8ccfff` | LOCKED. Inline links. |
| `ring` | `#d9d92c` | `#d9d92c` | LOCKED brand lime. Outer focus outline, always with a foreground ring inside it. |
| `destructive` | `#b6322d` | `#f66d62` | Errors and destructive actions. Text, icons and the confirm button; tint with destructive/10. |
| `success` | `#007835` | `#37bb62` | Passed, done. Text and icons; tint with success/10. |
| `warning` | `#965802` | `#df8605` | Needs attention. Text and icons; tint with warning/10. |
| `info` | `#0068a5` | `#1fa6ff` | Running, informational. Text and icons; tint with info/10. |

<!-- generated:colors:end -->

## Type

Inter for the interface. JetBrains Mono for code, IDs and keys.

### Text style values

<!-- generated:text-styles:start -->

| Style | Size / line | Weight | Tracking | Use |
| --- | --- | --- | --- | --- |
| `text-display` | 28px / 34px | 600 | -0.02em | The Home greeting, first-run hero screens, and the title on auth and error pages. Nowhere else. |
| `text-heading` | 20px / 28px | 600 | -0.015em | Page titles. One per page, the anchor of the alignment line. |
| `text-title` | 16px / 22px | 600 | -0.01em | Card and dialog titles. |
| `text-body` | 14px / 22px | 400 | 0 | Chat messages, descriptions, prose. Multi-line text. |
| `text-label` | 13px / 18px | 500 | 0 | The default for controls, nav, list rows and labels. Single-line text. The kit applies it through text-btn-md and text-field-md. |
| `text-body-sm` | 13px / 20px | 400 | 0 | 13px text that can wrap: field and cell values, card descriptions, short secondary prose. |
| `text-subtitle` | 13px / 18px | 600 | 0 | Section and panel titles inside a page or the right pane. |
| `text-metric` | 20px / 28px | 500 | 0 | A number that is the point of a tile: credits, counts, scores. With tabular-nums. |
| `text-meta` | 12px / 16px | 450 | 0 | Meta lines, timestamps, secondary table cells. |
| `text-caption` | 11px / 16px | 500 | 0.01em | Badges, keyboard hints, and the letter in a 16–24px Mark. |
| `text-code` | 13px / 20px | 400 | 0 | Code blocks, JSON, tool calls. |
| `text-code-sm` | 12px / 16px | 500 | 0 | Inline code, IDs, keys. |

<!-- generated:text-styles:end -->

## Space, size and shape

- A 4px grid on the Tailwind scale: `spacing-1` is 4px, the same as `p-1`.
- Below 640px, `control-md` steps down to 28 and `control-lg` to 32. The kit does this; a screen does not.
- Icons are drawings and keep their own curves. The shape rules are about component shapes.
- Shadows are translucent ink: `shadow-overlay` for menus, popovers, tooltips and toasts; `shadow-modal` for dialogs and sheets; `shadow-raised` for a card while it is dragged.

### Scale values

<!-- generated:scales:start -->

| Variable | Value | Use |
| --- | --- | --- |
| `spacing-0.5` | `2px` | Hairline offsets. |
| `spacing-1` | `4px` | The tightest gap: inside badges and xs buttons, between grouped buttons, inside menus. |
| `spacing-1.5` | `6px` | Gaps inside a control. |
| `spacing-2` | `8px` | Gaps inside a row. |
| `spacing-3` | `12px` | List row side padding. Gap between a label and its field group. |
| `spacing-4` | `16px` | Page gutter on compact windows; card padding. |
| `spacing-5` | `20px` | Dialog padding. |
| `spacing-6` | `24px` | Gap between the title row and the body; the right pane's own margins; section gap on compact. |
| `spacing-8` | `32px` | Top of every page; section gap on medium and expanded windows. |
| `spacing-10` | `40px` | Space above an empty state. |
| `spacing-12` | `48px` | Page top padding on expanded windows. |
| `spacing-16` | `64px` | Largest layout gap. |
| `radius-xs` | `2px` | Status dots, timeline nodes, skeleton bars and thin bars of 4–8px. |
| `radius-sm` | `4px` | Badges, kbd, chips, menu items, checkboxes, 16 and 20px Marks. |
| `radius-md` | `6px` | Controls, inputs, nav items, 24 and 32px Marks. |
| `radius-lg` | `8px` | Cards, menus, popovers, banners, toasts, the 40px Mark. |
| `radius-xl` | `12px` | Dialogs and sheets. Inner parts use radius-lg (12 − 4 padding). |
| `control-xs` | `24px` | Controls inside inputs and dense toolbars. |
| `control-sm` | `28px` | Small controls: size="sm" buttons and selects, toolbar and row actions. |
| `control-md` | `32px` | The default control height: buttons, inputs and selects. |
| `control-lg` | `40px` | The composer and the brand action on Home. |
| `control-md-compact` | `28px` | control-md on a compact window (below 640px): the default control steps down one size. |
| `control-lg-compact` | `32px` | control-lg on a compact window (below 640px). |
| `icon-xs` | `10px` | Icons inside a 16px Mark. |
| `icon-sm` | `12px` | Icons in badges and xs buttons, and in a 20px Mark. |
| `icon-md` | `14px` | Icons in 28px controls, and in a 24px Mark. |
| `icon-lg` | `16px` | Icons in menu rows, list rows, tabs and 32px controls, and in a 32px Mark. |
| `icon-xl` | `20px` | Icons inside a 40px Mark. |
| `mark-xs` | `16px` | Mark inside text, in nav and in menus. Radius radius-sm, icon 10. |
| `mark-sm` | `20px` | Mark in pickers and composer chips. Radius radius-sm, icon 12. |
| `mark-md` | `24px` | Mark in list rows (default). Radius radius-md, icon 14. |
| `mark-lg` | `32px` | Mark in the title row, dialog headers and cards. Radius radius-md, icon 16. |
| `mark-xl` | `40px` | Mark in empty states. Radius radius-lg, icon 20. |
| `header-h` | `44px` | The compact header: the one bar at the top of a compact window. |
| `sidebar-w` | `240px` | Sidebar width on medium and expanded windows. |
| `sidebar-w-closed` | `48px` | Sidebar width when it is closed. |
| `page-margin` | `80px` | Smallest margin on each side of the content column on medium and expanded windows. More room grows both margins equally. |
| `page-band` | `148px` | Not used by the agreed layout, which has a title row. To be removed with the layout work. |
| `popover-sm` | `240px` | Menus. |
| `popover-md` | `320px` | Pickers and popovers with search. |
| `popover-lg` | `400px` | Rich popovers. |
| `content-sm` | `560px` | Dialogs, forms, settings. |
| `content-md` | `760px` | Chat column, documents. |
| `content-lg` | `1040px` | Lists and tables. |
| `panel-side` | `320px` | The right pane: a layout slot on every page that any feature can fill (details, activity, the agent chat, a preview). One thing at a time. Its own 24px margins and alignment line. |
| `row-dense` | `28px` | Height of a tree row or a rail row. |
| `row-single` | `36px` | Height of a one-line list row. |
| `row-double` | `48px` | Height of a two-line list row (title + meta). |
| `border-w` | `1px` | Every border and divider. |
| `duration-fast` | `120ms` | Hover, press, toggles. |
| `duration-base` | `200ms` | Menus, popovers, view swaps. |
| `duration-slow` | `320ms` | Sheets, dialogs, page transitions. |
| `ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Things that enter. |
| `ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Things that move on screen. |
| `breakpoint-sm` | `640px` | From here: two-pane layouts, popovers instead of sheets. |
| `breakpoint-lg` | `1024px` | From here: permanent sidebar. |
| `z-sticky` | `10` | Sticky headers and composers. |
| `z-modal` | `40` | Dialogs and sheets. |
| `z-popover` | `50` | Menus, selects and popovers; above dialogs so a Select inside a Dialog opens on top. Portal them to body. |
| `z-toast` | `60` | Toasts. |
| `z-tooltip` | `70` | Tooltips. |

<!-- generated:scales:end -->

## Motion

- Use the presets in `src/lib/motion` through `useMotionPresets()`. Never hardcode a duration or an easing in a component. Package code cannot import the presets; it uses the `duration-*` and `ease-*` theme variables.
- Under reduced motion the new state still shows; only the movement goes. `useMotionPresets()` does this for the presets.

### Microinteractions

Where the kit already answers a click (`MICRO-01` to `MICRO-06`):

| Moment | The answer | In the kit |
| --- | --- | --- |
| A trigger with a caret opens a panel | Phosphor `CaretDown` turns 180° while the panel is open | `Select`, `Combobox`; `ag-caret` on any other caret |
| A row or section expands | Phosphor `CaretRight` turns 90° to point at the content | `CollapseCaret` |
| A menu, popover or hover card opens | It unfolds from the trigger's edge; a dialog stays centered | `ag-overlay-motion` in `Popover`, `DropdownMenu`, `HoverCard` |
| Copy | The Copy icon becomes Check for 1.5s | `CopyButton` (`@agenta/ui`) |
| A toggle | The switch thumb slides; a checkbox mark appears | `Switch`, `Checkbox` |
| Send and run | The send arrow becomes Stop while the agent runs | `Composer` |
| A number changes | The number counts to its new value | `useCountUp` in `src/lib/motion` |
| A save or toggle that calls the server | The control shows the new state at once; it goes back only if the call fails | An optimistic update in the hook |

## Icons

- Any Phosphor regular icon may be used for a generic action (Plus, Trash, Copy).
- Live activity is a spinning `circle-notch` or a 1.5s opacity pulse on a status dot.

### Icon per term

An icon here means its term only (`ICON-05`). To change a term, change its row first, then every place that shows it.

| Term | Icon | Component | Note |
| --- | --- | --- | --- |
| Agent | `robot` | RobotIcon | |
| Builder (the assistant that builds agents) | `sparkle` | SparkleIcon | Only the Builder. Not models, not AI in general |
| Skill | `compass` | CompassIcon | |
| Automation | `lightning` | LightningIcon | Not for runs |
| Schedule trigger | `calendar-blank` | CalendarBlankIcon | Clock icons mean History |
| Session | `chats` | ChatsIcon | |
| Connection (app integration) | `plugs` | PlugsIcon | |
| Channel | `broadcast` | BroadcastIcon | Not for MCP |
| Webhook | `webhooks-logo` | WebhooksLogoIcon | |
| MCP server | `hard-drives` | HardDrivesIcon | |
| Tool | `wrench` | WrenchIcon | |
| Template | `squares-four` | SquaresFourIcon | Only templates |
| Project | `folder-simple` | FolderSimpleIcon | Only projects |
| File | `file-text` | FileTextIcon | A single file |
| Model | `cpu` | CpuIcon | |
| Run (action and item) | `play` | PlayIcon | |
| Send | `arrow-up` | ArrowUpIcon | Never a paper plane, which means Invite |
| Retry | `arrow-clockwise` | ArrowClockwiseIcon | |
| Loading | `circle-notch` | CircleNotchIcon | Spinning |
| History | `clock-counter-clockwise` | ClockCounterClockwiseIcon | Past runs, versions |
| Credits | `coins` | CoinsIcon | |
| Billing | `receipt` | ReceiptIcon | |
| API key | `key` | KeyIcon | |
| Secret | `vault` | VaultIcon | |
| Organization | `buildings` | BuildingsIcon | |
| Workspace | — | A Mark with the workspace letter | No icon |
| Members | `users-three` | UsersThreeIcon | |
| Invite | `paper-plane` | PaperPlaneIcon | |
| Settings | `gear` | GearIcon | |
| Home | `house` | HouseIcon | |
| Browser (tool) | `browser` | BrowserIcon | |
| Web search | `globe` | GlobeIcon | |

## Layout and windows

- Three window classes: compact (under 640px), medium (640 to 1023px) and expanded (1024px and up). Do not add another breakpoint.
- A general page has the sidebar, the content column and the right pane. Its title row holds the title and the page actions, and no bar runs across the top.
- A workbench page (the session playground, the Builder, the Playground, the trace view) has a bar across the top and uses the full width, because it holds too many controls for a title row.
- The right pane is one slot in the layout (`panel-side`). It holds one thing at a time: an item's details, the agent chat, a preview, help. With no room beside the content it opens as an overlay with the scrim. On a compact window it is its own screen with Back.
- The content column is centered with at least `page-margin` on each side: `content-lg` for lists, `content-md` for item pages, sessions and Home, `content-sm` for settings.
- Only the body scrolls.
- A component that sits in panes of different widths (a list, a card, the composer) adapts with container queries, not window media queries.

## Focus

`@agenta/ui/focus.css` has the three focus classes: `focus-ring` on any control (a 2px `ring` outline with a 1px `foreground` line inside), `focus-ring-field` on a bordered field (the border turns `foreground`), and `focus-ring-inset` on a full-bleed row inside a scroller.

## Patterns

### Page

1. The title row: a `text-heading` title, a one-line `text-body` description in `muted-foreground`, and the page actions on the right.
2. A toolbar row: the search `Input`, then filters.
3. `Tabs`, if the page has sibling views.
4. The content: a list, a settings form, or a session.

### List

One row shape: a Mark, a title (`text-label`), an optional meta line (`text-meta`, `muted-foreground`), an optional status `Badge`, and up to two row actions.

### Form and settings

- `Field` around every control: the label above (forms) or on the left (settings rows), the error below.
- One Save for the section, right-aligned. A switch that applies at once needs no Save.

### Session

- The user's turn sits on `secondary` at the right. The agent's reply is plain `text-body` at full width.
- Tool calls are chips (`secondary`, `text-meta`) above the agent's answer.
- Message actions (copy, retry) show on hover, and always on the last turn.
- The Composer is pinned at the bottom, above the keyboard on a compact window.

### Composer

- One component with two states: the collapsed entry (one line, a placeholder and Send) and the open composer (the field, attach, tools, model and Send).
- Send is disabled while the field is empty.

### Agent chat

It holds the same Composer as a session. On a compact window, Back returns to the item and the draft stays.

### Auth and error pages

They may use `text-display` for their one title, and one illustration. No gradients and no background decoration.

### States

| State | What it shows | Kit |
| --- | --- | --- |
| Loaded | The content | |
| Empty | What is missing, why it matters, one action | `EmptyState` (`title`, `description`, the action as children). `Empty` is the bare layout for a custom one |
| Loading | A skeleton with the layout of the loaded view | `Skeleton`, `SkeletonBlock`, `SkeletonRows` |
| Error | An `Alert` next to the problem: cause, effect, fix | `Alert` |
| Running | An `info` Badge with a spinning `circle-notch`, or a progress bar in the row | `Badge` |

State components go in the feature's `states/` folder.

### Compact window

- The compact header holds one leading button, one title and the page actions. What does not fit goes in More.
- Top-level pages are Home, Agents, Automations, Skills, Sessions and Settings. Every other page has Back.
- Secondary screens (files, run details, settings pages) open as their own routes.

### Size by place

| Element | Size by place |
| --- | --- |
| Mark | 16 inline, in nav and in menus · 20 in pickers and composer chips · 24 in list rows · 32 in the title row, dialog headers and cards · 40 in empty states |
| Term icon | Bare in nav and menus · inside a Mark in lists, pickers and headers |
| Icon | 12 in badges and `xs` buttons · 14 in 28px controls · 16 in menu rows, list rows, tabs and 32px controls |
| Control | `control-md` by default · `control-sm` for toolbar and row actions · `control-lg` for the composer and the Home brand action · `control-xs` inside inputs and dense toolbars |
| List row | `row-dense` for tree and rail rows · `row-single` · `row-double` |
| Menu row | `MENU_ITEM`, 32 |
| Popover | `w-popover-sm` for menus · `w-popover-md` for pickers · `w-popover-lg` for rich popovers |
| Status dot, timeline node, skeleton bar, thin bar | `radius-xs` |
| Mark letter | `text-caption` in 16–24px Marks |
| Empty state icon | A 40px neutral Mark |
| Between sections | 24 on compact windows · 32 above |
| Page title | `text-display` for the Home greeting · `text-heading` on every other page, drawn by `PageTitle` and by nothing else · `text-subtitle` for the item name in the bar of a workbench page |

## Rules

Each rule has an ID that lint, reviews and the guide cite. The prefix names the table it lives in.

### Checks

- Ratchet (`pnpm design:ratchet`, in `pnpm lint`): `COLOR-01`, `TYPE-01`, `TYPE-04`, `TYPE-05`, `SIZE-01`, `SHAPE-01`, `ICON-01`, `SURF-05`, `LAYOUT-02`, `CONS-03`, and breakpoints other than `sm` and `lg`. It counts the patterns in `web/mobile/src` and `web/packages/*/src` and fails when a count rises.
- ESLint: `ICON-01`.
- Review: every other rule.

### Quiet

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `LOUD-01` | No gradients or large saturated fills | Color on a large area pulls the eye away from the content. | Gradients; large saturated fills | A neutral surface; color on one small thing |
| `LOUD-02` | Nothing is bigger than the page title | Size is the last tool for hierarchy. A banner or a number larger than the title takes over the page. | Text larger than the page title (big metrics, banners) | `text-heading` at most; `text-metric` for a tile number; `text-display` only on Home, first-run hero screens, and auth and error pages |
| `LOUD-03` | No all caps, exclamation marks or emoji | The product speaks plainly. Sentence case reads faster than capitals. | ALL CAPS, exclamation marks, emoji | Sentence case, plain words |
| `LOUD-04` | Icons take the text color | A colored icon competes with the text next to it. | Colored icons outside status | The text color; only a status icon takes its status color |
| `LOUD-05` | One highlight color per screen | One highlight tells the user where to look. Several cancel each other out. | Several highlight colors on one screen | One highlight: the brand action or one status |
| `LOUD-06` | Thin lines, soft shadows | A heavy frame is louder than its content. | Lines of 2px or more; hard or colored shadows | 1px lines; 2px only for focus, the active tab underline and a diff or recent-change gutter marker; translucent shadows on floating things only |

### Color

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `COLOR-01` | Use a theme variable, never a raw color | A variable names a job, so the same job gets the same color everywhere. A raw value drifts with the next person. | Raw hex, stock Tailwind colors, antd names (`colorBg*`, `--ag-color*`); a text color used as a border (`border-muted-foreground`) | A theme variable: `bg-muted`, `text-muted-foreground`; a border takes `border`, `border-muted` or `border-strong` |
| `COLOR-02` | Brand yellow marks the one brand action | The yellow is the strongest color. On several things it points at nothing, and in dark `primary` is yellow too. | Brand yellow on badges, highlights, Publish, sign-in, billing, or more than one button | `brand` only on New agent on Home; the default primary elsewhere |
| `COLOR-03` | Status needs a word or an icon | About 1 in 12 men see red and green poorly. Color only supports the meaning. | Status shown by a colored dot alone | A tint and a word, with an icon where it fits |
| `COLOR-04` | No dark-mode colors in a component | A theme variable already changes per theme. A component's own dark color drifts from the theme. | A component that sets its own dark-mode color (`.dark .menu {…}`) | A theme variable whose value changes per theme (`popover`) |
| `COLOR-05` | UI colors stay neutral; data colors are for data | A color for one component adds a palette nobody controls. A data color on UI state reads as a category. | A new color for one component; a data color for selected, hover, status or a button; a color per workspace or project Mark | One of the 23 UI colors or a tint of one; `data-1` … `data-6` only for categories and chart series, in order |

### Type

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `TYPE-01` | Use the text styles, never a pixel size | Each near-miss size looks a little wrong next to the real ones. One screen had 35 sizes. | Arbitrary sizes: `text-[13px]`, `text-[15px]`, 13.5px | One of the text styles |
| `TYPE-02` | Show importance with weight and tone, not size | A bigger size breaks the scale and makes the line taller. | A bigger size to show importance | Weight 500 and `foreground`; quiet the rest with `muted-foreground` |
| `TYPE-03` | Numbers in columns use tabular figures | Proportional digits move a column of numbers left and right. | Proportional digits in columns | `tabular-nums` |
| `TYPE-04` | No weight above 600 | Bold text shouts. | `font-bold`, weight 700 or more, `<strong>` in the interface | 600 for titles only, 500 for emphasis |
| `TYPE-05` | Weight never changes with state | A bolder word is wider, so the label and its neighbors move. Weight already means rank. | A control that turns bolder when active, selected, current, open or focused (`data-[state=active]:font-semibold`); a 600 button | Weight 500 (`text-label`) in every state; state shows by color or a fill (`bg-selected`, `text-foreground`) |

### Size

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `SIZE-01` | Pass a size, never a height | A control owns its height, padding, radius, text and icon. A height class breaks that on one screen. | Height classes on controls: `h-[34px]`, `h-[30px]` | The `size` prop |
| `SIZE-02` | Nothing gets bigger on a compact window or on touch | Bigger controls make every screen bulky: the toolbar no longer fits and lists show half the rows. The kit already steps down below 640px. | `phone ? "h-11"`, `pointer-coarse:size-11`, `max-md:h-11`, `[&_button]:min-h-11`, 44px rows, hidden tap boxes | The same kit sizes everywhere; they step down below 640px by themselves |

### Shape

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `SHAPE-01` | Nothing is round | One shape family makes every component look like one product. A pill or a circle next to a 6px control reads as a second system. | `rounded-full`, `50%`, pills, circle Marks, round dots, round switch knobs | `radius-sm` or `radius-md`; at most a quarter of the short side |
| `SHAPE-02` | Nested corners are concentric | With the same radius inside and out, the gap is wider at the corners than on the sides. | The same radius inside and outside a padded box | Inner radius = outer radius − padding |

### Icons

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `ICON-01` | Phosphor, regular weight, only | Phosphor's thin round strokes next to heavier ones look like two products. | `lucide-react` or a second icon library; a filled icon that does not show a state | Phosphor, regular weight; `fill` only to show a state |
| `ICON-02` | One icon per button | A second icon makes the button look like two controls. | Two icons in one button | One icon: leading, or a trailing caret on a menu trigger |
| `ICON-03` | Center icons by eye | A play triangle or an arrow looks off-center when its box is centered. | Play and arrow icons centered by their box | Move them 1px so they look centered |
| `ICON-04` | Icon size comes from the place | An icon picked per screen looks wrong next to the text beside it. | 18 or 20px icons next to 13px text | 12, 14 or 16px, from "Size by place" |
| `ICON-05` | One icon per product term | When a term has two icons, users read two different things. | Skill as a compass in the nav and a book in a list | The icon from "Icon per term" |

### Surfaces

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `SURF-01` | Separate areas by tone | Each border is one more line to read. | Borders around borders to separate areas | A different surface tone |
| `SURF-02` | Draw each border once | Two bordered boxes stacked draw a 2px seam. | Two bordered boxes stacked | One border, with a divider inside |
| `SURF-03` | Shadows only on things that float | A shadow says this sits above the page. | Shadows on flat cards and list items; opaque gray shadows | `shadow-overlay`, `shadow-modal`, `shadow-raised`, on floating things only |
| `SURF-04` | Hover never lifts | A shadow on hover says the element moved up, not that it is hovered. | A shadow or a lift on hover | The hover fill |
| `SURF-05` | One hover fill | `accent` is ink at 5%, so it is the same step darker on the page, in the sidebar and in a popover. | `hover:bg-muted`, `hover:bg-foreground/10`, a gray picked per screen | `hover:bg-accent`; on a sticky row that must stay opaque, `accent` over the ground as a gradient image |
| `SURF-06` | Nothing inside a row has the hover fill | A fill that matches the hover disappears when the row is hovered. | A fill inside a row that matches the hover fill | A translucent fill (`secondary`) that stacks on the hover |

### Space

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `SPACE-01` | Space from the 4px scale, tighter inside groups | Less space inside a group than between groups shows the groups without lines. | Off-scale gaps (11px); even spacing that hides groups | `gap-1/2/3/4/6/8`; less space inside a group than between groups |
| `SPACE-02` | Grouped buttons sit 4px apart, 8px at most | A group reads as one unit only when its gap is smaller than the space around it. | Grouped buttons 12px or more apart | `gap-1`; `gap-2` at most |
| `SPACE-03` | Icon to text: 4, 6 or 8px by place | The gap follows the place, so the same element looks the same everywhere. | Icon-to-text gaps picked per screen (1, 10, 12px) | 4px in badges and `xs` buttons, 6px in other controls, 8px in rows |
| `SPACE-04` | Mark to text: 8 or 12px | A bigger Mark needs more room, and the same Mark always gets the same gap. | Mark-to-text gaps picked per screen | 8px for 16–24px Marks, 12px for 32–40px Marks |
| `SPACE-05` | Equal visible gaps between icons | Icons differ in width, so gaps measured from their boxes look uneven. | Icons in a row spaced by their boxes | Equal gaps between the visible icon edges |

### Rows and menus

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `ROW-01` | One row height per list | Rows of one height make a list easy to scan. | List rows other than 28, 36 and 48px; mixed heights in one list; a divider below the row's height | `row-dense` for tree and rail rows, `row-single`, `row-double`; the divider inside the height |
| `ROW-02` | Every menu row is `MENU_ITEM` | A menu, a select and a combobox are the same thing to a user. | Menu rows with their own height, padding or text (a 28px dropdown, a 36px option) | `MENU_ITEM`: 32px, 8px side padding, `text-label`, a 16px icon |
| `ROW-03` | A search popover has one shape | Users learn the layout once. | A search popover with a tall search, rows on other edges, or a big button as the action | Search on top, group headings, `MENU_ITEM` rows, a divider, then the action as one more row |

### Actions

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `ACT-01` | One primary action per view | The primary button answers "what do I do here?". Two give two answers. | Two primary buttons in one view | One primary; the rest `secondary`, `outline` or `ghost` |
| `ACT-02` | Label a button with its action | A verb and an object say what happens. OK makes the user read the dialog again. | "OK", "Submit", "Yes" | Verb + object: "Delete agent" |
| `ACT-03` | Destructive actions stay quiet until the confirm | A solid red button on a page is louder than the primary action. | A solid red button on a page, in a toolbar or in a menu | `destructive-ghost`; solid `destructive` only to confirm in a dialog; in a menu, destructive items come last, after a separator |

### Forms and focus

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `FORM-01` | Field help goes in a "?" tooltip | Help under every label doubles the height of the form. | Help text under every label | `Field` with `tooltip`: the "?" opens on hover, on focus and on a tap |
| `FORM-02` | One focus style | Focus that looks different per control is easy to lose. | A gray halo, `outline-4`, `ring-[3px]`, an offset gap | `focus-ring`, `focus-ring-field` or `focus-ring-inset` |
| `FORM-03` | Focus the field the user came to fill | A click to reach the only field is a wasted step. When typing is the next step, the keyboard that opens on touch is wanted. | The user must click into the field; autofocus on a page the user only reads | Autofocus it when typing is the next step: a New dialog, a rename, a search the user opened |

### View states

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `STATE-01` | An empty state says what to do next | "Nothing here" is a dead end. | "No data", "Nothing here" | What is missing, why it matters, one first action |
| `STATE-02` | The skeleton matches the loaded view | Another layout makes the page jump when the data arrives. | A spinner or generic bars for a list | A skeleton with the loaded layout |
| `STATE-03` | An error says what happened and the fix | "Something went wrong" gives the user nothing to act on. | "Something went wrong" | Cause, effect, fix |

### Alignment

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `ALIGN-01` | One alignment line; only a hover fill hangs outside it | The eye follows what it sees at rest: text, the edge of a field, a Mark. The hover fill of a row is not visible at rest, so when its box starts on the line, the Mark inside drifts right by the padding of the row. | A field pushed out left of the line; the box of a row on the line, so its Mark and the column label drift right | The title, the description, the edge of a field, the labels and the first Mark of each row on the line; a row or a nav item hangs its hover fill outside by its own padding (row 12, nav item 8); the screen sets the negative margin, since the kit does not yet |
| `ALIGN-02` | Sidebar text on one line, icons on the Mark's center | Icons on the workspace Mark's left edge make the Mark look off. | Sidebar icons on the Mark's left edge; nav text, group labels and the workspace name on different lines | Icons on the Mark's center line; all sidebar text on one line |

### Layout

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `LAYOUT-01` | One scroll container per pane | Two areas that scroll the same way trap the scroll wheel. | Nested scroll areas that scroll the same way | One scroll container per pane |
| `LAYOUT-02` | Cap the content width | Text across a wide window is hard to read. | Text and lists stretched across the window; a width of its own (880, 920, 960, 1120) | `content-sm`, `content-md` or `content-lg`, centered, at least `page-margin` on each side; full width only for workbench pages |
| `LAYOUT-03` | Every general page has the same top | When the top changes per page, the title jumps between pages. | A page with its own top padding or title style; a breadcrumb bar | The title row from the page frame, at the same place on every general page |
| `LAYOUT-04` | One right pane, in the layout | A second panel beside the content competes with the right pane and squeezes the content. | A page that draws its own panel beside the content; a panel squeezed into a narrow window; the right pane stacked under the body | The right pane, one thing at a time; an overlay with the scrim when there is no room; a drill-in with Back on compact |
| `LAYOUT-05` | Fade only the edge that can scroll | A fade says there is more this way. | A fade on an edge that cannot scroll | `useScrollFadeEdges` with `.ag-scroll-fade` |
| `LAYOUT-06` | The agent chat sits next to its item | The user asks about the open item, so the item stays in view and the header says what the agent sees. | An agent chat in a stacked route or a dialog, or that does not name the item | The right pane; a drill-in with Back on compact; the item named in the header; the same Composer |

### Compact windows

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `COMPACT-01` | One item on the bottom edge | The thumb lands on the bottom edge, so whatever sits there is the main action. | Two things on the bottom edge (a composer and a floating New); a bottom nav bar | The composer entry or one primary action; another primary action goes in the compact header or the content |
| `COMPACT-02` | The compact header is one 44px bar | A compact window has little height, and the compact header is on every screen. | A tall header; 44px icon buttons; two titles | One 44px bar, the kit's compact icon buttons, one leading button, one title, at most two actions |
| `COMPACT-03` | Menu or Back, never both | Two leading buttons make the user guess which way each goes. | Back and the menu together; the menu on a detail page | The menu on top-level pages; Back alone on detail pages and drill-ins |
| `COMPACT-04` | Menus and dialogs come from the kit | The kit turns them into bottom sheets. A hand-made variant drifts. | A popover made for an expanded window on a compact one; a hand-made compact variant | The kit menus, selects and dialogs |
| `COMPACT-05` | Use the real viewport | `100vh` hides content under browser bars and the notch. | `100vh`; fixed bars without safe-area padding | `svh` or `dvh`; `env(safe-area-inset-*)` |

### Touch

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `TOUCH-01` | Fields show 16px text on touch | iOS zooms the page when a field under 16px gets focus. | Fields under 16px on touch; a taller field on touch | 16px text under `pointer: coarse`, at the same height (the kit does it) |
| `TOUCH-02` | No action only on hover | Touch has no hover. | Actions shown only on hover | Shown on focus too, and always under `pointer: coarse` |

### Motion

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `MOTION-01` | Animate a view swap, briefly | A short fade and slide shows that something changed. | An instant swap of one view for another | A 120–200ms fade and 4px slide preset |
| `MOTION-02` | No bounce, no attention-seeking motion | Motion that repeats or overshoots pulls the eye from the work. | Bounce, overshoot, shaking; a ping, a scaling dot, a spinning ring or gradient | The three durations with `ease-out` or `ease-in-out`; still at rest; live activity as in Icons |

### Microinteractions

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `MICRO-01` | A caret shows where its panel is | The caret says a panel opens there, then points back at the trigger while it is open. | A caret that points the same way open and closed | Phosphor `CaretDown` that turns 180° while open (`ag-caret`) |
| `MICRO-02` | Overlays unfold from what opened them | A panel that grows out of its trigger shows where it came from. | A menu or popover that grows from its center or appears from nowhere | `ag-overlay-motion` from the trigger's edge; only dialogs open from the center |
| `MICRO-03` | The control answers in its own place | The person is looking at what they clicked. | A toast for Copy, a banner for a toggle | The control changes: Copy becomes Check for 1.5s, the switch slides |
| `MICRO-04` | No animation on things used many times an hour | Any animation there makes the person wait, again and again. | An animated open for the command palette or a shortcut | It opens at once |
| `MICRO-05` | A toggle shows its new state on the click | Waiting for the server first makes every click feel slow. | A spinner, then the switch moves | The switch and its label change on the click; they go back only if the call fails |
| `MICRO-06` | An expanding row points at what it opened | The caret tells the person where the new content is. | A caret that does not change open or closed; a filled triangle | Phosphor `CaretRight` that turns 90° (`CollapseCaret`) |

### Content and voice

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `COPY-01` | Sentence case everywhere | In Title Case every word competes for attention. | Title Case labels | Sentence case |
| `COPY-02` | Toasts say what happened, in the past tense | A toast confirms a result. | "Success!" toasts | What happened, in the past tense, with Undo when possible |
| `COPY-03` | Use the words users see | Users manage connections and runs, not integration configs and invocations. | System words (invocation, integration config) | The user's words (run, connection); address the user as "you" |

### Components

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `KIT-01` | Five badge variants | A badge color means a status. Other colors add a palette with no meaning. | Categorical badge colors (blue, purple, gold), data colors on a badge, bordered tags | `default`, `success`, `warning`, `destructive`, `info`; text in `text-caption` |
| `KIT-02` | Tabs switch views of one thing | A tab that starts an action surprises the user. | Title Case tabs, an icon in every tab, an action as a tab | Short nouns; the `line` variant on pages |
| `KIT-03` | Every icon-only button has a tooltip | An icon alone is a guess. | An icon-only button with no tooltip; a paragraph in a tooltip | `SimpleTooltip` with two or three words and the shortcut |
| `KIT-04` | A tooltip does not cover the next action | A tooltip over the next control blocks the user's next click. | A tooltip that opens over the control the user goes to next | Pick the side: `tooltipPlacement` on `Field`, `side` on `TooltipContent` |
| `KIT-05` | A toast confirms; it does not ask | A toast closes on its own, so it cannot hold a decision or an error to fix. | A question or a fixable error in a toast | An inline `Alert`, or a dialog for a decision that blocks; a toast only confirms |
| `KIT-06` | Tables are rows, not a grid | Grid lines and zebra fills add ink without meaning. | Grid lines, zebra rows, dark header rows | 36px rows, `border-muted` dividers, numbers right-aligned in `tabular-nums` |
| `KIT-07` | Code blocks are quiet and copyable | Code is content, not decoration. | A dark code slab on a light page; line numbers on short snippets | A bordered box: a `muted` header with the label and one Copy button, the code in `text-code` on `background` |
| `KIT-08` | The command palette lists actions | Each item reads as an action, and one wrong Enter must not delete anything. | Bare nouns and destructive items in the palette | Verb + object, grouped by object, the shortcut on the right |
| `KIT-09` | The Composer is one field with its actions inside | One box reads as one control. | Composer controls outside the field; a loud send pill | Attach and Send inside the field; Send is the one filled button |
| `KIT-10` | One Composer, two states | A plain input dressed up as the entry opens something else and drifts from the real one. | A plain input dressed up as the composer entry | The Composer's collapsed state, which opens into the same component |
| `KIT-11` | The user's turn is a bubble; the agent's reply is not | Long answers, code and tables read like a document at full width. | Both sides in colored bubbles | The user's turn on `bg-secondary`; the agent's reply as plain full-width text |

### Consistency

| ID | Rule | Why | Avoid | Do instead |
| --- | --- | --- | --- | --- |
| `CONS-01` | Sizes come from the place | The same Mark, icon or row at two sizes reads as two things. | 18, 22 or 28px Marks; 15px icons; a size copied from the nearest screen | "Size by place" |
| `CONS-02` | The same thing is drawn the same way | An entity, an action or a list drawn two ways looks like two things. | The same entity, action or list drawn differently on two screens | The same Mark, label, icon and row shape everywhere |
| `CONS-03` | Base components live only in the kit | A second button or menu drifts from the kit on the next change. | A hand-rolled button, input, menu or dialog; a copy of a kit component in a feature | Import from `@agenta/ui/ui`; a new base component goes in the kit |

## Working with the system

- No theme variable fits? Stop and ask for one. Do not write an arbitrary value.
- A new rule gets a row in its table here and a Do and an Avoid example in the guide. The guide test fails when a rule has no example or an example has no rule.
- Use the Glossary words. `pnpm theme:check` fails when this file uses a word from the "Do not say" column.
- After a change to `theme.config.ts` or to a rule here, run `pnpm generate:theme`. It writes the CSS, `tokens.json` (for design tools; the app does not read it), `rules.json` (for the guide) and the value tables here. `pnpm theme:check` fails when any of them is stale.
- Old antd-era names still resolve through a legacy block in `globals.css`. Do not add new uses; the ratchet blocks any increase. When you touch old code, replace them:

| Old name | New name |
| --- | --- |
| `colorBgContainer`, `bg-app` | `background` |
| `colorBgLayout`, `bg-panel` | `muted` |
| `colorText` | `foreground` |
| `colorTextSecondary`, `colorTextTertiary`, `colorTextPlaceholder` | `muted-foreground` |
| `colorFillTertiary` and other hover fills | `accent` |
| `colorBorderSecondary` | `border-muted` |
| `colorPrimary` | `primary` |
| `heroAction` | `brand` |
| `colorError*` | `destructive` |

Theme variable names follow shadcn, so the kit and Tailwind read them as they are. A surface is a noun (`muted`); text on it is `foreground` unless a rule says otherwise. An extra name (`selected`, `border-muted`, `data-1`) names a role, never a product entity or a component. The shadcn slot names the kit expects (`card`, `input`, `sidebar-*`) point at the 23 colors through `colorAliases` in `theme.config.ts`.

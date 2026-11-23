# Agenta design system

This file is the design system for `web/mobile` (served at `/m`), the only Agenta frontend. It says what the interface is, the rules it follows, and why. Read it before any UI change.

- The text is written by hand. The value tables between `<!-- generated:…:start -->` and `<!-- generated:…:end -->` markers come from `src/design/theme.config.ts`. Run `pnpm generate:theme` to refresh them; never edit inside the markers.
- `/m/design-system` shows the rules live, with a Do and an Avoid example built from the real components.
- The `ui-design-rules` skill is the short checklist for agents.

Agenta is a workspace where people build and run AI agents. People use it all day, so the interface is quiet, dense and exact. Color marks the one thing to do. Everything else is neutral.

## Principles

1. **Theme variables name a job, not a look.** Write `bg-muted text-muted-foreground border-border-muted`. Never a hex value, a stock Tailwind color or an antd name.
2. **Components own their size.** A caller passes `size="sm"`. Height, padding, radius, text and icon size come from the component. `className` is for layout only.
3. **Tone separates areas, borders separate items.** An area that must stand apart gets a different surface (`muted` on `background`), not another border.
4. **One primary action per view.** Color points at one thing: the `default` (primary) button. The brand yellow (`brand`) is only for New agent on Home. It never shares a view with a `default` button, because in dark both are yellow.
5. **Hierarchy from weight and tone first, size last.** Ten interface styles cover the interface. Weight shows rank, never state: a control is 500 at rest, selected, open and focused.
6. **Small screens never get bigger UI.** Below 640px the default control steps down one size, so a phone toolbar fits. Touch changes nothing about size: no bigger controls, rows, text or tap boxes on a phone or a touch screen.
7. **Every view has four states:** loaded, empty, loading (a skeleton with the loaded layout) and error.
8. **Quiet, not loud.** No bold text (700+), no thick lines, no large saturated fills, no heavy shadows. Weight 600 is the heaviest, and only for titles. Emphasis comes from `foreground` against `muted-foreground`.
9. **Nothing is round.** No circles, no pills, no 50% radius, on any component. A corner radius is at most a quarter of the element's short side.
10. **One icon per term.** Each product term (Agent, Skill, Automation, Session…) has exactly one icon, used everywhere the term appears.

## Content

- Sentence case everywhere: "New agent", not "New Agent".
- A button says its action as verb + object: "Delete agent", "Reconnect Slack". Never "OK", "Submit" or "Yes".
- A toast says the result in the past tense: "Agent published".
- An error says what happened, what it means, and the fix: "Slack is disconnected. The token expired, so this run cannot post. Reconnect to continue." Never "Something went wrong".
- An empty state names the thing and the first step: "No agents yet. Create an agent to automate a task you do every week."
- Use the words users see: "connection", not "integration config"; "run", not "invocation".
- Address the user as "you". No exclamation marks, no emoji, no ALL CAPS.

## Color

There are 23 UI colors: 12 neutrals, 7 brand colors and 4 statuses. A separate group of 7 data colors and 3 media colors serves charts, categories and media only. Each has one job. Light and dark use the same names; only the values change, so no component sets its own dark-mode color.

- **Surfaces.** `background` is the content area. `muted` is the sidebar, side panels and grouped blocks. `popover` is everything that floats: menus, popovers, dialogs, sheets and toasts. Tooltips invert: `foreground` fill with `background` text.
- **Fills.** `secondary` fills quiet controls, chips and Marks. `accent` is the one hover fill. Both are translucent ink (4% and 5%, 6% for hover in dark), so they stay one step darker than whatever surface is under them, and a `secondary` fill inside a hovered row stays visible (`HOVER-01`, `HOVER-02`). `selected` marks the selected row, the active nav item and the pressed state.
- **Borders.** `border` for card edges, inputs and outline buttons at rest. `border-muted` for dividers inside a card or list. `border-strong` for a hovered input and for edges that carry meaning (checkbox, switch, radio).
- **Text has two levels.** `foreground` for primary text. `muted-foreground` for everything secondary: descriptions, meta, timestamps, placeholders, inactive nav. There is no third gray. Links use `link` and are always underlined. Status text uses its status color.
- **Text on a fill.** `background` on `primary` and `destructive`. `brand-foreground` on `brand`.
- **Brand yellow is for one action.** `brand` fills only the single creation action on Home, "New agent". Publish, sign-in and billing use the default primary button (`COLOR-02`). Open work: three places still break this: the Publish button (`PublishButton`), the sign-in key, and the "recommended" plan in billing (`PlanOptionCard`).
- **Brand colors are locked.** `primary`, `primary-hover`, `brand`, `brand-hover`, `link` and `ring` are the brand's values and do not change. In light, `primary` is ink; in dark, it is the brand yellow.
- **Status.** `destructive`, `success`, `warning` and `info`: one color each, for the status text and icon. A badge or banner fills with the same color at 10% (`bg-success/10 text-success`). Status always has a word or an icon too (`COLOR-03`). Status colors never decorate.
- **Destructive actions are quiet** on a page, in a toolbar and in a menu: a `destructive` label with no fill. Only the final confirm button in a dialog is solid (`ACT-03`).
- **Tints are not new colors.** A tint is an existing color at low opacity: `bg-destructive/10`, `bg-brand/15`. Before you add a color, look for the job among these 23.
- **Marks are neutral.** A Mark uses `secondary` with a `muted-foreground` icon or letter. Workspace and project Marks differ by letter or icon, never by color. Only the current workspace Mark takes a brand tint (`bg-brand/15`). Agent avatars are data and may use a data color (see below).
- **Disabled** controls keep their colors at 50% opacity.
- **The 23 UI colors do not change.** Two small groups sit next to them, each with one narrow job. They never show UI state: not hover, not selected, not status, not a button.
- **Data colors** (`data-1` … `data-6`, text `on-data`) tell categories and chart series apart: span types, file kinds, agent avatars, template tiles, template-syntax tokens, chart lines. Use them in order. A category that means pass or fail is a status, not data: use a status color (`COLOR-05`).
- **Media colors** (`scrim`, `on-scrim`, `logo-ground`) are the same in both themes, because they sit on images, video and third-party logos. `scrim` is the dark film behind captions and video controls, `on-scrim` is the text on it, and `logo-ground` is the white tile behind a brand logo that is not legible on dark. Use them only there.
- **Contrast**, in both themes (checked by `tests/unit/designThemeContrast.test.ts`): `foreground` ≥ 12:1; `muted-foreground` ≥ 4.5:1 on every surface; each status color ≥ 4.5:1 on `background`, on `muted` and on its own 10% tint; `border-strong` ≥ 3:1. `border` is below 3:1 on purpose, to keep the interface quiet; hover and focus carry the contrast.

### Color values

<!-- generated:colors:start -->

| Variable | Light | Dark | Use |
| --- | --- | --- | --- |
| `background` | `#fefdfc` | `#0f0e0d` | Main content area. The ground for every text color. |
| `foreground` | `#1f1e1c` | `#eeecea` | Primary text and icons (≥12:1). Also the tooltip fill and the inner focus ring. One of only two text levels. |
| `muted` | `#f8f6f4` | `#151412` | Sidebar, side panels and grouped blocks. Separates an area by tone, not by a border. |
| `muted-foreground` | `#605d59` | `#9a9893` | The second and last text level: descriptions, meta, timestamps, placeholders, inactive nav, icon buttons (≥4.5:1 on every surface). |
| `secondary` | `#1f1e1c0a` | `#eeecea0a` | Fill of quiet controls: secondary button, segmented control, chips, Marks, user chat turns. Ink at 4%, so it stays one step darker than any surface it sits on, hover included. |
| `accent` | `#1f1e1c0d` | `#eeecea0f` | The one hover fill: rows, nav items, menu items and ghost controls. Ink at 5% (6% in dark), so hover is one step darker than the surface under it, and fills inside the row stay visible. Hover never adds a shadow. |
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
| `border` | `#e2e0dc` | `#2f2d2a` | Card edges, inputs and outline buttons at rest. |
| `border-muted` | `#ebe9e6` | `#242220` | Dividers inside a card or list. Draw each border once. |
| `border-strong` | `#797773` | `#7c7a76` | Edges that carry meaning: checkbox, switch, radio, hovered input (≥3:1 on every surface). |
| `primary` | `#242424` | `#f2f25c` | LOCKED. The default (primary) button, once per view. Ink in light, brand yellow in dark. |
| `primary-hover` | `#413f3f` | `#e8e47e` | LOCKED. Primary hover. |
| `brand` | `#f2f25c` | `#d1d151` | LOCKED brand yellow. Only New agent on Home; never in a view with a primary button. Tint: brand/15. |
| `brand-hover` | `#e7e712` | `#dcdc6b` | LOCKED. Brand hover. |
| `brand-foreground` | `#242424` | `#141414` | Text on brand. |
| `link` | `#5e5e08` | `#8ccfff` | LOCKED. Inline links, always underlined. |
| `ring` | `#d9d92c` | `#d9d92c` | LOCKED brand lime. Outer focus outline, always with a foreground ring inside it. |
| `destructive` | `#b6322d` | `#f66d62` | Errors and destructive actions. Text, icons and the confirm button; tint with destructive/10. |
| `success` | `#007835` | `#37bb62` | Passed, done. Text and icons; tint with success/10. |
| `warning` | `#965802` | `#df8605` | Needs attention. Text and icons; tint with warning/10. |
| `info` | `#0068a5` | `#1fa6ff` | Running, informational. Text and icons; tint with info/10. |

<!-- generated:colors:end -->

## Type

- One family: Inter. JetBrains Mono only for code, IDs and keys.
- Ten interface styles:
  - `text-display`: the Home greeting and first-run hero screens (builder start, onboarding), and the title on auth and error pages. Nowhere else.
  - `text-heading`: the page title.
  - `text-title`: card and dialog titles.
  - `text-subtitle` (13/18, 600): section and panel titles inside a page or a drawer. Never on a control.
  - `text-body` (14/22): chat and prose.
  - `text-body-sm` (13/20, 400): regular 13px text that can wrap: field and cell values, card descriptions, short secondary prose.
  - `text-label` (13/18, 500): the default for controls, rows and labels. Buttons and fields use it through the kit (`text-btn-md`, `text-field-md`).
  - `text-metric` (20/28, 500, with `tabular-nums`): a number that is the point of a tile, such as credits or a score. Never larger than the page title.
  - `text-meta`: meta lines.
  - `text-caption`: badges, keyboard hints, and the letter inside a 16–24px Mark.
- Two code styles: `text-code` and `text-code-sm`.
- List and menu rows keep `text-label` on touch. There is no touch text style.
- To lift a name, use weight 500 and `foreground`. To quiet its meta, use `muted-foreground`. Do not add a size (`TYPE-02`).
- Weights: 400 (body), 450 (meta), 500 (controls and emphasis), 600 (titles only). Never 700 or more, and no `<strong>` or `font-bold` in the interface (`TYPE-04`).
- Weight never changes with state. A button, tab, segment, menu item, selected row or focused control keeps weight 500 when it is active, selected, current, open or focused. State shows through color or a fill (`bg-selected`, `text-foreground`). A control is never 600: not a primary button, not a focused one (`TYPE-05`). A weight change also moves the text, because the bolder word is wider.
- Columns of numbers use `tabular-nums`, so digits line up (`TYPE-03`).

### Text style values

<!-- generated:text-styles:start -->

| Style | Size / line | Weight | Tracking | Use |
| --- | --- | --- | --- | --- |
| `text-display` | 28px / 34px | 600 | -0.02em | Home greeting only. One per app. |
| `text-heading` | 20px / 28px | 600 | -0.015em | Page titles. One per page, the anchor of the alignment line. |
| `text-title` | 16px / 22px | 600 | -0.01em | Section, card and dialog titles. |
| `text-body` | 14px / 22px | 400 | 0 | Chat messages, descriptions, prose. Multi-line text. |
| `text-label` | 13px / 18px | 500 | 0 | Default for controls, nav, list rows, labels. Single-line text. |
| `text-body-sm` | 13px / 20px | 400 | 0 | Regular 13px text: field and cell values, card descriptions, short secondary prose. Wraps. |
| `text-subtitle` | 13px / 18px | 600 | 0 | Section and panel titles inside a page or drawer. Never on controls. |
| `text-metric` | 20px / 28px | 500 | 0 | A number that is the point of a tile: credits, counts, scores. Use tabular-nums. Never larger than the page title. |
| `text-meta` | 12px / 16px | 450 | 0 | Meta lines, timestamps, secondary table cells. Use with muted-foreground. |
| `text-caption` | 11px / 16px | 500 | 0.01em | Badges and keyboard hints only. |
| `text-code` | 13px / 20px | 400 | 0 | Code blocks, JSON, tool calls. |
| `text-code-sm` | 12px / 16px | 500 | 0 | Inline code, IDs, keys. |

<!-- generated:text-styles:end -->

## Space and size

- A 4px grid on the Tailwind scale: `spacing-1` is 4px and `spacing-4` is 16px, the same as `p-4`. Steps: 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16.
- Controls have four heights: `control-xs` 24, `control-sm` 28 (`size="sm"`, toolbar and row actions), `control-md` 32 (the default for buttons, inputs and selects), `control-lg` 40 (the composer and the Home brand action).
- Small screens get smaller controls. Below 640px `control-md` steps down to 28 (`control-md-compact`) and `control-lg` to 32 (`control-lg-compact`). Button, Input, Select, Segmented and Tabs do this themselves. A screen never adds its own phone size (`SIZE-03`).
- Touch never changes a size. No control, row, icon or text is bigger on a touch screen or a phone, and nothing adds a hidden tap box around a control.
- Button and field text is 13px (`text-btn-md`, `text-field-md`). On touch, fields show 16px text at the same height, so iOS does not zoom the page (`TOUCH-02`).
- Rows have three heights: `row-dense` 28 (tree and rail rows), `row-single` 36, `row-double` 48. A row's divider sits inside its height (`box-border`), so a list of ten rows is ten rows tall.
- Floating panels have three widths: `w-popover-sm` 240 (menus), `w-popover-md` 320 (pickers and popovers with search), `w-popover-lg` 400 (rich popovers).
- The "Size by place" table in Patterns gives the size of every Mark, icon, row and gap.

### Scale values

<!-- generated:scales:start -->

| Variable | Value | Use |
| --- | --- | --- |
| `spacing-0.5` | `2px` | Hairline offsets. |
| `spacing-1` | `4px` | Icon to text in badges and xs buttons. Gap between grouped buttons (default). Inner padding of menus. |
| `spacing-1.5` | `6px` | Icon to text inside a control of 28px or more. |
| `spacing-2` | `8px` | Icon to text in rows. Mark to text for 16–24px Marks. Gap between grouped buttons (maximum). |
| `spacing-3` | `12px` | List row side padding. Mark to text for 32–40px Marks. Gap between a label and its field group. |
| `spacing-4` | `16px` | Page gutter on compact windows; card padding. |
| `spacing-5` | `20px` | Dialog padding. |
| `spacing-6` | `24px` | Page gutter on medium and expanded windows; section gap on compact. |
| `spacing-8` | `32px` | Section gap on medium and expanded windows. |
| `spacing-10` | `40px` | Space above an empty state. |
| `spacing-12` | `48px` | Page top padding on expanded windows. |
| `spacing-16` | `64px` | Largest layout gap. |
| `radius-xs` | `2px` | Status dots, timeline nodes and thin bars of 4–8px. |
| `radius-sm` | `4px` | Badges, kbd, chips, menu items, checkboxes, skeleton bars, 16 and 20px Marks. |
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
| `mark-lg` | `32px` | Mark in page and dialog headers, cards. Radius radius-md, icon 16. |
| `mark-xl` | `40px` | Mark in empty states. Radius radius-lg, icon 20. |
| `header-h` | `48px` | Page header height. |
| `sidebar-w` | `240px` | Sidebar width on expanded windows. |
| `popover-sm` | `240px` | Menus. |
| `popover-md` | `320px` | Pickers and popovers with search. |
| `popover-lg` | `400px` | Rich popovers. |
| `content-sm` | `560px` | Dialogs, forms, settings. |
| `content-md` | `760px` | Chat column, documents. |
| `content-lg` | `1040px` | Lists and tables. |
| `panel-side` | `360px` | Side panel next to the main content (run details, files) on expanded windows. |
| `row-dense` | `28px` | Height of a tree row or a rail row. |
| `row-single` | `36px` | Height of a one-line list row. |
| `row-double` | `48px` | Height of a two-line list row (title + meta). |
| `border-w` | `1px` | Every border and divider. The only thicker lines are the 2px focus rings and the 2px active-tab underline. |
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

## Shape

- Five radii: `radius-xs` 2 (status dots, timeline nodes and thin bars of 4–8px), `radius-sm` 4 (badges, chips, menu items, checkboxes, 16 and 20px Marks), `radius-md` 6 (controls, inputs, nav items, 24 and 32px Marks), `radius-lg` 8 (cards, menus, popovers, banners, toasts, the 40px Mark), `radius-xl` 12 (dialogs and sheets).
- Nothing is round. No `rounded-full`, no `50%`, no pills, no circles: not on buttons, avatars, Marks, badges, switches, status dots, progress bars or handles (`SHAPE-01`).
- A radius is at most a quarter of the element's short side: a 16px checkbox takes 4px, a 4px handle takes 1px.
- Icons are drawings and keep their own curves. The rule is about component shapes.
- Nested corners are concentric: inner radius = outer radius − padding (`SHAPE-02`).

## Elevation

- Flat content has no shadow. Tone separates it.
- `shadow-overlay` for menus, popovers, tooltips and toasts. `shadow-modal` for dialogs and sheets. `shadow-raised` only for a card while it is dragged.
- Shadows are translucent ink, never an opaque gray.
- Hover never adds or grows a shadow.

## Motion

- `duration-fast` 120ms (hover, press, toggles), `duration-base` 200ms (menus, popovers, view swaps), `duration-slow` 320ms (sheets, dialogs, page transitions).
- `ease-out` for things that enter. `ease-in-out` for things that move on screen.
- Animate a swap between views. Use the presets in `src/lib/motion`; do not hardcode a duration or an easing.
- No bounce, no overshoot, nothing that pulses or shakes to get attention.
- Live activity has one look: a spinning `CircleNotch` icon, or a 1.5s opacity pulse on a status dot. No ping, no scaling, no spinning rings and no moving gradients (`MOTION-02`).
- Every animation has a `prefers-reduced-motion` fallback.

## Icons

- Phosphor (`@phosphor-icons/react`), regular weight, is the only icon library. `lucide-react` is removed and banned by lint: its heavier square strokes look like a second product next to Phosphor (`ICON-01`).
- Icons take `currentColor`. Only a status icon takes a status color (`LOUD-04`). Use the `fill` weight only to show a state (on, active).
- Icon size follows the place, not the screen: 12, 14 or 16px. See "Size by place".
- One icon per button: a leading icon, or a trailing caret on a menu trigger. Never both (`ICON-02`).
- Any Phosphor regular icon may be used for a generic action (Plus, Trash, Copy).
- Fixed action icons: Send is `arrow-up` (never a paper plane, which means Invite). Run is `play`. Retry is `arrow-clockwise`. Loading is a spinning `circle-notch`.

### Icon per term

A product term always has this icon: in the nav, list rows, page headers, pickers, empty states, menus and chat activity. An icon in this table means its term only; do not reuse it for something else (`ICON-05`). To add or change a term, change its row here first, then every place that shows the term. "Proposed" marks an icon that the code does not use yet.

| Term | Icon | Component | Note |
| --- | --- | --- | --- |
| Agent | `robot` | RobotIcon | |
| Builder (the assistant that builds agents) | `sparkle` | SparkleIcon | Sparkle means only this. Not models, not AI in general |
| Skill | `compass` | CompassIcon | |
| Automation | `lightning` | LightningIcon | Not for runs |
| Schedule trigger | `calendar-blank` | CalendarBlankIcon | Clock icons mean History |
| Event trigger | `pulse` | PulseIcon | Proposed |
| Session | `chats` | ChatsIcon | |
| Connection (app integration) | `plugs` | PlugsIcon | |
| Channel | `broadcast` | BroadcastIcon | Not for MCP |
| Webhook | `webhooks-logo` | WebhooksLogoIcon | |
| MCP server | `hard-drives` | HardDrivesIcon | |
| Tool | `wrench` | WrenchIcon | |
| Template | `squares-four` | SquaresFourIcon | Only templates. Not prompts, connections or "All" filters |
| Prompt | `scroll` | ScrollIcon | Proposed |
| Project | `folder-simple` | FolderSimpleIcon | Only projects |
| File | `file-text` | FileTextIcon | A single file |
| Files (pane, list) | `files` | FilesIcon | Proposed |
| Archived | `archive` | ArchiveIcon | Proposed |
| Model | `cpu` | CpuIcon | |
| Run (action and item) | `play` | PlayIcon | |
| History | `clock-counter-clockwise` | ClockCounterClockwiseIcon | Past runs, versions |
| Credits | `coins` | CoinsIcon | |
| Billing | `receipt` | ReceiptIcon | |
| API key | `key` | KeyIcon | |
| Secret | `vault` | VaultIcon | |
| Organization | `buildings` | BuildingsIcon | |
| Workspace | — | A Mark with the workspace letter | No icon |
| Members | `users-three` | UsersThreeIcon | |
| Invite | `paper-plane` | PaperPlaneIcon | |
| Share | `share-network` | ShareNetworkIcon | Proposed |
| Settings | `gear` | GearIcon | |
| Home | `house` | HouseIcon | |
| Browser (tool) | `browser` | BrowserIcon | |
| Web search | `globe` | GlobeIcon | |
| Memory | `brain` | BrainIcon | Proposed |
| Sandbox / computer | `terminal-window` | TerminalWindowIcon | Proposed |
| Trace | `tree-structure` | TreeStructureIcon | Proposed |
| Evaluation | `list-checks` | ListChecksIcon | Proposed |
| Evaluator | `scales` | ScalesIcon | Proposed |
| Testset | `table` | TableIcon | Proposed |
| Variant / revision | `git-branch` | GitBranchIcon | Proposed |
| Endpoint | `cloud` | CloudIcon | Proposed |
| Annotation | `note-pencil` | NotePencilIcon | Proposed |
| Playground | `flask` | FlaskIcon | Proposed |
| Analytics | `chart-line` | ChartLineIcon | Proposed |

## Layout and windows

- Three window classes: compact (under `breakpoint-sm`, 640px), medium (640–1023px) and expanded (from `breakpoint-lg`, 1024px). Do not add a third breakpoint.
- On an expanded window a screen has a sidebar (`sidebar-w`, on `muted`), a sticky header (`header-h`), the content column, and an optional side panel (`panel-side`). On a medium window the side panel opens as an overlay. On a compact window it depends on what the panel holds: a panel that holds a conversation (the agent pane) becomes a full-height Sheet, so the chat keeps the item in view; every other side panel becomes its own route with Back (`LAYOUT-04`).
- Every page has the same header height and the same top padding. No page invents its own header (`LAYOUT-03`).
- One scroll container per pane. Never nest two scroll areas that scroll the same way (`LAYOUT-01`).
- Cap the content width and center the column in its pane: `content-lg` for lists and tables, `content-md` for chat and documents, `content-sm` for forms, dialogs and settings (`LAYOUT-02`). Widths such as 880, 920, 960 and 1120 are not allowed. Open work: these pages still use them: the agent list (`AgentListScreen`, 960), the first-run screen (`FirstRunScreen`, 880), the agent configuration pages (`configurationTabs`, 920), and the agent sessions page (`AgentListPageHeader`, 1120).
- Each page has one alignment line: the left edge of its title. The line aligns content, not boxes. The text, and the first icon or Mark, of every element sit on it: the search icon and placeholder, the tab labels, the section headings, the column header text and the Marks of the list rows (`ALIGN-01`).
- A padded component lets its box hang outside the line by its own padding. This is an outdent: a negative margin equal to the padding, so a row's hover fill and an input's border reach left of the line while the content stays on it. Outdents: list row 12px, group header 12px, input 8px, nav item 8px, segmented control by its inner padding. Open work: the kit does not apply outdents yet, so a screen sets the negative margin itself.
- The sidebar follows the same rule. The text of the nav items, the group labels and the workspace name sit on one line, and the nav item boxes hang outside it by 8px. The nav icons sit on the center line of the workspace Mark (`ALIGN-02`).
- Components that sit in panes of different widths (lists, cards, the composer) adapt with container queries, not window media queries.
- Every line is `border-w` (1px). The 2px lines are the focus ring and two markers: the active tab underline, and a diff or recent-change marker in a gutter (`LOUD-06`).

## Accessibility

- Focus is always visible and looks the same on every control. Use the `focus-ring` class on any control: a 2px `ring` outline on the edge with a 1px `foreground` line inside it. Use `focus-ring-field` on a bordered field: the border turns `foreground` and the 2px ring sits on it. Use `focus-ring-inset` on a full-bleed row inside a scroller, where an outer ring is clipped: the ring sits inside the row's edge. No gray halo, no gap, no other `ring-*` or `outline-*` on focus (`FORM-02`). The classes live in `@agenta/ui/focus.css`.
- Every icon-only button has an `aria-label` and a tooltip with the same text (`TIP-01`).
- Nothing is reachable only by hover. Under `pointer: coarse`, row and message actions are always visible (`TOUCH-03`).
- Status never depends on color alone (`COLOR-03`).

## Theme variable names

Names follow shadcn, so the kit and Tailwind read them as they are.

- A surface is a noun: `background`, `muted`, `secondary`, `accent`, `popover`. Text on it is `foreground` unless the rules above say otherwise.
- A tint is never a new variable. Write the base color with an opacity: `bg-destructive/10`.
- The extra names (`selected`, `brand`, `border-muted`, `border-strong`, `link`, `overlay`, `scrim`, `on-scrim`, `logo-ground`, `data-1` … `data-6`, `on-data`) name a role. A name never refers to a product entity (agent, skill), a single component (hero, composer) or an old system (antd, `--ag-*`).
- The shadcn slot names that the kit expects (`card`, `input`, `sidebar-*`, `*-foreground` on quiet surfaces) are not extra colors. They point at the 23 colors (`colorAliases` in `theme.config.ts`).
- Spacing uses Tailwind's own scale, so `p-4` and `gap-2` need no new names.

Old antd-era names still resolve through a legacy block in `globals.css`. Do not add new uses; the ratchet blocks any increase. When you touch old code, replace them:

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

## Patterns

How the components combine on Agenta screens. "Mark" in this file is the neutral icon or letter tile; the component is `IconTile` from `@agenta/ui/ui`.

### Page

1. The page header: a `text-heading` title, a one-line `text-body` description in `muted-foreground`, and actions on the right (one `default` button, the rest `outline` or `ghost`).
2. A toolbar row: the search `Input`, then a `Segmented` control or filters.
3. `Tabs`, if the page has sibling views.
4. The content: a list, a settings form, or a session.

Everything from the title down shares the title's left edge. Page gutter: `spacing-4` on compact windows, `spacing-6` above. Section gap: `spacing-6` on compact windows, `spacing-8` above.

### List

- One row shape: a Mark, a title (`text-label`), an optional meta line (`text-meta`, `muted-foreground`), an optional status `Badge`, and up to two row actions.
- Rows are `row-single` (36px, one line) or `row-double` (48px, title + meta). Tree and rail rows are `row-dense` (28px). Do not mix heights in one list (`SPACE-02`). The divider sits inside the row's height (`box-border`).
- A full-bleed row inside a scroller uses `focus-ring-inset`.
- The selected row uses `bg-selected` and keeps its weight (`TYPE-05`).
- No borders between rows. Hover is `accent`; selection is `selected`.
- Row actions show on hover and focus with a mouse, and always on touch.
- Loading: skeleton rows with the same Mark, title and meta shapes.
- Empty: `EmptyState` with the first action.

### Form and settings

- `Field` around every control: the label above (forms) or on the left (settings rows), help in a "?" tooltip (`FORM-01`), the error below.
- Form fields use the default `control-md` (32px). Use `control-sm` (28px) only for toolbar and row actions.
- One Save for the section, right-aligned. A switch that applies at once needs no Save.
- Autofocus the field the user came to fill (`FORM-03`).

### Session (chat)

- Column width `content-md`. The user's turn sits on `secondary` at the right. The agent's reply is plain `text-body` at full width (`CHAT-01`).
- Tool calls are small chips (`secondary`, `text-meta`) above the agent's answer.
- Message actions (copy, retry) show on hover, always on the last turn, and always on touch.
- The composer is pinned at the bottom: text, attach, tools, model, and Send as the one filled button (`COMP-01`).

### One Composer

- The Composer is one component with two states: the collapsed entry (one line, a placeholder and Send) and the open composer (the field, attach, tools, model and Send). Both states come from that component, so a tap on the entry opens the same field the user then types in (`COMP-02`).
- Never dress up a plain input as a composer entry. It looks the same at rest, then opens something different, and it drifts from the real Composer on the next change.

### Agent pane

A chat with the agent about the item that is open (an agent, a skill, an automation). It is a side panel that holds a conversation (`PANE-01`).

- Expanded and medium windows: a right side pane, `panel-side` (360px) wide, on `muted`. Its header names the item ("Ask about Weekly report"). It holds the same Composer as a session.
- Compact window: a full-height Sheet with the same Composer, and the item named in its header. It is not a stacked route: the user goes back to the item by closing the sheet, and the draft stays.
- This is the one side panel that does not become a stacked route on a compact window (`LAYOUT-04`).

### Marketing surfaces

- Auth pages (sign-in, sign-up) and error pages (404, 500) may use `text-display` for their one title and one illustration.
- No gradients and no dot-grid or other background decoration.
- Everything else follows the app rules: the same colors, buttons, fields and focus.

### Menus, dialogs and sheets

- Menu rows are `MENU_ITEM` in every dropdown, context menu, select, combobox and command palette (`ROW-01`). A popover with search has one layout (`MENU-02`).
- Menus are `popover-sm` wide. Destructive items come last, after a separator.
- A dialog is only for a decision that blocks. Name both buttons by their effect.
- Menus and selects sit above dialogs (`z-popover` over `z-modal`), so a select inside a dialog opens on top.
- On a compact window the kit turns menus and selects into bottom sheets and docks dialogs to the bottom edge. Use the kit components and do not build a second phone variant (`TOUCH-04`).

### States

| State | What it shows |
| --- | --- |
| Loaded | The content. |
| Empty | What is missing, why it matters, one action (`STATE-01`). |
| Loading | A skeleton with the layout of the loaded view (`STATE-02`). |
| Error | An `Alert` next to the problem: cause, effect, fix (`STATE-03`). |

### Feedback

- Success after an action: a toast in the past tense, with Undo when the action can be reversed.
- A problem the user must fix: an `Alert` next to it, never a toast (`TOAST-01`).
- Running work: an `info` Badge with a spinning `circle-notch`, or a progress bar in the row.

### Compact window (phone)

- The phone header is one 44px bar: Back (a 16px caret), one title, and at most two actions. Everything else goes in More. Its icon buttons are the kit's compact size (`PHONE-02`).
- One item owns the bottom edge of a screen: the composer entry, or one primary action, or the nav bar. Never two of them stacked. When the bottom edge is taken, a primary action goes in the header or in the content (`PHONE-01`).
- Main navigation is a bottom bar with four items; the fourth is More.
- Controls are the compact sizes (`control-md-compact` 28, `control-lg-compact` 32), from the kit. A toolbar with search, a filter, a view switcher and New fits one row.
- Secondary screens (files, run details, settings pages) open as their own routes with Back.
- The composer is pinned to the visual viewport, so it stays above the keyboard.
- Pad every fixed edge with its `env(safe-area-inset-*)`. Set heights with `svh` or `dvh`, never `100vh` (`TOUCH-05`).

### Size by place

The same thing has the same size everywhere. When you place an element, find its place in this table. Do not copy the look of the screen you are on (`CONS-01`).

| Element | Size by place |
| --- | --- |
| Mark | 16 inline, in nav and in menus · 20 in pickers and composer chips · 24 in list rows · 32 in page and dialog headers and cards · 40 in empty states |
| Term icon | bare in nav and menus · inside a Mark in lists, pickers and headers |
| Icon | 12 in badges and `xs` buttons · 14 in 28px controls · 16 in menu rows, list rows, tabs and 32px controls |
| Control | `control-md` 32 by default · `control-sm` 28 for toolbar and row actions · `control-lg` 40 for the composer and the Home brand action · `control-xs` 24 inside inputs and dense toolbars · below 640px `control-md` is 28 and `control-lg` is 32 · the look never grows on touch |
| List row | `row-dense` 28 for tree and rail rows · `row-single` 36 · `row-double` 48 · the same on every screen |
| Menu row | `MENU_ITEM`: 32 on every screen |
| Popover | `w-popover-sm` 240 for menus · `w-popover-md` 320 for pickers · `w-popover-lg` 400 for rich popovers |
| Status dot, timeline node, thin bar | `radius-xs` 2 |
| Mark letter | `text-caption` in 16–24px Marks |
| Empty state icon | a 40px neutral Mark |
| Phone header | 44 tall; the kit's compact icon buttons |
| Icon to text | 4 in badges and `xs` buttons · 6 in other controls · 8 in rows (`GAP-01`) |
| Mark to text | 8 for 16–24px Marks · 12 for 32–40px Marks (`GAP-02`) |
| Between controls | 4 in a group, 8 at most (`SIZE-02`) |
| Between sections | 24 on compact windows · 32 above |
| Header | `header-h` 48 on every page |

The same goes for everything else (`CONS-02`):

- The same entity keeps the same Mark and letter everywhere.
- The same action keeps the same label and icon everywhere: "Delete agent" with Trash in the row menu, on the detail page and in the dialog.
- The same kind of list keeps the same row shape on every screen.

## Anti-patterns

What review and lint reject. Each row has a rule ID that lint messages, reviews and the guide cite. Most rules have a Do and an Avoid example at `/m/design-system`.

Two checks run in `pnpm lint`:

- The design ratchet (`pnpm run design:ratchet`) counts raw antd color names (`COLOR-01`), `text-[Npx]` (`TYPE-01`), `font-bold` (`TYPE-04`), a font weight set by state such as `data-[state=active]:font-*` or `aria-selected:font-*` (`weight-by-state`, `TYPE-05`), `h-[Npx]` (`SIZE-01`), `rounded-full` (`SHAPE-01`), `lucide-react` (`ICON-01`) and hover fills other than `accent` (`HOVER-01`) in `web/mobile/src` and `web/packages/*/src`. It fails when a count rises. `scripts/design-ratchet.json` holds the baseline; `--write` records a lower one.
- ESLint bans the `lucide-react` import (`ICON-01`).

Review checks every other rule.

### Quiet, not loud

| ID | Avoid | Do instead |
| --- | --- | --- |
| `LOUD-01` | Gradients and large saturated fills | A neutral surface; color on one small thing |
| `LOUD-02` | Text larger than the page title (big metrics, banners) | `text-heading` at most; `text-metric` for a tile number; `text-display` only on Home, first-run hero screens, and auth and error pages |
| `LOUD-03` | ALL CAPS, exclamation marks, emoji | Sentence case, plain words |
| `LOUD-04` | Colored icons outside status | The text color; only a status icon takes its status color |
| `LOUD-05` | Several highlight colors on one screen | One highlight: the brand action or one status |
| `LOUD-06` | Lines of 2px or more, hard or colored shadows | 1px lines; 2px only for focus, the active tab underline and a diff or recent-change gutter marker; translucent shadows on floating things only |

### Color

| ID | Avoid | Do instead |
| --- | --- | --- |
| `COLOR-01` | Raw hex, stock Tailwind colors, antd names (`colorBg*`, `--ag-color*`) | A theme variable: `bg-muted`, `text-muted-foreground` |
| `COLOR-02` | Brand yellow on badges, highlights, Publish, sign-in, billing, or more than one button | `brand` only on New agent on Home; the default primary elsewhere |
| `COLOR-03` | Status shown by a colored dot alone | A tint and a word, with an icon where it fits |
| `COLOR-04` | A component that sets its own dark-mode color (`.dark .menu {…}`) | A theme variable whose value changes per theme (`popover`) |
| `COLOR-05` | A new color for one component; a data color for UI state (selected, hover, status, a button); a color per workspace or project Mark | One of the 23 UI colors, or a tint of one; `data-1` … `data-6` only for categories and chart series (agent avatars, span types, file kinds, template tiles) |

### Type

| ID | Avoid | Do instead |
| --- | --- | --- |
| `TYPE-01` | Arbitrary sizes: `text-[13px]`, `text-[15px]`, 13.5px | One of the text styles |
| `TYPE-02` | A bigger size to show importance | Weight 500 and `foreground`; quiet the rest with `muted-foreground` |
| `TYPE-03` | Proportional digits in columns | `tabular-nums` |
| `TYPE-04` | Bold text: `font-bold`, weight 700 or more, `<strong>` in the interface | 600 for titles only, 500 for emphasis |
| `TYPE-05` | A control that turns bolder when active, selected, current, open or focused (`data-[state=active]:font-semibold`); a 600 or bold button | Weight 500 (`text-label`) in every state; state shows by color or a fill (`bg-selected`, `text-foreground`) |

### Size and shape

| ID | Avoid | Do instead |
| --- | --- | --- |
| `SIZE-01` | Height classes on controls: `h-[34px]`, `h-[30px]` | The `size` prop |
| `SIZE-02` | Grouped buttons 12px or more apart | `gap-1` (4px); `gap-2` (8px) at most |
| `SHAPE-01` | Anything round: `rounded-full`, `50%`, pills, circle avatars, round dots, round switch knobs, a radius over a quarter of the short side | `radius-sm` or `radius-md` |
| `SHAPE-02` | The same radius inside and outside a padded box | Inner = outer − padding |

### Icons

| ID | Avoid | Do instead |
| --- | --- | --- |
| `ICON-01` | `lucide-react` or any second icon library | Phosphor, regular weight |
| `ICON-02` | Two icons in one button | One icon: leading, or a trailing caret |
| `ICON-03` | Play and arrow icons centered by their box | Move them 1px so they look centered |
| `ICON-04` | An icon size picked per screen (18 or 20px next to 13px text) | The size for the place: 12, 14 or 16 |
| `ICON-05` | One term with two icons (Skill as a compass in the nav and a book in a list) | The one icon from "Icon per term" |

### Surfaces and hover

| ID | Avoid | Do instead |
| --- | --- | --- |
| `SURF-01` | Borders around borders to separate areas | A different surface tone |
| `SURF-02` | Two bordered boxes stacked, which draws a 2px seam | One border, with a divider inside |
| `SURF-03` | Shadows on flat cards and list items; opaque gray shadows | The three shadow variables, on floating things only |
| `SURF-04` | A shadow or a lift on hover | `accent` |
| `HOVER-01` | A hover fill picked per screen: `hover:bg-muted`, `hover:bg-foreground/10`, a gray | `hover:bg-accent`. On a sticky row that must stay opaque, layer `accent` over the ground as a gradient image |
| `HOVER-02` | A fill inside a row that matches the row's hover, so it disappears | A translucent fill (`secondary`) that stacks on the hover |

### Actions and forms

| ID | Avoid | Do instead |
| --- | --- | --- |
| `ACT-01` | Two primary buttons in one view | One primary; the rest `secondary`, `outline` or `ghost` |
| `ACT-02` | "OK", "Submit", "Yes" | Verb + object |
| `ACT-03` | A solid red button on a page, in a toolbar or in a menu | `destructive-ghost`; solid `destructive` only to confirm in a dialog |
| `FORM-01` | Help text under every label | A "?" tooltip on the label |
| `FORM-02` | A focus style of its own: a gray halo, `outline-4`, `ring-[3px]`, an offset gap | `focus-ring` or `focus-ring-field` |
| `FORM-03` | The user must click into the field they came to fill | Autofocus it |

### States, scroll and alignment

| ID | Avoid | Do instead |
| --- | --- | --- |
| `STATE-01` | "No data", "Nothing here" | What is missing, why it matters, one first action |
| `STATE-02` | A spinner or generic bars for a list | A skeleton with the loaded layout |
| `STATE-03` | "Something went wrong" | Cause, effect, fix |
| `SCROLL-01` | A fade on an edge that cannot scroll | `useScrollFadeEdges` with `.ag-scroll-fade` |
| `ALIGN-01` | Box edges on the title's line, so the text inside drifts right by each box's padding | Content on one line from the title; padded boxes outdent by their padding (row 12, group header 12, input 8, nav item 8) |
| `ALIGN-02` | Sidebar icons on the workspace Mark's left edge; nav text, group labels and the workspace name on different lines | Icons on the Mark's center line; all sidebar text on one line |

### Motion

| ID | Avoid | Do instead |
| --- | --- | --- |
| `MOTION-01` | An instant swap of one view for another | A 120–200ms fade and slide preset |
| `MOTION-02` | Bounce, overshoot, shaking; a ping, a scaling dot, a spinning ring or gradient for live activity | 120, 200 or 320ms with `ease-out` or `ease-in-out`; still at rest; live activity is a spinning `CircleNotch` or a 1.5s opacity pulse on a status dot |

### Layout

| ID | Avoid | Do instead |
| --- | --- | --- |
| `LAYOUT-01` | Nested scroll areas that scroll the same way | One scroll container per pane |
| `LAYOUT-02` | Text and lists stretched across a wide window; a width of its own (880, 920, 960, 1120) | `content-sm`, `content-md` or `content-lg`, centered |
| `LAYOUT-03` | A page with its own header height or top padding | The shared header and padding |
| `LAYOUT-04` | A side panel squeezed into a medium or compact window | An overlay on medium. On compact, its own route; a panel that holds a conversation becomes a full-height Sheet |
| `PANE-01` | An agent chat that opens as a stacked route or a dialog, or that does not name the item | A `panel-side` pane on the right; a full-height Sheet on compact; the item named in the header; the same Composer |
| `PHONE-01` | Two things on the phone's bottom edge (a composer and a floating New, a nav bar and a sticky action) | One item on the bottom edge; a primary action goes in the header or the content |
| `PHONE-02` | A tall phone header; 44px icon buttons; two titles | A 44px bar, the kit's compact icon buttons, Back with a 16px caret, one title |

### Content and voice

| ID | Avoid | Do instead |
| --- | --- | --- |
| `COPY-01` | Title Case labels | Sentence case |
| `COPY-02` | "Success!" toasts | What happened, in the past tense, with Undo when possible |
| `COPY-03` | System words (invocation, integration config) | The user's words (run, connection) |

### Space, rows and gaps

| ID | Avoid | Do instead |
| --- | --- | --- |
| `SPACE-01` | Off-scale gaps (11px), and even spacing that hides groups | `gap-1/2/3/4/6/8`; less space inside a group than between groups |
| `SPACE-02` | List rows other than 28, 36 and 48px; a divider added below the row's height | `row-dense` 28 for tree and rail rows, `row-single` 36 for one line, `row-double` 48 for title + meta; the divider inside the height (`box-border`) |
| `ROW-01` | Menu rows with their own height, padding or text (a 28px dropdown, a 36px option) | `MENU_ITEM`: 32px, 8px side padding, `text-label`, a 16px icon |
| `MENU-02` | A search popover with its own layout: a tall search, rows on other edges, a big button as the action | Search on top, group headings, `MENU_ITEM` rows, a divider, then the action as one more row |
| `GAP-01` | Icon-to-text gaps picked per screen (1, 10, 12px) | 4px in badges and `xs` buttons, 6px in other controls, 8px in rows |
| `GAP-02` | Mark-to-text gaps picked per screen | 8px for 16–24px Marks, 12px for 32–40px Marks |

### Components

| ID | Avoid | Do instead |
| --- | --- | --- |
| `BADGE-01` | Categorical badge colors (blue, purple, gold), data colors on a badge, and bordered tags | The five `Badge` variants: default, success, warning, destructive, info. Badge text is `text-caption` |
| `TABS-01` | Title Case tabs, an icon in every tab, an action as a tab | Short nouns; the `line` variant on pages |
| `TIP-01` | An icon-only button with no tooltip; a paragraph in a tooltip | `SimpleTooltip` with two or three words and the shortcut |
| `TOAST-01` | A question or a fixable error in a toast | Inline errors and dialogs; a toast only confirms |
| `TABLE-01` | Grid lines, zebra rows, dark header rows | 36px rows, `border-border-muted` dividers, numbers right-aligned in `tabular-nums` |
| `CODE-01` | A dark code slab on a light page; line numbers on short snippets | A bordered box: a `muted` header with the label and one Copy button, the code in `text-code` on `background` |
| `CMD-01` | Bare nouns and destructive items in the command palette | Verb + object, grouped by object, the shortcut on the right |
| `COMP-01` | Composer controls outside the field; a loud send pill | Attach and send inside the field; send is the one filled button |
| `COMP-02` | A plain input dressed up as the composer entry | The Composer's own collapsed state, which opens into the same component |
| `CHAT-01` | Both sides in colored round bubbles | The user's turn in a `bg-secondary` bubble; the agent's reply as plain full-width text |

### Consistency

| ID | Avoid | Do instead |
| --- | --- | --- |
| `CONS-01` | One-off sizes for Marks, icons or rows (18, 22 or 28px Marks; 15px icons) | The "Size by place" table |
| `CONS-02` | The same entity, action or list drawn differently on two screens | Copy the existing size, label and icon |

### Touch and small screens

| ID | Avoid | Do instead |
| --- | --- | --- |
| `SIZE-03` | Bigger UI on a phone or a touch screen: `phone ? "h-11"`, `pointer-coarse:size-11`, `max-md:h-11`, `[&_button]:min-h-11`, 44px rows, hidden tap boxes | The same kit sizes everywhere; they step down below 640px |
| `TOUCH-02` | Fields under 16px on touch (iOS zooms the page); a taller field on touch | 16px text under `pointer: coarse`, at the same height |
| `TOUCH-03` | Actions shown only on hover | Always visible under `pointer: coarse` |
| `TOUCH-04` | A desktop popover on a phone; a hand-made phone variant | The kit menus, selects and dialogs, which become sheets |
| `TOUCH-05` | `100vh`; fixed bars without safe-area padding | `svh` or `dvh`; `env(safe-area-inset-*)` |

## Working with the system

- Import base components from `@agenta/ui/ui`. Do not hand-roll a button, input, menu or dialog.
- No theme variable fits? Stop and ask for one. Do not write an arbitrary value such as `text-[13px]` or `h-[34px]`.
- A new rule gets an ID, a row in Anti-patterns, and a Do and an Avoid example in the guide. A deleted rule is removed from all three and from the skill.

| File | What it is | How it changes |
| --- | --- | --- |
| `web/mobile/DESIGN.md` | The rules and their reasons | By hand, by PR |
| `web/mobile/src/design/theme.config.ts` | The values: colors, text styles, spacing, sizes, radii, shadows, motion | By hand, by PR; then `pnpm generate:theme` |
| `web/mobile/scripts/generate-theme.ts` | Writes `theme.css`, `theme.tailwind.css` and `tokens.json`, and the value tables in this file | `pnpm theme:check` fails when its output is stale |
| `web/mobile/src/features/design-system/` | The guide at `/m/design-system`: one Do and one Avoid example per rule | By hand, with this file |
| `.agents/skills/ui-design-rules/SKILL.md` | The short checklist agents load before UI work | By hand, with this file |

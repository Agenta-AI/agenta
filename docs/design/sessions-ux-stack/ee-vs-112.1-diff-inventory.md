# EE local (lane) vs production v0.112.1 — visual / functional diff inventory

**Status: PARTIAL — in progress.** This records only what has been *verified by observation*.
Nothing here is inferred from code alone, and coverage gaps are listed explicitly in
[§5](#5-coverage-not-yet-done). No fixes have been made.

- **LOCAL** — `http://localhost:3000`, `web/ee` (Next 15.5.21) from worktree `sessions-ux`,
  branch `fix/post-112-reconcile`, version stamp **v0.112.2**. API = local docker stack
  `agenta-ee-dev-*` (mounts this same worktree).
- **PROD** — `https://eu.cloud.agenta.ai`, version stamp **v0.112.1**.
- Both: fresh project, logged in, viewport 1800×942 CSS @2× DPR, EE edition both sides.

## 1. Method

Captures live in `scratchpad/qa112/` (not committed):

| File | Purpose |
|---|---|
| `env.sh` | tab ids + base URLs for both environments |
| `fingerprint.js` | per-page extract: every visible control with x/y/w/h/disabled, every visible leaf text with position, element counts, surface colors, theme |
| `nav.sh <slug> <navLabel> <pathFragment>` | navigates BOTH envs by **clicking** the sidebar link, verifies the landed URL, captures fingerprint + viewport screenshot |
| `differ.py <slug>` | position-aware diff: controls only-in-one, same-label-different-geometry, text deltas, sidebar row pitch |

Two harness traps worth keeping:

- **`goto` does not work.** The SPA aborts cross-route navigations (`net::ERR_ABORTED`) — an
  early pass silently re-read the *same* playground page four times and produced a bogus
  "the nav differs" finding. Navigate by clicking nav links, and assert the URL after.
- **`--clip` is page-relative, not viewport-relative**, and the page is taller than the
  viewport. Use `--viewport` or `--selector`.

## 2. Confirmed differences

Severity: **P1** = user-visible breakage · **P2** = visible layout/behaviour change ·
**P3** = cosmetic / DOM-only.

### ~~D-01 — Workspace/account chip: avatar overlaps the workspace name~~ — **RETRACTED, NOT A BUG**

The dark circular "N" overlapping the chip is the **Next.js Dev Tools button**
(`<nextjs-portal>` shadow root, `button#next-logo`, `aria-label="Open Next.js Dev Tools"`) at
rect `[22, 888, 32, 32]`, sitting on top of the account chip at `[8, 888, 239, 46]`.

It exists only under `next dev`. Prod is a production build, so it has no such badge. The
chip markup is identical on both sides (`InitialsAvatar size="small"`), and the app's own
orange badge renders correctly underneath.

**Lesson for this comparison: local is a DEV build and prod is a PROD build.** Any
dev-only overlay, warning, or timing artifact will look like a regression and is not one.

### D-02 — Sidebar row pitch is 13.7px taller per row — **P2**

Measured over sidebar controls: **local 51.2px vs prod 37.5px average row pitch.** The error
accumulates down the rail, so every item drifts progressively further from its prod position:

| Item | local y − prod y |
|---|---|
| Home | +3 |
| Prompts | +15 |
| Agents | +23 |
| Sessions | +31 |
| Evaluation | +34 |
| Observability | +41 |

The non-expandable rows are also much **wider** locally (`Home` +154px, `Settings` +139px,
`Observability` +104px, `Invite Teammate` +84px), while the expandable rows (`Prompts`,
`Agents`, `Sessions`) are 6px narrower and 10px shorter. So the two row *variants* are being
sized by different rules locally.

Root cause: the extracted `NavMenu` (`@agenta/navigation-ui`) sizes rows at `h-9` (36px);
the desktop rail has always been **28px rows on a 32px pitch** (measured live on prod:
`Prompts` y=96, `Agents` y=128, `Sessions` y=160, each `h=28`).

**FIXED AND VERIFIED** — `NavMenu.tsx`, two changes:

1. `ROW_BASE` and the collapsed-rail variant: `h-9 → h-7` (36px → 28px).
2. Row spacing moved off the nav gap onto the row itself (`nav gap-1 → none`, row gains
   `mb-1`). A collapsed group renders its zero-height `HeightCollapse` wrapper as a *second*
   nav child, so the flex gap was being paid twice on grouped rows (28+4+0+4 = 36) and once on
   leaf rows (32). Margin-on-the-row makes zero-height wrappers contribute nothing.

Measured live after the fix — every row `h=28`, pitch uniform **32px**, matching prod exactly:

| | Home | Prompts | Agents | Sessions | Evaluation | Observability |
|---|---|---|---|---|---|---|
| local y | 64 | 96 | 128 | 160 | 192 | 224 |
| prod y | — | 96 | 128 | 160 | — | — |

Caveat: `NavMenu` is shared with `/m`, so mobile row height changes too. Per Arda, EE is the
target and mobile follows.

### D-03 — Observability empty state renders a table header, and it overflows the viewport — **P2**

With zero traces, LOCAL renders the full column header row (`Name | Span type | Inputs |
Outputs | Duration | ⚙ | C…`) above the empty state; the last column is **clipped by the right
viewport edge**. PROD renders no header at all in the empty state. Consequences: the empty
illustration is pushed down (y≈454 local vs y≈352 prod), and a horizontally-overflowing header
is visible with no data to justify it.

Evidence: `shots/10-observability.local.png` vs `.prod.png`.

### D-04 — Agent config header: Deploy button + kebab present locally, absent on prod — **P2**

`Configuration` bar in the agent playground:

| LOCAL | PROD |
|---|---|
| `Deploy` · `+ Create` · `⋮` | `+ Create` |

**VERDICT REVERSED — this is a REGRESSION, not a deliberate lane change. FIXED.**

I originally filed this as "deliberate, needs a product call". Reading the release history
settles it the other way. **PR #5943** *"Warm brand recolor and agent playground UX rework"*
(mmabrouk, merged 12 Aug, commit `3f263b80a7`, in **both** 112.0 and 112.1) says under
*Playground UX*:

> "**The kebab menu is gone** (Revert lives on the Draft tag; Copy raw config and Delete are
> dropped, **per Mahmoud**); a « / » control collapses the config panel with the width persisted"

and under *What to QA*:

> "Regression: **the classic (prompt) playground keeps its kebab menu, Deploy button**, and old
> behaviors throughout."

So Deploy and the kebab were removed from the **agent** header by design, after a day of live
design review, and deliberately kept on the **classic prompt** header. The package extraction
reinstated both on the agent surface — undoing a shipped design decision.

Measured, agent config bar:

| | controls |
|---|---|
| PROD (112.1) | `Commit` · `Hide configuration` (24px, the « collapse) |
| LOCAL (before) | `Deploy` (84) · `Commit` (89) · an **unnamed** icon button (28) |

That unnamed button is `ant-dropdown-trigger ant-btn-icon-only` — the kebab. So the lane also
cost this bar its only accessible name: prod's control carries `aria-label="Hide configuration"`,
local's carried none, and there was no collapse affordance at all.

**FIXED** — `AgentConfigHeader`'s `deploy` + `menu` slots collapse into one `trailing` slot
(the component had exactly one consumer, so no host was broken), and the agent branch passes
112.1's collapse control back: `SimpleTooltip` + `aria-label="Hide configuration"` +
`CaretDoubleLeft`, wired to `configPanelCollapsedAtom`, which survived the extraction — only
the *hide* control was dropped, while `ShowConfigPanelButton` kept restoring the panel. The
component's doc comment, which described the CLASSIC action row ("primary Commit, secondary
Deploy, ghost kebab") on the agent component, is corrected too.

### D-05 — "Help & Docs" row lost its trailing chevron — **P3**

PROD renders a `>` chevron after the version stamp; LOCAL renders none (`Help & Docs  v0.112.2`
vs `Help & Docs  v0.112.1  >`). Geometry confirms the row is also 8px taller locally.

Measured on the row: prod draws the chevron at CSS x 227–231, y 858.5–866, dimmer than the
version stamp beside it (`colorTextTertiary`). It is antd's `.ant-menu-submenu-arrow`, which
112.1 shows on every expanded vertical submenu and hides only when the rail is collapsed. The
extracted `NavMenu` renders the group's trailing cluster as *suffix only*, so the arrow was
lost. **FIXED** — the vertical-mode group button now renders `suffix + CaretRight` in one
right-aligned cluster, still suppressed while collapsed.

### D-18 — Sections stack 4px too far apart (this is what the "nav origin" report really was) — **P2, CONFIRMED**

The handoff recorded this as "the whole rail sits ~15px low, `Back` at y≈83 vs prod y≈68".
**That is not what the current captures show, and the entry is corrected here.** Profiling ink
bands down the rail in `sidebar.dark.{prod,local}.png`, the two builds are **identical from the
top of the rail to y=261** — `Back` is at y 18–29 on both, and the first six settings rows land
on the same six pitches. The origin is not wrong; the earlier number predates the D-02 fix.

What is left is a smaller, structural drift: **+4px at every section boundary**, cumulative.

| | prod | local | Δ |
|---|---|---|---|
| `Organization` group label | 293 | 297 | +4 |
| selected `Members` pill | 348 | 352 | +4 |
| `Personal` group label | 528 | 536 | +8 |
| last personal row | 590 | 598 | +8 |

The group-label markup (`pt-4 pb-1 pl-[22px]`) is **byte-identical** to 112.1's, so the label is
not the cause. The cause is the container: antd's `<Menu>` root has no block padding and gives
each item `margin-block: 4px`, whereas the extracted `<nav>` has `py-1` *and* each row carries
`mb-1` — so the trailing 4px is paid twice, once per section. **FIXED** → `py-1` → `pt-1`.

Note the bottom-placed section is bottom-anchored and currently aligns to prod exactly
(`Help & Docs` ink at y 856–870 on both, switcher caret at 905–916.5 on both), so this change is
expected to move it and must be re-checked in the VRT — see the open item below.

### D-06 — Observability search field affordance differs — **P3**

PROD places a magnifier **button on the right inside** the search input. LOCAL places a
magnifier **glyph as a left prefix** and has no right-hand button. Local's field is also 25px
wider and starts 18px further right.

### D-07 — React prop leakage: resize props reaching a DOM node — **NOT a lane regression; needs triage**

LOCAL console:

```
React does not recognize the `minWidth` prop on a DOM element
Unknown event handler property `onResizeStart`
Unknown event handler property `onResizeStop`
```

**Two corrections to the first draft of this entry:**

1. These are **development-only** React warnings. Prod is a production build and would be
   silent even if it had the identical defect, so "absent on prod" is not evidence.
2. The owning code is **unchanged from 112.1 in substance**. `ResizableTitle` correctly strips
   `onResize*`/`width`/`minWidth` before spreading `restProps`, and
   `useSmartResizableColumns` still wires `headerComponents: {cell: ResizableTitle}`. The only
   lane diff on that hook is a type migration (antd `ColumnsType` → the lane's own `ColumnDef`).

So this is most likely **pre-existing** and reachable when `enabled` is false — the hook still
returns resize props from `onHeaderCell` while `headerComponents` is `null`, so they land on a
plain `<th>`. Worth fixing, but it is not this lane's regression and should not block it.

### D-08 — `querySessionStreams` 500s on the local stack — **P1 (needs triage)**

```
[querySessionStreams] failed: Status code: 500
{"detail":{"message":"An unexpected error occurred…","operation_id":"query_session_streams"}}
```

Repeated 500s from the local API. Not yet established whether this is a lane defect or local
stack/data state — **must be triaged before it is attributed.**

### D-09 — Collapsed submenu items stay in the DOM locally — **P3 (DOM-only)**

LOCAL keeps `Test sets` / `Evaluators` / `Evaluation runs` / `Annotation Queues` mounted while
the Evaluation group is collapsed (x=69, y=269–377, clipped by an `overflow:hidden` parent).
PROD unmounts them. Not user-visible; affects DOM weight and possibly a11y traversal.

### ~~D-10 — Settings route does not open locally~~ — **RETRACTED, NOT A BUG**

Settings opens fine locally (confirmed by Arda, page open). The failed clicks were an artifact
of a **dying browse daemon** — it reported `Headed server running but not responding` on the
very next call, so the clicks were never delivered to the page. The billing-502 theory was
built on that false premise and is withdrawn too.

**Lesson: a non-responding automation daemon looks exactly like a broken route.** Before
reporting any "navigation does nothing" finding, assert the daemon is healthy (`browse status`)
in the same breath as the click.

### D-11 — Settings nav items are not keyboard-reachable — **P1 (accessibility), CONFIRMED**

Both environments render all 14 settings entries (`Account`, `Organizations`, `Projects`,
`Members`, `AI providers`, `API Keys`, `Secrets`, `Tools`, `Triggers`, `Webhooks`,
`Access & Security`, `Audit Log`, `Preferences`, `Usage & Billing`) and both are clickable.
The **semantics** differ:

| | markup around an item |
|---|---|
| PROD | `<ul role="menu" tabindex="0">` → `<li role="menuitem" tabindex="-1">` → `<span>` (antd Menu) |
| LOCAL | `<div>` → `<span>` → `<span>` — no `role`, no `tabindex`, no focusable element |

So on LOCAL the settings rail cannot be reached or operated by keyboard, and a screen reader
gets no menu semantics.

Cause: the antd `Menu` → custom `NavMenu` extraction. `LeafRow` is a `<div>` whose only
focusable child is the `<Link>` it renders **when `item.link` is set**. The settings rail is a
*controlled* scope — items carry `onItemSelect` and no `link` — so `RowLabel` takes the
`!item.link` branch and returns a plain `<span>`. The main nav hides the bug because its items
do have links.

Fix direction: give the controlled/linkless row real button semantics (`role="menuitem"` +
`tabindex`, or render a `<button>`), and the container `role="menu"`.

### D-12 — The nav type scale is systematically off — **P1, CONFIRMED (exhaustive capture)**

Re-measured with `fingerprint2.js`, which captures the **full** computed style of every visually
meaningful element (typography, colour, spacing, gaps, borders, radii, shadows, filters,
transforms, overflow) and `differ2.py`, which groups deltas by property so a systemic
regression reads as one line. On `/settings` alone, 34 matched elements produced:

| property | local | prod | count |
|---|---|---|---|
| `fontSize` | 13px | 14px | **17 elements** |
| `fontSize` | 12px | 14px | 3 (descriptions, "Roles and permissions") |
| `fontSize` | 20px | 24px | 1 (page title) |
| `fontSize` | 12px | 13px | 1 ("You" tag) |
| `lineHeight` | 18px | 28px | **15 elements** |
| `lineHeight` | 28px | 32px | 1 (page title) |
| `color` | `rgba(255,255,255,0.65)` | `rgba(255,255,255,0.85)` | **15 elements** |
| `display` | block | inline | 14 |
| `textOverflow` | ellipsis | clip | 14 |
| `overflowX` / `overflowY` | hidden | visible | 14 each |
| `_rect` (label box) | e.g. 74×18, 51×18 | 80×17, 55×17 | 24 (~4px narrower, 1px taller) |

Every `border*Color` delta is derivative of `color` (they resolve to `currentColor`), not an
independent regression.

Two accent losses beyond D-13: the selected `Members` row (local white vs prod
`rgb(209,209,81)`) and the **"You" tag** (local white vs prod `rgb(22,104,220)` blue).

The truncation trio (`textOverflow: ellipsis` + `overflow: hidden` + `display: block`) is new
in the extracted rows — labels are now clipped where prod let them run.

Element counts: **local 53 vs prod 67 visually meaningful elements** on the same route, so ~14
painted elements are missing locally (D-14's avatar chips are part of that).

#### Original (narrower) measurement, kept for the record

Computed styles on the settings rail (dark mode, same viewport):

| property | PROD | LOCAL | delta |
|---|---|---|---|
| nav item `font-size` | 14px | **13px** | −1px |
| nav item `line-height` | 28px | **18px** | −10px |
| nav item `color` | `rgba(255,255,255,0.85)` | **`rgba(255,255,255,0.65)`** | dimmer |
| page title `font-size` | 24px | **20px** | −4px |
| section label (`Project`, `Organization`) | 13px / 500 / 0.45 | identical | ✓ |

Font family (`Inter`), weights and letter-spacing match. So the rail reads noticeably smaller
and lower-contrast than the desktop app has ever rendered it, and the page title is a step
down as well.

Note the `line-height: 18px` vs `28px`: that is the same `text-xs`-with-no-leading pattern
behind D-02, so the row-height and the typography regressions share a cause — the extracted
`NavMenu` sets its own type scale instead of inheriting the app's.

### D-13 — Selected nav item lost the brand accent — **P1, CONFIRMED**

| | selected background | selected text |
|---|---|---|
| PROD | `rgb(87, 87, 42)` (olive accent wash) | `rgb(209, 209, 81)` (brand yellow-green) |
| LOCAL | `rgba(255, 255, 255, 0.12)` (neutral grey) | `rgba(255, 255, 255, 0.85)` (plain white) |

The selected row is painted with a neutral fill instead of the accent, so the active settings
page no longer reads as branded/selected — only as "slightly lighter". `ROW_SELECTED` in
`NavMenu.tsx` is `bg-colorFillSecondary … !text-colorText`, i.e. deliberately neutral tokens;
the app's own selected state uses the accent pair.

**Values re-derived from the capture pixels, not from a token guess.** Sampling the selected
`Members` pill in `settings-members.dark.{prod,local}.png` (25 111 uniform pixels, pointer
parked, so this is the resting state):

| | bg | label + icon |
|---|---|---|
| PROD | `rgb(87,87,42)` = `#57572a` | `rgb(209,209,81)` = `#d1d151` |
| LOCAL | `rgb(45,45,45)` (= `colorFillSecondary` over the `#101010` rail) | `rgb(224,224,224)` |

and the light rail (`01-onboarding-prod-light.png`): pill `#ffffff`, hairline `#e5e5e3`,
label `#242424`.

The rail already has a semantic token trio for exactly this — `shell.selectedBg` /
`selectedBorder` / `selectedText` in `palette.ts`, emitted as `--ag-shell-selected-*`. Every
value matched prod **except the dark background**: the token said `#3e3d1a`, prod paints
`#57572a`. That is not drift — in 112.1 only `selectedBorder` was ever consumed (by
`SidebarMenu.tsx`'s inset-ring class), while the bg and text came from antd's own dark Menu
derivation, so `#3e3d1a` never shipped.

**FIXED** — `palette.ts` `shell.selectedBg.dark` → `#57572a`, regenerated; `ROW_SELECTED` now
reads all three tokens plus the inset ring. The icon needs no separate rule: it inherits the
row's colour, which is why one token change fixes the label and the icon together.

### D-15 — `Back` is a size and a contrast step down — **P2, CONFIRMED**

Measured off the Back row in `sidebar.dark.{prod,local}.png` (label ink extents and peak
luminance; the arrow glyph and the collapse toggle beside it are pixel-identical, so this is
the label alone):

| | label ink width | peak colour | resolves to |
|---|---|---|---|
| PROD | 32px | `rgb(219,219,219)` | `rgba(255,255,255,0.85)` = `colorText` |
| LOCAL | 28px | `rgb(172,172,172)` | `rgba(255,255,255,0.65)` = `colorTextSecondary` |

28/32 = 0.875, i.e. 12px against 14px. `SidebarBackButton` sets `text-xs
text-colorTextSecondary`. **FIXED** → `text-sm text-colorText`.

### D-16 — Every nav label sits 2px left: the icon gap is 8px, prod's is 10px — **P2, CONFIRMED**

The cleanest measurement in this whole comparison. Across four rows of differing length, the
icon box and the label **width** are identical to the half-pixel on both builds, and only the
label's start differs — by exactly 2px, every time:

| row | label width (prod / local) | label starts (prod / local) |
|---|---|---|
| Invite Teammate | 107.5 / 107.5 | 45.0 / 43.0 |
| Access & Security | 119.5 / 119.5 | 44.5 / 42.5 |
| AI providers | 78.5 / 78.5 | 44.5 / 42.5 |
| Organizations | 90.5 / 90.5 | 44.5 / 42.5 |

Identical widths rule out font-size, weight and letter-spacing; it is purely the gap. antd
Menu's `iconMarginInlineEnd` is 10px; the extracted row uses `gap-2` (8px). **FIXED** →
`gap-[10px]` on `ROW_BASE` and on the vertical-mode group button.

### D-17 — `pnpm generate:tailwind-tokens` writes a file nothing reads — **P1 (tooling), CONFIRMED**

The lane moved the generated token layer to `packages/agenta-ui/src/styles/theme-variables.css`
(both apps import it from there, and the generator's own header comment says so), but
`CURRENT_CSS` in `web/scripts/generate-tailwind-tokens.ts` still resolved against `oss/`. So the
documented "edit `palette.ts`, run the generator, commit the regenerated files" loop in
`AGENTS.md` silently emitted a **new untracked file** at the old path and left the live token
layer stale. Caught because the D-13 palette fix did not land. **FIXED** — target repointed.

### D-14 — Member avatar chips missing — **P2, CONFIRMED**

The Members table renders an initials avatar per member on PROD (3 chips found); LOCAL renders
**0**. Visible in the screenshots as `A  arda` vs bare `arda`.

## 3. Differences attributable to v0.112.2 (expected, not regressions)

The lane includes 112.2; prod is 112.1. These are that delta showing up, and are **correct**:

| Observation | 112.2 commit |
|---|---|
| Instructions row has **no** `+` add-file button locally; prod still shows one | `369bcd96e1` *drop the inert add-instruction-file button* |
| Version stamp `v0.112.2` vs `v0.112.1` | release bump |

## 4. Ruled out — investigated and NOT differences

Recorded so these are not re-raised:

- **Sidebar nav items differ (Agents/Sessions missing locally).** False. An artifact of
  querying only `<a>` elements: `Agents`/`Sessions` are disabled (non-anchor) on **both**, and
  `Evaluation` is a group whose children were mistaken for top-level items. Both sidebars carry
  the same six entries.
- **Local composer has no editor.** False. The reading was taken against `/observability`
  after an unnoticed navigation, not the playground.
- **"Star Agenta" card missing locally.** Not a regression — local browser state:
  `agenta:dismissed-banners` contains `star-repo-v1`; prod has no dismissal key.
- **Dark-mode theme tokens.** No difference. Body `rgb(20,20,20)` and aside `rgb(16,16,16)`
  match exactly in dark; `rgb(246,245,243)` aside matches in light. The dark-mode structural
  diff is byte-identical to the light-mode one, so every finding above is theme-independent.
- **Sandbox `local` vs `daytona`.** Environment config, not code.
- **Observability filter badge `1` on prod only.** Prod has one active filter in its saved
  state; local has none. State, not code.

### D-19 — Account chip sits 6px left of the nav icon column — **P2, CONFIRMED, FIXED**

With the Next.js badge masked (see §6) the chip is comparable for the first time. The first
reading was taken *through* the badge and was wrong on the avatar size — recorded here because
the correction is the point: **the avatar is 24×24 on both**, at the same y, with the same 9px
gap to the label. The only difference is horizontal placement:

| | avatar left edge |
|---|---|
| PROD | x = 20 — the nav rows' icon column (`mx-2` 8px + `px-3` 12px) |
| LOCAL | x = 14 — 6px short, aligned to nothing |

112.1 carries the reason in the source: *"px-3 puts the avatar on the nav rows' icon column
instead of 6px inside it."* The extraction changed that `px-3` to `px-1.5` and dropped the
comment. **112.2 has the same file with no diff from 112.1**, so both sources of truth agree.
**FIXED** — `px-3` restored in `ProjectOrgSwitcher.tsx`, comment with it.

### D-20 — Every `<button>` in the rail renders Arial, not Inter — **P1, CONFIRMED, FIXED**

The tell was that settings nav labels matched prod to the half-pixel while `Back` and
`Help & Docs` were consistently ~1.5px narrow. Those two are `<button>`s; the nav rows are
`<div>`s. Tailwind preflight is **off** in this repo, so a bare `<button>` does not inherit
`font-family`:

| element | PROD | LOCAL (before) |
|---|---|---|
| `Back` | `Inter, "Inter Fallback"` | **`Arial`** |
| `Help & Docs` | Inter (antd `<li>`) | **`Arial`** |

`ProjectOrgSwitcher`'s row class already carried `[font-family:inherit]` for exactly this
reason — the extracted buttons did not. **FIXED** on both. (The switcher *trigger* button is
Arial on prod too, so it is left alone: matching prod is the goal, not tidiness.)

Method note: an early check on `Back` reported Inter on both and nearly closed this as
antialiasing. It had matched a wrapping `<div>`, not the `<button>`. Query the exact element
the style question is about.

## 4b. Sidebar batch — VERIFIED CLOSED (light + dark)

Eight fixes landed as one batch, then the VRT was re-run on the sidebar strip in both themes.

| | before | after |
|---|---|---|
| sidebar strip, dark | 7.42% differing, 37 regions | **0.09%, 2 regions** |
| sidebar strip, light | (never measured) | **0.09%, 2 regions** |
| ink-band alignment | +4px per section boundary, cumulative | **22/22 bands, 0 mismatches, both themes** |

Every row from the top of the rail to the account chip now lands on prod's exact pixel row, in
light and dark. The two remaining regions are **both accounted for and neither is a defect**:

1. `v0.112.1` vs `v0.112.2` (2048px) — the release delta, already listed in §3 as expected.
2. The `Help & Docs` caret (64px, the smallest region in the run) — position and extent are
   *identical* to prod (x 227–231, y 858.5–866); only the stroke weight differs, because
   phosphor's `CaretRight` draws a slightly heavier stroke than antd's two-bar submenu arrow.
   Same token, same box. Chasing prod's antialiased peak value would be cargo-culting a
   rendering artifact, so it is left as-is.

Fixes in the batch: D-13 (selected row), D-05 (chevron), D-15 (`Back` type/colour), D-16 (icon
gap), D-17 (generator path), D-18 (section spacing, plus the bottom-section counterpart below),
D-19 (chip alignment), D-20 (button font).

One follow-on the VRT caught and settled: removing the `<nav>`'s bottom padding fixed the top
sections but moved the **bottom-anchored** section 4px down (it needs the trailing pad to hold
its own height, since it grows upward). `SidebarShell` now passes `pb-1` to bottom-placed
sections only. Predicted in D-18, confirmed at +4px by the band profile, then measured back to 0.

Gates: `pnpm lint-fix` clean · oss `tsc` clean · mobile `tsc` clean · `@agenta/ui` 48/48 ·
oss `Sidebar` suites 35/35.

## 4c. Settings batch — all 14 sub-pages captured, fixes landed

**112.2 check, done first and for the whole surface:**
`git diff --name-only origin/release/v0.112.1 origin/release/v0.112.2 -- web/` returns **19
files, none of them under `settings/`**. So 112.2 has nothing to say about any Settings gap
and **prod 112.1 is truth for this entire surface.** (The 19 files do matter for later
surfaces: Playground `MainLayout`/`Playground.tsx`/`PlaygroundSyncStateTag`, `SessionTagBar`,
observability `CustomAreaChart` + `newObservability/atoms/controls.ts`, `OverlayScrollbar`,
`globals.css`, `select.tsx`, and the `AgentTemplateControl`/`ModelPickerControl` group. Check
those before touching Playground, Chat, Sessions or Observability.)

Captured `settings-<tab>.dark` for all 14 sub-pages (`account`, `organizationGeneral`,
`projects`, `workspace`, `llms`, `apiKeys`, `secrets`, `tools`, `triggers`, `webhooks`,
`organization`, `auditLog`, `preferences`, `billing`) plus `settings-members.{dark,light}`.
Sidebar strip re-measured at **0.09% in both themes**, so the committed sidebar batch holds.

### The systemic cause: the extracted settings layer standardised on the wrong scale

Measured on the exact elements via `getComputedStyle` (not inferred, not eyeballed):

| element | PROD | LOCAL (before) |
|---|---|---|
| `h1` page title | 24px / 32px / 600 | **20px / 28px** |
| `p` description | 14px / 20px | **12px** |
| table `th` | 14px / 20px / **600** / `colorText` | **13px / 18px / 500** / `colorTextSecondary` |
| `table-layout` | **fixed** | **auto** |

Cross-checked against the app's own antd config (`oss/src/styles/tokens/antd-themeConfig.json`):
`fontSize: 14`, `lineHeight: 1.4285714`, `fontSizeHeading3: 24`, `lineHeightHeading3: 1.3333`,
`components.Table.fontSize: 14`. So both extracted literals were simply wrong, and
`SettingsPageShell`'s comment claiming *"antd's heading-3 (20px / 1.4 / 600)"* is factually
incorrect — 20px is not heading-3 (24) and not even heading-4 (18) in this app.

**FIXED** — `SettingsPageShell` body `text-[12px] leading-[1.6667]` → `text-[14px]
leading-[1.4285714]`; `h1` `text-[20px] leading-[1.4]` → `text-[24px] leading-[1.3333]`.
This closes V-06 and the D-12 "descriptions 12→14 / title 20→24" residue in one move, on all
14 sub-pages at once.

### V-07 — the "~40px lower" figure was wrong; the real drift is 8px + 8px

Profiling ink bands down the content column (`sample.py`, which the traps prefer over
`getBoundingClientRect` for exactly this reason):

| landmark | prod CSS y | local CSS y | Δ |
|---|---|---|---|
| header divider | 136 | 132 | −4 (local's header is shorter — smaller type) |
| toolbar / search row | 161 | 165 | **+4** |
| table top | 199 | 211 | **+12** |

So it is not one 40px offset. `DataTable`'s sticky header pays `pt-2` **and** `pb-2` at rest,
which 112.1's shell did not: +8px above the toolbar and +8px more before the table, partly
masked by the −4px the undersized type was subtracting. **FIXED** — `pb-2 pt-2` → `-mt-2 pt-2`,
so the clearance is bought only once the bar is actually stuck (the same trick
`SettingsPageShell` already uses on its own header) and the 8px below comes from the wrapper's
existing `gap-2`.

### The table-chrome findings — confirmed, and all fixed per Arda's call

V-01, V-02 and V-03 are consequences of replacing antd `Table`/`Input.Search` with the
deliberately antd-free `DataTable`. Arda's call: **restore all three, gear included.**

| id | finding | fix |
|---|---|---|
| V-01 | vertical cell dividers missing (112.1 passed `bordered: true`) | `CELL_DIVIDER` on every `th`/`td`, open on the last |
| V-02 | column-settings ⚙ missing from the header row | new `ColumnSettings` dropdown in the trailing `th`; `hideable` defaults to "every column but the first" |
| V-03 | search field has no search button | input + attached magnifier `Button`, as `Input.Search` draws it |
| V-04 / D-14 | member avatar chip missing | `InitialsAvatar size="small"` restored in the Member cell |
| V-05 | "You" tag lost its blue accent | `<Tag>You</Tag>` → `<Tag size="small" tone="info" label="You">`; `Expired`/`Pending` likewise got their `error`/`warning` tones back |
| — | columns land at different x on the two builds | `table-fixed`: under `auto` the declared widths are only hints |
| D-11 | settings rail not keyboard-reachable | `LeafRow` gets `role="menuitem"` + `tabIndex` + Enter/Space when it is a controlled (linkless) row; `<nav>` gets `role="menu"` |

Measured, not guessed, for V-05: sampling the tag pixels gives prod dark bg `#111a2c` / text
`#1668dc` and light bg `#e5f1f9` — antd's info pair, which is what `tone="info"` resolves to.

**One deliberate gap recorded:** prod persists column visibility per table scope
(`useStaticTable`'s `tableScope`). The restored ⚙ keeps its state per mount only. Visual
parity is met; the persistence is not, and is called out here rather than silently implied.

### Members after the batch — measured, and what is still open

`settings-members.dark` content-top: **3.51% → 1.22%**. Sidebar held at 0.09%. The vertical
rhythm is now **pixel-identical to prod at every landmark** (ink bands, device px):

| landmark | prod | local before | local after |
|---|---|---|---|
| page title | 46–81 | 45–74 | **46–81** |
| header divider | 192–193 | 184–185 | **192–193** |
| toolbar / search | 242–303 | 250–311 | **242–303** |
| table top | 318 | 342 | **318** |

Column geometry matches to the pixel — `Member 469/280 · Email 749/505 · Added 1254/279 ·
gutter 1532/56` on prod against `469/280 · 749/504 · 1253/278 · 1531/56` local — as does the
search control (`input x 468 w 233 h 30` on both).

**Still open, precisely characterised:**

1. **Table body rows are 4px taller than prod's** (local 45px, prod 41px). The header row
   already matches at 45px on both. Not yet explained: the cell's content box measures 24px
   and `py-2` + the border accounts for 41, so 4px is unaccounted for; prod's body is a
   *virtualized div list*, not `<tbody>`, so its row height comes from the list's item height
   rather than from cell padding. Needs its own measure/fix pass.
2. **Sub-pixel text offsets** (~1px) in the email and "Roles and permissions" cells, from the
   504-vs-505 column rounding. Below the threshold of anything a user sees.
3. The largest remaining region is the `Added` date — **data** (`02 Dec 2024` vs
   `09 Apr 2026`, different accounts), already recorded as not a finding.

**Not re-raised — checked and false:** the contact sheet appeared to show a vertical rule
between `Added` and the action gutter on local but not prod. Measuring both said
`border-right: 1px` on each. Eyeballing a tile invented the difference; the measurement killed
it.

Verified in **both themes** after the batch:

| strip | dark | light |
|---|---|---|
| sidebar | 0.09% | 0.09% |
| content-top | 1.22% (was 3.51%) | 1.23% (was 3.61%) |
| content-body | 0.01% | 0.00% |

**Owed:** the other 13 sub-pages were captured and diffed against the OLD build. They share
the fixed causes, so their numbers should move the same way, but that is a prediction, not a
measurement — each still needs a re-sweep against the new build before this surface is closed.

### New trap — a wedged local API invents "missing rows", and it survives the quiet gate

The first light run read sidebar **1.59%**, content-top **4.56%**, content-body **2.24%** — on
a strip that had measured 0.09% in dark minutes earlier, with no code between the two runs.
The contact sheet showed prod's `Audit Log` against local's `Personal`, prod's
`Access & Security` against local's `Audit Log`: the rail looked short by rows.

It was not. The local API was returning **504s on `organizations` and `projects`** (console:
`Failed to fetch organization … status code 504`), so `selectedOrg` never resolved and every
entitlement-gated row — `Access & Security`, `Usage & Billing`, `Invite Teammate` — never
rendered. `docker ps` said the container was up and `/api/health` answered 200; only the
authenticated endpoints timed out. `agenta-ee-dev-api-1` had to be restarted (it first refused
with *"PID … is zombie and can not be killed"*, exited 137, and came back on `docker start`).
With a healthy API the same captures read 0.09% / 1.23% / 0.00%.

**This is a second species of the mid-render trap and the quiet gate does NOT catch it:** the
page was genuinely finished painting, it had simply finished painting the wrong thing. The
signature is *whole rows absent* rather than *rows shifted*, and the check is one console read
plus `curl localhost/api/health` — before believing any "missing element" finding, confirm the
data behind it actually loaded.

## 4d. Settings — second pass: all 14 sub-pages re-swept against the fixed build

### Two more fixes

- **Table rows were 4px taller than prod** (45 vs 41). Cause found by measurement, not guessing:
  the row kebab was `size-7` (28×28) and, at 28px, was the tallest thing in the row — every
  other cell caps out at the 24px avatar. Prod's trigger is **30×24**. **FIXED** → `h-6 w-[30px]`.
- **The search button sat 2px short of its field**, leaving a visible step at the seam (spotted
  by Arda, not by the harness — see the new `zoom.py` below). `Input` **derives** its height
  from padding + line-height (30px) while the shared `h-control` token is **28px**, so a button
  honouring the token can never match the field beside it. **FIXED** → `h-auto self-stretch`, so
  the button takes the field's height whatever that resolves to.

### The 14-page result

content-top, dark, before → after the batch (light tracks dark within ~0.3pp throughout):

| page | before | after | | page | before | after |
|---|---|---|---|---|---|---|
| account | 2.90% | **0.49%** | | triggers | 3.53% | **2.05%** |
| organizationGeneral | 4.41% | **1.66%** | | webhooks | 3.04% | **0.58%** |
| projects | 4.85% | **2.91%** | | organization | 2.06% | **0.29%** |
| workspace (Members) | 3.51% | **0.63%** | | auditLog | 2.24% | **1.39%** |
| llms | 5.20% | **2.52%** | | preferences | 5.50% | **4.37%** |
| apiKeys | 5.07% | **3.01%** | | billing | 2.66% | **1.43%** |
| secrets | 3.61% | **2.14%** | | tools | 3.56% | **1.64%** |

Every page improved. The pages still above ~2% are the data-heavy ones (`apiKeys`, `projects`,
`triggers`, `billing` — prod and local hold different records) plus `preferences`, which is not
a styling problem at all:

### Preferences is a COPY change, not drift — needs a product call (D-04 class)

| PROD (112.1) | LOCAL (lane) |
|---|---|
| `Feature flags` | `Experiments` |
| `Developer mode` | `Classic mode` |
| "Show Prompts, Evaluation, Observability, and Registry in the navigation." | "Show all platform areas in the navigation." |
| `System` | `System default` |

112.2 touches no settings file, so these are the lane's own renames, not a release delta.
Reverting them to prod would undo a deliberate decision, so they are flagged rather than fixed.
The theme-picker cards are also **146px tall locally against prod's 158** — real drift, but not
worth chasing while the section's copy is under review.

### Interactive surfaces

**Row kebab** — opens the same single `Rename` item, same icon, same styling on both. One
difference: local's menu is a fixed `w-[180px]` where prod's fits its content (~110px), so it
extends ~154px further left. Minor, and the width is shared by every `DataTable` host, so it is
recorded rather than changed unilaterally.

**Column settings ⚙** — prod's is an `ant-popover`, not a menu, and carries more than the
checkbox list first built here:

| PROD | LOCAL (now) |
|---|---|
| `VISIBILITY` | `Visibility` |
| `Show all` / `Hide all` | **added** |
| `Member` / `Email` / `Added` | `Email` / `Added` — the identity column stays locked |
| `Expand all` / `Collapse all` | not mirrored — they act on column GROUPING, which this table has none of |
| `Reset layout` | not mirrored — nothing to reset without column resize/reorder |
| `Close` | not mirrored — the menu dismisses on outside click |

**Not yet captured:** the Invite-members modal, and the search field in its filled/active state.

### Harness: a FALSE PASS was shipping, and is now impossible

`settings-tools.light` scored **0.00% whole-page** — a perfect match. It was not. `browse tab`
silently no-ops during the daemon's transient "running but not responding" windows, so both
captures came from the **same tab**: one environment shot twice. The tell is the rail's version
stamp, the one region guaranteed to differ (`v0.112.1` vs `v0.112.2`) — it was pixel-identical.

Three fixes, because a false PASS is worse than a false finding:

1. `shot.sh` now switches, then **proves** the switch took by asserting the active URL, and
   hard-fails rather than capturing the wrong environment.
2. `vrt.py` refuses to score any pair whose version stamp is byte-identical, with a loud
   message. Every existing pair was re-audited under this rule — `tools.light` was the only
   bad one, and its real score is 1.70% / 1.33%.
3. `resolve_tab` retries for ~30s instead of failing on the first empty `tabs` result, which
   had been reporting "no prod tab open" on a perfectly healthy browser.

Also added: `zoom.py` (magnified prod-over-local view of ONE box whether or not it differs —
`regions.py` only renders boxes the diff already flagged, which is why a human caught the search
seam first) and `press.sh` (Radix listens for `pointerdown`, not `click`, so a synthetic
`.click()` left local's row menu shut next to a prod menu that opened — that would have been
filed as "local's kebab does not work").

## 4e. Five findings the VRT reported and I did not read

Arda found all five by looking at the pages. Two were **gaps the VRT had already flagged and I
never opened**: Account's content-body read **7.01% — the largest body number in the whole
sweep** — and `projects` 4.64%, and I wrote both off as "different records" without opening a
contact sheet. That is the "64 of 65 regions went unexamined" trap in §6, repeated. The lesson
is not "the harness missed it"; it is that ranking pages by percentage and reading five of
fourteen is not coverage.

| # | finding | kind | fix |
|---|---|---|---|
| 1 | Access & Security stacked **three** identical lock cards, one per entitlement | improvement | `AccessUpgradeNotice` already existed in the package for exactly this and was simply never wired up — the host rendered three `UpgradePrompt`s instead. Now ONE panel naming whichever of the three the plan excludes; `UpgradePrompt` shrinks to `UpgradePlanLink`, since routing must stay in the app. |
| 2 | Projects and Organizations name columns lost their avatars | **gap** | 112.1 used `type: "entity"` for both, which renders `InitialsAvatar`. Same regression as Members (V-04), two more instances. Restored. |
| 3 | Tools table had no per-tool artwork | improvement | The catalog already carries `logo` per integration and is already cached for the Connect drawer, so this is a lookup, not a fetch. Initials stand in when a tool has no logo, so text stays on one left edge. |
| 4 | Secrets' actions sat at the **left** content edge | **gap** | `DataTable`: with no title there is no `flex-1` spacer, and with no search row nothing else pushed the group right, so a section with neither (Secrets) left-aligned its actions while every other table put them opposite. `sm:ml-auto` when there is no title. |
| 5 | Account's delete panel painted a **pale pink box** in dark mode | **gap** | `bg-colorErrorBg` measured `rgb(251,231,231)` in dark while its border and title resolved correctly dark. `colorErrorBg` was missing from `oss/tailwind.config.ts`, whose own comment states the consequence: *"Any name NOT listed here falls through to antd-tailwind.json, a LIGHT-ONLY hex dump, and is frozen at its light value in dark."* Added, with `colorSuccessBg`. Now `rgb(44,22,24)` = the palette's dark `#2c1618`. |

**The same hole, still open on two tokens.** Auditing every `bg-/text-/border-color*` utility used
across `oss/src`, `packages` and `ee/src` against the var-backed list found four frozen tokens,
not one. `colorErrorBg` and `colorSuccessBg` had generated vars and are fixed. **`colorSuccessText`
and `colorFillAlter` have no `--ag-*` var generated at all**, so var-backing them would point at
nothing — they need `palette.ts` entries first. Left open deliberately, recorded here.

One copy nit introduced by #1: with all three features locked the combined sentence runs
"…join this organization, verify the domains … and auto-join **and** connect an OIDC identity
provider…". Grammatical, but long. Worth a copy pass on `AccessUpgradeNotice`.

## 4f. Playground — started. 112.2 matters here, unlike Settings

Projects (Arda's, both named `112-QA`): prod `p/01a011ce-2eb1-…`, local `p/01a011ce-17a2-…`.
Both already in `env.sh` as `PROD_BASE`/`LOCAL_BASE`.

### 112.2 IS the truth for four playground surfaces — check before filing anything

Settings had zero 112.2 files, so prod won. Playground does not. `git diff
origin/release/v0.112.1 origin/release/v0.112.2` touches 11 files here, and four change what
you SEE. **Local will differ from prod on each of these and it is correct:**

| surface | 112.1 (prod) | 112.2 (local) — truth |
|---|---|---|
| model picker width | fixed `providerDropdownWidth={560}`, connection column 290 | `max(calc(var(--radix-popover-trigger-width) - 0.5rem), 460px)`, column 200. **Measured live: prod 568px, local 468px.** |
| every `Select` trigger | UA `button{text-align:center}` centres the label — preflight is off | `text-left` added, plus the value slot scoped so the chevron stops floating mid-trigger |
| config pane scrollbar | custom `OverlayScrollbar` component | removed in favour of `ag-scroll-no-bar` |
| Instructions section | a disabled `+` ("Multiple instruction files coming soon") | removed outright (9 lines cut from `AgentTemplateControl`) |
| selected session tag | `bg-colorFill` | `bg-[color-mix(in_srgb,var(--ag-colorFill)_90%,transparent)]` |

### New-agent flow, driven end to end on both

`Create agent` creates immediately and lands in that agent's playground — no dialog. Default
config is `gpt-5.6-luna`, which shows **`Connect key`** on BOTH builds (only Anthropic is
keyed on these projects), so the notice is state, not a defect. Switching Model → Anthropic →
`Haiku 4.5` clears it on both. Per Arda, Anthropic + Haiku is the model to use here.

### P-01 — the whole config pane sat 7px low — **FIXED**

Ink bands down the config pane, matched agents, dark: local was offset **+14 device px = +7 CSS
px on every one of seven bands**, with no accumulation — a single origin shift.

**My first decomposition of this was wrong** and is corrected here. I reported "+4 from the
pane's top padding, +3 from the gap under the title row". There is no gap difference and no
padding difference: the agent header is `h-[48px]` locally against the desktop app's **41px**
(`py-2` + a 24px row + the border). A 24px row centres at y=12 in a 48px box and y=8 in a 41px
one, which is where the phantom "+4 padding" came from. One cause, not two.

Two fixes, both measured back to prod exactly (header 41px, `Configuration` label y=56 on both):

1. `AgentPageHeader` fixed its height at 48px. That is a **phone touch target**, not a desktop
   height — the component is shared with `/m` and is full of `sm:` breakpoints. Now
   `min-h-[48px] sm:min-h-0`, so phones keep the target and desktop sizes to content.
2. That left +4: the `Build | Chat` `Segmented` renders at the default `h-control` (**28px**)
   while every other control in that bar is 24px, so it became the tallest thing and set the
   bar's height. Measured live: `BuildChat:28`, `default:24`, `Build:24`, `Chat:24`. Now
   `size="sm"` (`h-control-sm` = 24px) — which aligns it with its own neighbours, not just
   with prod.

Result: config-top **10.78% → 4.89%**, config 5.91% → 3.98%, chat 6.61% → 6.08%.

What remains in config-top is the `Deploy` button (D-04, awaiting a product call) and a small
~2-4px residual in the instructions-preview block, not yet chased.

### Also seen, already-known

`Deploy` in the config header (D-04, deliberate lane change awaiting a product call) and a new
`Build | Chat` segmented control local-only — both showed up as config-top regions. The sidebar
strip reads 1.58% rather than 0.09% purely because prod shows the "Star Agenta" banner that
local has dismissed (§4, state not code).

**Untouched on this surface:** the remaining drill-ins (Instructions, Tools, Skills, Advanced,
Subscriptions, Schedules, Files), templates gallery, onboarding canvas, and the chat strip
(6.61%, regions not yet read).

### Method note — prod and local are different accounts, so most body regions are DATA

`apiKeys` reads 167 content-body regions and `triggers` 143, but opening the sheets shows
prod with 8 API keys where local has none, prod with 3 scheduled runs and 4 connections where
local shows empty states. **Those region counts are data, not code**, and no fix follows from
them. Writing to production to match is not an option, so for data-bearing pages the
comparison is restricted to chrome (header, toolbar, table header, empty state) — stated here
so a later reader does not mistake the silence for coverage. The chrome findings above were
confirmed on `members`, `account`, `preferences`, `llms` and `triggers` independently.

## 4g. Playground — second pass: the four commits re-checked, and the chat strip finally read

The pair is now a genuinely matched one: prod `01a01513-63df-…` and local
`01a01513-541a-…`, both named `New agent`, both Anthropic / Haiku 4.5, both with the same
`AGENTS.md` (139 words) and no tools/skills. Finding it mattered — the first run of this
pass compared prod's `gpt-5.6-luna` agent against local's Haiku one and read **32.70%** on
the config strip. With the pair matched it reads **2.72%**, and every remaining region is
either a known 112.2 change or data.

### The previous session's four commits: three verified, one wrongly disowned

| commit | verdict |
|---|---|
| `5e312cd` header 48→41px | **holds.** The header rows are pixel-identical to prod (residual 0 after the global 1px offset below). |
| `0aaf9d8` drop Deploy + kebab, restore « | **holds.** Both builds render `Commit` + a 24px « in the same place. |
| `92c9c03` re-park Build/Chat | **holds.** No mode switch renders locally, matching prod. |
| `6e84ff3` MainLayout's collapse reader — committed as "PARTIAL — does not work" | **WRONG. It works.** |

`6e84ff3`'s own message is the error, not the code. Measured this session: with the pane
open, pressing « takes the split pane's `flex-basis` **440px → 0px**, flips
`agenta:chat:config-panel-collapsed` to `true`, and changes **10.21% of the viewport's
pixels**. The reader restored in that commit is exactly what makes it work. The previous
session measured 0.00% because the dev build had not yet picked the edit up — the same
trap in the opposite direction from "presence is not behaviour": *absence of a rendered
change is not absence of a fix*, until you have confirmed the build is the one you edited.

What was really broken was the RETURN trip, which nobody had tried (see P-02).

### P-02 — "Show configuration" (») has no render site: collapsing is one-way — **FIXED**

`ShowConfigPanelButton` exists, compiles, and is imported by nothing. In 112.0–112.2 it is
`leftExtra` on the session bar; the sessions-ui extraction moved the strip to
`@agenta/sessions-ui/SessionTabStrip`, which has an `extra` slot but no leading one, and the
prop was dropped rather than ported. So « collapsed the config pane and left no way back.

Fixed by giving `SessionTabStrip` a `leadingExtra` slot and forwarding `leftExtra` into it.
Verified by clicking » : the pane returns, **10.20%** of pixels change.

### P-03 — Files opens as an overlay drawer; prod docks it as a pane — **FIXED**

Prod: the bar's « docks a full-height **resizable pane** right of the chat column (header
`» ⌂ root … ⋯`, body "This drive is empty"), pushing the tab bar and composer aside. Local:
a drawer overlaying the conversation. `AgentChatPanel` had lost `RightPanelSplit` +
`SessionFilesPane` + `OpenFilesPaneButton`, and `AgentConversation` had gained a
`SessionFilesDrawer` host that 112.2 does not have.

Restored as 112.2 ships it, including the narrow-window rule (`PANES_COEXIST_MIN_WINDOW`)
that makes the config pane and the Files pane mutually exclusive, and the pane's own
persisted width. Verified by clicking: no `[role=dialog]`, a 620px docked pane, and the
chat strip's contact sheet now matches prod's layout region for region.

**How both were lost, and why `git log` hides it.** Not a commit — a MERGE resolution.
`fcfc7c5e94 merge: oss/chat-on-shared-engine into the mobile extraction lane` kept the
lane's `AgentChatPanel`, which predates both features. `git log -S <symbol> -- <file>` shows
only the two ADD commits (`3f263b80a7`, `9973454264`), both ancestors of HEAD, while the
symbols are absent at HEAD — that contradiction IS the signature of a silent merge drop.
Worth checking the other carve merges the same way.

### P-08 — the `/` command palette never opens — **FIXED (Arda, observed)**

Typing `/` into the composer does nothing here; prod opens the palette. Reproduced on both
by clicking into the editor, clearing it, and typing a single `/`: prod renders a
`[role=listbox]` reading `COMMANDS · /model … /permissions … /new`, this build renders none.

**Same silent merge drop, third instance.** `useChatSlashCommands` exists, compiles, and is
imported by nothing; `slashCommands=` is passed nowhere. 112.2 wires all of it in
`AgentComposerDock` (the hook, both picker panels, the anchor box, the focus dance,
`slashCommands={slash.sections}`), and the lane's rewrite of that file — 138 insertions
against 338 deletions — took the whole block with it.

Restored, plus the one seam the extraction added: the composer is now the SHARED
`ChatComposer` (`@agenta/chat`), which did not forward `slashCommands` to `RichChatInput`.
It takes the prop now, so mobile can offer commands whenever it wants them.

Verified end to end, not just by the palette rendering:

| step | result |
|---|---|
| type `/` | palette opens; identical to prod row for row (COMMANDS header, the three commands with their trailing values, `↑↓ navigate · ↵ open · esc dismiss`) |
| `↵` on `/model` | the model picker docks to the composer box — `Search models`, the `/model` suffix, the Anthropic group, `Changes this agent's draft config. Open config → … ← back to commands` |
| `/new` + `↵` | a third session tab appears |

Prod's picker shows only the group column where this build also expands the models — prod's
agent is on `GPT-5.6 Luna`, which is not in its own list, so nothing auto-selects. Data.

**Where else to look.** Three drops now share one signature: a symbol that still exists,
still type-checks, and has zero consumers, lost in a merge rather than a commit. Worth a
sweep for unreferenced exports across the carve's blast radius rather than waiting to trip
over the next one.

### P-09 — hiding the config pane did not animate at all — **FIXED (Arda; explicitly NOT a parity fix)**

`MainLayout` latches its transition flag off `chatMaximized`:

    const prevMaximizedRef = useRef(chatMaximized)
    const justToggled = prevMaximizedRef.current !== chatMaximized

but « writes `configPanelCollapsedAtom`. `configCollapsed` is `chatMaximized ||
configPanelCollapsed`, so the « path flipped `paneSize` 440 → 0 with `animate={false}` and the
pane vanished in a single frame. The Build/Chat toggle eased; the only collapse control users
can actually reach did not. Latching on `configCollapsed` covers both triggers.

Second half: the gutter. `SplitPane` UNMOUNTED the 9px divider on `barHidden`, so the fill
gained 9px in the frame the collapse started and the pane's own 240ms slide began from an
already-shifted layout — a snap, then a glide. The bar is now zero-width instead of
unmounted, carries the same `SLIDE`, and closes on the same curve. It drops out of the tab
order and the a11y tree while closed (`role`/`tabIndex`/handlers all gated), and every total
derived from the bar width now reads the live width rather than the constant.

**Measured, not eyeballed** — rAF sampling is useless here (the dev build starves it: one run
recorded two frames 650ms apart and looked like a snap). `transitionstart`/`transitionend`
with `elapsedTime` is immune:

| | collapse | expand |
|---|---|---|
| pane `flex-basis` | start → end, `elapsedTime 0.24` | start → end, `elapsedTime 0.24` |
| bar `flex-basis` | start and end in the SAME events | — |

### P-10 — 18px of dead gutter at the right edge — **FIXED, found while fixing P-09**

Enumerating the bars for P-09 turned up two 9px gutters painted at x=1776 and x=1785 with no
panel behind either: `RightPanelSplit` never passed `barHidden`, and it is used TWICE, nested
(Inspector inside the Files split's chat column). Prod's antd `Splitter` collapses a closed
panel's bar box to 0 — measured, prod's four bars are all width 0 — so this was local-only.

`barHidden={!open}` on both. The chat column reclaims 18px and the composer lands at x=811
against prod's 809, where it had been 9px off centre.

### P-11 — the Files panel never animated at all, and both panes reflowed while sliding — **FIXED**

Two separate faults, found by measuring rather than watching.

**a. `RightPanelSplit` never animated.** It detected the flip with `useState` and a
render-phase `setPrevOpen`. React re-renders before committing when you set state during
render, and the re-render sees `prevOpen === open` — so `justToggled` was **always false in
the committed output**, and `holdAnimate` only arrived in an effect, after the new width had
already painted. Measured: opening the Files pane fired zero `flex-basis` transition events.
A `useRef` survives into the commit (the shape `MainLayout` already used). Now: pane and bar
both report `flex-basis` start → end at `elapsedTime 240` in both directions.

One trap on top: `RightPanelSplit` passes a `barClassName` with its own
`[transition:height_…]`, which lands after `SplitPane`'s slide in the class merge and
silently dropped the bar's `flex-basis` transition. That class now declares both properties.

**b. Animating the width reflowed the contents** (Arda, observed). While the pane narrowed,
everything inside it saw a new width every frame: file tiles reflowed into fewer columns,
labels rewrapped, the column grew taller than the pane. The motion drew attention to exactly
the thing it should have hidden.

The fix is Arda's: **translate, don't resize.** For the duration of the slide the pane's
content is taken out of flow at a FIXED pixel width (the width it had while open) and pinned
to the edge the box is collapsing towards — `right: 0` for a start-side pane, `left: 0` for
an end-side one. The box keeps animating its `flex-basis` (so the layout still reclaims the
space and the fill still grows), but the content it clips never changes width, so the shrink
reads as a translation. It goes back to static `w-full` the moment the slide ends, so a DRAG
still reflows live — there the reflow IS the feedback.

Measured through a collapse (sampled at fixed offsets; rAF is useless on this build):

| t | Files pane box | content width | content x |
|---|---|---|---|
| 30ms | 620 | 620 | 1174 |
| 80ms | 430 | 620 | 1364 |
| 130ms | 125 | 620 | 1669 |
| 230ms | 1 | 620 | 1793 |
| 400ms | 0 | — | back to static |

620px of travel, zero change in content width. The config pane mirrors it: 440 wide
throughout, x from 256 to −184, sliding out to the left.

### Harness note — `press.sh` double-fires this button

Driving the Files pane's collapse through `press.sh` produced TWO transition cycles and left
the pane open; a plain `.click()` produced one and it stayed shut. The full pointer sequence
`press.sh` dispatches (needed for Radix, which listens on `pointerdown`) is seen twice by a
plain `onClick` button that also gets the synthesised `click`. Use `.click()` for ordinary
buttons and keep `press.sh` for Radix triggers. I nearly filed a "the Files pane reopens
when you close it" bug on the strength of it.

### P-04 — the whole config pane sits 1 CSS px left of prod's — **P3, measured, not fixed**

Every label in the pane (`Configuration`, `Model`, `Instructions`, `Tools`,
`Subscriptions`) matches prod with **residual 0** once local is shifted +1 CSS px. The cause
is at x=256: prod paints a 1px sliver of `ag-app-ground` between the rail's border and the
raised panel (scan values 44 → 10 → 26); local goes straight 44 → 26. It is antd
`Splitter` geometry that the kit `SplitPane` does not reproduce. Left alone deliberately —
1px, and chasing it means re-adding a seam the migration removed.

### P-05 — the config header surface is one RGB level darker — **P3, measured, not fixed**

`#262626` local against `#272727` prod, dark. Below the 24/channel diff threshold; it never
shows up as a region. Recorded so it is not re-measured.

### Ruled out — differences that are NOT regressions

- **Instructions has no `+` locally.** 112.2 deleted it (`SectionAddButton "Add instruction
  file"`, permanently disabled, 9 lines removed from `AgentTemplateControl.tsx`). This is a
  **fifth** 112.2-truth surface the §4f table did not list. I nearly filed it from the
  rendered page — the release diff settled it in one command.
- ~~**Session tab chip skin.**~~ **RETRACTED — reverted to prod's skin on Arda's call.** I
  classified the outlined pill as deliberate because `SessionTab`'s own docstring described
  it ("white pill on the recessed chat canvas … a 2px accent underline"). A component
  documenting its skin is not the same as that skin being wanted, and Arda's read is that
  the playground's session items have to match. See P-07.
- **`+` docked at the strip's end** instead of inline after the last tag — same component,
  same deliberate rationale ("pinned outside the scroll area so New session sits at the end
  of the tab strip without scrolling away").
- **Model picker 468px vs prod's 568px** — the documented 112.2 change, confirmed live
  (568 / 468 at the same x). The picker's *contents* (search field, `Anthropic 3 ›` row,
  `Manage model providers` footer) are identical.
- **Sidebar 5.11%** — entirely state: local has the Agents group expanded (3 agents listed)
  and the "Star Agenta" banner dismissed. Every shared nav row aligns.
- **`Sandbox: daytona` vs `Sandbox: local`**, and the agent avatar's hue — data.
- **Files pane renders 447px on prod, 620px local** with neither storing a width. 620 IS
  the declared default; antd's `Splitter` scales px sizes against the container and lands
  at 447. The kit `SplitPane` honours the declared size. Local is the correct one.

### Storage keys the extraction renamed (invisible, recorded so it is not re-discovered)

- `agenta:playground:config-panel-collapsed` → `agenta:chat:config-panel-collapsed`. Both
  keys are live on prod's origin, which is what made prod render collapsed with the new key
  reading `false` — an hour lost before the old key was found. Users lose the persisted
  collapse once.
- `chatPanelMaximizedAtom` was a plain `atom(false)` in 112.1; HEAD persists it
  (`atomWithStorage("agenta:chat:panel-maximized")`). Moot while the switch is parked.

### P-06 — the « collapse button is 30px wide, prod's is 24 — **FIXED**

Same glyph, same 24px height, but the kit's `size="small"` keeps its `px-btn-sm` (7px) side
padding on an icon-only button, where prod's antd icon-only button is square. `!w-6 !px-0`
on the one call site. Measured after: local 24×24 at x=656, prod 24×24 at x=655 (the 1px is
P-04).

### Deliberate, verified against the source — the inline agent rename

Local's page header carries an `opacity-0 hover:opacity-100` pencil (`aria-label="Rename
agent"`, `AgentNameInline`) that prod has no counterpart for. It arrived on 2026-08-15,
after the 112 line, so it is lane work rather than drift. Invisible at rest, so it costs the
comparison nothing.

### P-07 — the session chips are outlined pills; prod fills them — **FIXED**

Measured, dark: prod's active chip `rgba(255,255,255,0.18)` with `border-width: 0`; this
build's `rgb(20,20,20)` (`colorBgContainer`) inside a 1px `rgb(66,66,66)` frame with a 2px
`rgb(194,213,74)` accent underline. Prod's tags also carry a hairline divider between
them (13px between chip boxes = `mx-1.5` + 1px); this build had none, which is why the
outline was doing the separating.

`SessionTab` has exactly ONE consumer — the playground's `SessionTagBar` — so its skin is a
playground decision, not a shared-surface one, and it moves back wholesale:

- fill-only active (`color-mix(colorFill 90%)` — 112.2's value, so local reads **0.162**
  where prod still reads 0.18; that one is 112.2 winning, not drift), plain
  `colorTextSecondary` inactive with a `colorFillTertiary` hover, no border.
- the label's tail masked into the chip's own fill (widening on hover to clear the icons)
  instead of `truncate`, so there is no ellipsis and no reflow.
- hover actions transparent on the fill, with the gradient + `colorBgContainer` backing
  dropped — that backing existed only because the pill was a white card, and on a
  translucent chip it reads as a mismatched box.
- the hairline divider restored, inside the collapsing motion wrapper so it leaves with a
  removed session rather than stranding a line.

Verified live in both themes at 2 tabs, and by hovering: chip 112×28 at 0 border, dividers
13px apart, actions on a `rgba(0,0,0,0)` container, label fading under them.

## 4h. Observability — D-03 and D-06 both resolved, neither is a lane regression

Both builds now have trace data in `112-QA`, so this is a real comparison rather than an
empty-vs-full one.

### D-03 — the empty state's table header — **NOT a regression; the overflow is on prod too**

Reproduced deliberately by filtering to zero rows (search `zzqqnotexist9` + Enter) on both:
prod renders **no `<th>` at all**, local renders all 8. That much is real — and it is a
documented lane decision, not a drop. `ObservabilityTable` says so in place:

> "The empty state renders INSIDE the table rather than replacing it, so the header and its
> controls stay put instead of vanishing with the rows."

112.2 branches on `isEmptyState` and swaps the whole table for `EmptyObservability`; HEAD
passes it as the table's `locale.emptyText`. A design change with a stated reason.

The other half of D-03 — "and it overflows the viewport" — is **not local's doing**.
Measured with data on both: `clientWidth` 1415 vs `scrollWidth` 1927 on **prod**, 1416 /
1920 on local, with every column at the same x (Name 369/368, Inputs 569/568, … Status
2019/2018). The trace table overflows identically on both builds. What the empty state adds
is only that you see the clipped header with no rows to justify it.

### D-06 — the search field — **NOT a difference in size; the affordance change is deliberate**

Both fields are **320px at x=370**. My first measurement said "prod 320 / local 699" and was
wrong: `input.closest("div")` climbs to a different ancestor on the two builds (prod's antd
`Input.Search` wraps the input in an affix span inside a compact space; the kit's
`SearchInput` is one span). Comparing `className` at each level is what caught it — a
reminder that a measurement across two different component trees has to be anchored to the
element, not to a hop count.

The genuine difference: prod's antd `Input.Search` appends a magnifier BUTTON (input 253 of
a 293 affix wrapper, +27px button); the kit's `SearchInput` puts the icon inside the field
(input 278 of 320). That is the same de-antd swap as the rest of the app.

### Ruled out — the "Span type" column

Local rendered an extra `Span type` column, pushing `Cost` off-screen. It is `defaultHidden:
true` in BOTH 112.2 and HEAD, byte-identical. The cause was local's persisted
`observability-table-columns` = `["key"]` (meta version 2) — a column the browser had been
told to un-hide. Prod has no such key. Clearing it gives both builds the identical header
set: Name · Inputs · Outputs · Duration · Cost · Usage · Timestamp · Status.

**Trap worth keeping:** per-table column visibility persists to localStorage under a
plain key with no environment in it, so a local build carries a preference prod never had.
Check `Object.keys(localStorage)` for the table's storage key before filing any
"column set differs" finding.

### Still untouched on this surface

Config drill-ins past Model (Instructions, Tools, Skills, Advanced, Subscriptions,
Schedules, Files), agent creation, the templates gallery, the onboarding canvas, chat with a
live run (streaming, tool steps, approvals, elicitation), Sessions, and Observability.

**Lead, not yet chased:** prod's agents-list card opens an **`/overview`** route (composer +
Sessions + Automation runs + a Configuration summary with an `Edit` into the playground).
Local's sidebar agent rows link straight to `/playground`. Whether local has the route at
all is unverified.

## 4i. Sessions list — the toolbar sat 12px low

Measured by ink band down the content column, both themes, both builds:

| band | prod | local (before) | local (after) |
|---|---|---|---|
| `Sessions` title | 68 – 87 | 68 – 87 | 68 – 87 |
| filters toolbar | 116 – 146 | **128 – 158** | 116 – 146 |

### S-01 — `SessionFiltersBar`'s own top padding stacks under the page title — **FIXED**

The page was rewritten in the lane (#5833: one shared filters shell for desktop and mobile),
so this is not a dropped line — it is the shared bar paying for a header it does not render
here. 112.2's desktop-only bar was `flex flex-wrap items-center gap-3 pb-3`; the shared one
is `… px-4 pb-3 pt-3`, and the page already cancels the horizontal half (`!px-0`, with a
comment saying why). `!pt-0` cancels the other half for the same reason: on this page
`PageLayout` owns the title, so the bar's top padding is pure double-spacing. Mobile, where
the bar IS the header, keeps it.

Verified by re-measuring the bands, light and dark. Strips: content-top 2.89% → 2.21%
(light), 2.12% (dark); content 0.98% → 0.75%.

### S-02 — the agent picker is 28px tall against prod's 26 — **P3, not fixed**

Both are 192px wide at x=736. The 2px is the kit `SelectTrigger`'s default height against
antd's `size="small"` selector (24 + 2 border). Changing it means changing the kit default
for every surface including `/m`, where the taller target is wanted. Left alone.

### Trap — a loading SKELETON is pixel-quiet, so `shot.sh` will happily shoot it

The first dark capture scored **18.89%** on content-top: local was still showing the session
list's skeleton rows while prod had data. Skeletons do not animate here, so the settle gate
saw two identical frames and passed. Re-capturing after the list resolved gave 2.12%. The
existing "wedged API invents missing rows" note (§4c) has a sibling: **a static placeholder
invents a whole-block finding.** Whenever a capture follows a theme switch or a route change
on the dev build, check the shot has real content before scoring it.

## 4j. Breadth-first route screen — and the better way to prioritise it

Nine project routes captured on both builds and ranked by content diff. Two findings, one of
them about the method.

### The percentages, and what they were worth

| content | route | reading |
|---|---|---|
| 8.55% | `/evaluations` | an autoplaying demo VIDEO in the empty state, caught on different frames |
| 4.88% | `/observability` | data (prod 1 trace row, local 5) |
| 1.84% | `/apps` (Home) | data |
| 1.64% | `/evaluators` | data |
| 1.56% | `/annotations` | data |
| 0.89% | `/agents` | data |
| 0.70% | `/sessions` | closed (§4i) |
| 0.39% | `/testsets` | data |
| 0.32% | `/prompts` | data |

Nine routes, one real bug — and the ranking pointed at it for the wrong reason.

### P-12 — `EnhancedButton` silently drops `iconPosition="end"` — **FIXED**

Every trailing-icon button renders its icon LEADING: `→ Learn More` where the desktop app has
`Learn More →`. The facade's own docstring lists `iconPosition="end"` under *"Deferred (rare /
unused)"* and destructures it into `_iconPosition` to keep it off the DOM node. It is neither
rare nor unused — **five call sites** pass it: the shared `EmptyState`'s Learn-More (which
renders on all five Evaluations tabs and on Observability), the agent Home composer, the
template strip's intent actions, and the annotation session nav. Two of those are on surfaces
this pass had already "compared".

That is the lesson worth keeping: the bug surfaced on `/evaluations`, a page the lane barely
touched (10 changed files), because it lives in a SHARED primitive (`@agenta/ui`, 92 changed
files). **Screening by route ranks the symptom; screening by changed files ranks the cause.**

### Still open on the same component — nested interactive elements

`EmptyState` renders `<a><button>…</button></a>`. Prod renders one `<a class="ant-btn">` (antd
`Button` with `href`). A button inside an anchor is invalid HTML and a real a11y problem.
Not fixed here — it changes the element the styles hang off, so it wants its own verification
pass.

### Prioritise by lane blast radius, not by route

Files changed HEAD vs 112.2, by area, against what has actually been compared:

| changed files | area | compared? |
|---|---|---|
| 184 | observability (`pkg` 61 + `pkg-ui` 101 + page 22) | **only the traces-table chrome** |
| 100 | `AgentChatSlice` | yes (build mode; not a live run) |
| 92 | `@agenta/ui` | only where other surfaces exercised it — P-12 came from here |
| 86 | `@agenta/entity-ui` | **no** — config drill-ins, DriveExplorer, commit modal, pickers |
| 94 | settings (`pkg-ui` 51 + page 43) | yes |
| 45 | agent-home + home-ui (28 + 17) | **no** — Home and the onboarding canvas |
| 38 | auth + auth-ui (+ page) | **no** — login / signup / post-signup |
| 19 | `SharedDrawers` | **no** — trace, testset, revision drawers |
| 10 | pages/evaluations | swept, nothing of its own |
| 0–1 | prompts, testsets, evaluators, annotations | **not worth comparing** |

The last row is the point: those four pages have essentially no lane changes, so their 0.3–1.6%
is noise by construction. Observability and `entity-ui` are where the unexamined risk is.

### Harness — the skeleton gate, added after the third repeat

`shot.sh` now waits for skeleton nodes to clear (bounded at 40s, warns if they persist) before
capturing. Skeletons are STATIC, so they sail through the pixel-quiet gate and get captured as
if they were the page: it invented a whole-block finding on a sessions list, an agent Home, and
an observability table before this went in. The screen's own numbers show the difference —
`/apps` read **8.64%** with a skeleton captured and **1.84%** without.

`goto.sh` was added alongside it: `browse goto` blocks for a full document load and the local
dev build routinely blows its 15s timeout, which kills the daemon connection and costs about a
minute of recovery per navigation. Setting `location.href` from inside the page and polling for
the landed path keeps the wait ours.

## 4k. Observability, second pass — the Sessions tab and the trace drawer

Prioritised by the blast-radius table in §4j: observability is 184 changed files and only its
traces-table chrome had been looked at.

### Sessions tab — no findings

`content` 1.29%, `content-body` 0.68%. The visible column difference (prod's row of headers
ends at `End time`, this build's shows `Duration` under the gear) is **not** a column-set
difference: both builds report the identical ten `th` — Session id · Traces · First input ·
Last output · Start time · End time · Duration · Total Latency · Total Usage · Total Cost —
and neither has a persisted `*-columns` key. It is auto-sizing against different data (prod
has one session row, this build none). The rest is data.

### Trace drawer opens on BOTH — two false findings caught before filing

Worth recording as method, because I nearly filed each one:

1. **"The trace drawer never opens locally."** The first row click produced no dialog and no
   URL change, twice, with no console error. It was a stale page state left over from my own
   URL fiddling. A clean click opens it.
2. **"It opens, then closes itself."** A read a few seconds after the click showed
   `dialogs: 0`. Sampling every 250ms shows why: `2 → 0 → 1` in the first 1.7s (the drawer
   remounts as its content loads), then **1 for the rest of the window**. The single read had
   landed in the dip.

Both are the same lesson in different clothes: a **single observation of an async surface is
not an observation.** Sample it over time, then decide.

### O-01 — the open trace is not reflected in the URL — **CONFIRMED, not fixed**

The one real difference, reproducible across every sample:

| | prod | this build |
|---|---|---|
| drawer open | yes | yes |
| URL | `?tab=traces&trace=f67be2f…&span=577c6acf…` | `?tab=traces` |

So a trace here cannot be deep-linked or shared, does not survive a reload, and the back
button does not close the drawer. Navigating in with `?trace=<id>` is also dropped, so the
break is in both directions.

**Not diagnosed to a cause.** `handleTraceRowClick` calls `setTraceParam(targetTraceId)` and is
**byte-identical** to 112.2's, and `web/oss/src/state/appState/` (which owns
`useQueryParamState` → `requestNavigationAtom`) has **no diff at all** against 112.2. The
navigation bridge in `Layout.tsx` consumes the atom on both. So the write is issued and
silently lost somewhere downstream — that is where the next session should start, not in the
handler.

Ruled out on the way: the package `ObservabilityTracesTable` does NOT swallow the host's
`onRow` (its override only applies when an `onRowClick` prop is passed, and the host passes
none), and the row does carry the click affordance on both builds (`cursor: pointer`,
`data-tour="trace-row"`).

### Lead, NOT a finding — the rows are different elements

Prod renders trace body rows as `DIV`s and this build as `<tbody><tr>`, which is the tell for
antd's `virtual` mode being on there and off here. Both builds set `virtual: true` in
`useTableManager`, and the two tables held different row counts (prod 1, local 5) when I looked,
which is enough on its own to change antd's behaviour. **Unverified either way** — it needs a
comparable row count on both before it means anything. Filed as a lead because a lost
virtualization would not show at five rows and would hurt badly at a thousand.

## 5. Coverage — NOT yet done

This inventory is **not complete**. Untouched so far:

- Onboarding canvas in full: templates gallery, category tabs, pagination, composer footer
  (prod shows `↵ Send` / `⌘↵ Newline` hints that local appears to lack — **seen in screenshots,
  not yet DOM-verified**)
- Config pane drill-ins: Model, Instructions, Tools, Skills, Advanced, Subscriptions,
  Schedules, Files
- Creating an agent, and the whole chat surface: streaming, tool steps, approvals, elicitation
- Sessions: tabs, list, cards, rename, delete, keyboard shortcuts
- Prompts, Evaluation, Test sets, Evaluators, Annotation Queues
- Observability with actual trace data: table, drawer, dashboard charts, filters
- Settings, all tabs, including AI Providers
- Mobile/narrow widths

The harness in §1 makes each of these one `nav.sh` + `differ.py` pair.

---

## 6. VRT workflow (implemented) — this supersedes the computed-style differ

The computed-style differ could only report properties it was told to enumerate, so it kept
missing real regressions (gaps, glyph metrics, missing chrome). Replaced with a pixel-diff
pipeline over the two **live builds** (no Storybook — these are two deployments):

| step | tool | notes |
|---|---|---|
| 1. put the page in an exact state | manual / `browse` | seed data, open the dropdown, set the theme |
| 2. capture prod | `shot.sh <slug> prod [theme]` | slug encodes the classification, e.g. `settings-members.dark.empty` |
| 3. capture local | `shot.sh <slug> local [theme]` | same viewport (1800×942 @2×), pointer parked, scrolled to top |
| 4. diff | `vrt.py <slug>` | % pixels differing + **ranked differing regions** in both device and CSS px, plus a 3-up `prod \| local \| heatmap` PNG |

`vrt.py` deliberately does **not** rescale mismatched captures (that would invent
differences); it reports the size mismatch and compares the common region. Runs from
`scratchpad/vrtenv` (Pillow+numpy; the system python is PEP-668 managed).

States to capture per page: **light + dark**, **empty + with-data**, and one per interactive
surface (dropdown, tooltip, popover, drawer, modal).

### Harness fixes (done)

The first two were the ones owed up front; 3–5 were forced by failures during the sidebar run.

1. **The Next.js dev badge is masked.** `shot.sh` now hides every `<nextjs-portal>` shadow host
   immediately before the screenshot. Hiding it rather than painting the box black also recovers
   the account-chip pixels underneath, which the badge had been covering — that area is
   comparable for the first time (D-19). No-op on prod, which has no such element.
2. **Diffing is per strip.** `strips.py` holds named CSS-px strips (`sidebar`, `content`,
   `content-top`, `content-body`) measured live on both builds; `vrt.py <slug> [strip]` and
   `regions.py <slug> [max] [perSheet] [strip]` both take one, and shift every reported box back
   into full-page coordinates so it still cross-references to the DOM. Confirmed on the existing
   captures: `settings-members.dark` reads **2.08%** whole-page but **7.42%** on the sidebar
   strip alone — the whole-page number was burying the entire sidebar batch.
3. **Captures wait for the page to go quiet.** `shot.sh` shoots repeatedly until two
   consecutive frames differ by <2000px, then captures. A fixed 10s sleep and (later) a
   DOM-node-count check both passed while the local dev build was still painting, and each
   produced a full page of phantom "rows are missing / shifted" findings — twice. Byte-identity
   is too strict: a small live widget in the content area (~490px, 0.007%) never stops
   repainting on *either* build, so the gate settles on quiet, not frozen. With it, a
   theme-flip capture lands correct on the first attempt instead of needing a manual re-shoot.
4. **DPR is derived, not assumed.** `strips.py` computes it from capture width; the headed
   browser handed out DPR 1 in one session and 2 in another, and a hardcoded `/2` silently
   mis-crops every strip in the DPR-1 case.
5. **Tabs resolve by URL, not by id.** `env.sh` matches on the base URL, so relaunches and
   duplicate tabs stop mattering. `closetab` is banned outright — closing a tab tore down the
   whole headed browser context once and cost a relaunch.
Process rule (per Arda): collect **all** issues for a page from the VRT first, fix them as one
batch, then re-run the VRT for that page. Do not fix-and-verify line by line.

### First VRT run — `settings-members.dark` (2.08% pixels differ, 65 regions)

Found by looking at the diff, **all missed by the computed-style pass**:

| # | finding |
|---|---|
| V-01 | **Table column dividers missing.** Prod draws vertical borders between `Member ǀ Email ǀ Added`; local draws none. |
| V-02 | **Column-settings gear missing** from the table header (prod has ⚙ at the right edge). |
| V-03 | **Search field has no search button.** Prod has a bordered magnifier button attached to the right of the input; local has none. |
| V-04 | **Member avatar chip missing** (confirms D-14 visually — prod yellow `A` chip). |
| V-05 | **"You" tag lost its blue accent** — prod blue-tinted, local neutral grey. |
| V-06 | **Page title smaller** (confirms D-12: 20px vs 24px). |
| V-07 | **Vertical rhythm looser locally** — the whole content block sits ~40px lower; more space between the description rule and the search row, and taller table rows. |

Not a finding: the `Added` date differs (`02 Dec 2024` vs `09 Apr 2026`) — different accounts.

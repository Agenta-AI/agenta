# Handoff — EE local vs prod v0.112.1 visual parity work

Read this file **in full** before touching anything. It is the complete brief.

---

## 1. What this work is

`fix/post-112-reconcile` (worktree `sessions-ux`) reconciles the mobile-extraction lane with
the v0.112 release line. The lane extracted large parts of `web/oss` into `@agenta/*` packages.
**Those extractions dropped visual and behavioural details.** The job is to find every such gap
against the deployed product and close it.

**Source of truth, in this order:**

1. If `origin/release/v0.112.2` addresses the gap → 112.2 wins.
2. Otherwise → **the deployed production build (v0.112.1) is truth.** Match it.

Check (1) explicitly for every gap before fixing. Do not skip it. Example of why: the sidebar
gaps are NOT in 112.2 at all (`agenta-navigation-ui` does not exist in 112.2), so prod wins —
and prod renders that rail with **antd `Menu`**, whose theme tokens the extracted Tailwind
`NavMenu` inherited none of.

## 2. Environment — read before running anything

| | |
|---|---|
| LOCAL | `http://localhost:3000` — `web/ee`, Next 15.5.21 **dev build**, this worktree. Version stamp v0.112.2. |
| PROD | `https://eu.cloud.agenta.ai` — **production build**. Version stamp v0.112.1. |
| API | local docker stack `agenta-ee-dev-*`, mounts **this** worktree. `curl localhost/api/health` must be 200. |
| Browser | gstack browse daemon, headed. Tab **4 = local**, tab **3 = prod**. |
| Viewport | 1800×942 CSS @2× DPR on both. Screenshots are 3600×1884; **CSS = device/2**. |

**Arda runs the dev servers and the browser. Do not start, restart, or kill them.** If the dev
server or `/open-gstack-browser` is needed, ask. (The one exception already agreed: the API
container may be restarted if it has wedged — see §6.)

## 3. The workflow — follow exactly, no shortcuts

For each page:

1. **Visit the page on PROD.** Put it in an exact, named state. Screenshot + classify.
2. **Visit the same page on LOCAL**, same state (seed data first if the state needs data).
   Screenshot + classify.
3. **Run the visual regression.**
4. **Find the gaps from the VRT output** — by looking at *every* region, not the top one.

Slugs encode the classification: `settings-members.dark`, `observability.light.empty`,
`playground.dark.tools-dropdown-open`.

**Capture one state per axis that the page has:**

- theme: **light AND dark**
- data: **empty AND with-data** (create the data if it does not exist)
- every interactive surface: dropdown, tooltip, popover, drawer, modal — each open, as its own
  classified shot

**Batching rule (Arda's, explicit):** collect **all** issues for a page from the VRT first, fix
them as **one batch**, then re-run that page's VRT. **Do NOT fix-one-verify-one.**

## 4. Tooling — already built, in `scratchpad/qa112/`

Scratchpad root:
`/private/tmp/claude-501/-Users-ardaerzin-Documents-GitHub-agenta-open-source--claude-worktrees-sessions-ux/de1cc990-9200-4483-9048-2b0c67875f2f/scratchpad`

| file | what it does |
|---|---|
| `env.sh` | `source` this first. Sets `$B` (browse bin), `$QA`, tab ids, base URLs. |
| `shot.sh <slug> <local\|prod> [light\|dark]` | captures ONE classified state of the CURRENT page in ONE env. Does not navigate — you put the page in state first. |
| `vrt.py <slug>` | pixel diff. % differing + **ranked regions** (device px and CSS px) + a 3-up `prod \| local \| heatmap` PNG. |
| `regions.py <slug> [maxRegions] [perSheet]` | **the important one.** Renders EVERY region ≥1200px as a prod-over-local tile into contact sheets. Open every sheet. |
| `fingerprint2.js` + `differ2.py <slug>` | secondary: full computed-style diff (typography, colour, spacing, gaps, borders, radii, shadows, transforms, overflow), grouped by property. Use to explain *why* a visual gap exists, never as the detector. |

Python needs the venv: `$SP/vrtenv/bin/python` (system python is PEP-668 locked).

Typical loop:

```bash
source .../scratchpad/qa112/env.sh
# put both tabs in the same state first
$QA/shot.sh settings-members.dark prod
$QA/shot.sh settings-members.dark local
$SP/vrtenv/bin/python $QA/vrt.py     settings-members.dark
$SP/vrtenv/bin/python $QA/regions.py settings-members.dark 30 7
# then OPEN EVERY SHEET with the Read tool
```

## 5. Two tooling fixes owed before the next sweep

1. **Mask the Next.js dev badge.** `<nextjs-portal>` (`button#next-logo`, ~`[22,888,32,32]` CSS)
   renders only in the local dev build and generates a phantom region every run. Paint that box
   black in BOTH captures inside `shot.sh`, or skip the box in `vrt.py`/`regions.py`.
   `fingerprint2.js` already excludes it; the screenshots do not.
2. **Diff per strip, not whole-page.** Run the region hunt on sidebar / header / content strips
   separately, or large content blocks bury small-but-real regions. Proven: the whole page read
   2.08% differing, but the sidebar strip alone was **7.30%**.

## 6. Traps — every one of these already cost time. Do not relearn them.

- **LOCAL is a DEV build, PROD is a PRODUCTION build.** Dev-only overlays and React dev warnings
  are NOT regressions. This caused 2 false findings.
- **A dying browse daemon looks exactly like a broken app.** Assert `$B status` is `healthy` in
  the same breath as any "clicking does nothing" claim. This caused 1 false finding.
- **zsh does not word-split unquoted vars.** `for t in "4 local"; do set -- $t` leaves `$2`
  empty and files get written to `slug..json`. Write explicit commands instead. This caused a
  bogus "the harness is broken" claim.
- **`$B goto` is aborted by the SPA** (`net::ERR_ABORTED`) on many routes. Navigate by
  **clicking** links, then assert the URL. A whole nav comparison was invalid because of this.
- **`$B screenshot --clip` is PAGE-relative, not viewport-relative.** Use `--viewport` or
  `--selector`.
- **Query more than `<a>`.** Sidebar rows are `<div>`s; an anchor-only query invented a
  "the nav differs" finding that did not exist.
- **Ranking regions is useless if you only open one.** 64 of 65 regions went unexamined once.
  Open every contact sheet.
- **Do not guess design tokens.** `colorPrimaryBg` maps to `GROUND` in `palette.ts`; guessing it
  made the selected row *worse*. Theme colours flow from `palette.ts` → `pnpm
  generate:tailwind-tokens`. Never hand-edit generated files.

## 7. State of the code right now

Only ONE file is modified, uncommitted: `web/packages/agenta-navigation-ui/src/NavMenu.tsx`.

**Fixed and verified (2):**

- Row height `h-9 → h-7` (36→28px) and spacing moved off the nav flex-gap onto the row (`mb-1`),
  because a collapsed group renders a zero-height `HeightCollapse` wrapper as a second nav child
  and was paying the gap twice. Result: uniform **32px pitch, 28px rows**, matches prod exactly.
- Type scale `text-xs → text-sm leading-7` and `text-colorTextSecondary → text-colorText`.
  Result: eliminated 47 element-level deltas (17 `fontSize`, 15 `lineHeight`, 15 `color`).

**Reverted (do not re-apply blindly):** `ROW_SELECTED` → `bg-colorPrimaryBg/!text-colorPrimary`
was WRONG (resolves near-white). It is back at `bg-colorFillSecondary font-medium
!text-colorText`, which is also not prod. Prod's values are bg `rgb(87,87,42)`, text
`rgb(209,209,81)`, and the **icon is tinted too**. Trace the real source through antd
`Menu.itemSelectedBg`/`itemSelectedColor` and the dark CSS-var layer.

**Gates NOT run on this change:** no lint, no tsc, no tests. Nothing committed.
`NavMenu` is shared with `/m` — per Arda, EE is the target and mobile follows.

## 7b. THE SIDEBAR BATCH — **DONE AND VERIFIED. Start at §9 instead.**

> Closed on 18 Aug. Sidebar strip is **0.09% differing in BOTH light and dark**, with 22/22 ink
> bands aligned to prod and the only two remaining regions accounted for (the `v0.112.1` vs
> `v0.112.2` stamp, and a 64px stroke-weight difference on the caret). Eight fixes, not three —
> see §4b of the inventory. Gates all green. **Nothing is committed yet.**
>
> Two claims in the table below were **wrong** and are corrected in the inventory:
> - S-3's "~15px low, `Back` at y≈83 vs 68" — the rails were already pixel-identical from the
>   top down to y=261. The real residue was +4px *per section boundary*.
> - S-1's "icon also tinted" is real but not a separate fix: the icon inherits the row colour,
>   so one token change does both.
>
> Three findings the VRT surfaced that this table never listed: the account chip sits 6px left
> of the nav icon column (D-19), every `<button>` in the rail renders **Arial** instead of Inter
> because preflight is off (D-20), and `pnpm generate:tailwind-tokens` was writing to a dead
> path so palette edits silently did not land (D-17).

### Original table, kept for the record

The sidebar is **not** done. Two of five gaps are fixed. These three are still visibly broken
and are confirmed against screenshots of both builds. Fix them as **one batch**, then re-run
`shot.sh` + `vrt.py` + `regions.py` on the sidebar strip in **both light and dark**.

| # | gap | prod (truth) | local (broken) |
|---|---|---|---|
| S-1 | selected row — **three** things, not one | bg `rgb(87,87,42)`, label `rgb(209,209,81)`, **icon also tinted** `rgb(209,209,81)` | bg `rgba(255,255,255,0.12)`, label white, icon white |
| S-2 | `Help & Docs` trailing chevron | `>` present after the version stamp | absent |
| S-3 | nav vertical origin | `Back` row at y≈68 | y≈83 — whole rail ~15px low. **Pitch is already correct (32px); the ORIGIN is wrong**, so look at the container's top padding / brand-row height, not the row rules. |

For S-1, do **not** guess a token — the last guess (`colorPrimaryBg`) resolves to `GROUND` and
made it worse. Prod renders this rail with antd `Menu`; trace `Menu.itemSelectedBg` /
`itemSelectedColor` through `palette.ts` → the generated dark CSS-var layer, and make the icon
inherit the same colour as the label.

Only after the sidebar strip's VRT is clean in light AND dark, move on to the next surface.

## 8. Open findings — full list

In `ee-vs-112.1-diff-inventory.md`. Summary:

| id | finding | state |
|---|---|---|
| D-02 | sidebar row pitch | **FIXED** |
| D-12 (nav rows) | type scale / colour | **FIXED** |
| D-13 | selected row: bg + text + **icon** tint all wrong | open, next |
| — | **nav vertical origin ~15px too low** (pitch right, origin wrong) | open, next |
| D-03 | observability empty state renders an overflowing table header | open |
| D-05 | Help & Docs chevron missing | open |
| D-06 | observability search affordance | open |
| D-11 | settings nav has no `role=menu`/`menuitem`/tabindex — **not keyboard reachable** | open |
| D-12 (rest) | page title 20→24px, descriptions 12→14px, Back 13→14px | open |
| D-14 / V-04 | member avatar chip missing | open |
| V-01 | table column dividers missing | open |
| V-02 | column-settings gear missing from table header | open |
| V-03 | search field has no search button | open |
| V-05 | "You" tag lost its blue accent | open |
| V-07 | content block ~40px lower, looser rhythm, taller rows | open |
| — | truncation trio (`ellipsis`+`overflow:hidden`+`display:block`) not in prod | **needs Arda's call** |
| D-04 | agent header gained `Deploy` + kebab (deliberate lane change for `/m` parity) | **needs Arda's call** |
| D-07 | React resize-prop warnings — pre-existing, not this lane | triage separately |
| D-08 | `querySessionStreams` 500s locally | triage separately |

**Retracted — do not re-raise:** D-01 (Next.js dev badge), D-10 (dead daemon), "the nav differs"
(anchor-only query), "`$B eval` is stale" (it is not; zsh was the cause).

## 9. Coverage still owed

Only `/settings` (Members, dark) and `/observability` have been compared at all, and neither in
light mode or with data. Untouched: onboarding canvas, templates gallery, all config-pane
drill-ins, agent creation, the whole chat surface (streaming/tool steps/approvals/elicitation),
sessions (tabs/list/cards/rename/delete), prompts, evaluation group, observability with data,
every settings sub-page, and all interactive surfaces everywhere.

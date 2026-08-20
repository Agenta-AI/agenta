# Next session — Playground parity. Read this before touching anything.

The previous session left the Playground surface in a **half-finished, partly unverified**
state and got three things wrong that you must not repeat. Start by distrusting its commits.

## 1. What is on the branch

`fix/post-112-reconcile`, worktree `sessions-ux`. **5 unpushed commits.** Origin has everything
up to `497cc93`.

| commit | what | trust |
|---|---|---|
| `497cc93` | settings: access notice, avatars, tool icons, secrets align, colorErrorBg | **verified** live + VRT |
| `5e312cd` | playground: agent header 48→41px (`min-h-[48px] sm:min-h-0`, mode switch `size="sm"`) | measured, **no VRT re-run** |
| `0aaf9d8` | playground: drop Deploy + kebab from agent header, restore « collapse | structure measured, **no VRT, control never clicked** |
| `92c9c03` | playground: re-park Build/Chat behind `SHOW_MODE_SWITCH = false` | measured, **no VRT re-run** |
| `6e84ff3` | playground: restore `configPanelCollapsedAtom` reader in MainLayout | **PARTIAL — does not work** |

**First job: verify or revert `5e312cd`, `0aaf9d8`, `92c9c03`, `6e84ff3`.** They are individually
well-argued against the 112.x source, but none was checked with a real diff after landing.

## 2. Three open defects (Arda, observed; all real, none measured by me)

1. **Hide-config does nothing.** Clicking « changes **0.00% of pixels** (screenshot diff before
   vs after the click). `6e84ff3` restored 112.1's reader in `MainLayout`
   (`configCollapsed = … (chatMaximized || configPanelCollapsed)`) and it STILL does not work.
   Next step: confirm the running build actually has the change (the dev server was restarted
   mid-session), then trace whether `configCollapsed` reaches the pane's size prop —
   `paneSize={configCollapsed ? 0 : agentPaneSize}` and `size={configCollapsed ? 0 : undefined}`
   are the two consumers in HEAD's MainLayout.
2. **Session rail behaviour is not aligned** with prod. Not investigated at all.
3. **Prod embeds the file drawer as a PANEL on the right**, not a drawer. Not investigated at all.

2 and 3 live in the **chat strip**, whose regions were never opened once. That is the gap.

## 3. The mistakes to not repeat

- **Presence is not behaviour.** I reported the collapse control "restored" because it rendered
  with the right `aria-label`. I never clicked it. It was broken the whole time. **Click every
  control you claim to have fixed, and diff the screenshot before/after.**
- **I never re-ran the VRT after any playground fix.** Three commits landed on spot measurements.
- **I never opened a single chat-strip contact sheet** (6.08% differing) — which is exactly where
  defects 2 and 3 are. The right-hand side of the page was never in a diff at all.
- **Ad-hoc DOM selectors lied four times in ten minutes** (`32`, `1544`, `[]`, `visible: true`
  for the same element). Use the harness — `shot.sh` + `vrt.py` + `regions.py` + `zoom.py` — not
  improvised `querySelectorAll` filters.
- **Classify from the release history, not the rendered page.** Twice I called a lane change
  "deliberate"/"new" from what prod displayed, and twice the source said otherwise
  (D-04 → PR #5943 removed it by design; Build/Chat → parked behind `SHOW_MODE_SWITCH = false`
  since 112.0). `git show origin/release/v0.112.{0,1}:<path>` and `gh pr view <n>` settle these.

## 4. 112.2 is truth for four playground surfaces — check BEFORE filing anything

Unlike Settings (zero 112.2 files), Playground has 11. Local differing from prod is CORRECT for:

| surface | prod 112.1 | local 112.2 = truth |
|---|---|---|
| model picker | fixed 560px / column 290 | `max(calc(trigger-width - 0.5rem), 460px)` / 200 — measured prod 568, local 468 |
| every `Select` | label centred (preflight off) | `text-left` |
| config scrollbar | `OverlayScrollbar` component | removed for `ag-scroll-no-bar` |
| session tag selected | `bg-colorFill` | 90% `color-mix` |

## 5. Environment + tooling

- LOCAL `http://localhost:3000` — **Arda runs the dev server. Ask; do not start it.**
- PROD `https://eu.cloud.agenta.ai`. Both projects are named `112-QA` and are already
  `LOCAL_BASE`/`PROD_BASE` in `env.sh`.
- An agent exists in both, set to **Anthropic / Haiku 4.5** (the default `gpt-5.6-luna` shows a
  `Connect key` notice on BOTH builds — state, not a defect). Prod drifted off it at the end;
  re-open the same agent on both before capturing anything.
- Harness: `scratchpad/qa112/` (path in `VRT-SESSION-HANDOFF.md` §4). `source env.sh` first.
  `shot.sh <slug> <local|prod> [theme]` · `vrt.py <slug> [strip]` · `regions.py <slug> [max]
  [perSheet] [strip]` · `zoom.py <slug> <x,y,w,h> [scale]` · `press.sh <env> <js>` (Radix needs
  pointerdown, not click) · `go.sh <env> <label> <urlFragment>` · `keepalive.sh <min>` (run it
  backgrounded during gates; the daemon idles out at 1800s).
- Strips now include `config`, `config-top`, `chat` (added last session, in `strips.py`).
- `vrt.py` refuses to score a pair whose version stamp is byte-identical — that guard exists
  because a same-tab capture once scored a **0.00% "perfect match"**. Do not defeat it.

## 6. Order of work

1. Put both envs on the same agent, dark. Capture `playground.dark`.
2. Diff **all four strips** and open **every** contact sheet — chat strip first, it is untouched
   and holds defects 2 and 3.
3. Only then fix, as one batch, and re-run the VRT for the surface.
4. Gates before landing: `pnpm lint-fix` in `web/`, oss tsc, mobile tsc, affected suites.

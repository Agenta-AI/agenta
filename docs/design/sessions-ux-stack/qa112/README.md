# qa112 — the EE-local vs deployed-prod parity harness

Compares this worktree's local EE dev build against deployed production, surface by surface, to
close the visual and functional gaps the mobile-extraction lane introduced. Findings go in
[`../ee-vs-112.1-diff-inventory.md`](../ee-vs-112.1-diff-inventory.md); the plan of attack is in
[`../NEXT-SESSION-PARITY.md`](../NEXT-SESSION-PARITY.md).

**This directory is committed on purpose.** Two earlier copies lived in a session scratchpad under
`/private/tmp` and were both wiped between sessions, taking the tab pin, `vrt.py`'s align mode and
`strips.py`'s measured boxes with them. `venv/`, `shots/` and `.tabpin.*` stay ignored — via the
ROOT `.gitignore`, because the repo ignores all dotfiles (`.*`), so a `.gitignore` in here would
itself be untracked and a fresh clone would happily commit ~370 PNGs.

## Setup

```bash
python3 -m venv venv && ./venv/bin/pip install numpy Pillow   # once
source docs/design/sessions-ux-stack/qa112/env.sh
./doctor.sh                    # check daemon, dev server, stack, DPR, base URLs
pin_tab local; pin_tab prod    # REQUIRED — see "DPR is per tab" below
```

## Commands

| command | what it does |
| --- | --- |
| `shot.sh <slug> <local\|prod> [light\|dark]` | capture ONE classified state of the current page |
| `vrt.py <slug> [strip] [align]` | diff one strip, ranked regions + a 3-up image |
| `regions.py <slug> [max] [perSheet] [strip]` | contact sheets of every differing region |
| `zoom.py <slug> <x,y,w,h> [scale]` | magnified prod-over-local of one box |
| `goto.sh <env> <pathFragment>` | navigate by URL, poll for the landing |
| `go.sh <env> <label> <urlFragment>` | navigate by CLICKING, assert the landing |
| `press.sh <env> <js>` | full pointer sequence (Radix needs `pointerdown`) |
| `keepalive.sh <min>` | run backgrounded during long gates |
| `doctor.sh` | preflight — run it first, and after any environment change |
| `prop-drop-sweep.py` | props a call site passes that the component never reads (P-12's class) |

Strips: `sidebar` · `content` · `content-top` · `content-body` · `config` · `config-top` · `chat`
· `chat-body` · `full`, or an explicit `x,y,w,h` in CSS px.

Slugs encode the state, e.g. `chat.dark.tool-step-expanded`, `settings-members.light.empty`.

## The workflow, no shortcuts

Per surface: put PROD in an exact named state → `shot.sh` → put LOCAL in the *same* state →
`shot.sh` → `vrt.py` per strip → `regions.py` and **open every contact sheet** → collect ALL
issues → fix as one batch → re-run that surface's VRT. Do not fix-one-verify-one.

Capture light and dark, empty and with-data, and every interactive surface open as its own
classified shot. **Do not ship a fix you have not driven in a browser.** If the browser is down,
say so and stop.

## Source of truth

If `origin/release/v0.112.2` addresses the gap, **112.2 wins**; otherwise deployed v0.112.1 is
truth. Check 112.2 explicitly for every gap (`git show origin/release/v0.112.{1,2}:<path>`,
`gh pr view <n>`) before calling anything deliberate. Both directions have bitten: the Usage
label dropping its `Last` prefix was already a shipped 112.2 change, and the session chip skin I called
deliberate — on the strength of the component's own docstring — was a regression Arda wanted
reverted. **A component documenting its skin is not evidence the skin is wanted.**

Deliberate, confirmed with Arda, do NOT re-file: the 9px config↔chat gutter (kit `SplitPane`),
the session tab strip's chip skin and docked `+`, the inline agent rename, the observability empty
state keeping its table header.

## Traps, each of which cost real time

- **DPR is per TAB, not per host.** Local tabs 2 and 3 sat at DPR 1 while tab 12 was at DPR 2, all
  three on the same URL. A DPR-1 tab captures 1800×942 against prod's 3600×1884 and every strip is
  garbage. `pin_tab` picks the tab whose DPR matches prod's. Always run it.
- **A no-op tab switch shoots one environment twice**, which reads as a perfect score —
  `settings-tools.light` once scored 0.00% whole-page, impossible when the rail stamps different
  versions. `use_tab` proves the switch, and `vrt.py` refuses a pair whose version stamp matches.
- **Skeletons are STATIC**, so they sail through the pixel-quiet gate and get captured as the page.
  `/apps` read 8.64% with one captured and 1.84% without. `shot.sh` waits them out (bounded 40s).
- **`browse goto` kills the daemon** on the dev build (15s timeout) — use `goto.sh`.
  `browse newtab <url>` blocks the same way: open the tab bare, then `goto.sh` into it.
- **`press.sh` double-fires plain buttons.** Its pointer sequence (needed for Radix) is seen twice
  by an ordinary `onClick`. Use `.click()` for normal buttons.
- **`browse type` presses Enter for a `\n`, and Enter SENDS.** A multi-line prompt fired one send
  per line — 17 runs on each build instead of one. Keep chat prompts on ONE line.
- **Resolve tabs by URL every time.** Arda browses in this same window; a hardcoded id drove one of
  his tabs to a news site for several minutes.
- **Never `closetab`** — it tore the whole browser context down once. `status`/`tabs` auto-spawn a
  headless daemon; `Mode: launched` on `about:blank` is a stray you made. "Running but not
  responding" is usually transient (observed recovering after ~7 min) — check before relaunching.
  A relaunch keeps logins (persistent Chromium profile) but loses tabs.
- **rAF sampling cannot measure motion here** — the dev build starves it badly enough to make a
  working 240ms transition look like a snap. Use `transitionstart`/`transitionend` + `elapsedTime`.
- **A wedged local API renders whole rows missing** and survives every gate; a stack one migration
  behind made every session surface read empty for two sessions. `doctor.sh` checks both.
- **Per-table column visibility persists to localStorage** under a key with no environment in it,
  so local carries preferences prod never had. Check `Object.keys(localStorage)` before filing any
  "the column set differs".
- **LOCAL is a DEV build, PROD is PRODUCTION.** Dev overlays and sub-pixel glyph differences are
  not regressions. Preflight is OFF, so a bare `<button>` renders Arial and UA button text-align
  centres labels. Measure pixels, then find the token holding that value; ink bands beat
  `getBoundingClientRect`.
- **`querySelectorAll` is global, and the chat keeps every session pane mounted.** Counting
  `.ag-turn` across the document counts other sessions too. Scope to the visible pane, and always
  print WHAT a selector matched — class and size, not just the count.

## Method rules that caught real mistakes

- **One observation of an async surface is not an observation.** "The trace drawer never opens" was
  a page state I had broken myself; "it opens and closes itself" was a single read landing in a
  1.3s remount dip. Sample over time, then decide.
- **When your result and the user's disagree, instrument immediately.** One prefixed, greppable log
  across the whole chain found a render loop that three rounds of reasoning had missed.
- **Changing one side of a read-modify-write re-enters.** Reading the live URL instead of a stale
  snapshot fixed one race and armed an infinite loop, because a no-op write still navigated.
  Always ask what re-enters.
- **A facade asserting parity is not evidence of parity.** `EnhancedButton` documented
  `iconPosition="end"` as "deferred (rare / unused)"; `EmptyState` passed it, and that one call
  site renders on all five Evaluations tabs and on Observability. `ChatBubble` documented "metrics
  mirror antd-x"; the 12px gap did, the 32px avatar column did not. Measure the claim.
- **Count the call sites that reach the FACADE, not the ones that use the prop.** P-12 was filed as
  "five call sites"; the sweep shows only `EmptyState` imports `EnhancedButton` — the others pass
  `iconPosition` to a raw antd `Button` and were never affected. The bug was real; the number was not.
- **Prioritise by files the lane CHANGED, not by route.** Screening by route ranks the symptom: the
  `iconPosition` bug surfaced on `/evaluations`, which the lane barely touched, because it lives in
  `@agenta/ui`, which it rewrote.

## Environment

LOCAL `http://localhost:3000` (web/ee, Next dev, this worktree) · PROD `https://eu.cloud.agenta.ai`.
Both projects are `112-QA`. Viewport 1800×942 CSS at DPR 2. The matched agents and the `PR reviewer`
pair are `AGENT_*` / `PRREV_*` in `env.sh`.

**Arda runs the dev server and the browser. Ask before starting, restarting or killing either.**

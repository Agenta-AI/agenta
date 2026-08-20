# Next session — closing the rest of the lane's parity gaps

Read this, then §4f–4k of `ee-vs-112.1-diff-inventory.md`. §3 below is the part that changes how
you work; read it twice.

## 1. Where things stand

Branch `fix/post-112-reconcile`, worktree `sessions-ux`, pushed and **stacked as PR #6112 onto
the lane PR #6065** (`lane/mobile-extracted-packages → release/v0.112.2`). Everything committed
is pushed; the branch and origin agree.

Closed and confirmed: sidebar, settings (14 sub-pages), the sessions list, the playground's
config pane and chat strip in build mode, the observability traces table and Sessions tab, and
the trace drawer (open AND close, confirmed by Arda).

Fixed this round, all measured, all in #6112: the `/` command palette (unwired), the config
panel reveal `»` (no render site), the docked Files pane (had become a drawer),
`iconPosition="end"` (dropped by the `EnhancedButton` facade, five call sites), the trace
drawer (three URL races), sticky table headers (translucent), table borders and pinned
stacking, and the config/Files panel motion.

**One bug class is now exhausted.** Four of those came from the same fingerprint: a symbol that
still exists, still type-checks, and has ZERO consumers, dropped in a merge resolution rather
than a commit (so `git log -S` finds only the commit that ADDED it). A sweep of all 557 exported
components/hooks across the 900 files the lane changed found 25 zero-consumer exports, and every
one was already zero-consumer in 112.2. Pre-existing dead code, not lane drops. Re-run it if you
touch new areas:

    python3 docs/design/sessions-ux-stack/orphan-export-sweep.py

It does NOT catch dropped **props** (that is how `iconPosition` hid) or behaviour changes.

## 1b. Update — WP-1 is CLOSED, WP-2 is part-done

Sessions since this was written (full detail in §4m–§5f of the inventory):

- **WP-1 chat is finished.** Two bugs found and fixed, both driven: the 32px avatar column
  (`ChatBubble`) and per-line fenced code blocks (Streamdown's `lineNumbers` coupling). Markdown
  scale and rhythm restored to the desktop app's on Arda's call. Streaming, stop mid-stream, tool
  steps, payload expanders, the composer, the send queue, elicitation (card + resume) and the
  agent `/overview` are all confirmed at parity, in BOTH themes.
- **WP-2 is started.** Config pane at rest is byte-identical (26 controls); the `Advanced`
  drill-in drawer is at parity (0.11%). Only `model-harness` and `advanced` route to drawers —
  every other section expands in place, so there are no other drill-ins to find.
- **The harness is committed** at `qa112/` and survives a machine wipe. Run `doctor.sh` first,
  then `pin_tab local; pin_tab prod`. It now also carries `prop-drop-sweep.py`.

**Open decisions for Arda** (none shippable without him): **L-01** code-block theming
(prod always-dark, local theme-following); **D-21** `closeOnLayoutClick` is inert so 13 drawers
dismiss on outside clicks — pre-existing, so it wants its own PR; and whether to rename prod's
agent back to `New agent` (it renamed ITSELF during an elicitation run, so the pair is no longer
name-matched).

**Next, in order:** the commit modal and Tools/Skills expansions (both need a dirty draft or an
agent with real tools — the `PR reviewer` pair is the candidate), `DriveExplorer`, the entity
pickers, then WP-3 with `prop-drop-sweep.py` as the entry point.

## 2. What is left, in priority order

Prioritise by **files the lane changed**, not by route. Screening by route ranks the symptom;
`iconPosition` surfaced on `/evaluations` (10 changed files) because it lives in `@agenta/ui`
(93). Counts are `git diff --name-only origin/release/v0.112.2 HEAD -- <path>`.

### WP-1 — Chat with a live run (133 files, `AgentChatSlice` + 73 in `@agenta/chat`)

The biggest partial and the only work that reaches code a static page never executes. Send a
real message on the `112-QA` agent and compare, on both builds: streaming (token flow, the stop
button), tool steps (the humanized log, `Used N tools`, per-row payload expanders), approvals
(the in-card approve/deny, the dock), elicitation (the form card, resume after answering), the
queue, and errors. Ask Arda before the first send if cost is a concern.

### WP-2 — `@agenta/entity-ui` (86 files, completely unexamined)

The config drill-ins (Instructions, Tools, Skills, Advanced, Subscriptions, Schedules, Files),
`DriveExplorer`, the commit modal, the entity pickers. All reachable from the playground. Note
the Model drill-in is already compared and its 112.2 differences are documented.

### WP-3 — `@agenta/ui` on purpose (93 files)

Three bugs came out of it sideways and nobody has looked at it deliberately. Everything imports
it, so a defect here is repo-wide. Start with the props the facades declare as "deferred" or
"unused": `EnhancedButton` had exactly that comment above `iconPosition`, and it was wrong.
Grep for `Deferred (rare / unused)` and check each claim against real call sites.

### WP-4 — the rest

`SharedDrawers` (49: trace drawer contents, testset, revision), agent-home + home-ui (45: Home,
the onboarding canvas, the templates gallery), auth (15). Also unexercised everywhere: the
INTERACTIONS inside surfaces already marked done (rename, delete, drag-reorder, keyboard
shortcuts). The trace drawer showed how much hides behind one click.

Not worth comparing: prompts, testsets, evaluators, annotations. 0–1 changed files each; their
0.3–1.6% pixel diffs are noise by construction.

## 3. Mistakes from the last session — do not repeat these

- **One observation of an async surface is not an observation.** I filed "the trace drawer never
  opens", then "it opens and closes itself", and both were wrong: the first was a page state I
  had broken myself, the second was a single read landing in a 1.3s remount dip. Sample over
  time, then decide.
- **Check what a selector actually matched.** `.ant-drawer, [role=dialog]` matched an unrelated
  popover for an hour and inverted my conclusion twice. Print the element's class and size, not
  just the count.
- **Do not ship a fix you have not driven.** Three partial fixes went in against my own runs on
  a flaky daemon; one froze Arda's tab, one caused an infinite render loop. If the browser is
  down, say so and stop.
- **When your fix and the user's report disagree, add logs immediately.** I let that mismatch run
  three rounds. One instrumented run (`[trace-drawer] 1..9` across the chain) found the loop in a
  single paste. Instrument the WHOLE chain, prefix it, make it greppable.
- **Changing one side of a read-modify-write re-enters.** Two of the regressions were mine:
  reading the live url instead of a stale snapshot fixed one race and armed an infinite loop,
  because a no-op write still navigated. Always ask what re-enters.
- **Classify from the release history, not the rendered page.** 112.2 deliberately removed the
  Instructions `+`; the session-tab restyle is shipped `@agenta/sessions-ui` design. Both would
  have been filed as regressions from the screenshot alone. `git show origin/release/v0.112.{1,2}:<path>`
  and `gh pr view <n>` settle these. The inverse also bit: I classified the session chip skin as
  deliberate because the component's own docstring described it, and Arda wanted it reverted. A
  component documenting its skin is not evidence the skin is wanted.

## 4. Source of truth

If `origin/release/v0.112.2` addresses the gap, 112.2 wins. Otherwise deployed v0.112.1 is
truth. Check 112.2 explicitly for every gap. Known 112.2 truths where local differing from prod
is CORRECT: model picker width (468 vs 568), `Select` `text-left`, the config scrollbar
(`ag-scroll-no-bar`), the selected session tag's 90% `color-mix`, and the Instructions `+`
(deleted outright).

Deliberate lane design, NOT drift: the session tab strip's chip skin and its docked `+`
(`@agenta/sessions-ui`), the inline agent rename in the page header, the observability empty
state keeping its table header.

## 5. Environment and tooling

LOCAL `http://localhost:3000` (web/ee, Next dev, this worktree). PROD `https://eu.cloud.agenta.ai`.
Both projects are named `112-QA` and are `LOCAL_BASE`/`PROD_BASE` in `env.sh`. The paired agent is
`New agent`, Anthropic / Haiku 4.5: prod `01a01513-63df-…`, local `01a01513-541a-…`. Re-open the
same one on both before capturing; the default `gpt-5.6-luna` shows `Connect key` on BOTH, which
is state, not a defect.

**Arda runs the dev server. Ask before starting, restarting or killing it.**

Harness in `scratchpad/qa112/` (path in `env.sh`). `source env.sh` first.

    shot.sh <slug> <local|prod> [light|dark]   capture one classified state
    vrt.py <slug> [strip]                      diff ONE strip, ranked regions
    regions.py <slug> [max] [perSheet] [strip] contact sheets
    zoom.py <slug> <x,y,w,h> [scale]           magnified prod-over-local
    press.sh <env> <js>                        Radix needs pointerdown, not click
    goto.sh <env> <pathFragment>               navigate by url, poll for the landing
    go.sh <env> <label> <urlFragment>          navigate by CLICKING
    keepalive.sh <min>                         run backgrounded during long gates

Strips: `sidebar`, `content`, `content-top`, `content-body`, `config`, `config-top`, `chat`.

### Traps, each of which cost real time

- **Diff per strip, never whole-page, and open every contact sheet.** A big content block buries
  small regions elsewhere.
- **`shot.sh` now waits out skeletons** as well as pixel-quiet. Skeletons are STATIC and sailed
  through the quiet gate three times, inventing whole-block findings (`/apps` read 8.64% with one
  captured, 1.84% without). If a capture follows a theme switch or a route change, check it has
  real content.
- **`goto.sh`, not `browse goto`.** `browse goto` blocks on a full load and the dev build blows
  its 15s timeout, which kills the daemon and costs a minute of recovery per navigation.
- **`press.sh` double-fires plain buttons.** Its full pointer sequence (needed for Radix) is seen
  twice by an ordinary `onClick`. Use `.click()` for normal buttons. This nearly became a bogus
  "the Files pane reopens when you close it".
- **Resolve tabs by URL every time.** Arda browses in the same window; I drove one of his tabs to
  a news site for several minutes.
- **rAF sampling is useless for motion on this build.** It gets starved badly enough to make a
  working 240ms transition look like a snap. Use `transitionstart`/`transitionend` and read
  `elapsedTime`.
- **Browse daemon:** never `closetab`; `status`/`tabs` auto-spawn a headless daemon
  (`Mode: launched` + `about:blank` is a stray you made, kill it); "running but not responding"
  is usually transient, so check before relaunching. A relaunch preserves logins (the Chromium
  profile is persistent) but loses tabs.
- **Per-table column visibility persists to localStorage** under a plain key with no environment
  in it, so local carries preferences prod never had. Check `Object.keys(localStorage)` before
  filing any "the column set differs".
- **A wedged local API renders whole rows missing** and survives every gate. Check the console
  and `curl` the API before believing a "missing element" finding.
- LOCAL is a DEV build, PROD is PRODUCTION. Dev overlays and sub-pixel glyph differences are not
  regressions. Preflight is OFF, so a bare `<button>` renders Arial and UA button text-align
  centres labels. Measure pixels, then find the token holding that value; ink bands beat
  `getBoundingClientRect`.

## 6. Before landing

`pnpm lint-fix` in `web/`, oss tsc, mobile tsc, affected suites. Record findings in the inventory
as you go, including the ones that turn out wrong and why. Commit per surface. Never put
Claude/Anthropic/Co-Authored-By in a commit message.

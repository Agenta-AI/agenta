Read docs/design/sessions-ux-stack/NEXT-SESSION-PLAYGROUND.md and
docs/design/sessions-ux-stack/ee-vs-112.1-diff-inventory.md §4f in full before doing anything.
The handoff's §3 ("mistakes to not repeat") and §4 (112.2 is truth for four surfaces) are the
parts that tell you how to work; read those twice.

Branch fix/post-112-reconcile, worktree sessions-ux. We are closing visual and functional gaps
the mobile-extraction lane introduced, by comparing local EE dev against deployed prod v0.112.1.
Settings is DONE and verified. Playground was left half-finished by the previous session and it
made real errors — your first job is to clean that up, not to build on it.

START HERE, in this order:

1. Verify or revert the last four commits. 5e312cd, 0aaf9d8, 92c9c03 landed on spot
   measurements with NO VRT re-run. 6e84ff3 is explicitly PARTIAL and does not work. Each is
   argued against the 112.x source in its commit message; check the argument holds AND that the
   result is right on screen. Revert anything that does not survive. Do not stack on top first.

2. Fix the three defects Arda reported and I did not close:
   a. Hide-config («) does nothing — 0.00% pixel change on click, measured. 6e84ff3 restored
      112.1's configPanelCollapsedAtom reader in MainLayout and it is still dead. Trace whether
      configCollapsed actually reaches the pane: paneSize={configCollapsed ? 0 : agentPaneSize}
      and size={configCollapsed ? 0 : undefined} in MainLayout. Confirm the running build has
      your change before concluding anything — the dev server was restarted mid-session.
   b. The session rail's behaviour is not aligned with prod. Uninvestigated.
   c. Prod embeds the file drawer as a PANEL on the right; local still has a drawer.
      Uninvestigated.
   b and c both live in the chat strip, which was never diffed once. That is the hole.

3. Then the rest of the surface: config-pane drill-ins (Model, Instructions, Tools, Skills,
   Advanced, Subscriptions, Schedules, Files), agent creation, templates gallery, onboarding
   canvas. After that: Chat (streaming, tool steps, approvals, elicitation), Sessions (tabs,
   list, cards, rename, delete), Observability empty AND with data (D-03 and D-06 are open
   leads there).

Source of truth, in this order: if origin/release/v0.112.2 addresses the gap, 112.2 wins;
otherwise deployed v0.112.1 is truth. Check 112.2 explicitly for every gap — Playground has 11
files changed in 112.2 and four of them change what you see, so local differing from prod is
CORRECT for the model picker width, Select text-align, the config scrollbar and the session-tag
fill. The handoff §4 has the table. Also check the release PRs before calling anything
deliberate: twice last session a lane change was classified from the rendered page and the
source said the opposite (git show origin/release/v0.112.{0,1}:<path>, gh pr view <n>).

The workflow — no shortcuts. Per surface: put PROD in an exact named state -> screenshot -> put
LOCAL in the same state -> screenshot -> run the VRT per strip -> open EVERY contact sheet ->
collect ALL issues -> fix as ONE batch -> re-run that surface's VRT. Do not fix-one-verify-one.
Capture every state axis: light AND dark, empty AND with-data, and each interactive surface
open as its own classified shot. Slugs encode it: playground.dark.model-picker-open.

CLICK EVERY CONTROL YOU CLAIM TO HAVE FIXED, and diff a screenshot before vs after the click.
Last session reported the collapse control "restored" because it rendered with the right
aria-label; it had never been clicked and was broken the whole time. Presence is not behaviour.

Environment. LOCAL http://localhost:3000 (web/ee, Next dev, this worktree). PROD
https://eu.cloud.agenta.ai. Both projects are named 112-QA and are already LOCAL_BASE/PROD_BASE
in env.sh. An agent exists in both, set to Anthropic / Haiku 4.5 — the default gpt-5.6-luna
shows a "Connect key" notice on BOTH builds, which is state, not a defect. Prod drifted off that
agent; re-open the same one on both before capturing. Viewport 1800x942 CSS — verify DPR before
trusting any capture. Arda runs the dev server and the browser. Do not start, restart, or kill
them. Ask.

Tooling — in scratchpad/qa112/, already hardened. Use it, don't rebuild it, and don't substitute
improvised querySelectorAll filters for it: last session those gave four contradictory answers
for one element in ten minutes. source env.sh first, then shot.sh <slug> <local|prod>
[light|dark], vrt.py <slug> [strip], regions.py <slug> [max] [perSheet] [strip], zoom.py <slug>
<x,y,w,h> [scale] (magnified prod-over-local of one box, whether or not it differs), press.sh
<env> <js> (Radix listens for pointerdown, not click), go.sh <env> <label> <urlFragment>,
keepalive.sh <min> (run backgrounded during gates; the daemon idles out at 1800s). Python is
$SP/vrtenv/bin/python. Strips include sidebar, content*, config, config-top, chat.

Traps — each already cost real time:

Diff per strip, never whole-page. Open every contact sheet. A mid-render capture invents
findings; shot.sh gates on pixel-quiet. shot.sh also PROVES the tab switch took and vrt.py
refuses to score a pair whose version stamp is byte-identical — a same-tab capture once scored a
0.00% "perfect match"; do not defeat those guards. A wedged local API renders whole rows missing
and survives the quiet gate — check the console and curl localhost/api/health before believing
any "missing element" finding. Measure, don't guess tokens; sample the pixels then find the
token holding that value. A name missing from oss/tailwind.config.ts falls through to a
light-only hex dump and freezes at its light value in dark (colorSuccessText and colorFillAlter
are still frozen and need palette.ts entries first). Theme colours: palette.ts -> pnpm
generate:tailwind-tokens; never hand-edit generated files. Preflight is OFF, so a bare <button>
renders Arial and UA button text-align centres labels. Ink bands beat getBoundingClientRect.
LOCAL is a DEV build, PROD is PRODUCTION — dev overlays and sub-pixel glyph differences are not
regressions. zsh does not word-split unquoted vars; write explicit commands. Browse-daemon:
never closetab; never probe flags; $B status/tabs auto-spawn a headless daemon that blocks a
relaunch (Mode: headed is the real browser, Mode: launched + about:blank is a stray you made);
"running but not responding" is usually transient — check status before relaunching.

Before landing: pnpm lint-fix in web/, oss tsc, mobile tsc, affected suites. Record findings in
the inventory as you go — including the ones that turn out wrong, and why. Commit per surface;
don't push unless asked. Never put Claude/Anthropic/Co-Authored-By in a commit message.

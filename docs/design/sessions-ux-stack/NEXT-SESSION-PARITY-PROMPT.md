# Opening prompt for the next session

Paste everything below the line.

---

Read `docs/design/sessions-ux-stack/NEXT-SESSION-PARITY.md` in full, then §4f–4k of
`docs/design/sessions-ux-stack/ee-vs-112.1-diff-inventory.md`. §3 of the handoff ("mistakes from
the last session") is the part that tells you how to work; read it twice.

Branch `fix/post-112-reconcile`, worktree `sessions-ux`, already pushed as PR #6112 stacked on
the lane PR #6065. We are closing the visual and functional gaps the mobile-extraction lane
introduced, by comparing local EE dev against deployed prod v0.112.1. Sidebar, settings, the
sessions list, the playground in build mode, the observability table and the trace drawer are
closed and confirmed. Do not re-open them.

**Work WP-1 first: chat with a live run.** It is 133 changed files in `AgentChatSlice` plus 73 in
`@agenta/chat`, it is the biggest remaining gap, and it is the only work that reaches code a
static page never executes. Send a real message on the `112-QA` agent on BOTH builds and compare
streaming, tool steps, approvals, elicitation, the send queue and error states. Ask me before the
first send. Then WP-2 (`@agenta/entity-ui`, 86 files, completely unexamined) and WP-3
(`@agenta/ui` deliberately, 93 files, where three bugs have already surfaced sideways).

Prioritise by files the lane changed, never by route. Screening by route ranks the symptom: the
`iconPosition` bug surfaced on `/evaluations`, which the lane barely touched, because it lives in
`@agenta/ui`, which it rewrote.

Source of truth, in this order: if `origin/release/v0.112.2` addresses the gap, 112.2 wins;
otherwise deployed v0.112.1 is truth. Check 112.2 explicitly for every gap, and check the release
PRs before calling anything deliberate. The handoff lists the known 112.2 truths and the known
deliberate lane designs. Both directions have bitten: things that looked like regressions were
shipped 112.2 changes, and one thing I classified as deliberate on the strength of a component's
own docstring turned out to be a regression Arda wanted reverted.

The workflow, no shortcuts. Per surface: put PROD in an exact named state, screenshot, put LOCAL
in the same state, screenshot, run the VRT per strip, open EVERY contact sheet, collect ALL
issues, fix as one batch, re-run that surface's VRT. Do not fix-one-verify-one. Capture light and
dark, empty and with-data, and each interactive surface open as its own classified shot. Slugs
encode the state: `chat.dark.tool-step-expanded`.

Drive every control you claim to have fixed, and diff before/after. Sample async surfaces over
time rather than reading them once. When your result and mine disagree, add logs across the whole
chain immediately instead of guessing another round: one instrumented run found a render loop
last session that three rounds of reasoning had missed.

Do not ship a fix you have not driven in a browser. If the browser is down, say so and stop.

Environment. LOCAL `http://localhost:3000` (web/ee, Next dev, this worktree). PROD
`https://eu.cloud.agenta.ai`. Both projects are `112-QA` and already in `env.sh`. The paired agent
is `New agent` on Anthropic / Haiku 4.5, prod `01a01513-63df-…` and local `01a01513-541a-…`;
re-open the same one on both before capturing. Viewport 1800x942 CSS, verify DPR before trusting
any capture. I run the dev server and the browser: ask before starting, restarting or killing
either.

Tooling is in `scratchpad/qa112/` and is hardened. Use it, do not rebuild it, and do not
substitute improvised `querySelectorAll` filters for it. `source env.sh` first, then `shot.sh`,
`vrt.py`, `regions.py`, `zoom.py`, `press.sh`, `goto.sh`, `go.sh`, `keepalive.sh`. The handoff's
§5 lists the traps, including several the last session created for itself. Read them before your
first capture, especially: `press.sh` double-fires plain buttons, `browse goto` kills the daemon
on the dev build, tabs must be resolved by URL because I browse in the same window, and rAF
sampling cannot measure motion here.

Before landing: `pnpm lint-fix` in `web/`, oss tsc, mobile tsc, affected suites. Record findings
in the inventory as you go, including the ones that turn out wrong and why. Commit per surface,
push to the existing branch so #6112 stays current, and never put Claude/Anthropic/Co-Authored-By
in a commit message.

Read `docs/design/sessions-ux-stack/NEXT-SESSION-112.2-MERGE.md` in full, then §6 of
`docs/design/sessions-ux-stack/ee-vs-112.1-diff-inventory.md`. §7 of the plan is the part that
tells you how to work; read it twice.

Branch `fix/post-112-reconcile`, worktree `sessions-ux`, pushed as PR #6112 stacked on the lane PR
#6065. The visual parity work is DONE and closed — do not re-open it. This session is the other
half: the branch is **113 commits behind `origin/release/v0.112.2`** (the lane is 445 behind), and
one thing I filed as a visual difference turned out to be missing feature work.

**Merge `origin/release/v0.112.2` into `fix/post-112-reconcile`.** Not into the lane — the lane
being 445 behind is real but it is a separate job, and mixing them makes both unreviewable. Note
it, do not do it.

`git merge-tree --write-tree --messages HEAD origin/release/v0.112.2` reports **18 conflicts**, and
the plan groups them. Do the relocations and small files first to shrink the diff, then the chat
slice. **`toolDisplay.ts` is the one that matters:** 112.2's is 665 lines against this branch's 26,
because ~10 commits of tool-activity naming and summary work landed there after our merge base.
Take 112.2's system whole rather than hand-merging it line by line, then re-apply anything the
lane's version does that 112.2 does not cover. `@agenta/chat`'s `skin/registry.ts` is the seam the
lane introduced and 112.2 grew its own — understand both before resolving.

Seven fixes live on this branch (plan §4 lists them with files). None of their files were touched by
the 113 commits, so a correct merge leaves them alone — but VERIFY, don't assume: the §5l regression
checks are one-liners in the browser and they caught nothing only because nothing had moved yet.

Before landing: `pnpm lint-fix` in `web/`, oss tsc, mobile tsc, package suites. **`@agenta/ui` must
report 83 tests across 11 files** — fewer means the vitest config regressed and six render suites
went dormant again.

Then re-run the comparison for what the merge touched: tool rows in chat (the point of the whole
session — drive both a successful tool call and a FAILING one), approvals, elicitation, session
hydration/start, auth and Home. Everything else in the inventory is closed and its files are not in
the conflict list; leave it alone.

Environment. LOCAL `http://localhost:3000` (web/ee, Next dev, this worktree). PROD
`https://eu.cloud.agenta.ai` — **it runs v0.112.2, not 112.1**; the inventory's older framing is
corrected in §6. Both projects are `112-QA`. The matched agents are `AGENT_PROD` / `AGENT_LOCAL` in
`env.sh`, both named `Hello-world helper`, Anthropic / Haiku 4.5. Viewport 1800x942 CSS; verify DPR
before trusting any capture. Arda runs the dev server and the browser — ask before starting,
restarting or killing either, and he is fine with you creating test data on either project.

Tooling is committed at `docs/design/sessions-ux-stack/qa112/` and is hardened. Use it, do not
rebuild it. `source env.sh`, then `./doctor.sh`, then `pin_tab local; pin_tab prod` — in that order,
every session. Then `shot.sh`, `vrt.py` (add `align` to register past the deliberate 9px gutter),
`regions.py`, `zoom.py`, `press.sh`, `goto.sh`, `go.sh`, `prop-drop-sweep.py`, `keepalive.sh`.
`qa112/README.md` lists every trap; §7 of the plan repeats the ones that will bite this session.

Work continuously. Do not stop after each unit to ask whether to carry on — the queue is in the
plan. Stop only for a decision that is genuinely Arda's, and when you do, ask what the right
behaviour is rather than offering him a menu of which build to match: prod is the reference for
spotting drift, NOT an authority on correctness.

Record findings in the inventory as you go, including the ones that turn out wrong and why — that
record is why this session knows what it knows. Commit per resolved area, push to the existing
branch so #6112 stays current, verify each push with `git ls-remote` against `git rev-parse`, and
never put Claude/Anthropic/Co-Authored-By in a commit message.

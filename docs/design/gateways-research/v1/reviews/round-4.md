# Independent review round 4: the redesigned candidate

Two reviewers read the same candidate independently. This file records what they found, what
survived verification, and what each finding is waiting on. The running log stays in
[open-reviews.md](../open-reviews.md); the round-3 record, which this one builds on, is
[round-3.md](round-3.md).

**Reviewed revision:** `0dcf27bf0c`, against base `e5643f00f5`.
**Verification revision:** `b9de76fcef`, the integration head, which is `0dcf27bf0c` plus seven
commits. Where a finding was verified at the later head rather than at the candidate, the section
says so. The demo stack serves this same revision, so a page check and a code check describe one
tree.
**Round-3 reviewed revision, for the delta range:** `5c67a2e871`.

**Scope.** Everything since round 3, which is two bodies of work rather than one. The first is the
round-3 fixes, the rebase onto a main that had moved 38 commits, and the D94 residual. The second is
the MCP screen redesign: seven work packages reimplementing every MCP surface on both apps, against
a designer's spec with 45 recorded decisions. The redesign is the larger half and it is new code
that no previous round has read.

Every line number below was read at the revision its section names. Paths are relative to the
repository root; host and container details are omitted.

## What blocks the release

Checked against `8f8d6eb16a`, the candidate plus its two closing test commits. Each code check ran in
its own worktree, every mutation was rerun here rather than taken from a fix's own report, every claim
from the three external reviews was graded by constructing a failing input, and the live checks ran in
an ephemeral project with its own provider key.

**One thing blocks the release, and it is not a defect.** D116: the review gate has seen none of this
work, because the branch that configures its passes is unpushed. The push is the closer. The only thing
to hold is that its completion is confirmed rather than assumed, because the failure mode is a refusal
that reports as a pass, which is how this finding arose.

**No P1 is open and no product defect is open.** Every finding this round raised against the product
has either landed a fix that was delta-checked here, or is deferred to a filed issue with its reason.

**Fourteen P3s are open**, none release-shaped. Five of them are one pattern worth naming as a pattern
rather than five times over: a guard is written, the defect is genuinely closed, and nothing exercises
the guard. D145, D158, D173's first attempt, D185's predecessor and now D187 are all that shape. Four
were closed during this round once someone looked; D187 is the one still open.

**Four P2s are deferred to issues**, none about what this release changed: a relayed refusal retried as
a session expiry, a refused connect leaving a row that reads connected, a secret that cannot be created
from inside the sheet, and a stored pane preference that hides the phone conversation.

**What has and has not been shown.** The acceptance pair is 11 of 11 on the candidate with retries
genuinely off. On the page, on both apps: a wrong key reaches the rejected-key screen naming its status
in one call where it took eleven; a revoked session no longer claims the server rejected the key; the
reconnect path completes at both widths from three entry points; the reconnect notice renders; and the
touch targets measure as recorded. Everything else driven here went against the deployable mock, with
one exception recorded as manual and closing nothing: real servers were connected to this candidate by
hand and work.

**Three things are proven at the code and not on the page**, listed so their absence is not read as
coverage: the prototype-key denial, which needs a server willing to advertise such a tool; the per-tool
readers failing closed, which needs a sender using the other field convention; and a session expiring
inside the window between the internal read and the relay call, which could not be forced live and is
covered by the case added for D185.

The deferrals are issues 6911 through 6921, plus 6926, 6927, 6928 and 6930.

## The two reviews

**Codex.** An external reviewer run at medium reasoning effort, read-only, given the delta, the
decisions file, the per-package reports, the open findings and the QA record, and told to verify
every claim against the code rather than trust the briefing. Verdict: one P1 blocker, five P2, two
P3, and, in its own closing words, "this review does not establish release readiness". It ran none
of the requested suites, for a stated and correct reason: the workspace had moved past the candidate
and a read-only sandbox could not materialise the candidate or build it.

```bash
codex exec -m gpt-6-astra -c model_reasoning_effort=medium --sandbox read-only \
  --color never -C <repository root> "$(cat <briefing>)"
```

**Second reviewer.** A fresh Opus reviewer, with no history in rounds 1 to 3, reading the same scope
independently. Fresh deliberately: six passes had dispositioned this codebase, and a reviewer
carrying that history reads the redesign as a delta when it is new code. Verdict: 0 P0, 0 P1, 8 P2,
8 P3, and "I would ship this". It ran every suite in its brief and quoted counts.

**How the two differ, and what that is worth.** The Opus review is far the more complete: it drove
the mock, the callback page, the flag defaults and a script-injection attempt against the running
stack, and it ran nine package suites, the runner suite, the SDK suite and two API layers. The Codex
review ran nothing and read narrowly, and it still produced four findings the Opus review did not,
two of them at the wire rather than in the copy. The pair is worth more than either, and the reason
is visible in D113: each reviewer found one half of it, and neither half alone is a P1.

## Counts

| | P0 | P1 | P2 | P3 | Total |
| --- | --- | --- | --- | --- | --- |
| Codex, as filed | 0 | 1 | 5 | 2 | 8 |
| Second reviewer, as filed | 0 | 0 | 8 | 8 | 16 |
| **At the close of round 4** | 0 | 4 | 45 | 39 | 93 |

The close row is the disposition table counted, and it is the only total worth quoting. Severity is
as verified rather than as filed, and two findings carry no severity, one withdrawn and one investigated and found not to be a
defect, so the severity columns sum to 88 against 93 rows.

Getting from the two reviewers' 24 filed findings to 93 takes three additions, and they are listed
rather than summed because an earlier version of this section presented addition rows that did not
reconcile with the close. Two Codex findings were duplicates of Opus ones, leaving 22 unique reviewer
findings. Verifying them added 6. Delta-checking the fixes added 5, every one of them created by a
fix rather than found in the candidate. Registering QA round 6c and the closing checks added the
rest. Three severities moved on verification, one down from P1, one up from P3, one down from P2,
each argued in its section.

## Disposition table

Findings are numbered from **D95**, continuing round 3, which closed at D94. D95 to D110 keep the
numbers the Opus reviewer assigned in its own file. `Fix rev` is the commit that resolves the
finding, and is empty while one is owed.

| ID | Src | Sev filed | Sev verified | Disposition | Fix rev | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| D95 | Opus | P2 | P2 | **fixed** | `8b54aea5dd`, `2e97438a40` | both shells green; pre-fix reproduced |
| D96 | Opus | P2 | P2 | **fixed** | `cac31419b9` | decision 54: removed; absence verified |
| D97 | Opus | P2 | P2 | **fixed** | `70f9890b55`, `883385bc2a` | 101/0 reproduced; remainder D128/D153 closed |
| D98 | Opus | P2 | P2 | **fixed** | `5b075f7d06` | mutation rerun: 4 cases, 2 per app |
| D99 | Opus | P3 | P3 | **fixed** | `9849044b85` | mock driven again, live |
| D100 | Opus | P3 | P3 | deferred, 6914 | | both files read |
| D101 | Opus | P3 | P3 | fix owed, web | | diff confirmed |
| D102 | Opus | P3 | P3 | fix owed, CI | | workflow read |
| D103 | Opus | P3 | P3 | deferred, 6914 | | line confirmed |
| D104 | Opus | P2 | P2 | **fixed** | `3a4c27bcab` | rendered; focus return proven |
| D105 | Opus | P2 | P3 | **fixed** | `6bfffecb89` | decision 50 settles scope |
| D106 | Opus, Codex 4 | P2 | P2 | **fixed** | `150600a088`, `d348f8b391` | ids resolved to targets; see D127 |
| D107 | Opus | P2 | P2 | **fixed** | `5576eaf03e` | label activation drives the control |
| D108 | Opus | P3 | P3 | deferred, 6915 | | probe modes grepped |
| D109 | Opus | P3 | P3 | fix owed, web | | read |
| D110 | Opus, Codex 5 | P3 | P3 | fix owed, web | | token sweep confirmed |
| D111 | Codex 1 | P2 | P2 | **fixed** | `21c7558ceb` | row dropped on an address change; mutation kills 1 |
| D112 | Codex 3 | P2 | P2 | **fixed** | `8ec01cc647` | rewritten flow confirmed |
| D113 | Codex 2, merge | P2 | **P1** | **fixed** | `223b017bf9` | payloads re-run, drawer rendered, control swapped |
| D114 | Codex 6 | P1 | P2 | **fixed** | `9bd9e05d8c` | reconnect sends the whole row; mutation kills 1 |
| D115 | Codex 7 | P2 | P3 | fix owed, runner | | parser executed |
| D116 | Codex 8 | P3 | P2 | planned | | repartitioned to 140 + 182 |
| D117 | merge | | **P1** | **fixed** | `27beaa82ea`, `aab9ce4651` | mutations rerun 9/12/3; gate absent from merged head |
| D118 | merge | | **P1** | **fixed** | `1f879a9973`, `3d6550262f` | 11 classes rendered; confirmed on merged head |
| D119 | merge | | P2 | deferred, 6911 | | helper read, call sites traced |
| D120 | merge | | P2 | deferred, 6912 | | config confirmed |
| D121 | merge | | P2 | deferred, 6913 | | skip confirmed |
| D122 | merge | | P2 | deferred, 6916 | | read, one branch reasoned |
| D123 | delta-check | | P2 | remainder deferred | | grant visible; D137 is all that is owed |
| D124 | delta-check | | P3 | fix owed, web8 | | rendered from the fix |
| D125 | delta-check | | P3 | deferred, 6917 | | normalizer executed |
| D126 | delta-check | | P2 | **fixed** | `1edc4e0ee0`, `f8d9190500` | 12 controls hit-tested at 1440 and 430; pitch trio is D150 |
| D127 | delta-check | | P3 | **fixed** | `c155691e64` | 11 cases, zero dangling references |
| D128 | delta-check | | P2 | **fixed** | `2e97438a40` | 101/0 right, 8/93 wrong, both rerun; see D141 |
| D129 | delta-check | | P3 | **fixed** | `2e97438a40` | fixture moved: 3 of 3 fail, not skip |
| D130 | delta-check | | P3 | superseded by D133 | | fixture vs live reconciled |
| D131 | QA 6c | P1 | **P1** | **fixed** | `56c61c95c1`, `5931523610` | all 5 reconnect mounts fail my drop mutation |
| D132 | merge | | P2 | **fixed** | `c72128a960` | rendered; but see D154, two mutations survive |
| D133 | QA 6c, D130 | P2 | P2 | **fixed** | `9bd9e05d8c` | 3 mutations kill 5, 2, 2; live check blocked, see D175 |
| D134 | QA 6c | P2 | P2 | **fixed** | `404b7ee257` | decision 53 is in the workspace file, not the tree |
| D135 | QA 6c | P2 | P2 | **fixed** | `e09b72a6ad` | accessible name resolved; see D143 |
| D136 | delta-check | | P3 | **fixed** | `49972c6ea4` | 4 mutations rerun; scoping graded sound |
| D137 | delta-check | | P3 | deferred to designer | | decision 57; no copy exists to ship |
| D138 | QA 6c | P2 | withdrawn | not reproduced | | cause is D139, not web9 |
| D139 | web7 | P2 | P2 | **fixed** | `4e9e19e37a` | 3 mutations rerun; production path rendered |
| D140 | web7 | P2 | P2 | **fixed** | `df4711e3cd` | 3 mutations rerun; every reader swept |
| D141 | delta-check | | P2 | **fixed** | `9893fc5818`, `883385bc2a` | wrong-port proof rerun read-only; D153 closed with it |
| D144 | delta-check | | P2 | **fixed** | `d33602b63d` | 70/70 tappable at 390 and 430; pre-fix reproduced |
| D145 | delta-check | | P3 | **fixed** | `946c194bdc` | coordinated revert now fails all 4; see D158 |
| D146 | delta-check | | P2 | **fixed** | `4fd69d7993`, `b5dd375370` | both behaviours reproduced; dead-port run |
| D147 | delta-check | | P3 | part fixed, api2 | `bea26cefa7`, `494eec58ef` | 2 of 3 fixed; not literally followable |
| D148 | team-lead | | not a defect | investigated, pinned | `08455448fe` | dock already catches; 3 mutations rerun |
| D150 | delta-check | | P3 | fix owed, web10 | | list pitch, not the border |
| D151 | delta-check | | P3 | fix owed, web10 | | mutation survives; unreachable today |
| D152 | delta-check | | P2 | **fixed** | `ce48087337` | two-process run identical, node-id diffed |
| D153 | delta-check | | P2 | **fixed** | `883385bc2a` | same-server rule; other stack unchanged |
| D154 | delta-check | | P3 | **fixed** | `5931523610` | both mutations now fail |
| D155 | delta-check | | P2 | **fixed** | `5931523610` | in-chat widget now fails its own case |
| D156 | delta-check | | P3 | **fixed** | `21c7558ceb` | typed value survives a later probe; mutation kills 1 |
| D157 | delta-check | | P3 | **fixed** | `21c7558ceb` | editor named by its visible label; mutation kills 1 |
| D158 | delta-check | | P3 | fix owed, web10 | | 2 controls still reader-only |
| D159 | delta-check | | P3 | fix owed, api2 | | explicit address silently rewritten |
| D160 | api2 | | P3 | deferred, 6921 | | import-time fetch; measured offline |
| D161 | round-5 | P2 | P2 | **fixed** | `1a6fa7624a` | reviewer's revert fails the new case only |
| D162 | round-5 | P3 | P3 | fix owed, docs | | half-updated in the same delta |
| D163 | round-5 | P3 | **P2** | **fixed** | `973eddc38d` | both layers fail when the import is removed |
| D164 | round-5 | P3 | observation | recorded | | consequence does not hold |
| D165 | round-5 | P3 | P3 | **fixed** | `9dfecd4b55` | keys on the body's code, not the status |
| D166 | round-5 | P3 | P3 | **fixed** | `90e36f823e` | policy prop restored per source |
| D167 | round-5 | P3 | P3 | **fixed** | `21c7558ceb` | typed value survives a later probe |
| D168 | round-5 | P3 | P3 latent | recorded | | slug half is dead code |
| D169 | round-5 | obs | observation | recorded | | only the offload wrapper is stubbed |
| D170 | r5 Codex | P2 | P2 | **fixed** | `9bd9e05d8c` | record pinned; clearing unpinned by design |
| D171 | delta-check | | P2 | **fixed** | `f3290aef68`, `0fe9a8c374` | 3 readers fail closed; absence still inherit |
| D172 | delta-check | | P3 | **fixed** | `0db1f46446`, `e639f2a471` | all 3 value paths pinned; floor mutation kills 15 |
| D173 | delta-check | | P3 | **fixed** | `e639f2a471` | fixture now allows; predicate mutation kills 3 of 4 |
| D174 | delta-check | | P3 | **fixed** | `609cbde82d` | all 3 readers go red on an emptied block |
| D175 | live pass | | P2 | **fixed** | `477944f11e` | one verify call, screen names (401), both widths |
| D183 | delta-check | | P3 | **fixed** | `4693151e3b` | second-press case; removing the reset kills it |
| D184 | delta-check | | P2 | **fixed** | `4693151e3b` | shape rule; 6 cases die on the mutation |
| D176 | web7 live | P2 | P2 | **fixed** | `b0adb90e42` | latch holds; its reset is unpinned, see D183 |
| D177 | live pass, web7 | | P2 | **fixed** | `cdf51982a7` | refused row removed; mutation kills 1 |
| D178 | web7 live | P2 | P2 | **fixed** | `cdf51982a7` | saved header kept; mutation kills 1 |
| D179 | r5b Codex | P2 | P2 | **fixed** | `b546205833` | 5 sites fixed; 1 pinned, see D187 |
| D187 | delta-check | | P3 | fix owed, integrator | | 4 of 5 prototype-safe sites unpinned |
| D185 | delta-check | | P3 | **fixed** | `8f8d6eb16a` | 1 case per package; covers the live gap |
| D186 | QA 6d, merge | P2 | P2 | deferred, 6930 | | a stored pane preference hides the chat |
| D180 | r5b Codex | P2 | P2 | **fixed** | `4fc3651100` | flag set true on a successful swap |
| D181 | r5b Codex | P2 | P2 | **fixed** | `4fc3651100` | current-attempt checked before the write |
| D182 | r5b Codex | P2 | P2 | **fixed** | `4693151e3b` | same rule; adversarial inputs behave |
| D149 | api2 | | P3 | **fixed** | `f9481fc534` | bypass complete; 10 pool cases keep the real pool |
| D142 | delta-check | | P2 | **fixed** | `7ae6abc84e` | verified by content; cherry-picked SHA |
| D143 | delta-check | | P3 | part fixed, web7 | `363444a86d` | grid pinned; JSON unasserted, see D157 |

## How this round was verified

The rule this round was held to is the one three false closures in round 3 came from breaking: a
fix or a claim is checked at the boundary the finding describes, which is the wire payload, the
rendered page or the running container, and never by confirming that a named file now matches the
finding's wording. Two corollaries were applied throughout. Where a finding says one value has
several readers, every reader is enumerated before anything is closed. And before a negative result
is trusted, a positive control is run to prove the probe would have caught the positive case.

That rule changed the outcome five times in this round. D113 and D117 and D118 are P1 findings that
neither reviewer filed as such, and all three were established by executing the code rather than
reading it. D114 came down from P1 because the precondition turned out to be unreachable through any
shipped surface. D115 came down from P2 because the parser's loose match, once executed, gave a
malicious server no capability the honest path already gives it.

It changed the outcome three more times when the fixes were delta-checked. D113's fix is complete and
correct, and it created two findings of its own that a diff would not have shown, because they are
about the meaning of a signal rather than the shape of the code. D117's and D118's fixes each closed
the half a diff would confirm and left the half that needed a render or a test, and both were reported
as done. Neither was dishonest: in both cases the commit message describes exactly what the commit
did, and it was the finding's own closing criterion that the fix did not meet.

**One methodological note, because it cost a discarded run.** A delta-check that swaps the pre-fix
file back in to run a control mutates the shared worktree. Two such checks were run concurrently in
one worktree, and each observed the other's control swap as an unexplained modification; one had to
discard a suite run that overlapped it. The results here stand, because every quoted count was taken
after the tree returned to clean and both checks reported the overlap themselves. But a control swap
is a write, so concurrent delta-checks need a worktree each.

**Two more method notes from the closing checks, both of which nearly produced a wrong entry.**

A copy sweep run across the lane worktrees reported three copy findings as still open, because the
lanes it read do not contain the lane that carried the fix. Checked on the merged head instead, all
three are closed: the singular tool count, the stale-entry label correctly split so the MCP source
says one thing and the catalogue source keeps its own, and the Custom preset's description. A finding
is open or closed on the head that ships, not on the lane that happens to be checked out, and a
per-lane answer to a copy question is a statement about lane topology rather than about the product.

The sharper one is D133. An earlier delta-check in this round closed a copy finding by rendering it,
which is the right method, and still got the wrong answer, because the render was fed a fixture that
was more generous than anything the live path can produce. Live QA driving a real server got a
different sentence. Rendering is not automatically verifying at the boundary: a render with
hand-authored inputs tests the template, and the finding was about what the inputs can be.

Three claims made in good faith did not survive checking, and they are recorded because each is the
same mistake in a different place.

- The Opus sweep states "there is no global retry". `web/tests/playwright.config.ts:45` sets
  `retries: process.env.CI ? 1 : ...`. See D120.
- The Opus sweep states that the API and SDK pytest trees hold no emptiness-tolerating branch.
  `api/oss/tests/pytest/utils/polling.py:145` returns its last response on exhaustion where its
  sibling raises. See D119.
- An acceptance test comment justifies a three-reload loop on the ground that the product's own
  recovery button "has no onClick (dead)". It has one, at
  `web/oss/src/components/Playground/Components/MainLayout/index.tsx:331`, and it had one at the
  base of this release too. Not a defect; a stale justification for an allowance. See D122.

## The findings

D95 to D110 are recorded in full in the Opus reviewer's own file and are summarised here with the
verification the merge added. D111 onward are recorded in full.

*A note on one number in the table, because it was disputed.* D98's row says the mutation fails four
cases where the fix's own commit message names two. Both describe the same event: the commit names
one representative case per app, the row counts the cases that actually fail. Rerun here, it is four,
two per app, the same four by name. The row keeps the count of failing cases, which is what a column
headed "how it was verified" should carry. One qualifier the record owes a future reader: the count
depends on which string the mutation hardcodes. Replacing the reason with a string that matches
neither the stated-reason form nor the standing wording fails four; replacing it with the standing
wording itself would leave two passing and look like a contradiction.

### D95. The callback page's "no origin to trust" guard is not pinned by the test that names it (P2)

`api/oss/tests/pytest/unit/gateways/test_gateways_mcp_connect_callback_page.py:128`, against
`api/oss/src/apis/fastapi/gateways/mcps/router.py:786`. The case passes `agenta_url=None` and
asserts the rendered origin is null, but the page reads `_app_origins(agenta_url)`, whose candidate
list also carries the ambient environment's declared app origins, which the case never clears. So it
asserts what it names only where the environment declares none.

**Verified.** The reviewer ran the API unit layer with the demo stack's environment file loaded, as
the repository's own contributor guide prescribes, and got 3 failed, 5337 passed, 171 skipped, this
case among the three, failing with a real origin where it expects null. With no environment file the
same three pass. The other two failures are pre-existing cases in
`test_composio_version_alignment.py` asserting on a default that is itself read from the
environment. Fix owed on the API side. The consequence worth naming is the second one: on any real
deployment the property has no coverage at all, and the round-3 change that introduced
`_app_origins` is the change that could break it.

### D96. The reload-on-empty-panel allowance survives, ungated, in the one file that tests the MCP agent configuration (P2)

`web/oss/tests/playwright/acceptance/playground/mcp-agent-config.ts:209-214`. A failed visibility
check on the MCP section reloads the page and checks again. Round 3 named this allowance and left
it, on the ground that its stated cause, a development server serving a chunk id the last rebuild
replaced, is real. Nothing gates it on a development server, so against the built image it absorbs a
different class: a configuration panel empty on first render and populated on the second, which is
D94's own desktop shape.

**Superseded by decision 54: the allowance is removed entirely rather than gated further.** The
delta-check of the gating fix found it sound against the defect class it was filed for, because a
panel empty on first render emits no chunk error and now throws, but keyed on a reported symptom
rather than on the stack, so a genuine dynamic-import failure against a built image would still
license one reload. The live evidence settled it: zero reloads across every trace of the three cases,
with the guarded wait resolving in 2.9 seconds against a 360-second budget. An allowance that never
fires and cannot be gated on the condition it was written for is dead weight, so it goes. Fix owed,
web7.

**Verified, and it is worse in company.** Confirmed present and unconditioned at both the candidate
and the integration head, and confirmed carried forward byte-identical on `wip/design-web7`, which
rewrote the rest of this file. It covers all three cases in the file and it is the first thing each
does. Read together with D120, a failure here is retried twice before anything is reported. Neither
reviewer drove it, and nor did the merge: the only live stack serves this branch and is another
agent's, so a removal experiment would have answered the wrong question. Three further allowances in
the same two files are D122. Fix owed.

### D97. The gateway integration layer cannot reach the deployment under test, skips 93 of 101 cases, and exits 0 (P2)

`api/oss/tests/pytest/utils/postgres.py:41-46`, used by
`api/oss/tests/pytest/integration/gateways/conftest.py:349-356`. The helper rewrites the configured
database host to loopback and keeps the port, on the stated ground that compose publishes the same
server on loopback. Compose publishes it on a different published port, so the fallback dials a port
this deployment does not use and finds nothing.

**Verified.** The reviewer ran the layer against the stack this release is being QA'd on and got 8
passed, 93 skipped, exit 0. The 93 are every case taking the seeded-project fixture: the OAuth grant
rekey migration, connection identity, endpoint writes and recovery. No workflow runs this layer, so
the only place these cases run is the place where they skip, which makes the silent skip more
consequential rather than less.

**The second half is the part to fix first.** The skip is keyed on connecting to a database by name,
which the module offers as its safety argument, on the ground that a stack under a different licence
listens on the same port with different database names. That argument holds only across licences.
Several same-licence stacks run on this box concurrently, each publishing its database on its own
port, and all of them carry the same database name. Had one of them held the port the helper dials,
this run would have connected, seeded projects and executed the release's gateway cases against
another deployment's database, silently. What prevented it was that the process on that port
belonged to a different licence, which is the one case the guard covers. Fix owed on the API side.

### D98. The refused-send call site is pinned on the mobile app and not on classic, and the reachability argument behind the asymmetry does not hold (P2)

`web/oss/src/components/AgentChatSlice/AgentConversation.tsx:698` and `:857`. Both apps put the
same description helper on the rejection in their composer's catch; only the mobile call site has a
case, and the mobile case names its own mutation in its header. Round 3 deferred the classic half on
the ground that the classic agent route redirects to the mobile app, so that composer is not
user-reachable.

**Verified.** The reviewer traced the mount chain: the classic Playground mounts the chat panel,
which lazily renders the conversation, and the device gate in the shared package moves mobile user
agents rather than agent routes. So the surface is reachable by a desktop browser and the deferral's
premise is about a route the component graph does not require. Fix owed: a case on the classic call
site.

### D99. The deployable mock's docstring says it has no event-stream leg; it has one (P3)

`api/oss/src/core/gateways/mcps/providers/mock/app.py:7`. The docstring says stateless JSON only,
no session id and no event-stream leg. Line 126 of the same file says the opposite, and the adapter
declares the tool-listing method as event-stream framed with a prelude notification.

**Verified live** against the running mock: the tool listing answers as an event stream with two
frames, the handshake answers as JSON. This is the comment pattern that produced D62, where a
reader trusted a docstring and concluded a framed body could not be exercised. Fix owed: correct the
docstring.

**Recorded, not a finding.** The brief asked whether the mock stays as strict as the real providers.
It does, on the axis that matters most. It refuses a tool listing carrying no protocol version
header, refuses a handshake that carries one, negotiates down from the version all three clients now
offer, and then refuses a follow-up naming the offered version rather than the negotiated one, so a
client echoing what it offered instead of what it was answered is caught. All four cases were driven.

### D100. Two surfaces give the same connection status two different tones (P3)

`web/packages/agenta-settings-ui/src/mcp/McpServersSection.tsx:64-68` maps the unreachable status to
an error tone; `web/packages/agenta-entity-ui/src/mcpEndpoint/McpPermissionDrawer.tsx:176` collapses
everything that is not connected to a warning tone. Decision 8 makes the drawer right and the table
wrong.

**Verified** by reading both files at the integration head; the vocabulary and the label are
correctly centralised in the entities package and only the tone is decided twice. Latent today
because decision 30 ships without the status, so nothing renders it. **Deferred to issue 6914**,
with D103, because it goes live the day the health field in issue 6907 arrives and not before.

### D101. A hardcoded colour literal survives on an MCP surface the redesign edited (P3)

`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/itemDescriptors.tsx:240`.
Decision 2 says no hardcoded hex anywhere. The design delta edits this function and removes a tag
three lines below the literal, leaving it. **Verified** from the diff. The neighbouring descriptors
carry the same shape, so this is a family rather than one site, but this is the one an MCP decision
governs. Fix owed.

### D102. The new Storybook CI job has no timeout (P3)

`.github/workflows/12-check-unit-tests.yml`. Every other concern about the job is met: it is kept
out of the build graph with the reason stated, and it lints as well as builds. It has no timeout, so
it inherits the six-hour default on a build that takes about fifteen minutes, and a hang costs a
runner for six hours while the check reads as pending rather than failing. Also cosmetic, same file:
the storybook path is added beneath a pattern that already matches it. **Verified** by reading the
workflow. Fix owed.

### D103. The settings registry's row key collapses to the empty string (P3)

`web/packages/agenta-settings-ui/src/mcp/McpServersSection.tsx:121`. The by-key tracking this file
introduces is the right shape and is the fix for the QA finding it addresses. The key function falls
back to the empty string, so two records missing both an id and a slug share a key and the open
drawer would follow whichever the lookup finds first, which is the failure the change exists to
prevent. **Verified** by reading the line. Low likelihood: every stored connection has an id.
**Deferred to issue 6914** with D100.

### D104. The inline confirm's consequence sentence is probably never announced, and focus is dropped when it closes (P2)

`web/packages/agenta-ui/src/components/ui/inline-confirm.tsx:43-56`, used for the remove action at
`McpPermissionDrawer.tsx:196-204`. The component does most of this right: escape cancels, and focus
opens on the cancel control rather than the destructive one, with the reason stated. Two things it
does not do. The container carries a polite live region and is mounted with its content already in
it, and a live region announces changes to a region already in the tree rather than a region that
appears with its text in place, so the comment claiming the sentence is announced does not hold.
And nothing returns focus to the trigger when the confirm closes, so a keyboard user who cancels
lands on the document body.

**Verified by reading only**, and the reviewer said so: it had no way to drive a screen reader and
did not run the Storybook accessibility script. The live-region behaviour is a well-established
property rather than a measurement. Recorded at the filed severity on that basis. Fix owed, and
either of two fixes is sufficient: an alert role on the container, which is announced on insertion,
or a description reference from both buttons to the message, which is the more precise because it
ties the sentence to the controls rather than to a moment in time.

### D105. The Custom preset's description is overridden at render, and the spec's own string is already in the file (P2 filed, P3 verified)

`agentTemplate/IntegrationPermissionDrawer.tsx:463`, `help: isCustom ? "Set below, per tool" :
def.help`. The spec gives this preset the description "Per-tool permissions below", and
`SchemaControls/integrationPolicy.ts:67` holds exactly that string. The render throws it away.

**Verified by dumping the rendered menu**, which is the check that matters here, because a check
against the preset table alone would have closed this finding as already correct: the table carries
the spec's wording and the drawer overrides it at render time. All five options as a person reads
them:

```
"Always ask" / "Approval before every run"
"Ask for write and delete" / "Read-only tools run automatically"
"Allow all" / "Everything runs without asking"
"Deny all" / "Tools stay listed but never run"
"Custom" / "Set below, per tool"          <- aria-disabled=true
```

The other four match the spec exactly, and the Custom trigger's override-count form matches the spec
too. **Severity lowered to P3.** It is a one-line copy deviation on a menu item that cannot be
picked, with no behavioural consequence and no safety claim, and both wordings say the same thing.
The reviewer argued P2 on the ground that decision 39 settled the preset copy explicitly; decision
39 settles the labels, and this is the description, which the reviewer itself concedes.

**One scope question for the fix, which is why this is not simply a one-line change.** The override
sits in the shared drawer, so restoring the table's string changes the Integrations drawer too.
Decision 45 says the Integrations drawer is unchanged in this release, while the spec digest says
the MCP preset list is exactly the Integrations list. Align both and decision 45's sentence is
violated on a technicality; align one and the two drawers disagree. Flag it to the designer rather
than picking silently.

### D106. On the two screens where a field goes invalid, nothing points at the reason (P2)

`web/packages/agenta-entity-ui/src/mcpEndpoint/McpConnectJourney.tsx:548-559` and `:639-687`. Filed
independently by both reviewers, which is worth noting because they are the only two findings both
reviewers reached. Two instances of one mistake. On the URL screen a description reference is
hardcoded on the input while the hint carrying that id is dropped the moment the check fails, so on
the refusal screen the input declares itself invalid and its only description points at a node that
is no longer rendered, with nothing pointing at the refusal box. On the key screen two fields go
invalid and the sentence explaining why has no id and no reference from either.

**Verified** by reading both files. **This is a regression of a fix the codebase documents.**
`agenta-ui/src/components/ui/field.tsx:118-122` states in as many words why the shared field
component generates and wires description and error ids, and it names this very dialog and the QA
round that reported it. The shared component does it correctly; the connect journey routes around it
with a hand-written attribute and a hand-managed id. The first-time case is covered, because the
refusal box announces on insertion; the return-to-the-field case is not. Fix owed, and the right fix
is to stop bypassing the shared field rather than to add a second hand-managed id.

### D107. The shared field cannot reach the secret picker, so the "Project secret" label points at nothing (P2)

`McpConnectJourney.tsx:966-980`, against `agenta-ui/src/components/ui/field.tsx:126-138`. The shared
field clones its child with the id, invalid state and description reference it generated, and renders
a label pointing at that id. The secret picker destructures six named props and has no rest spread,
so every cloned prop is dropped and the label points at an id no element carries.

**Verified** by reading both files: the destructure has no rest, and the field only assigns its own
id when the child has none, which is this case. Clicking the label does not focus the control, and
any description the field generates is not referenced. The control is not nameless, because the
trigger sets its own label and takes the invalid state directly, so this is a broken association
rather than an unlabelled control. Fix owed: spread the rest onto the trigger.

### D108. Decision 12 asks for a refusal variant the wire cannot produce, and nothing records that (P3)

`McpConnectJourney.tsx:568-576`, against `api/oss/src/core/gateways/mcps/probe.py`. Decision 12 asks
for the event-stream-only refusal case to be completed with existing copy. The probe emits two
causes only, so the variant is unreachable by construction rather than merely unwritten.

**Verified**: the probe's emitted causes are `unreachable` and `not_an_mcp_server`, nothing else.
The cost is not to a user today. It is that decisions 30 and 31 handle exactly this situation, a
specified state the API cannot supply, by shipping without it and filing an issue naming the missing
field, and this one was handled by silence, so the next reader will think the case was missed.
**Deferred to issue 6915**, which is the treatment decisions 30 and 31 got.

### D109. Copy and accessibility nits, bundled (P3)

Recorded in full in the Opus file. Copy: a one-tool server reads "1 tools" in two places, where the
file next door gets the noun right; a stale entry is labelled "not in catalog" where the spec says
"no longer offered"; a key-screen sentence was split into a headline with no status code and advice
with no scheme clause, which deleted the part telling the reader what to type; and the remove-confirm
slot is filled with the display name where the spec quotes the lowercase prefix. Accessibility: a
name input's description reference dangles on two screens, the same shape as D106 one screen on; the
shared field paints a required marker without setting the required state, affecting three fields in
this delta; a group header sets its expanded state without naming what it controls, where the
component beside it does; and an empty-search message is a plain span, so emptying the search is
silent. **Verified** by reading. Fix owed as one pass.

### D110. Two undeclared token names render at the inherited colour on agent-configuration surfaces, on both apps (P3)

`agentTemplate/AddSubagentDrawer.tsx:107` and `agentTemplate/AgentIntegrationDrawer.tsx:138`. Filed
by both reviewers. The name is declared nowhere in the theme variables file, and both files are
reachable from the mobile app through the drill-in barrel, so an affordance draws at the inherited
colour beside an MCP row where the same affordance now works. Codex adds a second undeclared name
with three more sites.

**Verified**: the sweep confirms it, and confirms the wider framing does not generalise. For the
redesigned surfaces every other token name is declared in the file the mobile app imports, so there
is no name resolving on one app and not the other, and the one name used and not declared is set
inline by the component that reads it. These two are the genuine remainder. The integrator's report
lists them as not MCP surfaces and therefore listed rather than fixed, which is a defensible scope
call; what it understates is that two of them draw a state affordance on a screen both apps render.
Fix owed: the working utility class is the whole fix.

### D111. Cancelling consent and then changing the address continues with the endpoint created for the first address (P2)

`web/packages/agenta-entity-ui/src/mcpEndpoint/McpConnectJourney.tsx:594`, with
`web/packages/agenta-entities/src/mcpEndpoint/hooks/useMcpConnectJourney.ts:340-343`.

Source: Codex, finding 1. Connect a server, cancel while awaiting consent, choose Change, enter a
second address, and connect again. Cancellation preserves the reference to the endpoint already
created for the first address, and the name submission reuses it without updating its address or its
name. The card can then show the second server while the authorization attempt still targets the
first.

**Verification, and its limit.** The mechanism is confirmed by reading: cancellation does not clear
the endpoint reference, and the submission path returns early through it when one exists. The
sequence was not driven, by either the reviewer or the merge, so what is established is the code
path and not the rendered outcome. That matters for one reason worth stating: decision 44 records
that this same path deliberately adopts an existing connection in the project with the same
normalized name and the same address, and continues as if it had created it, because a lost create
response looks identical. The adoption is keyed on the address matching. So the question this
finding really asks is whether the reuse after a cancel is the same deliberate adoption reaching a
case its key does not cover, which is what a driven check would settle. Recorded at P2 as filed, and
the fix should reset or update the created endpoint when its identity changes rather than widen the
adoption.

### D112. All three MCP configuration acceptance cases drove a flow the redesign removed (P2, fixed)

`web/oss/tests/playwright/acceptance/playground/mcp-agent-config.ts:240` at the candidate.

Source: Codex, finding 3. The cases sought a dialog containing a Connection combobox and drove a
Create button and the previous permission controls. The redesigned add flow renders server rows,
attaches through an Add control, and opens the permission drawer, so the cases could not reach their
assertions.

**Fixed at `8ec01cc647`** on `wip/design-web7`, and delta-checked rather than taken on trust. The fix was
first read at `551fde2037` and rewritten by a rebase of that lane; the two carry the same change, so
the SHA recorded here is the surviving one. At the
candidate the file drove `getByRole("combobox", {name: "Connection"})` and a Create button; at the
fix it drives an add-server drawer, a per-connection `Add <name> to this agent` button and an
explicit permission-drawer close, and the assertions against the saved configuration and the
permission payload are retained, which is what the finding asked for. The rewrite did not remove the
three retry allowances in the same file, which is D96 and D122, and it added one of its own, which
is recorded under D122.

### D113. The absent MCP policy claims a safety behaviour nothing implements, and the qualification decision 41 rested on has never rendered (P1)

`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/integrationPolicy.ts:44-50`,
`agentTemplate/mcpRail.ts:61-68`, `web/packages/agenta-entities/src/mcpEndpoint/core/policyAdapter.ts:77-83`,
and `agentTemplate/IntegrationPermissionDrawer.tsx:474-479`.

Sources: Codex finding 2 found the missing wiring; the Opus reviewer's sub-tasks reported the label
and help-line claim, and its final file carries neither. The merge established both halves at the
boundary and they are one finding, because neither half alone is a P1. Severity raised to P1.

**The wire.** Adding a server writes no server permission. Running the real adapter functions rather
than reading them, a server added and untouched produces `{"tools":{"mode":"all"}}`, and a person
explicitly picking the preset named "Ask for write and delete" produces `{"tools":{"mode":"all"}}`.
Byte-identical: no permission, no per-tool table, no floor for unnamed tools. The same probe
produced distinct payloads for Allow all, Always ask and Deny all, so it discriminates. One wire
shape therefore carries two different author intents, and it is displayed under a label whose help
line reads "Read-only tools run automatically".

**Every reader.** Fourteen were enumerated across the SDK, the runner and the web layer. Not one can
distinguish "the author picked this preset" from "nobody wrote anything", and the promised mechanism
exists nowhere: nothing in the SDK or the runner ever consults the read-only annotation an MCP
server publishes. The Pi tool type has no annotations field, so the hint is dropped at discovery.
Every producer of that hint in the runner sources it from an Agenta-side artifact, never from MCP,
and the cross-language golden fixture agrees, because every case carrying the hint is a relayed tool
and no harness-executed case carries one. What actually decides the outcome is the run-wide default:
under the read-allowing default every tool asks, including the read-only ones, which fails safe;
under the permissive default every write and delete runs unapproved, which fails open and is the
opposite of what the label says. That configuration is not exotic, because the platform's own
config-writing builtin instructs agents to write exactly it, at four places in
`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`.

**The mitigation does not exist.** Decision 41 accepted this for the release on the ground that the
drawer already qualifies the help line whenever the agent's own policy is not its default. The
conditional is real, and the prop feeding it is omitted by all three production callers of the MCP
drawer: `McpServerFormView.tsx:195-207`, `agentTemplate/McpServersSectionBody.tsx:223-255`, and
`agenta-settings-ui/src/mcp/McpServersSection.tsx:449-466`. Only the Integrations caller passes it.
Rendered at every state, the note appears when the prop is supplied and never appears without it,
which is how production renders it. So the qualification has never once appeared on an MCP surface,
including in the permissive case where the behaviour is the exact opposite of the promise.

**Why P1.** A permissions surface states a safety behaviour, no reader implements it, the surface
shows a preset the author never picked, and the only thing standing between the claim and the user
was a note that does not render. Not P0, because the wire is safe when the run default is left
alone, where the failure is over-asking rather than under-asking, and because decision 45 is already
the fix shape.

**Fix owed, web8, under decision 45, and the delta-check is not a diff.** Implement 45(b) literally,
writing the explicit shape the runner honours, and keep the preset disabled until the tool list has
arrived, because with no list there is nothing to name and the preset silently degrades to the absent
shape this finding is about. For 45(a), the absent policy must read back as the new "Follow agent
policy" preset. Either pass the agent policy from all three MCP callers or drop the note from the MCP
drawer and let the new preset carry the meaning; what must not ship is a third state rendering the
old promise. Closing this requires re-running the adapter probe: picking "Ask for write and delete"
must produce a payload that differs from the added-server payload and must name read-only tools by
name, and the absent policy must read back as the new preset.

**Delta-checked and CLOSED at `223b017bf9`.** Verified at both boundaries, with the pre-fix control
swapped back in to prove the probe discriminates. The two payloads now differ, driven through the
real drawer rather than by calling the adapter:

```
added and untouched          : {"tools":{"mode":"all"}}
pick Ask for write and delete: {"tools":{"mode":"all"},
                                "tool_permissions":{"get_issue":"allow","list_issues":"allow",
                                                    "get_current_user":"allow"},
                                "permission":"ask","new_tool_permission":"ask"}
```

The absent policy now reads back as a preset labelled "Follow agent policy", picking that preset from
a non-absent start clears everything, the round trip is exact by tool name rather than by shape, and
the preset is rendered disabled while the tool list is in flight and pickable once it lands. The
unrenderable note was removed rather than wired, which is one of the two acceptable outcomes: the
prop is gone from the drawer's own type, so the old promise cannot render in any state. The runner and
SDK resolvers were executed, not read, and both read the new shape the way the help line promises,
with named read-only tools allowed and everything else asking. With the fix reverted, the finding
reproduces exactly, including the two identical payloads.

**The fix created two findings of its own, D123 and D124**, both about the read-only signal it now
depends on. Neither reopens this one.

**Two documentation defects found in the same sweep, worth folding into the fix.**
`adapters/claude_settings.py:123-126` still documents the floor for unnamed tools as falling back to
the server permission, which the round-3 fix contradicted, and `agenta_builtins.py:224-225` tells the
config-writing agent the same thing. Both now describe behaviour the code does not have, and the
second is read by an agent that writes configuration.

### D114. API-key reconnection replaces the stored configuration and drops the tool filter (P1 filed, P2 verified)

`web/packages/agenta-entities/src/mcpEndpoint/hooks/useMcpConnectJourney.ts:441`, with
`api/oss/src/dbs/postgres/gateways/mcps/mappings.py:93`.

Source: Codex, finding 6, its only P1, filed on a request-to-mapper trace and explicitly not driven.
Driven here, against the database, and the mechanism is correct in every particular.

**The wire.** The captured request body carries the name, the authentication mode, the secret
reference, and a route block holding the address and the credential header name. It carries no tool
filter, no settings, no route headers and no description. The two reconnect flavours differ
decisively: an OAuth reconnect issues no update at all, because it stores the grant server-side and
then refetches, so this is strictly an API-key-reconnect defect, as the finding's title says.

**The persistence.** The mapper replaces the stored document wholesale, and that is deliberate and
already pinned by a passing test whose comment says so: this is a full replace, not a merge, and a
filter omitted from the new document reverts to unconstrained rather than being preserved. The
decisive experiment seeded a connection carrying an allowlist, a denylist, a route header, a timeout
and a description, applied the verbatim reconnect body, and read the row back: the filter, the
settings, the headers and the description were gone, and the check that had refused a named tool now
permits it. A positive control in the same run sent the whole fetched document and everything
survived.

**The blast radius is real.** The filter gates execution. The gateway service checks it before the
credential read and before the upstream dispatch, and refuses with a not-allowed cause, and
discovery is filtered by the same field. Neither the SDK nor the runner re-implements that check, so
the gateway is the only enforcement point. A lost filter is therefore a permissions widening and not
merely a data-integrity bug.

**Why it comes down to P2.** No shipped surface in this release can create the state the defect needs.
The filter type exists on the frontend as a type with no producer anywhere, so a custom endpoint's
filter can only arrive through a direct API call. The endpoints where an empty allowlist would be
read as deny-by-default are generated rather than stored and are not reachable by this update at all.
So this is a real widening on a state no shipped UI can produce, and it becomes P1 the moment any
surface ships that sets a per-connection filter.

**Fix owed, and the codebase has already decided it.** The sibling caller
`McpConnectionDetail.tsx:107-121` sends the whole row back under a comment stating that the edit
route writes what it is given rather than merging. The rename path honours the contract and the
reconnect path is the one place that violates it, so the fix belongs at the caller and not in the
mapper, where a merge would break a documented contract and a passing test. It is not a one-line
change: the journey's reconnect option carries only identity and address today, so it must be widened
to carry the stored document and flags, which the caller already holds. Add coverage at the same
time, because the existing reconnect case asserts only that the mutation was called on a mocked
function and can never see the body, which is why this slipped through.

### D115. The MCP response parser accepts a response belonging to another request (P2 filed, P3 verified)

`services/runner/src/extensions/pi-mcp.ts:315-333`.

Source: Codex, finding 7, which framed it as the round-3 D63 fix being incomplete.

**Executed, not read.** Fed a body containing a result for an id that was not requested and no
result for the id that was, the parser returns the foreign frame. With two foreign answers it returns
the last. The single-frame branch never looks at the id at all, and the bypass is not specific to
event-stream bodies. A positive control, a body carrying both the awaited id and a foreign one,
returns the awaited one, so the matching is real and the probe discriminates. Both non-test callers
were enumerated and neither validates the id afterwards; driving the registration path with a server
answering under a foreign id put that payload in front of the model.

**D63 was correctly closed, and this is a narrower residual.** D63's claim was that the parser joined
every event line into one string and could not read a conforming multi-event response at all. That
is genuinely fixed. The round-3 write-up's closing sentence, that two requests sharing a stream
cannot take each other's replies, is the only part that overreaches: it holds when the awaited id is
present, which is what its test pins, and not when it is absent.

**Why it comes down to P3.** Our client cannot cause this. It sends one message per request with no
batch path and no listening stream, and neither gateway adapter renumbers, so the exposure is to a
buggy or malicious upstream only. Against a malicious upstream it grants nothing: a server that wants
to return a false payload can already return it under the correct id and we would consume it
identically. What it actually costs is against a buggy server, where a crossed frame is served to
the model as this call's output instead of producing a clear error, which is a diagnosability loss
rather than a trust-boundary crossing.

**Fix owed anyway, because it is nearly free, and it is measured.** The check belongs at the calling
layer, where one comparison closes both the loose match and the single-frame bypass while preserving
the documented property that a malformed body names itself. Applied in a scratch state, the full
runner unit suite went from 194 files and 3424 tests green to exactly one failure, in a test whose
fetch mock hardcodes one id on every response. So the loose match is not load-bearing: one lazy mock
is the entirety of what depends on it. Use a string-normalising comparison rather than a strict one,
because a server echoing the id with the wrong JSON type is a real behaviour the loose match rescues
today. Two smaller items in the same edit: the handshake probe numbers its request but does not pass
the number to the parser, and the parser's docstring asserts the opposite, which by this repository's
convention that comments state invariants is itself a defect.

### D116. The CodeRabbit review gate is void for the newest and largest half of this pull request (P3 filed, P2 verified)

`.coderabbit.yaml:74-81`.

Source: Codex, finding 8, filed at P3 with the honest caveat that it had not checked the remote run.
Checked here, and the caveat is what the severity turned on.

The configuration documents a 300-file cap, states that its exclusions reduce the review to 282
files, and instructs a reader to re-measure after any rebase because the count moves with the base.
Running its own documented counting expression gives **342**, at both the candidate and the
integration head. Above the cap.

**The remote history makes it concrete.** The last CodeRabbit review on the pull request was
submitted on 2026-09-16 at 13:37 and states the range it covered, which ends at the round-3 head. The
redesign landed after that. So the 125-file redesign has never been reviewed by CodeRabbit, and the
next run on the current file set will refuse rather than review.

**Why it goes up to P2.** The configuration file states the consequence itself, two lines above the
count it now contradicts: the refusal is reported as a **passing check**. So this is not a cosmetic
drift in a comment. It is a review gate that will report green while reviewing nothing, on the half
of the pull request no automated reviewer has read, and the file's own instruction to re-measure was
not followed. It belongs in the same class as D97 and D121, which is the class this round kept
finding. Fix owed: repartition the passes so each stays under the cap, re-measure, and confirm a run
actually completed before crediting the gate.

### D117. The mobile app hides the MCP row on the default harness (P1)

`web/mobile/src/features/agents/AgentConfigCard.tsx:64`.

Source: the Opus reviewer's sub-tasks reported it; its final file does not carry it, and its "what I
could not verify" section explicitly parks the question, naming "the MCP row's visibility rule" as
one of three mobile parity items it did not finish. Established here by rendering.

```ts
const showMcp = summary.mcps > 0 || Boolean(summary.harness?.toLowerCase().includes("claude"))
```

**Rendered, every branch.** The row is present for the Claude harness with no servers, and for any
harness once a server exists. It is **absent** for the two other harness kinds with no servers, and
absent for any revision carrying no harness field at all. The harness that matters most is the one
that is missing: it is the default in the frontend fallback and in the SDK, so this is the default
agent and not an edge case. The shared desktop card was rendered at the same states as the control
and shows the row every time.

**The gate's premise is false at this commit.** Its comment claims MCP servers are a Claude-harness
feature the other runtimes ignore. All three harnesses declare user MCP server support in
`sdks/python/agenta/sdk/agents/capabilities.py`, at lines 404, 415 and 429, and the third harness's
own comment there says it accepts user HTTP MCP servers like Claude. No other reader in the
repository gates MCP on the harness; the shared configuration editor has no such condition. This is
the only harness gate on MCP anywhere, and it guards a capability that exists.

**What a person sees.** On a phone, on the default agent with no servers yet, the configuration card
lists model, instructions, integrations, skills and permissions, and there is no MCP servers line at
all, no label and no invitation to connect. The same agent on desktop shows the row and an invitation.
They are not fully stranded, because the card's edit affordance still reaches the configuration pane
where the section renders for every harness, so the accurate claim is that there is no way to
discover the capability rather than no way to use it. On the headline surface of an MCP release that
is the consequence that matters. P1, not P0, for exactly that reason.

**Why it survived three rounds, and what the fix must include.**
`web/mobile/tests/unit/agentConfigCardParity.render.test.tsx` is the one test whose job is
desktop-to-mobile row parity, and it pins the Claude harness in both fixtures, at lines 47 and 98,
with comments excusing the gate. It can never see the divergence it exists to catch. The value it
pins is not even a valid harness kind; it passes only because the gate's match is a loose substring.
Fix owed, web8: delete the gate and render the row unconditionally, as the shared card does, in
`web/mobile` only. The shared card and the summary builder are already correct and a change there
would regress desktop. Reparametrise the parity test across all three harness kinds, or the finding
is not closed.

**Delta-checked at `285b49375e`: PART FIXED, still blocking.** The render half is done and done
properly. All six cases now draw the row, the five empty cases render identical card text so the row
list no longer varies with the harness at all, and the gate is deleted rather than widened. The
control was swapped in, and with the pre-fix file restored the same probe shows the row absent for
the two other harness kinds and for the missing-harness case, so the pass means something. Neither
the shared card nor the summary builder was touched anywhere in the fix range. Mobile unit suite: 40
files, 250 tests, all passing.

The test half is not done, and the finding named it as part of the fix because it is the reason this
survived three rounds. The parity suite flipped exactly one fixture, the empty agent, from the
invalid Claude value to the default harness. It was not reparametrised: the suite is still seven
hand-written cases each pinned to one hardcoded harness, the third harness kind is never mounted
anywhere in the file, and the four cases in the first block, including the one whose whole job is to
pin the row list, still run only against a Claude-harness agent. So a gate keyed on the third harness
or on a missing harness field would pass the whole suite. The invalid harness value also survives in
the populated fixture, and it is worth naming why that was not cosmetic: the old gate matched on a
loose substring, so that value passed it exactly as the real one would, which made the fixture
invalid and self-concealing at the same time.

### D118. The mobile run-failure callout dead-ends every failure class but one (P1)

`web/mobile/src/features/chat/TurnRow.tsx:259-269` and
`web/mobile/src/features/chat/continuationRetry.ts:6-10`.

Source: the Opus reviewer's sub-tasks reported it; its final file does not carry it. Established here
by rendering the real component.

The shared callout offers an action only when the host passed the matching handler. The mobile host
passes one, and routes it through a helper that returns it only when the error code is the resumed
continuation. The add-key and sign-in handlers are never passed at all. So the retry handler is
absent for every other retryable class, including a transport failure, where the transport flag is
dutifully passed but has nothing to enable because a transport failure carries no code.

**Rendered, every class.** Mobile offers an action for the resumed continuation and for nothing else.
Desktop offers a retry for a rate-limited run, a lost execution, a failed credential delivery, a
sign-in refreshed elsewhere and a transport failure, offers to add a key when starter credits are
exhausted or the programme is paused, and offers to sign in again when the subscription sign-in is
required. The resumed-continuation row is the positive control: the same harness, the same selector,
found the action there, so the empty cells are real absences and not a harness that cannot see
buttons.

**What a person sees.** On a phone, a rate-limited run, a run whose sandbox was lost, or a dropped
request renders the failure and its reason and nothing else, no button and no link, so the person
retypes the message. Worse for this release specifically: when starter credits run out the phone
shows the reason with no way forward where desktop offers to add a key, and when the subscription
sign-in dies the phone shows the reason where desktop offers to sign in again. Those two are the
classes this release introduces. P1; not P0 because the message can be retyped and the credits path
is reachable through settings if the person thinks to look.

**Fix owed, web8, in `web/mobile` only.** The shared callout is correct and desktop passes all three
handlers with no per-code narrowing. Widen the helper to offer a retry for a transport failure and
for every retryable code on the last turn, matching the desktop call site, and pass the add-key and
sign-in handlers. **Then retire the stale justification, or the fix is blocked by its own test.**
Both the shared component's comment and `web/mobile/tests/unit/runFailureCallout.render.test.tsx:73-79`
assert the omission is deliberate because the mobile app has no provider drawer. That is no longer
true at this commit: the mobile app renders the same providers page from the shared settings package
at its own settings route, and it has a key-entry sheet. The test currently pins the defect as
intended behaviour.

**Delta-checked at `1b62e8e8cb`: PART FIXED, still blocking.** The credential half landed and landed
well. The add-key and sign-in actions now render for the three classes that need them, both route to
a real destination, and the destination was confirmed by clicking rather than by reading: each pushes
the mobile settings route that resolves to the shared providers page, the same page the desktop
drawer opens. The recovery helper correctly yields nothing off a project route, so there is no dead
button. The stale comment was rewritten and the assertion that pinned the omission as deliberate was
deleted outright and replaced by three cases asserting the positive behaviour and the destination.
The shared component was touched only inside its docblock, with no logic line changed, so desktop
cannot have regressed, and its 1113 tests agree.

The retry half is untouched. `web/mobile/src/features/chat/continuationRetry.ts`, which the finding
names as the mechanism of the narrowing, is not in the fix's file list and still returns the handler
only for the resumed-continuation code. Rendered at all eleven classes, six still show no action at
all where desktop shows one: the failed credential delivery, the unavailable starter credits, the
rate-limited run, the lost execution, the sign-in refreshed elsewhere, and a transport failure. The
no-code case correctly still shows nothing, which is the guard against an over-broad fix. The control
confirms the split: reverting the fix removes the three credential actions and leaves the
rate-limited case unchanged in both directions, which is direct evidence the retry half was never
addressed.

A second defect-pinning assertion also survives in the same test file, unmodified, and it covers the
half that is still broken: a case asserting the resumed continuation offers a retry, described in its
own title as "the class it passes a retry for". It is positive-only, so it never checks retry
breadth, which is how the suite stays green with six classes dead-ending. The narrowing is asserted
directly in `web/mobile/tests/unit/continuationRetry.test.ts` as well. Closing this needs both the
gate dropped, passing the rewind handler for any last turn and letting the shared component's own
retryable set do the narrowing as it already does for desktop, and that framing retired.

### D119. A polling helper passes when the record never arrives (P2)

`api/oss/tests/pytest/utils/polling.py:145`, with `:130-134`.

Source: the merge, from the retry sweep. It also corrects the Opus sweep, which states that the API
and SDK pytest trees hold no emptiness-tolerating branch.

The helper ends its loop with `return resp` on exhaustion, where its sibling in the same module
raises a timeout. So a caller that discards the return value proceeds as though the wait succeeded,
and a record that never arrives is indistinguishable from one that arrived late. The condition check
compounds it by swallowing every exception as "not arrived yet", so a payload whose shape changed,
and whose key the condition can no longer read, is reclassified as pending rather than reported.

**Verified** by reading the helper and tracing its call sites: 26 direct sites across 8 files, about
70 tests, plus 13 more through an evaluations helper. One call site is self-satisfying by inspection:
a tracing case waits for a count of one, discards the result, deletes, asserts only the accepted
status, then waits for a count of zero, which its first read satisfies if the trace never existed. If
ingest never persisted anything that case passes end to end and proves nothing about deletion. The
same shape appears at five more sites. Reasoned rather than driven, and labelled so: these need a
live stack and minted credentials.

**Deferred to issue 6911.** Not this release's code, and the fix is one change to the helper, raising
on exhaustion as its sibling does and narrowing the bare exception, plus capturing the return at the
sites that discard it. It is recorded here because it is in the suite this release gates on.

### D120. Every Playwright test is retried once on CI, and a flaky pass reads as green (P2)

`web/tests/playwright.config.ts:45`.

Source: the merge. It corrects the Opus sweep's statement that there is no global retry, which is the
premise its whole sweep rests on: the sweep concludes that every allowance it lists is a deliberate
local one, and that conclusion is weaker than it reads.

```ts
    retries: process.env.CI ? 1 : process.env.RETRIES ? parseInt(process.env.RETRIES) : 0,
```

**Verified** by reading the config, and refined by running against it. The opt-out is read ONLY when
the continuous-integration variable is unset, so setting the retry count to zero does not disable a
retry on CI: the variable has to be unset as well. Anyone trying to reproduce a flake with retries off
needs both, and the live rerun in this round had to do exactly that. The consequence is specific to this release's defect family: a
defect whose symptom is intermittent, which is what both D59 and D94 were, fails once, passes on the
retry, and Playwright reports the run green with a flaky annotation. A green run is what the gate
reads, and nothing reads the flaky list. Read together with D96, a first-load failure of the MCP
configuration panel is absorbed twice before anything is reported.

**Deferred to issue 6912.** The retry itself is reasonable; what is not is that the annotation
decorates the run rather than gating it. **One action is worth taking inside this release window
even though the fix is deferred:** read the flaky list from the last full CI run on this branch. A
defect of this family is far likelier to appear there than in the failures.

### D121. The agent chat elicitation acceptance suite never runs (P2)

`web/oss/tests/playwright/acceptance/agent-chat/elicitation.spec.ts:8`.

Source: the merge, from the retry sweep. The suite is registered with a skipped describe block, so it
reports green and covers nothing. The stated cause is precise and credible: the seed helper writes a
workflow without the agent flag, so the app never resolves as an agent and every case times out on
the playground URL.

**Verified** by reading the registration and its comment. This is recorded as a finding rather than
left as an honest comment for the same reason D97 and D116 are findings: a skipped describe block is
indistinguishable from passing coverage in the run summary. It also changes how D122's third
allowance should be read, because six of the seven cases depending on that fixture are inside this
skipped block, so the fixture's retry loop currently protects one case rather than seven. Elicitation
is an interaction a person drives by hand, which makes browser coverage the only coverage there.
**Deferred to issue 6913.**

### D122. Three further retry allowances in the MCP acceptance suites, and one added by the fix in flight (P2)

Source: the merge, from the retry sweep. D96 is the fourth and is recorded separately. The sweep found
eleven allowances in total; the ones outside the MCP path and outside the pytest tree are listed in
issue 6916 and in the Opus file's own sweep, and the two trees that came back genuinely empty are
recorded below.

**1. The saved-configuration read falls back to an older revision.**
`acceptance/playground/mcp-agent-config.ts:289-296`. This is the terminal assertion of all three
cases in the file. A newest revision whose MCP list came back empty is silently replaced by an older
revision that still has one, so an agent whose saved configuration was wiped by a later commit would
pass on the value of a superseded revision, which is the regression shape the file's own header
claims to guard. Not load-bearing today, because each case creates a fresh app with an empty agent so
nothing earlier carries items; it becomes load-bearing exactly when a regression drops them. Two
further holes in the same helper collapse a server error into an empty list, so a broken query
endpoint is indistinguishable from "not saved yet" for the whole poll.

**2. The shared navigate helper retries an aborted navigation up to four times.**
`acceptance/utils/mcpConnections.ts:180-203`. This is the entry point of both MCP suites, ten tests
transitively, which makes it the most widely shared allowance in scope. Its aborted-navigation arm
hides a page that navigates itself out from under a requested navigation, and its own comment names
that mechanism, an agent's playground opening its session. That is the same route-stealing
asynchrony D94 turned on. Its transport arm is a documented external flake and should stay.

**3. The agent playground fixture reloads up to three times.**
`acceptance/agent-chat/tests.ts:170-173`. Absorbs any first-load failure of the chat surface. Its
stated cause, read-your-writes lag against a revision committed moments earlier by direct API calls,
is real and is the most defensible justification in the set, but the loop does not distinguish it
from any other cause. Its comment also justifies preferring a scripted reload on the ground that the
product's own recovery button is dead, and **that claim is false**: the button is wired to a reload
at `web/oss/src/components/Playground/Components/MainLayout/index.tsx:331`, and was wired at the base
of this release too, so the justification is void. Not a product defect; a stale reason for an
allowance. See D121 for how many cases this fixture currently protects.

**4. The fix in flight adds one.** On `wip/design-web7`, the OAuth case in
`acceptance/settings/mcp-connect.ts` replaces an assertion on the consent page with
`await popup.waitForEvent("close", {timeout: 60000}).catch(() => undefined)`. The stated reason is
sound and specific, because the callback page closes itself on a timer shorter than the round trip,
so the sentence is usually gone before a query reaches it. But the shape is a catch that swallows a
missing result, and paired with the rewritten journey helper, which drops its own connected
assertion and now only waits for the dialog to disappear, the consent popup and the journey's success
are both no longer asserted. The case is not hollow, because the row reading Connected still
survives, but two presence assertions became one in the single flow only a browser can prove. This
one is routed back to web7 rather than deferred: assert on something durable before the popup closes,
such as the callback address or a posted message.

**Verified**: all four read at the relevant revision, and the two branch states diffed separately.
The removal experiments were **not** run, and that is labelled rather than implied: the only live
stack serves a different branch and belongs to another agent's QA run, so a removal there would have
answered the wrong question. **Deferred to issue 6916** for items 1 to 3; item 4 is owed by web7.

**Two trees came back genuinely empty, and that is worth recording.** The React Testing Library
suites across five packages, 367 files, hold no allowance of this class; the one candidate was tested
by replacing a retrying query with a synchronous one and it failed, because it covers a real dynamic
import. The runner unit tree holds none either: both its wait helpers hard-fail, there is no retrying
assertion wrapper anywhere, its fake-clock helpers drive time rather than retrying, and every long
real-clock sleep precedes a negative assertion, which is the correct construction. The gateway
acceptance suite is also clean, and it deliberately fails rather than skips when the gateway plane is
off, with a comment saying why.

### D123. The truthful-preset fix turns a server's own read-only claim into an allow rule, with nobody in the loop (P2)

`web/packages/agenta-entity-ui/src/mcpEndpoint/McpPermissionDrawer.tsx`, the `readOnlyToolNames`
derivation, and `web/packages/agenta-entities/src/mcpEndpoint/core/toolCatalog.ts`.

Source: the delta-check of D113's fix. Created by the fix, not present in the candidate.

Decision 45(b) asks the preset to allow, by name, every tool the server marks read-only. The fix does
exactly that, and the signal it reads is genuine: the read-only hint is the upstream server's own
annotation, carried intact because the browser speaks the protocol directly through the gateway's
raw-relay route rather than through a model that projects fields. The consequence is the part nobody
wrote down. The hint is a third-party server's self-description, and the preset now converts it into
an allow rule without a person seeing which tools were named.

**Rendered from the fix**, against a server advertising a destructive tool with the read-only hint
set true:

```
{"tools":{"mode":"all"},
 "tool_permissions":{"get_issue":"allow","delete_everything":"allow"},
 "permission":"ask","new_tool_permission":"ask"}
```

That tool then runs unapproved. This is not the fix inventing an inference, and it is what decision
45 asks for in as many words; the tool catalogue's own header also records that the hint is advice
rather than a guarantee. But it is new, because before the fix the preset wrote nothing and so could
auto-allow nothing, and it is the one place in the product where a remote server's claim about itself
becomes a permission grant with no human step.

**Why P2 rather than P1.** It requires a server that misannotates, the person did choose a preset
whose whole promise is that read-only tools run automatically, and the alternative reading, refusing
to trust the only read-only signal that exists, would leave the preset unable to do anything at all.
So this is a design question the fix surfaced rather than a defect in it. Fix owed, and the cheap
form is to show the named tools in the drawer when the preset is picked, so the grant is visible at
the moment it is made. Worth a designer and a security line before the release rather than after.

### D124. The same preset makes a promise it cannot keep against a server that annotates nothing (P3)

Same files. Source: the delta-check of D113's fix.

**Rendered from the fix**, against a server whose tools carry no annotations at all:

```
{"tools":{"mode":"all"},"permission":"ask","new_tool_permission":"ask"}
```

That is fail-closed, which is the right direction: every tool asks. But nothing runs automatically,
while the preset's help line says read-only tools do, so on such a server the preset is the "Always
ask" preset with extra steps and a help line that does not describe it.

**This matters for QA specifically, not just for copy.** Both the deployable mock and the Agenta
builtin bridge emit tools carrying only a name, a description and an input schema, with no
annotations. So anyone exercising this preset against the mock will see it name no tools and change
nothing, and the failure mode looks like the defect D113 just fixed. Anyone verifying D113's fix
against the mock alone would reasonably conclude it had not worked. Fix owed: either qualify the help
line when the loaded tool list carries no read-only annotation, or say in the drawer that this server
declares none.

### D125. A snake-case policy reaching the runner unconverted would silently fall back to the server permission (P3, latent)

`WireMcpServer.policy` in the SDK, typed as a free-form mapping, against
`services/runner/src/mcp-permission.ts`.

Source: the delta-check of D113's fix, from the reader pass it prompted.

The runner's resolver reads the camel-case field names the SDK's wire conversion emits. The wire type
for a server's policy is a free-form mapping, so a snake-case policy that reached the runner without
passing through that conversion would carry a per-tool table the resolver does not see, and the
resolver would fall back to the server-level permission. That is precisely the direction the D88
review closed, arriving by a different door.

**Verified** by feeding the snake-case form to the normalizer and watching the table disappear.
Nothing on the current path does this: every policy on the wire goes through the conversion. It is
recorded because the type permits it and nothing guards it, and because D113's fix makes the per-tool
table load-bearing for a preset a person can pick, where before it was written only by hand. The
guard is a typed wire model or a rejection of unknown key shapes at intake. **Deferred to issue
6917.**

### D126. The touch-target expansion falls two pixels short on five of six controls, and the helper's own height function encodes the same error (P2)

`web/packages/agenta-ui/src/components/ui/touch-target.ts:70`, and the six call sites the fix
`f4388979a0` applied it to.

Source: the delta-check of the mobile audit's touch-target fix. The fix is right in mechanism and
wrong in arithmetic, and it is the arithmetic that decides whether a thumb lands.

**Measured in a real browser at phone width, not asserted from a class.** The expansion is a
positioned pseudo-element, and an inset on one resolves against its containing block's padding box.
The shared button's base class list carries a transparent one-pixel border on every side, so the
expansion starts one pixel inside each edge and the box comes out two pixels short. Only the table's
row-actions control escapes, because it sets its border to zero.

| control | chrome height | border per side | inset per side | hit box | reaches 44 |
| --- | --- | --- | --- | --- | --- |
| table row-actions kebab | 24 | 0 | 10 | 44 tall, 38 wide | tall yes, wide no |
| registry status-cell Reconnect | 24 | 1 | 10 | 42 | no |
| response panel toggle | 24 | 1 | 10 | 42 | no |
| connection row Add | 28 | 1 | 8 | 42 | no |
| connection row Reconnect | 28 | 1 | 8 | 42 | no |
| notice card Reconnect | 28 | 1 | 8 | 42 | no |

Hit testing agrees to the pixel, sampled outward one pixel at a time: on the kebab a point ten pixels
above the chrome resolves to the control and eleven does not; on every button nine resolves and ten
does not, or seven resolves and eight does not. A real mouse click through the browser's own input
pipeline fired the control's handler in eleven of twelve edge cases, so the pseudo-element is a
genuine hit area rather than a painted no-op. The mechanism works; the size is wrong.

**Two problems the fix's own claim does not cover.** The horizontal reach is four pixels per side, so
the kebab is 38 pixels wide, under the minimum on that axis, and the minimum is a box rather than a
height. And on the registry table the wrapper clips the right-hand expansion, so the kebab measures
about 34 pixels wide there, on the control that is the only route to five actions.

**Why this survived its own tests, which is the part worth keeping.** The helper's companion function
computes the total as the height class plus twice the inset and ignores the border, so it encodes the
same wrong arithmetic. Five site tests and three shared tests assert that function returns 44 and
therefore pass against a 42-pixel reality. The tests confirm the class string, not the hit area.
Verified emitting identically in both app toolchains, which was the other half of the claim and does
hold.

**Corroborated independently by QA**, measuring the served build rather than the components, and
reporting the registry row-actions control at 30 by 24, the drawer's Close and Add at 28, and the
show-more control at 24. Those numbers are the visible chrome rather than the expanded hit box, which
is why they are smaller than mine; the two measurements agree that the controls are under the floor
and disagree only about how much of the expansion counts. Both are worth keeping in the record,
because a fix that satisfies one and not the other has not finished.

**Two corrections to this entry, both against my own numbers.**

*The prescription was wrong by a pixel a side.* I wrote that charging the border meant twelve pixels
on a 24-pixel control and ten on a 28. It does not. The shared button is `box-border` with a
transparent one-pixel border, so the height class is the border box and the pseudo-element insets
from a padding box two pixels smaller. The inset that reaches the minimum is `(44 - size) / 2 +
border`, giving eleven and nine. My numbers land at 46 and would push each control two pixels into
the neighbouring row's rhythm. The fix lane's arithmetic is the right one. Worth noting that the
helper's own comments encode the same error I made, adding to the border box, which is why the
height reader agreed with the wrong values and the tests confirmed the class rather than the hit
area.

*The 34-pixel width was a harness artefact, and I am retracting it.* Measured in the built Storybook
across eight viewport widths, the kebab's expanded box never crosses the scrolling wrapper's content
edge. The structural floor is 10.5 pixels of clearance, and it is a floor rather than a sample: the
actions column is a fixed 56-pixel column, the cell's padding is 8, and the 30-pixel control is a
block-level flex box that sits left in the 40-pixel content box, so 10 pixels of slack face a
7-pixel reach. Forced by replacing every connection name with a 140-character string, which pushes
every flexible column to its floor, the clearance fell from 22.6 to 10.5 and stopped there. The fix
lane's 17.5 is real but story-specific. My figure came from a synthetic page whose table width was
not the registry's, and the agent that took it has since found the precise mechanism and withdrawn
it: its probe scrolled the control into view first, which parked a 986-pixel table inside a
380-pixel scroller within half a pixel of its right extreme, and at that one scroll offset the
four-pixel right-hand reach falls outside the scroll container. Move the scroll four pixels and it
measures 38 again. Worth keeping because it is a general trap: scrolling an element into view before
hit-testing it can place it against a clipping edge that nothing in the product puts it against. The horizontal question is closed, and the entry keeps the
retraction rather than deleting the number, because the number was quoted to a fix lane.

*What the original text said:* The fix lane measured 17.5 pixels of
clearance to the wrapper in the built Storybook at both widths, and could not reproduce any clipping.
That number came from a synthetic page built from the real component DOM and each app's compiled
stylesheet, not from Storybook and not from the running app. The 42 and the 38 are properties of the
control and its class and do not depend on the page's layout; the 34 is a statement about how wide
the table was on that page, and the harness did not reproduce the registry's real width constraint
deliberately. It stands open under this finding until it is measured in the app at phone width with
realistic content, where a long server name can push the actions cell against the wrapper. If it
cannot be reproduced there it comes out of the record as a harness artefact rather than a defect.

**Decision 55** records that the kebab's vertical reach is bounded by the 41-pixel row pitch, and it
is flagged for the designer. The measured numbers belong with it, because the pitch alone understates
what a person experiences: the box is 44 on a 41-pixel pitch, so adjacent boxes overlap by three
pixels, and the lower row wins the whole band because its pseudo-element comes later in document
order at the same stacking level. About 1.5 pixels of a row's own visible area therefore presses the
next row's menu, and in the last row the scrolling wrapper clips the box to 42. The designer's
question is not whether 44 is reached but which row should win the seam. That is the real constraint behind this control: the vertical minimum
cannot be met there without either changing the row rhythm or accepting overlap between adjacent
rows' hit areas, which is a design question rather than an arithmetic one.

**Delta-checked at `1edc4e0ee0`, on the lane rather than the merged head: PART CLOSED.** The
mechanism is fixed and confirmed at the rendered hit area, not in the arithmetic: all six controls
now compute a pseudo-element box of exactly 44 pixels on the short axis, generated, positioned, and
hit-testable, with the browser agreeing with the formula the fix uses. Both toolchains emit the new
arbitrary-value classes, and for the older toolchain the browser measurement is itself the proof,
because a class that failed to emit would have measured 22 rather than 44.

**Four of the six deliver 44 reachable pixels; two do not, and both live in the data table.** The
row-actions kebab has a 44-pixel box on a 41-pixel row pitch, so adjacent boxes overlap by three
pixels and the lower row wins the band, taking about 1.5 pixels of the upper row's own visible area.
Its effective vertical span is the pitch, and in the last row the table's scrolling wrapper clips it
to 42. The registry's status-cell control is worse and is D144. Both are pre-existing rather than
introduced here, confirmed by swapping the previous classes back in and re-measuring, so neither
holds up this commit.

**Mutation count.** Fourteen were run here, every one killing at least one case, including the two
this check asked for: reverting the reader's border subtraction kills 11 across four packages, and
reverting the helper's charge kills 11. The commit claims twelve and enumerates eleven, which is a
bookkeeping slip rather than a substantive one. The coordinated revert is D145 and is the result
worth acting on.

**Fix owed, web10.** Charge the border: drop the transparent border on the expanded controls, or key
the expansion off the padding box, which for this scale means twelve pixels on a 24-pixel control and
ten on a 28-pixel one. Widen the horizontal inset, and relax the table wrapper's clipping. Then make
the height function subtract the computed border, or the next round's tests will pass on a 42-pixel
target again.

### D127. The connect sheet's name field points at a hint that is absent on four of its screens (P3)

`web/packages/agenta-entity-ui/src/mcpEndpoint/McpConnectJourney.tsx`, the name input.

Source: the delta-check of D106's fix, found by the same probe that closed it. Recorded in round 4's
bundled nits as affecting two screens; measured here at four, and not closed by the D106 fix.

The name input carries its description reference unconditionally, while the hint bearing that id
renders only on the OAuth screen and only when a prefix exists. So on the no-authentication screen,
the key screen, the refused-key screen, and the OAuth screen with no prefix, the reference resolves
to nothing. The sharpest case is an empty name on the OAuth screen, where the field carries two
references, one generated by the shared field component and resolving to the reason, and one
hand-written and resolving to nothing.

Milder than D106 was, because the reason does still reach the reader through the generated id. It is
recorded because it is the identical defect in the same file, and because it is exactly what
hand-managed ids produce: the D106 fix closed the two references it was filed for and left this one,
having kept the hand-managed pattern rather than moving to the shared component. Fix owed, web7.

### D128. The integration layer can now reach the right deployment, and can still reach a wrong one (P2)

`api/oss/tests/pytest/utils/postgres.py`, after the fix `70f9890b55`.

Source: the delta-check of D97's fix. The first half of D97 is closed and reproduced. This is the
second half, which the fix does not address, and it is the dangerous one.

**Proven live, read-only, on this box.** The fix makes the helper use the published port, so the
layer went from 8 passed and 93 skipped to 101 passed and 0 skipped, which I reproduced myself. But
nothing checks the identity of what answers. The address is still a port that may be supplied or
guessed, and the resolver accepts any address that opens a connection. Pointed at a different
same-licence deployment's published port, it connected, and the database it reached carried the same
name as the deployment under test, so the guard that is supposed to catch this saw nothing wrong.

So a stale or wrong port, or an unset one on a box where a same-licence stack holds the default,
still sends the seeding cases into another deployment's database. What stands between the suite and
that today is the database name differing across licences, which is exactly the argument D97 recorded
as not holding.

**What the fix did genuinely improve, and it is worth saying:** an unreachable database now fails
loudly and names both addresses it tried, instead of skipping green. That is the half that turned a
silent 93-case skip into a visible failure, and it is the more common failure mode. Fix owed: an
identity check on the deployment, not only a reachability check.

**One runbook precondition, not a defect.** Running the layer needs two Redis addresses exported by
hand, because the stack's environment file declares neither and the code defaults are in-network
names. Worth writing into the runbook, since the layer now runs where it used to skip.

### D129. Two of the three golden-fixture readers skip silently if the fixture moves (P3)

`sdks/python/oss/tests/pytest/unit/agents/mcp/test_mcp_policy_ladder_fixture.py` and
`web/packages/agenta-entities/tests/unit/mcp-policy-ladder.test.ts`, against
`services/runner/tests/fixtures/mcp-policy-ladder.json`.

Source: the delta-check of `0378bf319c`, which is otherwise the most valuable commit in the batch.
The fixture is real, holds the seven ladder cases and the two senders that omit the floor as claimed,
and all three readers genuinely load the file rather than restating its cases. The mutation was run on
all three readers and each one fails, so the cross-language guard bites in every language. That is
confirmed, not assumed.

The soft spot is how two of them behave when the file is not found: the Python reader skips, and the
web reader is conditionally skipped on the fixture being absent. So if the file moves, or a package is
extracted, two of the three guards disappear without failing anything. That is the same silent-skip
shape as D97 and D121, in the mechanism built to stop the permission ladder drifting apart. Fix owed:
fail rather than skip when the fixture cannot be found.

### D130. The probe carries the challenge's status to the client and no surface renders it (P3)

`web/packages/agenta-entities/src/mcpEndpoint/core/types.ts:121`.

Source: the delta-check of the decision 43 work. The scheme half is closed and is genuinely the
server's: it is read off the upstream response's authenticate header, split to scheme tokens with the
case as sent, and carried to the rendered field, where it reaches the reader as the clause telling
them what to type. No invented example anywhere in the path, which was the question worth asking.

The status half is carried and then dropped. The field appears in the type, in fixtures and in
stories, and no component reads it. The status code the reader does see on the refused-key screen
comes from the live refusal message instead, which is also server-sourced, so nothing is fabricated
and no one is misled. It is recorded because decision 43 names the status line as part of what the
probe returns for this screen, and a field carried to the client and read by nobody is the shape that
produced this round's D108. **Deferred to issue 6915**, which already tracks the probe's unrendered
surface.

### D131. Reconnect cannot renew a revoked login, from any of its entry points (P1)

`web/packages/agenta-entities/src/mcpEndpoint/core/connectJourney.ts:236` and `:264`, against
`web/packages/agenta-entity-ui/src/mcpEndpoint/McpConnectJourney.tsx:374`, `:431`, `:844`, `:898`.

Source: QA round 6c, filed as its own D-R6C-4 and confirmed there with network evidence. Reproduced
here on the currently served head `fac66e01b8`, and its blast radius settled, which QA had left open
as the first thing to check.

**What happens.** The row menu's Reconnect opens a sheet titled "Reconnect MCP server" in which
Connect and Cancel are both disabled and stay disabled. There is no way to finish and no way out but
the close control or the escape key. The probe result card saying the server is reachable arrives in
between eleven and twenty-one milliseconds, because it is rendered from stored state rather than
fetched, and both buttons are still dead at one, five, twelve and twenty seconds. No request is in
flight: the only gateway traffic in the sampled window is the permission drawer's own tool read being
refused, which is the expired login doing what it should. Two buttons dead together already ruled out
a validation rule, because a validation rule would not disable Cancel. The detail QA's capture did
not record and which settles it: Connect also carries a busy state, so the sheet believes a request
is in flight when none is.

**The blast radius, all three driven rather than traced.** The settings row menu, the permission
drawer's expired-login banner, and the chat's reconnect notice all open the identical sheet in the
identical dead state. QA could not land the chat one, because the transcript scrolls and an ordinary
click never passes the stability check; dispatching the press on the element itself lands it. It is
wider than three: six components mount the sheet and five pass a reconnect, so the agent's own
connect tool, the add-server drawer's per-row Reconnect and the view-tools banner reach it too. One
fix repairs all of them, because they funnel into one component in one state.

**The mechanism, and it is a closed loop.** The sealed concept is not involved: sealing keys on the
saving status, and the stuck status is `discovering_scopes`, which is why the close control still
works. A reconnect enters at `discovering_scopes`; that status is a member of the busy set; the busy
flag disables Cancel directly and makes the confirm guard return false; and the only thing that
advances the status is an effect gated on a consent request that is raised only by pressing the
disabled Connect. So for a reconnect the one status is both the screen waiting for a press and the
state that forbids it. The component's own comment states the intent correctly, that a reconnect
enters here with nobody having pressed anything and waits for the press, which is exactly what the
shared status prevents.

**Not the regression it looked like.** The commit that removed the success screen took four
post-save statuses, three events and the tool-loading actions out of the machine, and the obvious
suspicion was that the reconnect path depended on one of them. It does not; that commit left
`discovering_scopes` alone. The regression is the earlier redraw of the sheet into the spec's six
screens, which introduced all three ingredients in one commit: the consent gate on the effect,
Cancel disabled by the busy flag, and the busy rule in the confirm guard. Its parent drove scope
discovery unconditionally, so before the redraw a reconnect read its scopes at once and moved on. The
gate was added for a good reason, because a consent window will not open after a promise resolves on
one browser engine and so must open inside the press, and it did not notice that the status it gated
is also a reconnect's front door.

**Why the suite missed it.** The reconnect case exercises the hook only and correctly asserts the
status. Nobody ever rendered the sheet in that state.

**Confirmed live, which was this finding's only unproven half.** Driven on the final candidate at both
widths and from three entry points: both actions enable in about 450 milliseconds where they
previously stayed dead past forty seconds, discovery fires on the press, and the renewal completes so
the row returns to connected. The acceptance pair ran 11 of 11 alongside it. One thing QA nearly filed
as a defect and correctly withdrew is worth keeping: the sheet makes no request at all when it opens,
which is by design, because a reconnect shows what it will do and waits for the press.

**The fix, and the shipped machine expresses it.** No new status, event or reducer change is needed,
because the distinction already exists in the component as the consent request, consumed three lines
away. Deriving the busy flag so that it excludes a reconnect that is still awaiting its first press
brings both buttons alive and leaves the consent window opening inside the press. Verified in a
worktree: unpatched, an OAuth reconnect renders both buttons disabled and scope discovery is never
called, while a key reconnect's Cancel is live, which is the contrast case; patched, the pair comes
alive and all fourteen MCP unit files pass. Owner web7. **This is the release's only P1.**

### D132. One banner's Reconnect opens a blank connect sheet, so it would make a second connection rather than renew the first (P2)

`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/McpServerFormView.tsx:203`.

Source: the merge, found while enumerating D131's entry points. It is the one caller that does not
reach D131's dead end, and it does not reach it because it is wrong in a different way: it mounts the
journey without a reconnect, so its banner opens a blank "Connect MCP server" at address entry rather
than a reconnect of the connection whose login expired.

A person whose login expired presses Reconnect on this surface, is asked for a server address, and if
they supply one they create a second connection to the same server instead of renewing the first.
That leaves the original row still expired and every agent pointing at it still without tools, plus a
duplicate the project did not ask for.

Not found by QA, because D131 makes the other five entry points fail first and this one silently
looks like it works. Fix owed, web7, and it should land with D131 so that every entry point is
checked at once rather than five of six.

### D133. The key screen drops the status code the spec puts in it, and my earlier check of this closed it against a fixture (P2)

`web/packages/agenta-entity-ui/src/mcpEndpoint/McpConnectJourney.tsx:762-765`, against
`web/packages/agenta-entities/src/mcpEndpoint/api/api.ts:155-162`.

Sources: QA round 6c as its own finding, and D130 from this round's delta-check, which this entry
supersedes because the two are one defect seen from opposite ends.

**Recorded in full because of how it nearly closed wrongly.** A delta-check of the key-screen copy
earlier in this round reported the sentence as containing the status code, quoting a render. Live QA
driving a real server on the deployed build got a sentence with no code and protocol vocabulary in
the middle. Both observations were accurate. The rendered one was fed a fixture: the string carrying
the code exists in this repository only in stories and test cases, hand-set as the error. The live
middle clause is whatever the refusal function returns for what the call actually produced.

| what the spec asks for | what a person sees against a real 401 |
| --- | --- |
| The server rejected this key (401). Check the header the server expects, and the scheme, or pick another secret. | The server rejected this key. The server did not answer initialize. Check the header the server expects, or pick another secret. |

**Why the live path cannot produce the code.** The sentence is assembled from a constant headline, the
error, and advice. The middle clause is entirely the error, and the function producing it can return
four things: the server's own refusal text verbatim, a protocol error message verbatim, one of three
messages our own client raises, or a fallback naming the method that went unanswered. None of them
formats a number, by design, and the refusal module says so in its own header: it returns what the
server wrote or nothing, and invents no copy. For a key-authenticated connection the gateway
deliberately does not author a refusal, because a 401 from an API-key connection is that server's own
answer about that server's own credential, so the upstream's raw body is relayed, the refusal function
finds nothing it recognises in it, and the fallback fires. Rendered with a probe that genuinely
recorded a 401, the screen still shows no code, because nothing reads the recorded status. That is
D130, and it is why the two findings are one.

**Fix in flight and stranded.** A commit on the web7 lane puts the code into the headline, reads the
recorded challenge status, and deletes the relayed middle clause. It is not in the served head and
not on any lane I verified. It documents its own residual limit, recorded as decision 56: a reconnect
never probes, so the code will not appear on a reconnect even after the fix. Confirmed that the
backend supplies the input, because a server answering the anonymous handshake with a 401 or 403 is
recorded with its status and routed to the key screen.

### D134. The key screen offers an action the spec does not draw (P2, decision owed)

Source: QA round 6c. Both key screens carry a "Connect without authentication" button the spec does
not draw. It follows from the journey's own reasoning, which the code states plainly: an inconclusive
probe means the check could not tell, not that a key is required, so the screen offers the other
answer. That is defensible, and it is also an invitation to create a connection that cannot work, one
press from a screen that has just said the server rejected a key. A designer's call rather than a
code change, and it is recorded as a decision owed rather than a fix owed.

### D135. The field that takes the credential has no accessible name (P2)

Source: QA round 6c. In the create-a-secret step inside the sheet, every input carries a name or a
placeholder except the one that takes the credential value. Its absence is how QA's own harness
identifies it, which is the clearest possible statement of the problem: a screen reader cannot
announce the one field in this flow that must not be typed into by mistake. Fix owed, web7. It joins
the accessibility group D104, D106 and D107, and like them the right fix is to stop bypassing the
shared field component rather than to hand-write one more attribute.

### D136. While the tool list is in flight the preset trigger asserts a safety claim it cannot yet check (P3)

`web/packages/agenta-entities/src/mcpEndpoint/core/policyAdapter.ts:188`.

Source: the closing delta-check, graded rather than left open at the coordinator's request.

The predicate deciding whether a saved policy reads back as "Ask for write and delete" returns true
as soon as the tool list is absent, after checking only that every named entry is an allow. It never
checks which tools are named. The stated reason is real: reading it honestly would flash "Custom" and
then correct itself once the list arrives.

**The adversarial case exists and was rendered.** A saved policy that is shape-identical to what the
preset writes but which names the server's most destructive tool instead of its read-only set reads
back, while the list is in flight, as "Ask for write and delete", whose help line promises that
read-only tools run automatically. Once the list lands the trigger corrects to "Custom, one
override". So during that window the screen asserts a safety property the code cannot know, for a
policy that in fact allows a destructive tool unapproved, and the per-tool rows that would contradict
it are exactly what has not rendered yet.

The trade is backwards. Flashing "Custom" and settling on the truth is a cosmetic flicker; flashing
the safety claim and settling on "Custom" is not. The honest third state is to render the trigger as
pending while the list is absent, which the preset option already does for this same reason. P3
because it needs a hand-saved policy and a slow list, and it self-corrects. Fix owed, web8.

### D137. The grant is shown by name, and not shown to be the server's own claim (P3)

Source: the closing delta-check of D123's fix, under decision 52.

Decision 52 accepted D123 on condition the grant is made visible. It is, and well: after the preset is
picked, the drawer names each tool it just allowed, with its own description beside it, in the same
drawer directly under the preset trigger, flipping the instant the preset is picked. That is the
names rather than a count, and at the point of the grant rather than in a toast, which is the bar the
finding asked for. The payload is unchanged by the disclosure commit, confirmed by running the
adapter.

What it does not show is the thing decision 52 exists to surface. Rendered against a server
advertising a destructive tool with the read-only hint set true, the tool is named and its own
description sits beside the allow, so an attentive reader would catch it. But the group header states
"Read-only" and "runs automatically" as Agenta's own assertion, and nothing on screen says that
classification came from the server's self-description and was not verified. One clause attaching the
claim to its source closes it, in the group header or the preset's help line.

**One fact that improves the picture, found when this was rechecked.** The disclosure already exists
in the user documentation, in the user's own words, describing the preset as running the tools the
server marks read-only. So the remainder is discharged where a person reads about the feature and open
only on the screen where they act on it, which is exactly the designer's scope and narrows what is
owed.

**Deferred to the designer as decision 57, and this is the right call rather than a punt.** The fix
lane correctly declined to invent the wording: neither the decision that accepted this finding, nor
the specification digest, nor the product anywhere carries user-facing words for "this classification
is the server's own claim and was not verified". Writing them here would be inventing copy on a
permissions surface, which is exactly what the no-invented-copy rule exists to prevent. The decision
is to ship without the clause and have the designer supply it, flagged for the designer and for the
security reviewer, since it is a provenance statement on a screen that grants permissions. Added to
the designer-flagged list. That is a copy change
rather than a mechanism change. What would not close it is a count alone, or moving the disclosure
into a tooltip or below the fold on a server with many tools, because then the group header is the
only signal above the fold and it is the part that currently says the wrong thing.

### D138. The chat reconnect notice at phone width, withdrawn (P2 as filed)

Source: QA round 6c, filed as a candidate regression against the previous round. **Withdrawn, not
reproduced.** QA's rerun on the later head passes at both widths. Recorded rather than deleted so
that the earlier round's report is not read as an open defect.

### D139. After a reload, an approved gate re-submits its tool output and the approval dies (P2)

`web/packages/agenta-chat/src/model/interactionAnswer.ts:92`, propagated by
`serverOwnedApproval.ts:15-19`, awaited without a catch at `useAgentConversation.ts:923-969`.

Source: web7's diagnosis while investigating D138. Owner web8.

Reloading after an approved gate makes the transcript re-submit the tool output. The answer path
throws because there is no pending row to answer, the rejection is propagated, and the awaiting
caller has no catch. In development this surfaces as the framework's error overlay reading "This
approval is no longer pending. Refresh and retry." In production there is no overlay, so the
approval simply dies silently and the person is left with a gate that will not move. The mobile dock
already handles this case in its own approval actions, so the shape of the fix exists in the
codebase.

**It is also the real cause of D138.** QA filed a chat reconnect notice as missing at phone width and
then could not reproduce it, and attributed the difference to the responsive work. It was this race
falling either way. Recorded here so the withdrawal in D138 points at a defect rather than at
nothing.

### D140. A stored panel preference can hide the chat column below the phone breakpoint (P2, latent)

`SessionWorkspace.tsx:294`.

Source: web7's diagnosis. Owner web8. The chat column is hidden below the 768 pixel breakpoint when
an origin-wide stored key for the collapsed config panel reads false, and desktop paths set that key.
So a person who used the desktop layout and later opens the same origin at phone width can find the
chat column gone. Latent rather than reported, because it needs that key to have been written first.
Browser storage is per origin and survives, which is exactly what makes a desktop-set preference
reach a phone-width layout.

### D141. The sessions integration layer has no identity check, and installs its address globally (P2)

`api/oss/tests/pytest/integration/sessions/conftest.py:10`.

Source: the delta-check of D128's fix, which is closed. This is the same defect one directory over,
and it is worth its own entry because closing D128 could otherwise be read as closing the class.

D128 was that the integration layer accepted any database that opened a connection, so a stale port
sent the seeding cases into another deployment's database. The fix mints an ephemeral account through
the API under test and requires the dialled database to carry it, which I reproduced in both
directions. The sessions layer calls the older helper, which carries no identity check, and that
helper installs the resolved address onto the shared environment object. So a stale port does not
skip that layer; it runs it against the wrong database, and it changes the address other code reads.

**Delta-checked at `c0334951d9`, on the lane: the address half is closed, the identity half is NOT,
and this entry stays open.** The commit's own claim reproduces exactly, 17 passed and 1 failed with
no address exported, the single failure being the case issue 6920 describes, confirmed against the
issue's text rather than by matching a name. Its diagnosis also holds under independent check, and it
is a better diagnosis than anyone expected: the seven failures were the analytics engine reading a
tracing database address that nothing rewrote, which is neither the ordering nor the Redis
explanation that had been assumed. The partition is exact, seven analytics-engine cases against
eleven transactions-engine ones, and the mutation returns precisely those seven, every one on a name
resolution failure.

But my finding was never the seven failures. It was that the layer has no identity check, and that
its helper installs the resolved address globally. Neither is closed. The layer was run against a
different same-licence deployment on this box with the API address and auth key unset entirely, under
setup-only so nothing executed, and nothing refused; had the bodies run they would have seeded that
deployment. The global installation still happens and now happens twice, once per database, so the
fix doubled the reach of the part this finding flagged.

**Closing it is not a one-liner, and the reason is worth recording.** The gateways layer proves
ownership by reading a marker row out of the users table, and the tracing database has no users
table, so the same check cannot be applied verbatim. The tracing side needs either its own marker
written through the API under test, or a check that the confirmed core address and the tracing
address name the same server and published port.

**An inherent limit of the fix, worth stating so nobody over-reads it.** The check proves the API and
the database agree with each other, not that either is the deployment you meant. Point both the API
address and the port at the same wrong deployment and it passes.

### D142. A published guide tells the reader to press a control that no longer exists (P2)

`docs/docs/guides/04-add-an-mcp-server.mdx:28`.

Source: the delta-check of D134's fix. The fix removed the "Connect without authentication" action
from the key screens, correctly and pinned by a case. The user guide still reads "If the server in
fact needs nothing, click Connect without authentication", on exactly the screen the fix changed.

This is the documentation half of a code change, and it is user-facing, which is why it is a finding
rather than a note on D134. It is also the second time in this release that a change landed without
its documentation: the connect sheet's success step needed the same treatment when it was removed.
Owner docs.

**Two smaller remainders of the same commit.** The decision the commit says it recorded does not
exist: the decisions file on the merged head ends well short of the number the commit cites, and the
only occurrence of that number anywhere is a comment inside the test the same commit added. The
finding was filed as a decision owed, and the decision is still owed. And a comment in the journey
still explains why the removed action exists, so it now contradicts the change made beside it.

### D143. The credential field is named only in its default format (P3)

`web/packages/agenta-entity-ui/src/secret/SecretForm.tsx:175-177`.

Source: the delta-check of D135's fix, which is closed for what it was filed for. The accessible name
now resolves, confirmed by computing it through the name precedence chain rather than by checking an
attribute is present, and both the label association and the explicit label agree.

The label is wired only when the format is the default text one. In the other format the label falls
back to a plain element that names nothing, and the value region is a different editor. The sheet
mounts the form without restricting the format, so the format switch is visible and a person can
reach that state. Same class as D135, one branch over.

**Worth noting for the accessibility group.** Like D106 and D107 before it, this fix hand-writes its
own field plumbing rather than routing through the shared field component that already generates and
wires these identifiers. Each individual instance is correct. The pattern is why this group keeps
producing findings.

### D144. At phone width the registry's Reconnect is not pressable at its centre, and presses the row menu instead (P2)

The registry's status-cell Reconnect, in the settings MCP section.

Source: the delta-check of D126's fix, which found it while measuring. Pre-existing rather than
introduced, confirmed by swapping the previous classes back in and re-measuring: 21.3 per cent of the
control's box resolved to itself before the fix and 21.0 after, with the centre unreachable in both.

**What a person gets.** At 390 pixels, a pixel-by-pixel map of the control's box resolves 21 per cent
to the control and 57.7 per cent to the row-actions menu. Pressing the middle of Reconnect opens the
row menu. The cause is layout rather than the touch expansion: the control does not shrink, so it
overflows its squeezed status cell straight across the actions gutter and past the table's right
border, where the menu's own expanded box sits on top of it. In a screenshot of that width the rows
read "Reconne", cut off at the table edge, with no menu visible at all.

It resolves by 480 pixels and is gone by 560. It is filed at P2 rather than higher because the row
menu also offers Reconnect, so the action is reachable by a second route, and because a person who
presses it gets a menu rather than a wrong action. It is on the surface this release is about, at the
width the release's own QA drives, which is why it is worth its own entry rather than a note.

### D145. The touch-target tests do not survive a coordinated revert (P3)

Source: the delta-check of D126's fix, and the most useful thing that check produced.

Reverting the helper's border charge alone kills eleven cases across four packages. Reverting the
reader's border subtraction alone kills eleven. **Reverting both together kills two**, and both of
those are in the primitives package. The three packages that own the actual MCP call sites stay
green.

That is D126 reproducing exactly. The original defect was that the helper and its companion height
function made the same wrong assumption, so the tests asserted the class string rather than the hit
area and passed against a 42-pixel reality. After the fix, the site packages' protection is still
borrowed entirely from two cases in the primitives package, one of which catches a coordinated revert
only incidentally, by asserting that an arbitrary-pixel inset exists at all.

The fix is not to add more assertions on the helper's output. It is for at least one site test per
package to measure something the helper cannot fake, or to assert against a value derived
independently of the helper. Until then a future change that moves helper and reader together lands
green, which is the exact failure mode this finding is about.

### D146. The sessions integration layer skips its whole self and exits 0 (P2)

`api/oss/tests/pytest/integration/sessions/conftest.py`.

Source: the delta-check of the sessions address fix. This is D97's shape in a second layer, and it
was found because the check asked what the layer does when the database is absent rather than when it
is present.

Leave the licence variable unset and change nothing else: the database name prefix changes, neither
database exists on the stack, and the run reports **18 skipped, exit 0**. A gate reading the exit code
is told the layer passed while no case executed. A second published port on this box produces the same
silent green for a different reason, because its credentials differ.

That is precisely the false green the gateways layer was changed to stop, where an unreachable
database now fails loudly and names both addresses it tried. The sessions layer still skips. The fix
is the same one: require rather than skip.

### D147. The runbook's precondition still omits the one variable that produces a false green (P3)

`docs/design/gateways-research/v1/qa.md`, precondition 5.

Source: the same delta-check. The precondition was corrected for this round and is now accurate in
substance: the Redis requirement is walked back correctly, the address variable is described as
explicitness rather than a requirement, and the tracing explanation and counts match what I ran.

Three things are still wrong, and the first is load-bearing. The licence variable appears nowhere in
the file, and the precondition gives no run command for this layer at all. Getting it wrong yields
the 18-skipped, exit-0 result of D146, which is the false green the same document teaches its reader
to distrust. Second, the precondition still introduces a block of nine exports with the words "all
five of these", which is pre-existing but sits in the paragraph being corrected. Third, the sentence
describing the identity check now sits two paragraphs above the new sessions discussion, so a reader
takes it to cover the sessions layer. It does not, and after this change that reading is actively
false. The correction's whole purpose was to stop the next person mis-diagnosing this layer, so it
needs a sentence saying in as many words that the sessions layer has no identity check.

### D148. The approval dock already catches the refusal the transcript did not (not a defect)

`useApprovalDock.ts`, against the two shared approval submit paths.

Source: raised while D139 was being fixed, on the reasonable suspicion that the two dock-side
handlers share the submit shape D139 repaired and hand their outcome back to a caller that might not
catch. Investigated and **not a defect**: the dock settles its responses through a promise combinator
that does not reject, re-arms the card, and renders the refusal's own sentence. Pinned by a test-only
commit with a case asserting that the dock carries the refusal while the transcript stays clear, and
three mutations.

**The asymmetry with the transcript path is deliberate and worth recording as such**, because a
future reader will otherwise see two callers of one shape and assume one of them is wrong. On the
dock path the gate is still on screen when the refusal arrives, so telling the person to refresh and
retry is an action they can take. On the transcript path, which is D139, the gate is gone, so the
same message is a dead end. Same shape, different context, different correct behaviour.

### D149. A unit case waits on a thread pool it cannot get under twenty workers (P3)

`test_a_grant_keeps_its_registration_across_two_consecutive_renewals`, in the gateway unit directory.

Source: api2, attributing a failure this round had previously recorded as a lost non-zero exit
without a cause. Recorded here because an intermittent failure with no attribution is the thing this
round has repeatedly found hiding real defects, and this one now has an explanation and kept output.

**The timing figures, recorded with their caveat and then left alone.** The lane reports about 15.8
seconds at twenty workers against 5.4 with none, on an idle box. Rerunning here I got roughly half
that spread, about 5.9 against 3.4 on a quiet box, and on a loaded one the ordering inverted
outright. The likeliest reconciliation is that the larger figures were taken while the import-time
network fetch recorded as D160 was failing, which is that finding's cost rather than worker startup.
The conclusion both measurements support is the one that matters and it holds: no real name
resolution happens for those hosts. The numbers themselves should not be quoted.

**The first explanation was wrong and the correction is the useful part.** It was initially read as
the case reaching real name resolution against an invented host. It does not: the directory's own
fixtures stub the resolver. What actually fails is the offload's one-second wait to be handed a pool
thread, which a twenty-worker run on a loaded machine does not meet. So the failure is contention,
not a network call, and the distinction matters because the first reading would have sent someone to
mock a lookup that is already mocked.

The fix bypasses the offload for that directory through both bindings and gives the ten cases that
genuinely exercise the pool a fixture that takes the real one. Its mutation is the right shape:
setting the queue bound to a tenth of a millisecond turns eleven of seventeen failures into
seventeen passes, which demonstrates the wait is the mechanism rather than asserting it. Fix in
flight, pending merge.

### D150. Two controls miss the minimum because of list pitch rather than the border (P3)

The registry's row-actions menu and its status-cell Reconnect, and the "Show more" control in the two
permission drawers.

Source: the delta-check of D126's fix at the shipping head, and it corrects my own entry. I recorded
two controls as not delivering 44 for separate reasons. It is three, and the two in the registry
share one reason rather than two.

Measured at the rendered hit area rather than from the computed box, which is the distinction that
matters here: every expanded control's pseudo-element computes to exactly 44 on its constrained axis,
and the five bordered controls genuinely went from 42 to 44, so the border charge worked. But three
controls deliver less, because a neighbour wins the overlap.

| control | computed | delivered | why |
| --- | --- | --- | --- |
| registry row-actions menu | 44 | 41 | 41-pixel row pitch, lower row wins |
| registry Reconnect | 44 | 41 | same pitch, blocked above and below |
| "Show more", both permission drawers | 44 | 42 | the next tool row's own box |

None of this is a border problem, and the two controls that carry no border are byte-identical before
and after the fix. The cause is that a list whose pitch is under 44 cannot give every row 44 pixels
without the rows overlapping, which is the constraint decision 55 records for the table and which
turns out to apply to the drawer's tool rows as well. The same "Show more" control in two other
drawers does reach 44, because those lists are not as tight.

This is a design question rather than an arithmetic one, and it is the same one for all three: which
row should win the seam. Recorded at P3 because no visible control is covered, only invisible
expansion is lost, and every affected action has a second route.

### D151. One entry in the expansion table is untested and would silently repeat the defect (P3)

The 30-pixel-wide, bordered entry in the touch-target helper's horizontal table.

Source: the delta-check of D126's fix, from a mutation that survived. Reverting that entry to its
pre-fix value leaves every case passing, because the only 30-pixel-wide call site today is the
registry menu and it carries no border, so the combination is unreachable.

Nothing ships wrong. It is recorded because of what it would do next: a bordered 30-pixel icon button
added later would silently get 42, which is precisely the D126 failure mode, on the one path the
tests do not cover. The fix is to add that pair to the icon-button case, which costs a line.

### D152. A test helper's global write makes the unit layer's verdict depend on test ordering (P2)

`api/oss/tests/pytest/utils/postgres.py`, and the conftest files that read the same field.

Source: the delta-check of the identity guard. I had recorded the global install as an aggravating
detail of D141. It is worse than that, and it is now its own finding because it changes results
rather than merely reaching further than it should.

The two address helpers assign onto the shared settings singleton and nothing restores them, which I
confirmed by reading the value at session finish rather than by inference. Several conftest files
then read that same field to decide whether to skip: they parse it, try to connect, and skip
integration-marked cases when they cannot. So whether a unit case runs at all depends on whether an
integration case ran earlier in the same worker process.

Measured, three serial runs on one machine with one environment:

| run | result |
| --- | --- |
| the unit sessions directory alone | 838 passed, 142 skipped |
| one integration file first, then the same directory in the same process | 975 passed, 14 failed |
| the same directory alone, with the address preset to loopback | 966 passed, 14 failed |

The third run isolates the cause to the address value alone, with no integration case involved. Under
parallel workers the distribution decides this per worker, so it is nondeterministic across runs.

**Either reading of the 14 is bad.** If they are real defects, a skip has been hiding them. If they
are cases that only work in-network, they are failing for an environmental reason nobody declared.
What is not in doubt is that the layer's verdict depends on ordering, which is the property this
release has repeatedly found hiding defects behind green suites. Fix owed: scope or restore the
mutation rather than leaking it.

### D153. The tracing database's identity is not established, only its reachability (P2)

The shared identity guard, as it applies to the second database.

Source: the delta-check of D141's fix, and it is the precise remainder of that finding.

The guard proves ownership by minting an account through the API under test and requiring the dialled
database to carry it. The tracing database has no users table, which I had recorded as the obstacle.
The fix settles identity on the core database only and resolves the tracing address for reachability,
on the argument that one server publishes both, so proving the core address proves the server.

That argument holds for the default derivation, where both addresses fall back to the same port. It
fails the moment the tracing address is set explicitly, which the helper's own error message invites
an operator to do. Demonstrated: with the core port naming the deployment under test and the tracing
address pointed at a different same-licence deployment, the guard confirmed and refused nothing. The
run was stopped at resolution rather than executed, because executing it would have written into the
other deployment's tracing database.

So for the tracing side the established property is "reachable", not "belongs to this deployment",
and those are the two properties the original finding was about. Closing it needs either a marker the
tracing database can carry or, much cheaper, an assertion that the resolved tracing host and port
equal the confirmed core ones.

### D154. Two properties the reconnect fix relies on are asserted by nothing (P3)

`McpServerFormView`, and the suite that ships with its fix.

Source: the delta-check of D132's fix, from two mutations that survive. The fix itself is right: the
banner now opens a reconnect of the selected connection rather than a new-server journey, it hands
over the connection the agent actually selected rather than the first in the list, and a reconnect no
longer rewrites the item on success, which would have rewritten the frozen tool prefix. All three
were established by rendering, and the add and rename paths were checked and are intact.

Two of the three are unasserted. Handing over the first connection in the list instead of the selected
one passes the component's whole suite, because the added case asserts what the sheet drew, its title
and the absence of an address field, and neither changes when the wrong connection is handed over.
Restoring the unconditional write on success passes the entire package, 78 files and 1038 tests: the
behaviour change that protects the frozen prefix has no coverage anywhere.

Nothing ships wrong today. It is recorded because both properties are the kind a later refactor
silently undoes, and one of them protects a rule an earlier review round established.

### D155. A fifth component passes a reconnect and nothing pins it (P2)

`web/packages/agenta-entity-ui/src/clientTools/GatewayConnectToolWidget.tsx:75`.

Source: the delta-check of D131's remainder. Four mounts are now pinned and they pin properly. This
is the fifth, and it is the same defect shape as D132 one component over.

The four pinned cases capture the prop and assert its identity rather than reading the sheet's title,
which is the shape that matters, and I proved they discriminate rather than reading that they do:
handing over a different connection while still passing a reconnect fails the new case and leaves the
older title-shaped case green. That was the blind spot, and it is covered.

The widget is not. Under the same mutation, dropping its reconnect leaves the entity package green at
1048 tests. It has a test file, but that file asserts only that the connect-request tool routes to the
gateway surface; the word reconnect does not appear in it. So the enumeration that closes this is six
mount sites across five components, of which four pass a reconnect and are covered, one passes none by
design and is correctly uncovered, and this one passes a reconnect and is not.

**D131 stays open on this.** It is one more case of the shape already written four times, and the
reason to insist is the reason the finding exists: this is the second entry point found by
enumerating rather than by a test, and the first one shipped.

### D156. The property that protects a typed credential header is untested (P3)

`McpConnectJourney`, the key screen's header field.

Source: the delta-check of the key-screen work. The behaviour is correct and I drove it rather than
reading it: typing a header name and then delivering a later probe whose prefill differs leaves the
typed value intact, in both directions. That is the property that matters, because a prefill
overwriting what someone typed is data loss on a credential screen.

Nothing tests it. Making the value probe-derived instead of typed-or-prefill leaves the whole entity
package green at 1048 tests. The three prefill claims around it are each pinned by a failing case; the
one protecting typing is not. Fix owed: the harness that drove it is about thirty lines.

### D157. The JSON editor is named, and named as a widget rather than as the field (P3)

`SecretForm`, the credential value control in its non-default format.

Source: the delta-check of D143's fix. The grid half is fixed and pinned: each value control is named
by its key, resolving to a name that includes the key once one is typed. The JSON half is fixed in the
sense the finding asked for, because something now carries the name, and two things about it are worth
recording.

The group carries the visible label, and deleting that label leaves the package green, so that half is
unasserted. The author's case also checks the attribute across every labelled node in the form rather
than on the value control, so it would pass if the value control lost its name while a sibling kept
one. And the control an assistive technology actually focuses resolves to the editor's widget name
rather than the field's visible label, so someone tabbing into it hears the kind of control rather
than what it is for. Against the original finding that is an improvement, and it is a label-in-name
mismatch worth a follow-up rather than a reopen.

### D158. Two controls are still protected only by the reader (P3)

The connect journey's response toggle and the "Show more" control, in the entity package.

Source: the delta-check of D145's fix, which closes on the criterion set for it: reverting the
helper's border charge and the reader's subtraction together now fails all four packages, where
before it failed only the primitives. Each site package derives the reach from the rendered element's
own size, border and inset with the numbers written in the test file, calling neither the helper nor
the reader, which is the right shape.

These two controls have only a reader-based case. The package still fails the coordinated revert on
its other files, so the package-level criterion holds, but for these two the original shape survives:
a change moving helper and reader together would leave them green. Recorded rather than treated as
D145 not closing.

### D159. An explicitly configured database address is silently rewritten when it fails to connect (P3)

`api/oss/tests/pytest/utils/postgres.py`, the loopback rewrite.

Source: the delta-check of the identity guard, found while aiming an address at a third deployment
whose credentials differ. The helper rewrites an explicitly configured address that fails to connect
onto loopback at the declared port, with no message. In that case the rewrite quietly landed the run
back on the right server and the guard confirmed happily.

Benign as it stands, because the rewrite can only reach the port the operator declared, so it cannot
wander to a deployment nobody named. It is recorded because an explicit address being ignored without
a word is the kind of silence that makes the next diagnosis wrong, and because this area has now
produced four findings that all reduce to a test helper deciding something quietly.

### D160. The unit process fetches a model cost map over the network at import (P3, deferred)

Reached through the SDK's asset module and the tracing tree utilities, both of which import a library
that fetches at import.

Source: api2, confirmed and measured here. Importing the package costs between 4.7 and 5.7 seconds
with the network up against about 2.1 with the remote fetch disabled, so the fetch is roughly 3
seconds per process. Simulated offline by making resolution fail for that host alone, the import takes
between 8.7 and 10.6 seconds, three attempts with backoff, then falls back to the bundled copy and
continues: the process exits 0 and the map carries 3817 entries against 4110 from the remote one.

So it is not a correctness problem and the fallback genuinely works. It is recorded because a unit
layer should not leave the process at import, because across twenty workers the offline path costs
minutes of processor time, and because it masquerades as a slow test, which is how it was first
mis-attributed in this round. Pre-existing rather than this release's. **Deferred to issue 6921.**

## Round 5, and how its findings were graded

A second fresh reviewer read the candidate after the fix batches landed, reporting no P0 and no P1,
two P2 and eight P3. Its file is `round-5-opus.md` and it numbers its findings D150 to D159, which
collides with this record, so they are renumbered here as D161 to D169 and its first finding is
recorded under D116 rather than given a number of its own.

Every one was graded rather than accepted, and three came back different from how they were filed.
That is the point of grading: a reviewer's verification method is a claim like any other.

**One was raised.** D163, the deployment guard's wiring, was filed P3 and is P2. The claim is that
what holds the identity guard in place at both integration layers is a single import of an autouse
fixture, and that deleting it sends each layer back to accepting whatever database answers with
nothing failing. Driven, that is exactly right: removing the line from either conftest restores the
pre-fix behaviour, the layer dials the in-network name, and the failures that follow are name
resolution rather than a refusal. What moves it up a band is what the import looks like. It carries a
lint suppression because it reads as unused, and with that suppression stripped the linter reports it
as an unused import **with an autofix available**, while this repository's contributor guide instructs
running that linter with `--fix` before committing any change on this side. So a control standing
between the suite and another deployment's database is one routine tidy-up away from deletion, with
nothing red on the other side. One correction to the reviewer as well: the two cases whose names
promise to cover the identity call do not call the guard directly, they call a different and nearly
dead helper that makes its own check, so the gap is slightly worse than described.

**One was lowered.** D164, the batch approval path, is true in its code claim and false in its
consequence. The two submit paths do throw differently for the same condition, one typed and one bare.
But neither the single nor the batch handler has a catch at all; both let the rejection reach the
dock, which branches on the settled status and never inspects the error, so both produce the same
card. The predicate the finding turns on has exactly one consumer, on a different path that never uses
the batch atom. So there is no differential for a person to hit. Recorded as an observation: two
messages diverge for no reason and a future caller could not tell them apart.

**One had its proposed fix corrected, which matters more than its severity.** D165 is true: the
approval submit path recognises only the client-side branch, the server answers the same condition
with a 409, and a predicate for that already exists and is not called there. Driven at the boundary,
a 409 does stamp a run-failure callout on an approval that went through. But the reviewer's suggested
remedy, widening the existing predicate, would swallow a genuinely different 409 that says the
interaction belongs to another execution, which is a real failure a reader must see. The route
already returns a body carrying a code, so the fix keys on that code rather than on the status. The
trigger is also narrower than filed, because a repeat carrying the identical answer is idempotent
server-side. Worth noting the existing predicate matches any 409, so the mobile path already has the
over-broad behaviour this correction warns against.

**One had its disposition corrected.** D166, the new sixth preset never naming the policy it follows,
was filed as a designer's call under the decision that deferred an earlier copy question. That
reasoning does not transfer. The earlier deferral rested on no user-facing words existing anywhere, so
inventing them would be the worse error. Here the copy already exists three lines above for the
neighbouring preset, and what was removed in this same delta is the prop carrying the policy. So this
is a referent that was cut, not copy that has to be written, and the record says so.

**Two were confirmed and are worse than filed.** D162, a published guide describing a clause the key
screen no longer renders, was not documentation drifting: the same entry was edited in this delta,
gaining a new sentence about the scheme while keeping the stale half, and its bolded lookup key is now
stale too. And D167's ungrammatical advice is pinned by a case, so the wrong string is the asserted
string, and the case's own comment shows the punctuation was chosen deliberately and the run-on went
unnoticed.

**Two were confirmed and are milder than filed.** D168 is genuinely latent, and for a reason the
reviewer did not give: half of the guard it describes is dead code, because the control that reaches
it is disabled unless the value is already present, and the other half is closed on this path by a
deliberate route choice. D169 overstates its own reach: the directory-wide stub replaces the offload
wrapper only, so the address-resolution decision still runs in every case, and what is bypassed is
scheduling rather than the security check.

**The reviewer's verdict**, that the product code holds up and every fix it could break is pinned
except one, and that the release is not ready while its review gate has seen none of this work, is
recorded under D116 and is right.

### D133 REOPENED. The status code on the key screen is the anonymous probe's, not the credential's (P2)

`web/packages/agenta-entity-ui/src/mcpEndpoint/McpConnectJourney.tsx:780`.

Source: the round-5 external reviewer. **I closed this wrongly and this section records why**, because
the mistake is the same one this round has now made twice and it is worth a reader seeing it.

The original finding was that the key screen dropped the status code the specification puts in its
sentence. The fix put a code in the headline. I closed it after establishing that the code reaches the
screen from real probe data rather than from a test fixture, which had itself been the trap the first
time. That was true, and it was the wrong question. The number is real data **about the wrong
request**: it is `challenge_status`, written on exactly one backend path from the status of the
ANONYMOUS handshake and gated there to 401 or 403. The verify path never touches it.

**Driven through the real render.** An anonymous 401 followed by an authenticated 403 renders "The
server rejected this key (401)." An anonymous 401 followed by a timeout renders the same sentence.
The control is what settles it: holding the credentialed failure constant and changing only the
probe's status flips the headline, so the number tracks the probe and nothing else.

**The specification means the credentialed request.** The digest defines the transition as one
authenticated tool-listing call whose 401 or 403 goes to this screen, and the screen's own note says
the error names the status code. The only status in scope at that transition is the one the
authenticated call returned. So showing the anonymous number is wrong even in the common case where
both are 401. A second deviation surfaced with it: every verify failure routes to this screen, while
the specification routes only 401 and 403 there, so a timeout or a server error lands on a screen
never drawn for it.

**And the fix removed the field that could have contradicted it.** The relayed error was deleted from
this screen in the same commit, and none of the file's four reads of it is reachable here. Before, a
typed gateway refusal showed the gateway's own sentence; now it shows static copy plus a fabricated
code. For a timeout the old text was clumsy but truthful that the server did not answer; the new text
asserts a rejection that did not happen and attaches a number from a different request. The change did
not merely fail to fix a wrong headline: it added a confident false specific and removed the
diagnostic content.

**Decision 56 should go with the fix.** It records that the code cannot appear on a reconnect because
a reconnect never probes. That premise holds only while the number comes from the probe. Sourced
correctly, a reconnect's key failure has a real status and should show it, and a reconnect is exactly
where the discarded error was the only diagnostic content on the screen. Fix owed, web7: carry the
upstream status through the relay beside the cause it already carries, and restore the relayed error.

### D170. Adoption can still take another connection after the name is edited (P2)

`web/packages/agenta-entities/src/mcpEndpoint/hooks/useMcpConnectJourney.ts:385`.

Source: the round-5 external reviewer, graded here. Partly confirmed: live on one leg, latent on the
other, and the reviewer reached the latent one only because an isolated probe can hand the code an
error the real flow cannot produce.

The journey may adopt an existing connection when a create is refused for a taken name, because a lost
answer to a successful create is indistinguishable from a collision. Decision 44 narrowed that to a
create attempted in the same journey. The gate is a single boolean, written in one place and read in
one, set by every create failure that is not a name-taken refusal, and **nothing clears it**: not a
name edit, not a URL edit, not a success, only unmounting the sheet.

**The live leg needs no explicit rejection.** A genuine lost answer sets the flag; the person then
changes the name; a conflict on the new name is by definition somebody else's row, because the lost
row was written under the old name. Adoption still matches, because it keys on name plus address and
the address did not change. Driven against the real hook, that sequence adopts. A cold conflict with no
prior failure correctly refuses, so the gate does work as intended from a fresh sheet. This is exactly
what decision 44's own comment says the gate exists to prevent.

**The reviewer's other leg is latent.** An explicit refusal on the create cannot reach the gate,
because the probe route runs the same permission check and the same address guard first and says so in
its own comment, and editing the address forces a re-probe. So a person only reaches naming through a
probe that already passed.

**One compounding fact worth carrying into the fix.** Once adopted, the credential submit edits that
row, and per D114 that edit is a wholesale replace. So the journey does not merely join another
connection, it overwrites it.

**On the proposed remedy.** A server-supported idempotency key is the right principle and the wrong
scope: the name check is still a check-then-act with no constraint behind it, and closing that is a
migration already recorded. The in-release fix is smaller and covers every reachable case: record what
was attempted rather than a boolean, set it only when the failure is indeterminate, which the transport
layer already distinguishes by whether a response arrived, and require the recorded name and address to
match before adopting.

### D171. The mis-cased policy readers now fail closed, and absence is unharmed (P2, fixed)

The runner's intake, the web policy modules, and the SDK model, against the cross-language ladder
fixture.

Source: issue 6917, filed latent earlier this round and ruled in-release after the fixture exposed
that two of the three readers resolved a destructive tool to allow from a table they could not read.
The ruling was that both must fail closed.

**All three fail closed, executed rather than read.** Given a server permission of allow and a table
denying a destructive tool under the foreign spelling, the runner drops the server permission and
resolves that tool and every unnamed tool to ask; the web reader resolves both to ask and writes a
default of ask with an empty table; the SDK refuses the policy at construction. Rendered, the drawer
draws "Always ask" with rows reading "Inherits ask", and the page says tools ask first rather than
run automatically. The restore-the-fallback mutation bites in each reader, one case apiece.

**The absence case is intact, which was the thing most likely to break.** A change that refuses
unrecognised values can easily start treating absence as invalid, flipping the safe inherit default
into asking for everything, which would be a regression in the opposite direction and would not look
like one. It did not happen: the fully absent policy still resolves as inherit in all three readers,
the adapter case pinning decision 42 is green, and the rendered drawer file is green at 56 cases,
drawing "Follow agent policy" throughout. That was proven rather than assumed by making each refusal
deliberately over-reach onto absence, which turns 6, 13 and 8 cases red respectively. A fail-closed
change that swallowed absence could not have shipped.

**The narrowness claim holds for the two changed readers.** A policy carrying an unrelated unknown
field alongside a well-formed table is accepted and resolves correctly, so a field written by an older
image still passes. One asymmetry worth recording rather than fixing: the SDK model refuses any
unknown field and always has, so an older image's extra field is accepted by the runner and the editor
and refused by the SDK.

**The guard assertion bites too.** Both integration layers now carry a case asserting the guard
reached them as autouse, and deleting the guard's import from either conftest fails that case with a
sentence naming what is missing. That closes the shape recorded in D163, where the control was held by
an import a linter would offer to delete with nothing failing.

### D172. The web reader accepts a mis-cased permission VALUE and round-trips it (P3, latent)

`web/packages/agenta-entities/src/mcpEndpoint/core/toolPolicy.ts`.

Source: the delta-check of the fail-closed work, from the adjacent case nobody had asked about. The
fix closed mis-cased field NAMES. A mis-cased VALUE is a different door and only one reader closes it.

Given a table naming a tool with a capitalised value, the runner drops the bad entry and falls to the
declared floor, which is correct. The web reader passes it through verbatim: the resolved permission
is the corrupt string, the gateway shape carries it, the drawer renders the row's control as an empty
string so the editor cannot show what that tool is set to, and it round-trips, because the filter that
decides what to write back tests only for the inherit sentinel. The SDK then refuses the whole policy,
so the next run of that agent fails outright. The floor variant is worse cosmetically, printing the
raw value in user-facing copy.

Not a privilege escalation, which is why it is P3 rather than higher: nothing falls through to the
server permission. But it persists and displays garbage and then bricks the agent, and the trigger is
the same hand-written or foreign policy that issue 6917 was about. Since the ruling there was to fail
closed in this release, and this is the same module and nearly the same line, it should travel with
it.

### D173. The package that draws the drawer has no mis-cased case (P3)

`web/packages/agenta-entity-ui`.

Source: the same delta-check. With the fail-closed guards removed from the web modules, the entity
package that owns the permission drawer stays green at 1050 cases. The mutation does reach it, which
was checked rather than assumed, because that package resolves the entities package to source. So the
coverage simply is not there. The drawer is the surface this finding was written about, and its
protection is borrowed entirely from the package below it. Same shape as D145 and D158, and the fix is
the same: one case on the surface, asserting what the mis-cased policy draws.

### D174. The fixture's new entries are held in place by nothing in one of the three readers (P3)

`sdks/python/oss/tests/pytest/unit/agents/mcp/test_mcp_policy_ladder_fixture.py`.

Source: the same delta-check, and it is the shape the guard commit had just finished fixing elsewhere.

Deleting the mis-cased entries from the fixture turns the runner red and the web package red, both at
file level. The SDK reports an empty parameter set, skips, and the layer stays green. The existing
integrity case asserts only the main block of cases, not the new one. So if the entries are ever
removed or renamed, two of the three guards shout and the third goes quiet, which is precisely the
"held in place by nothing" pattern recorded in D163. One assertion closes it.

**Fixed, and confirmed by the experiment that the first attempt got backwards.** With the new guard
left in place and the entry block emptied, all three readers now go red: the SDK raises at collection
with a message naming the block and why it matters, and both JavaScript readers fail at the suite
level rather than reporting an empty run. The earlier attempt removed the guard and saw nothing fail,
and concluded it killed nothing. That was the wrong experiment, because the guard is the test: taking
it away and watching no test fail says nothing at all. Leaving it in and taking away what it guards
is the question.

Related and smaller: the SDK's fixture test restates the ladder inside the test rather than calling a
product resolver. It matters only if the model's strictness is ever relaxed, at which point that case
would be testing its own copy of the rule rather than the code.

### D173 does not close, and the new cases cannot fail for the right reason (P3)

`web/packages/agenta-entity-ui/tests/unit/mcpPermissionDrawer.render.test.tsx`.

Source: the delta-check of the pin added for this finding. The finding was that the package drawing
the permission drawer had no case covering a policy whose per-tool table arrives under the other
field spelling, so with the readers' refusal removed it stayed green and its protection was borrowed
entirely from the package below. Four rendered cases were added.

**They still cannot fail.** Disabling the predicate that detects the mis-cased shape, so the readers
handle such a policy normally, kills one case in the package below and **none** of the four here. The
reason is structural rather than a bad mutation: the fixture those cases use carries a server
permission of ask, so with the guard gone the code falls through to the ordinary "no table, use the
server permission" path and lands on ask anyway, coincidentally matching what the guard would have
produced. The cases assert the right thing about a policy that cannot distinguish the two outcomes.

**The file says so itself.** A comment three lines above the new block records that with the refusal
removed every case there stayed green and the drawer's protection was borrowed from another package.
That observation was correct and the cases added under it do not change it.

**The fix is one value.** The fixture needs a server permission of allow rather than ask, so that
removing the guard would resolve a destructive tool to allow and the case would catch it. That is
exactly the case the package below runs and this one does not.

**A note on method, because this nearly closed wrongly.** The first mutation I ran against this
mutated the readers to accept the other spelling and killed nothing, which looked like the same
result. It was not: the predicate short-circuits before those readers are reached, so the mutated
branches never ran. Mutating the readers tests nothing here; mutating the predicate is what asks the
question. A mutation that kills nothing is only evidence once you have shown it reaches the code.

### The final pass, and three things it changed

The last code pass ran ten mutations against the final candidate, and seven of the eight fixes it
covered close. What the pass also produced, and what this section records, is three facts that are
worth more than the closures.

**A guard nobody can test, and the reason is structural.** The adoption record added for D170 is set
only when nothing answered and cleared on any edit. Setting it on every failure kills a case, so that
half is pinned. Removing the clearing entirely kills nothing, in either package, across 3086 cases.
The reason is not a missing test so much as an unreachable one: adoption is gated on the submitted
name and address equalling what the record holds, and every existing edit-then-retry case changes one
of them, so the equality check already refuses regardless of whether the record was cleared. The
clearing is genuinely redundant today. The coordinator's ruling was to keep it as defence in depth and
record it as unpinned by design rather than as a gap, and that is the right call: a guard that cannot
be reached wrongly is worth more than a test that cannot fail. It is recorded here with the sharper
reason, which is that the equality check is doing the work.

**Two fixes are covered from the other side of a package boundary.** The adoption record's setting
condition and the reconnect payload both kill nothing in the package whose source they change, and
each is caught by exactly one case in the neighbouring package. Nothing is wrong and nothing ships
uncovered. It is recorded because a future reader running one package's suite to certify one
package's behaviour would be told it is safe by a suite that cannot see the code.

**D173 is unchanged and still does not close.** The predicate mutation kills one case in the package
below and none of the four cases added to the drawer package, exactly as before.

### D175. A server's own 401 is retried as a session refresh, so a rejected key reads as an unreachable server (P2, deferred)

The browser's session interceptor, against the gateway's relay route.

Source: the final live pass, and it is the only finding in this record that no amount of unit testing
could have produced, because the journey's own tests drive its state directly and never cross the
interceptor.

Three reasonable things line up. The gateway relays the upstream answer with its own status, so a
third-party 401 reaches the browser as a 401 from our origin. The session interceptor refreshes and
retries on a 401, which is right for our own API. And the retry limit is never configured here, so it
takes the library default of ten. I confirmed each of those in the source independently of the driven
run: the relay passes the upstream status through, the session library is present, and the setting
appears nowhere in this repository.

**What it costs.** A person who supplies a credential the server rejects lands on the "couldn't reach
this server" screen rather than the rejected-key screen, so the advice points at the address instead
of the credential. The screen built for this case is not reached, which means the status code in its
headline and the restored relayed sentence, both fixed in this release under D133 and D167, are not
reachable for the case they exist for.

**Ruling reversed back to deferred, as decision 58, and the reason is worth keeping.** It was briefly
ruled fixed-in-release. The only lever available on the front end is to skip the session interception
for the relay route, and that would leave the mobile app's relay calls unauthenticated, because that
app relies on the same interception for its authentication. So the correct remedy is on the API side
and is out of this release. One fact from the grading softens it: a 403 is not intercepted at all, so
a server answering 403 does reach the rejected-key screen normally. It is the 401 case, and only that,
which cannot be seen.

**Why it is recorded here and deferred rather than held.** It is a misdirection on a recoverable path
rather than a loss or a widening, and the connection fails either way. But it is worth saying plainly
that it makes a family of screens unreachable, so the D133 work should be read as correct at the wire
and unproven on the page until this is fixed. **Deferred to issue 6926**, which names the seam: either
give a relayed refusal a status that is not 401 while keeping the upstream status in the body, or
exempt the relay paths from the interceptor.

**Measured live, and it settles which of two explanations is right.** Driving a deliberately wrong
credential against the mock's key surface: the verifying call went out **eleven times**, every one
answered 401 with the server's own refusal body, interleaved with **nine** calls to our own session
refresh, all of which succeeded. The journey then landed on the generic screen reading "Couldn't reach
this server. The server did not answer initialize." That is the discriminating evidence. A single call
landing on the wrong screen would have implicated this release's routing change, which narrowed which
failures reach the rejected-key screen. Eleven calls and nine refreshes implicate the retry behaviour
instead, which is pre-existing. **So the routing change is exonerated and this finding is the whole
explanation.** The rejected-key screen is unreachable for the status it exists for, and the work done
on it this release is correct at the wire and cannot be seen on the page until this is fixed.

**Two things the issue asks and this pass could not settle.** Whether the reconnect path behaves the
same way, and whether any failure other than 401 reaches the rejected-key screen normally, which is
the difference between a screen that is unreachable for one status and one that is unreachable in
general.

*The mobile reconnect notice, asked twice and not reproduced either time.* A QA round reported the
chat's reconnect notice absent at phone width, with its own overlay detector confirming nothing was
covering it. Driven again on this candidate: the card renders, at phone width on the mobile app and at
desktop width on the classic app, with identical text and layout, in normal document flow, and it
survives a reload because it is read from the stored transcript rather than from live state. The
earlier withdrawal of this report blamed a race that has since been fixed; this run cannot blame
anything, because there was nothing to explain. It is recorded as not reproduced twice rather than
closed, since the reproducing conditions were never established and the second run reached the chat by
a different route, the model call itself failing for an unrelated reason on that deployment.

### D176. One Connect press mints three OAuth grants when two servers need reconnecting (P2)

The connect journey's consent effects, keyed on a memo whose dependencies include the journey state.

Source: web7's live pass, registered here. With two login-expired servers listed in an agent's
configuration, a single Connect press produced three scope-discovery calls and three full authorize
and callback cycles with distinct states. One server gives exactly one. The mechanism is that the two
effects carrying a press through to the provider are keyed on a memo whose dependency list contains
the journey state, so its identity changes on every render while the status has not moved, and more
rows mean more renders.

Pre-existing, from the six-screen redraw, and reachable only now that reconnect works at all, which is
why nothing found it until this week. Fix in flight: a per-attempt latch reset at the point consent is
requested, with a case that forces a re-render while discovery is in flight. Worth saying what the cost
is, since it is not merely untidy: each cycle is a real grant at the provider, so a person repairing
one login silently authorises three times.

### D177. A connect that was refused leaves a row reading Connected (P2, deferred)

Source: the final live pass, found incidentally while settling another question, and reported rather
than chased.

After a connect attempt with a deliberately wrong credential failed and the sheet reported that the
server could not be reached, the endpoint row was still present in the settings registry with the
status Connected. The person never finished the journey and the credential was refused every time it
was tried.

That is a row asserting a state the system has no evidence for, on the surface agents read to decide
what tools they have. It is recorded at P2 rather than higher because the underlying connection simply
will not work, so what is at risk is a misleading screen and a wasted debugging hour rather than an
unsafe grant. **Deferred to issue 6927.** It is adjacent to D175: the retry behaviour is what makes
the journey end on the wrong screen, and this is what the row does in the meantime, so whoever takes
one should look at the other.

## The last grading: four claims, all true, two worse than filed

An external review of the production diff claimed four defects. Each was graded by constructing a
failing input rather than by reading, which is the standard this round settled on, and all four hold.
Two are worse than the review states.

**D179, a tool named after the prototype key eats its own denial, and it is reachable.** Written into
the per-tool table, a denial for a tool literally called `__proto__` is silently lost on every
subsequent read, including within the same editing session, because the read assigns onto a plain
object where that name is not an ordinary key. Worse than filed: the reader does not drop it cleanly
and fall through to the floor, it returns the object's own prototype as though it were a permission,
so the code believes it found a per-tool entry and hands back a value that is not a decision at all.
Reachability was the question that decided this, and nothing constrains it: a tool name is carried
verbatim from the third-party server's own listing, with no validation, filtering or escaping anywhere
between that response and the table. So a server can advertise such a tool and a denial written
against it will not apply. That is the same class as the mis-cased policy this release already ruled
must fail closed, and it is a one-line fix with a case.

**D182, every platform refusal on that path reads as a rejected credential, and the fix is cheap.**
The predicate decides on the status alone, so a 403 our own platform raises is labelled as the server
refusing the credential. Worse than filed, and in a way that inverts the finding: on the only route
feeding this predicate, a genuine third-party 401 or 403 is never forwarded as itself, it is remapped,
so **every** 403 the predicate can currently see is platform-origin. The mislabelling is not an edge
case on that path, it is the whole of it. The cheapness is the other half: the distinguishing cause is
already in the error body and already has an exported reader in the same module, one call away at the
point the decision is made.

**D180 and D181 hold as filed**, both driven. A credential swap that succeeds writes the stored
validity flag back unchanged, so a connection repaired successfully is still marked as needing input.
And the guard for whether an attempt is still current is consulted only after the write and the
verification have both resolved, never before the write, so abandoning a reconnect while the read is
in flight still writes and verifies the credential; only the state dispatch is suppressed.

**None of the four is covered by the existing suites**, which is consistent with all of them being
found by a reviewer reading the diff rather than by a run.

## The live evidence, and one correction it forced

**The relay exclusion, confirmed live.** A deliberately wrong credential against the mock's key surface
now lands on the rejected-key screen at both widths, with the headline naming the status, and the
verifying call goes out **once** where it previously went out eleven times. The refused row is
discarded afterwards, which is the other half of the same commit. That is D175 closed on the page as
well as at the wire, and it is what makes the work recorded under D133 and D167 visible for the first
time.

**The acceptance pair, run with retries genuinely off.** Eleven of eleven passed on the final candidate
on the first attempt, no retry lines in the log, with both the continuous-integration variable unset
and the retry count at zero, which is the combination the configuration requires before the opt-out is
read at all. That is the strongest acceptance evidence this release has, and it was taken on the
candidate rather than on an earlier head.

**A correction to the touch-target record, in the product's favour.** Measured in the running
application at phone width, on a row with neighbours above and below, the registry's Reconnect link
reaches its full 44 pixels on the vertical axis and is not clipped to the row pitch, which the
Storybook measurement had predicted. Only the row-actions control is compressed, at 41. So the entry
recording two registry controls short on delivery is right about one and wrong about the other. The
correction is recorded rather than the entry quietly edited, because the original number was measured
in Storybook and the application disagrees, which is the more useful fact.

**The retry chain behind the unreachable key screen, confirmed at its source.** The interception is the
session library's own, deciding purely on status equality against same-origin traffic, with the
expired-session status at 401 and the retry ceiling at ten, neither overridden anywhere in this
repository. It cannot distinguish our session dying from a third party's credential being refused and
relayed with its status intact, because it never looks at the path or the body.

**One thing found and deliberately not chased.** Creating a project secret from inside the reconnect
sheet's drawer returned a server error on every attempt, with a fresh name each time. It blocked one
live reproduction and is unrelated to anything under review here. Filed as issue 6928 rather than investigated.

### D184. The relay exclusion makes an expired session read as a rejected key (P2)

`web/packages/agenta-entities/src/mcpEndpoint/core/refusal.ts`, after the exclusion landed.

Source: the delta-check of D175's fix, from the question I raised before running it, because the shape
of the fix invited it.

The fix stops the session layer retrying a 401 on the relay route, so a third-party server's refusal
now reaches the rejected-key screen instead of being retried ten times into a generic failure. That
part works and is what the finding asked for. The consequence is that the route is also no longer
refreshed, so a person whose own session has genuinely expired at the moment a relay call goes out
gets a 401 that nothing handles.

**What the journey does with it, proved by construction.** The predicate deciding that a failure is a
credential refusal reads the status alone. Fed an error shaped exactly as our own middleware returns
for an expired session, a flat unauthorised body, it returns true. Fed a relayed third-party refusal
with no envelope at all, it returns true. They are indistinguishable to it because it was never given
anything to distinguish them with.

**Confirmed in the running application, and it is wider than the code reading suggested.** Driven on
the served head with a session genuinely revoked rather than simulated, which took actually revoking it
server-side, because clearing the cookie was not enough: the session library healed the access token
from its own refresh cookie before the call went out. With the session really gone, the screen read
"The server rejected this key (401). Unauthorized. Check the header the server expects, or pick another
secret."

The sharper fact is where that 401 came from. It was not the relay call at all. It came from an
internal read of the stored connection earlier in the same submit, answered by our own API, and the
relay call to the server was never reached. So the mislabelling is not confined to the relayed
response: the predicate is applied across the whole credential submit, which means **any** 401 our own
API returns anywhere in that flow is reported to the person as the MCP server rejecting their key.

And they are left there. No redirect to sign in, no sign-out, the address unchanged. The application
only discovers the session is gone on the next full page load.

**So the screen now says the server rejected the key when the truth is that the person is logged out.**
That is the same mislabelling as D182, arrived at from the other direction, and this fix converts it
from latent to live: before the exclusion, an expired session on this route was retried and refreshed,
which is exactly what the session layer is for.

**The distinction is available and unused.** Our own refusals carry a structured body with a cause and
the module already exports a reader for it. The smallest correct fix is to stop keying on the status:
either special-case our middleware's own unauthorised shape, which no other 401 on this route produces,
or wrap a genuine upstream refusal in the structured envelope the gateway already uses elsewhere and
require that cause. The second also closes D182, which is the argument for doing it once rather than
twice.

**Decision 58 is superseded, and its successor should say this.** The decision reversed the fix on the
ground that the exclusion would leave the mobile app unauthenticated. That premise was wrong, because
skipping interception does not strip a cookie-borne session. The right reservation was a different one,
and it is this.

### D183. The consent latch's reset is a no-op in every case that covers it (P3)

`web/packages/agenta-entity-ui/src/mcpEndpoint/McpConnectJourney.tsx`.

Source: the same delta-check. The latch itself holds: it bounds a press to one journey to the provider
however often the host re-renders, and that is what D176 needed.

Its reset does not. Removing the reset kills nothing, for two independent reasons found rather than
assumed. The latch begins false on mount, so on a first press the reset does nothing at all. It matters
only on a retry, a second press after a failed attempt in the same mount, and no case presses Connect
twice. So the guard against the case that actually produced three grants at a provider is written and
untested.

Worth one line for whoever fixes it: the existing case presses once and re-renders around it, which
pins the latch. A second press in the same mount is what pins the reset.

### The notice regression: driven on QA's own route, and not reproduced

Driven on the served head where it is reported absent, following QA's exact route rather than a
shorter one: a provider key in a throwaway project so a turn could actually complete, a server
connected through the mock's OAuth surface, the agent set to ask rather than allow, a tool call
raising the approval gate, the gate approved and the call completed, the connection then disconnected
in the settings registry so its row read expired, and a second tool call sent in the same chat.

**The notice renders, at both widths.** Found by its own data attribute with a visible on-screen
bounding box, by its status role, and by searching the document for its exact copy, then walking up
from the matched text to confirm it resolves to the same card. It reads that the server needs a new
sign-in and that its tools fail until someone reconnects, and its button opens the real reconnect
dialog pre-filled with that server, so it is wired rather than decorative. Present without a reload.
Evidence under `evidence/notice-004e37d804/`.

**One discovery worth more than the result, because it changes how any width-sensitive check must be
run here.** This deployment sends a browser with no stored preference to the mobile app **at any
viewport size**. So a check at desktop width is testing the mobile app unless it explicitly forces the
classic view, and the two are different code. Both render this notice, which is why the answer is the
same either way, but a finding that says "absent at desktop too" may be describing the mobile app at a
wide viewport rather than the classic one. Anyone comparing widths on this stack has to pin the view,
not just the size.

**How to read this against QA's report.** It is a refutation of the finding as filed, on the head it
was filed against, by the route it was filed with, which is what my two earlier non-reproductions were
not. It is not proof that QA saw nothing: a precondition I did not hit remains possible. But three
runs have now failed to reproduce it and this one had no route objection left, so the finding should
not be treated as established without a fresh reproduction that pins the view.

### The earlier attempt, and why I could not settle it then

QA reports that on the served head the chat's reconnect notice never enters the DOM, at desktop width
as well as phone width, where on the previous head it appeared at desktop. Its overlay check rules out
anything covering it, and everything before the notice works: the approval gate, the echo and the
disconnect leaving the row expired.

**I could not run it, and the reason is worth recording rather than hiding.** Driving QA's exact route
needs a completed model turn, because the notice appears in response to a tool call after the
connection has expired. A throwaway project carries no model provider key, so the first turn fails
before any tool call happens, and the project that has keys is the one another agent is using. So the
answer is that this check cannot be run by anyone working in their own project, which is the isolation
rule we adopted to avoid colliding.

That is the second check this release blocked the same way, and it is worth saying plainly what it
means: anything needing a completed model turn cannot be verified independently while provider keys
live in one shared project. It also explains my earlier report of not reproducing this twice. Both of
those runs reached the chat by a route that did not require a tool call, so they were not testing what
QA was testing, and that non-reproduction should not be read as evidence against QA's finding.

### The cause-keyed refusal, checked before it merged, with one warning withdrawn

I asked for the commit that keys the credential refusal on the cause to be held, on the grounds that
requiring the cause would stop a genuine wrong key being recognised. **That warning is withdrawn**, and
the reason it was wrong is worth recording alongside what it did find.

**Why it was wrong.** The commit does not require the cause. It returns true on the cause and then
falls back to the status, so a bare 401 from a relayed refusal still reaches the rejected-key screen.
The wrong-key case is safe and there is no regression.

**What the check found instead, which is that the commit's own premise is false.** Its doc comment
states that the relay never answers with the upstream's status, that an upstream refusal is mapped to
424 with a cause, and therefore that every 401 and 403 the route can produce is our own. That holds
for an unreachable or refusing-egress server, which is raised as an exception and mapped. It does not
hold for a reachable server that answers 401 to a bad credential: the branch converting a 401 into a
reconnect is guarded on the connection being OAuth, and its own comment says why, so an API-key
connection's 401 returns through the ordinary path with the third party's status and body intact and
no cause attached. I had already observed exactly that live, one call answering 401 and a headline
naming it.

**So two things follow, and they pull in opposite directions.**

D184 is **not fixed** by this commit. An expired session also produces a bare 401 with no cause, so it
takes the same fallback and still reads as the server rejecting the key. The commit fixes D180 and
D181 and stops the relay's own 424 being printed where the specification asks for the server's status,
which is a real improvement on the headline, but the mislabelling this finding is about survives.

And there is a trap left behind. The comment says the fallback costs nothing and that no route relays a
status verbatim. Both are wrong, and the fallback is the only thing keeping the wrong-key screen
working. A later tidy-up that removes it on the strength of that comment, which is what the comment
invites, would break the case the screen exists for. That is the regression I warned about, deferred
rather than avoided, and correcting the comment is the cheapest way to prevent it.

## The final candidate: the refusal rule, checked at the code and on the page

The rule that decides whether a failed credential check means the server refused the credential is the
last thing this release changed, and it was got wrong twice before this. It now requires the failure to
come from the relay call, and counts it as the server's refusal when it carries the relay's own cause
or is a bare 401 or 403 whose body is not one of our two exact unauthorised shapes. It does **not**
decide by the presence of a detail key, which was the hole I raised while it was being written, because
a third-party server controls its own body and may use that key itself.

**Pinned well.** Requiring the cause again, which is the shape of the fix I had wrongly feared, kills
two cases in the data package and four more in the journey package, including one asserting that a
session expiring during a credential submit still calls a bare relayed 401 what it is. Removing the
consent latch's reset kills its new second-press case, which closes the gap where the reset existed and
nothing exercised it.

**The three adversarial inputs behave.** A third-party body carrying a detail key with a string is read
as the server's refusal, so the rule is not matching on the key. Both of our own shapes are excluded.
And the unavoidable case, a third-party body byte-identical to one of ours, falls on the side of
reading as our own session. That is the rule's blind spot and it is stated here rather than discovered
later: a server that echoes our exact wording will be misread, and no rule keyed on body shape can
avoid it. It fails toward telling the person their session is the problem, which is the safer of the
two wrong answers, because it does not accuse a credential that may be fine.

**Confirmed on the page.** A wrong key now lands on the rejected-key screen naming its status, on both
the classic and the mobile app, with the verifying call going out once where it went out eleven times
before. And a session revoked before the submit no longer claims the server rejected the key: it says
plainly that the request was unauthorised. One honest limit: the harder race, a session revoked
strictly between the internal write and the relay call, could not be constructed after four attempts,
because an already-issued token kept authenticating an in-flight submit. So the case the scoping exists
for is proven at the code and not on the page.

**The notice renders on this head too**, at both widths, on both apps, found in the document rather
than judged from a screenshot, after the full route with an approval gate raised, approved and
completed and the connection then disconnected.

### D185. Nothing proves the relay-call scoping holds (P3)

Source: the final check. Removing the scoping, so a failure from an internal call is judged by the same
rule, kills nothing. The mutation does reach the code, which was verified rather than assumed by
instrumenting the branch and watching it run. It evaluates safely anyway, because the one case that
exercises the internal call's failure gives it a body that is our own shape, so it is excluded on shape
whether or not the scoping is there.

So the scoping is doing real work and no test would notice if it were removed. The case that would is an
internal call failing with a body that is not one of ours, which is exactly the situation the scoping
exists for. One case closes it.

### D186. A stored pane preference hides the phone conversation, approval gate and all (P2, deferred)

`web/mobile/src/features/chat/sessionPanes.ts`, the rule choosing between the conversation and the
agent's configuration pane.

Source: QA reported the reconnect notice present in the document at phone width but never visible, where
my own run in a fresh context found it visible. Both were right, and the disagreement is the finding.

**A person on a phone sees the notice by default.** My run was correct for a fresh context.

**QA's harness was also correct, and what it was carrying is the defect.** The mobile chat keeps a
per-device preference for whether the configuration pane is showing. Set to the value the product
itself writes when that pane is left open, the conversation is not rendered at all on the next load:
an ancestor of the notice resolves to display none, and the configuration screen occupies the surface
instead. Reproduced by setting that preference and reloading, and reversed by restoring it, with the
notice returning at identical geometry. Not an automation artefact: a person in that state sees the
same thing.

**The path that sets it is the ordinary one.** Attaching a server to an agent and setting its
permission policy are both done from the configuration pane. So a person who sets an agent up on their
phone and comes back to it is in exactly this state, which is also why a QA harness reaches it and a
fresh context does not.

**What it takes with it is the reason this is P2 rather than a preference quirk.** The conversation
carries the things that ask the person for something: a tool call waiting for approval, and the notice
saying a server needs a new sign-in. Both are suppressed by a preference about a different pane.

**Not the earlier defect of the same family.** The one where a preference written by the desktop layout
bled into the phone layout is fixed, and I tested it: setting the desktop key has no effect here. This
is the mobile-local key.

**Deferred to issue 6930.** The fix is a guard in that rule rather than one line: do not suppress the
conversation while a turn is waiting on the person. It is not about what this release changed, and it
predates the MCP work.

### A correction to what the QA rounds covered

Recorded because it changes how every QA result in this release should be read, and because QA found and
reported it against its own work. Its harness always signed in through the mobile app, and this
deployment routes a browser with no stored preference to the mobile app at any viewport. So the rows
labelled desktop in rounds 6 through 6d were the mobile app at desktop width, and the classic app was
never covered by that harness at all. QA has relabelled those rows rather than leaving the wording
standing, and has pinned the view in its shared runner so each scenario now records which app rendered
rather than inferring it from the size.

What survives is that each result remains valid for the app it actually tested, and the scenario that
matters here failed on the mobile app at mobile width, which is the case it is about. **Classic
coverage in this release therefore rests on the two acceptance suites and on the live tables**, not on
the scenario rounds. That is worth knowing before anyone reads a scenario result as covering both apps.

### The last two checks, and what each left behind

**D185 closes, and the case added is better aimed than I expected.** Removing the scoping now kills
exactly one case in each package. The new one mocks the relay call itself rejecting with our own
middleware's unauthorised body, which is a session expiring in the window between the internal read and
the relay call. That is precisely the variant my live run could not construct after four attempts,
because an already-issued token kept authenticating the in-flight submit. So the case covers at the
code the one thing the page could not reach, which is the right division of labour between the two.

Worth recording alongside it, because it explains an earlier zero: the internal-read failure never
reaches this predicate at all, so the path I originally worried about was excluded for a different
reason than the scoping. The scoping earns its place on the relay call carrying an internally-shaped
body, which is the case now pinned.

**D179's defect is fixed and its coverage is one site out of five.** Restoring plain property access at
the reader fails a case asserting that a denial written against a prototype-named tool survives, with
the prototype object standing where a permission belongs, which is the signature exactly. The other
four sites, the two adapter writers, the helper that strips a key and the setter's spread, were all
changed to the safe construct and **nothing tests any of them**. That is not inferred from a zero: each
mutated line was instrumented and watched running during the suites, between two and twenty-seven times
each, and never once with a prototype-named input. So the lines execute and no assertion could
distinguish safe from unsafe behaviour there.

That is D187, and it is the same shape this round has now found five times: a guard written, the defect
genuinely closed, and the guard itself resting on nothing. It is P3 because the product is correct
today; it matters because the next person to touch one of those four sites gets no signal.

## What the round confirmed

Recorded because a confirmation that cost work is worth as much as a finding, and because the next
round should not re-drive these. All of these were driven or executed, not read, except where noted.

**The five-reader per-tool policy ladder, which round 3 closed as D88, holds.** Both reviewers
checked it independently and agree, and the merge's own reader sweep agrees. The runner has a single
resolver imported by both its own path and the in-sandbox extension, and it returns the whole-server
permission only when no floor is declared, so a declared table makes the server permission inert,
which is the rule D88 established. The SDK computes the same floor with the same default and the same
rule, and the web reader matches line for line. Decision 38's explicit permissive floor is not a
special case in the adapter; it falls out of comparing the edited default against the policy as the
tool edits leave it. Decision 42's fix is present and neither reviewer could find a transition that
widens. D113 is not a contradiction of this: it is about the absent policy and its label, not about
the ladder.

**The connect journey seals all three doors while saving**, not one. **The settings list tracks the
open connection by key** and looks the record up fresh on every render. **A filter-hidden tool keeps
a disabled control and a separate remove path**, which is both halves of what that finding needed,
because the API refuses the whole policy for such an entry. **An inherited row states its
provenance** rather than showing a bare value. **The mid-flight tool list is discarded on a
connection switch.** **The consent watch is installed before the popup is pointed anywhere.**

**The callback page, driven live.** It serves the declared origin list, and the browser half trusts
only the API's own origin as the sender, which is the right asymmetry. A script-injection attempt
through the error description came back escaped in the body and escaped inside the script block, with
exactly one closing script tag on the page.

**Flag defaults are as the brief expects**: the LLM gateway off, the MCP gateway on, mocks off,
insecure egress off.

**No cloud, host or credential detail in the diff.** Every address literal added belongs to the
egress guard's private-range table, every tunnel reference is a service name or an environment
variable with no hostname committed, and every token-shaped literal is synthetic and says so. The one
public hostname is a documented public endpoint already present in the base tree.

**Stories exist per state** for every redesigned surface, and the Storybook build passes and is added
to CI. Codex judged the story coverage incomplete against a strict every-state reading, naming
tool-discovery outcomes, creation failure and timeout as missing from the journey stories; that is a
fair criticism of coverage and is not recorded as a defect.

**Tests assert behaviour rather than markup**, measured rather than assumed: across the twenty test
files the design delta adds or rewrites, markup-coupled assertions are 2 of 81, 2 of 74, 0 of 51 and
0 of 38, with the higher ratios confined to the primitives where the class mapping is the behaviour.

**The token dialect sweep is clean apart from D110.** Every token name in the redesigned files is
declared in the file the mobile app imports, so for these surfaces there is no name resolving on one
app and not the other, and the earlier framing that this was a classic-versus-mobile split does not
generalise.

**Copy discipline holds.** Forty em dashes across the redesigned files, every one inside a comment
and none in copy. No hardcoded colour literal in the files the redesign wrote. All five preset labels
and their descriptions are the spec's, in the spec's order, word for word, with D105 the single
exception, and the four per-tool values, the five rollups and every empty state, banner and confirm
sentence match the digest exactly.

**No focus ring is suppressed anywhere in the delta**, every custom clickable carries a role, a tab
index and a key handler, icon-only buttons are labelled with their server's name, and the skeleton
rows are hidden from assistive technology. The accessibility findings D104, D106, D107 and the
bundle in D109 are specific gaps against that background, not a general absence of care.

**The rebase dropped nothing.** Object comparison confirms the dropped prefix fix is present in the
pinned base and that both hand-resolved refused-send conflicts match the rehearsal versions. Their
runtime behaviour was not driven by either reviewer.

## The acceptance baseline, and how the suites must be pointed

**Baseline for the merged head.** The integrator's run at `fac66e01b8` is 11 of 11 on both MCP
acceptance suites, with evidence under evidence held outside the repository.
That is the acceptance result this round closes on, and it supersedes the earlier 8-passed,
2-failed run recorded in this file, which ran on an earlier head before two of the fixes landed.

Both failures in that earlier run are accounted for and neither was a product defect. One was the
saved-configuration read polling before the permission edit committed; the product had written
exactly what the case asserts, 4.7 seconds after the case read, which I proved by querying the
revisions directly. Its fix is the commit that makes the poll wait for the permission edit rather
than for the item. The other was a transport failure against the public tunnel.

**How live runs must be pointed, settled during this round.** Everything that can run against the
dev stack's local ports does. The exception is the OAuth case: the deployable mock advertises the
tunnel address in its protected-resource document, and discovery refuses a server whose origin
differs from the resource its metadata names, so that one case is bound to the tunnel on this
deployment and runs in a single pinned worker there. A transport failure at the tunnel is recorded as
environmental and the case is rerun once, rather than being treated as a result either way.

**Two operational notes for anyone rerunning these.** The shared tree's Playwright moved to 1.60.0
through main without the matching browser being fetched, so a launch fails until
`playwright install chromium` is run from the web test package, which writes only to the local
browser cache. And the retry opt-out is read only when the continuous-integration variable is unset,
so a run meant to have retries off needs both.

**Live verification is currently parked.** The public tunnel returns 403 with the hosting provider's credit error,
which I confirmed independently, and sign-in works only on that origin, so nothing needing a session
can run until the account is restored. The local origin serves the app and its API answers, and the
QA agent confirmed the local origin is not a workaround for anything needing a browser session. Any
check below that needs the stack is pending the tunnel rather than skipped.

**Housekeeping, recorded because the project is shared.** The throwaway agents this round's
verification created in the QA project are deleted. Two existed rather than the three first reported,
which was a miscount in the verification agent's own report; a database-wide search confirmed no
third under that prefix in any project, and nothing was substituted on a guess. The connections named
Linear and Axiom were never in the delete path and their stored timestamps predate this round. The
API key minted to do it was revoked afterwards.

## Delta-checks pending the integrator

One commit remains unmerged and unchecked: the documentation guide fix for D142. Everything else in
this round's fix batches is now on the integration head `c1a1727464` and has been delta-checked from
it, one worktree per check.

**A correction to how I was reading the tree, worth recording because it cost a round of confusion.**
I had been testing whether a fix was merged by asking whether it was an ancestor of the shared tree's
checked-out head. The shared tree is the one the demo stack serves and it is fast-forwarded only when
a batch completes, so for a while it reported every pending fix as unmerged when the branch that
ships had already taken them. The branch to ask about is the integration branch, not the served
checkout. The two are the same repository and it is an easy substitution to make silently.

The earlier text of this section, kept because it names what was pending at the time: They are listed so nobody reads their absence from
the table as a judgement.

Checked on the lane and needing re-confirmation on the merged head: the touch-target border charge,
and the sessions layer's address resolution. Both are recorded above with their lane revisions and
their verdicts, and both verdicts are about the lane.

Not yet checked, awaiting the merge: the phone-width fix for the status cell, the preset's pending
scope, the two approval findings, the approval-dock pin, the documentation guide, the shared identity
guard for both integration layers, the marker account taken to one per run, the resolver pool case,
and the three web7 commits covering the reconnect entry point, the dangling name reference and the
removal of the reload allowance.

D131's remainder is now settled by measurement rather than by my judgement, and the answer is that
the single case does not close it. The added case renders one component and asserts what the SHEET
drew, its title and the absence of an address field. It asserts nothing about what the COMPONENT
passed. Dropping the reconnect at each of the other four mount sites and running the owning suites:
the settings section, the chat notice card, the agent's connect tool and the agent configuration body
all stay green, 37, 1120, and 1038 tests respectively, and one of those components has no test file
at all. **Four of the six mount sites can lose their reconnect with the entire test estate green.**
That is the defect this finding is about, still live at four addresses.

What closes it is one parametrised case over the mount sites, each mounting the real component with
the sheet stubbed to CAPTURE ITS PROPS, asserting the captured reconnect is present and carries the
identity of the connection that surface is about. Capturing the prop rather than reading the sheet's
title is the whole point, and it is also the only shape that catches the wrong-connection case in
D154, which a title assertion is blind to. A cheaper partial, if six cases is too many: extract a
shared helper that builds the reconnect payload from a connection, test it once, and have every mount
call it, so a mount either calls it or visibly does not in the diff.

## What no one verified

Named so the next round starts here rather than rediscovering it, and so no reader takes a silence
for a pass.

- **The Playwright acceptance suites were not run**, by either reviewer or by the merge. Every
  finding about them, including D96 and D122, is about the shape of a case that was read, not about a
  run that was watched. Running them needs a stack built from this revision with the mocks enabled,
  which the live stack is not.
- **The gateway integration layer ran, and 93 of 101 cases skipped.** That is D97, and it is the
  reason that line is not evidence of anything.
- **Codex ran no suites at all.** Its findings are code reading plus targeted in-memory probes, which
  it stated plainly. Its four unique findings are none the worse for it, and two of them were
  confirmed by execution here.
- **No screen reader was driven.** D104, D106, D107 and the accessibility half of D109 rest on
  reading plus well-established properties of live regions and label association. The Storybook
  accessibility script was not run by anyone, and running it is the cheapest way to raise the
  confidence on that whole group.
- **No real MCP server.** Everything driven went against the deployable mock. The mock is strict in
  the ways that matter, which D99 records, but rounds 2 and 3 both found that the residual risk in
  this release concentrates in client seams only a real server exercises, and nothing in this round
  moves that. This is the largest remaining unknown in the release.
- **Mutation testing was not done.** Codex named the three mutations worth running, which are
  retaining the endpoint after an address change, dropping the agent policy at the caller, and
  accepting an unmatched request id. All three are now findings D111, D113 and D115, so the cases
  those mutations would have caught are the cases those fixes must add.
- **The API-key path was read, not driven.** Decision 43 records that the probe already reports an
  unknown mode on a challenge carrying no OAuth metadata, so the key screen is reached, and a
  key-authenticated mock surface landed on the shared branch after the candidate. D114 drove the
  reconnect update against the database, which is the part that mattered, but no one drove the key
  screen end to end in a browser.
- **The runner and client changes were probed in memory, not inside the container.** D115's parser
  was executed in the unit harness; the deployed runner was not exercised.
- **Branch protection is not readable from a checkout**, so D102's severity assumes the new job is
  advisory rather than required.

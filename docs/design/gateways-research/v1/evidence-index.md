# PR #6049 evidence index

This is the map a reviewer needs to open pull request #6049 cold. It says what changed, how each
claim was verified, where the record is, and what is still open. It does not argue that the release
should ship. The gate calls that a separate human decision.

This file lives at `docs/design/gateways-research/v1/evidence-index.md`, beside the round records it
cites. Paths given here are relative to that folder. Evidence that does not live in the repository,
which is the QA recordings, the live tables, the design decisions record and the per-package and
round-5 review reports, is attached to the pull request comment instead. Terms: a **finding** is a numbered defect, written `D<n>` from a review round, `P<n>` from
a CodeRabbit pass, `OR<n>` from the running log. The **data plane** relays a tool call to a
customer's MCP server; the **control plane** creates and configures connections. A **harness** is one
of the three agent runtimes: Pi, Claude Code and Codex.

---

## 1. The candidate revision

| Field | Value |
| --- | --- |
| Release-ready revision | `81d1d25ffb`, the pushed head of pull request #6049 |
| Base | `e5643f00f5` |
| Reviewed in round 4 | `0dcf27bf0c`, verified at `b9de76fcef` |
| Integration head last driven by QA and acceptance | `fac66e01b8` |
| Pull request | https://github.com/Agenta-AI/agenta/pull/6049 |
| CI run on the candidate | `CI_RUN_LINK` |
| CodeRabbit pass A, source files | `CODERABBIT_PASS_A_LINK` |
| CodeRabbit pass B, the redesign | `CODERABBIT_PASS_B_LINK` |

`81d1d25ffb` appears once, in the cell above. It is the candidate `e1108531c7` plus its two closing test commits, the documentation commit and one header correction. The gate asks the evidence index to identify one
exact revision, and a revision repeated in twelve places is one that gets updated in eleven.

Everywhere else a revision is named because a measurement was taken against it. Those are historical
and must not be substituted for the candidate.

Two things have to survive the push. The gitleaks fingerprints are anchored to a commit, a file and a
line, so they are regenerated after any rebase and immediately before the push. The CodeRabbit file
counts are re-measured, because the redesign moved them.

---

**One behaviour change hides behind a test-shaped commit message.** Commit `2e97438a40` is titled as
a test change and also edits `api/oss/src/utils/env.py`. The Composio base URL gains a named shipped
default, `COMPOSIO_DEFAULT_API_URL`, resolved through a helper, so a deployment that declares
`COMPOSIO_API_URL` with an empty value now falls back to that default instead of handing adapters an
empty base URL. The value is still bound once at import. Flagged here because a reviewer scanning
commit subjects would not look for it.

## 1b. The merge with main, after the first push

The first push showed the branch conflicting with main, 195 commits behind it. Main was merged in as
a single merge commit, `6bc881dfc4`, rather than a rebase, so the review history above stays
addressable.

Two of main's own changes landed on surfaces this release had rewritten, and both were resolved
toward main rather than toward us.

**Main rewrote the mobile chat turn row.** Three things this release added had to be re-homed into
main's activity timeline: the reconnect notice card, the run-failure callout, and the retry. They
render from the same components as before; what changed is where the timeline mounts them.

**Main brought its own configuration-pane mechanism**, which replaces the fix this release made for
the stored pane preference that could hide the phone conversation. Our fix is gone and our test is
ported onto main's mechanism, so the property stays pinned by something that exercises what now
ships. Issue #6930 stays open under main's mechanism rather than being closed by the merge.

**The merge itself produced three findings**, and they are the reason a clean merge is not the same
as a correct one. The retryable class gate this release added had to be ported into main's version of
the callout, because main's rewrite carried the callout without it. The overview screen lost its
edit-config behaviour to a prop main computes and never passes. And one file merged without conflict
while importing a module the merge had deleted, which nothing in the merge itself would catch and the
type-check did.

**The chat surface was re-checked on the merged head**, `6bc881dfc4`, four ways.

- **Both acceptance suites are 11 of 11**, run by the integrator, with no compile errors.
- **Two QA scenarios pass at 430 pixels in the mobile app**, scenarios 04 and 07, held as controls
  for the surfaces the merge did not touch.
- **A stream-level run shows the reconnect notice chain working after a revoked login**: the part
  reaches the wire, the tool call is attempted and refused, and the card renders with a working
  `Reconnect`.
- **QA retracted its own round 6e finding against that notice.** The model had declined the tool call
  conversationally, and the assertion fired mid-turn, so the notice was never the thing at fault.

A follow-up commit hardens the chat turn row on two counts: a failed MCP call that carries no notice
now renders as a failed step rather than as nothing at all, and the notice's `Reconnect` action is
pinned by a test for the first time.

**On the pushed head `890953d2b4`, the notice was owed and delivered for the first time.** QA's
deterministic scenario 05 passed at 1440 in the mobile app: the call executed against the revoked
server, failed, and the reconnect notice rendered carrying its `Reconnect` action. At 430 the same
scenario is **inconclusive rather than failing**, because the model declined the call, so the notice
was never owed and the run proves nothing either way. Recordings are attached to the pull request comment.

The acceptance pair on that head is settings 8 of 8 and playground 2 of 3. The third playground case
passed on a rerun; it had timed out in setup under load, before reaching any MCP assertion, so the
failure was the harness getting to the starting line rather than anything the suite is there to
check.

## 2. The gate checklist

The thirteen items from `mcp-release-gate.md`, in its order. An unchecked mandatory item means NOT
READY, in the gate's own words.

| # | Gate item | State | Where the evidence is |
| --- | --- | --- | --- |
| 1 | Independent account identity and any migration verified | Done | `qa.md` section "Connection identity", eleven API-driven checks, and "The migration, run against the deployment's own rows", where eleven grant rows became ten with no reconnect. Coverage in `integration/gateways/test_mcp_oauth_connection_identity.py` and `test_mcp_oauth_grant_rekey_migration.py`. |
| 2 | Single Connect flow and fallback and error states verified | Done | Acceptance suite `settings/mcp-connect.spec.ts`, eight of eight at `fac66e01b8`. Recorded QA rounds 6, 6b and 6c drove the journey at two widths. |
| 3 | Per-tool permission enforcement verified through supported runners | Done, one cell not run | `qa.md` section "MCP permissions", fourteen cells across Pi, Claude Code and Codex, each read against the gateway's request log rather than the model's reply. Three Pi runs against a real provider. The write cell against a real provider is not run; section 5 says why. |
| 4 | OAuth recovery, isolation and credential boundaries verified | Fixed, live confirmation owed | D131, "Reconnect cannot renew a revoked login, from any of its entry points", is fixed and delta-checked. One live defect remains at a reconnect entry point, D132. Section 10. |
| 5 | Required automated suites and CI pass on the final candidate | Pending the push | Section 4. Both MCP acceptance specs are green at `fac66e01b8`. CI has not run since the branch began conflicting; the rebase clears that and the run goes at `CI_RUN_LINK`. |
| 6 | Recorded product QA and upstream side effects support the result | Five recorded rounds, plus live tables on the candidate | Section 7. Round 6d measured the Reconnect fix at 450 milliseconds, and the live tables on the candidate carry sixteen checks passing at both widths. Section 10 says what is proven on the page and what is proven only at the code. |
| 7 | New LLM gateway and wallets remain disabled, legacy model path works | Done | `test_llm_gateway_disabled_acceptance.py` passes four of four with the LLM plane off. The gateway acceptance directory reports 23 passed and 20 skipped in that mode, the skips being exactly the LLM suites. The six legacy-path changes no flag covers are dispositioned in OR82, all six kept. |
| 8 | Unresolved findings classified, no release-blocking finding remains | Classified, three evidence gaps open | No P0 and no P1 open. Three findings void evidence the gate reads, and they are the ones to weigh. Section 10. |
| 9 | Codex gpt-6-astra at medium reasoning reviewed the final candidate | Done | Round 4, section 3, plus the round-5 delta reviews, two Codex passes and one Opus, held outside the repository. Codex's closing words on the round-4 candidate were "this review does not establish release readiness"; the delta reviews read the fixes that followed. |
| 10 | CodeRabbit completed review, skips are not approval | **Void, being repaired** | D116: the file count reached 342 against a 300-file cap, so the review refused and the refusal reported as a passing check. The largest and newest half of the pull request has never been reviewed. Repartitioned to 140 plus 182 files; both passes must complete before the gate is credited. |
| 11 | Docs match implemented behavior, nothing planned is advertised as shipped | Done | The MCP guide and both reference pages are rewritten against the shipped components. Section 6. |
| 12 | Data-preserving rollback and disable procedure verified | Done | Section 8. |
| 13 | Evidence index identifies the exact release-ready revision | Done once the cell is filled | Section 1. |

Two mandatory-coverage rows a checklist can hide. Nobody has read a real provider's consent screen
and clicked Authorize on it, because the mock issuer has no consent screen; abandonment was driven by
aborting the authorize navigation before a code is issued, which is what abandoning a real consent
page does. And the audit trail has one gap, round-1 finding D11, where a refusal raised before the
audit recorder produces no audit event, deferred with its closure stated in the code.

---

## 3. Code review

Four independent rounds and two CodeRabbit passes. Each round used two reviewers who read the same
candidate without seeing each other's work.

| Pass | Revision read | Reviewers | Record | Raised | Real and fixed | Deferred | Not applicable |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Round 1 | `528204c3d9`, 67 files, api, sdks and services only | Codex gpt-6-astra medium, do not ship on seven; second reviewer, ship with fixes on two | `reviews/round-1.md` | 17 after merge | 17 closed | 4 | 1 withdrawn |
| Round 2 | `3d0bff5dee`, everything since round 1 plus the entire frontend | Codex and a second reviewer, both do not ship | `reviews/round-2.md` | 24 plus 4 quality notes | 34 closed, 5 part fixed | 10 open | none |
| Round 3 | `5c67a2e871`, roughly sixty fixes | Codex and a second reviewer, both would not ship unchanged | `reviews/round-3.md` | 28, no P0, 5 P1 | all five blockers fixed | see section 9 | none |
| Round 4 | `0dcf27bf0c`, verified at `b9de76fcef` | Codex gpt-6-astra medium; a fresh Opus reviewer with no history in rounds 1 to 3 | `reviews/round-4.md` | 95 at close | all four P1s fixed, no product defect open | #6911 to #6921, #6926 to #6928 | 5 rows carry no severity |
| CodeRabbit pass 1 | `3d0bff5dee`, production source, 270 files | CodeRabbit, 2026-09-15 | `reviews/coderabbit-pass-1.md` | 39 | 23 | 12 | 4 |
| CodeRabbit pass 2 | `664838e419`, tests and configuration, 238 files | CodeRabbit, 2026-09-16 | `reviews/coderabbit-pass-2.md` | 15 | 9 | 4 | 2 |

### Round 4, the one that read the redesign

Scope, in the record's words: "Everything since round 3, which is two bodies of work rather than one.
The first is the round-3 fixes, the rebase onto a main that had moved 38 commits, and the D94
residual. The second is the MCP screen redesign: seven work packages reimplementing every MCP surface
on both apps, against a designer's spec with 45 recorded decisions. The redesign is the larger half
and it is new code that no previous round has read."

| | P0 | P1 | P2 | P3 | Total |
| --- | --- | --- | --- | --- | --- |
| Codex, as filed | 0 | 1 | 5 | 2 | 8 |
| Opus, as filed | 0 | 0 | 8 | 8 | 16 |
| At the close of round 4, by verified severity | 0 | 4 | 45 | 40 | 89 |

Findings are numbered **D95 to D189, 95 rows**, checked against the pushed head `890953d2b4`. The
severity columns sum to 89 because five rows carry none. Severities are
as verified, not as currently open, which is the convention round 3 used.

**All four P1 findings have landed fixes**, each delta-checked with every mutation rerun in the round
rather than taken from the fix reports.

**The two verdicts disagreed, and the disagreement is the useful part.** Codex filed one P1 blocker
and closed with "this review does not establish release readiness", having run none of the suites in
its brief, because a read-only sandbox could not materialise the candidate. Opus filed no P1, ran
every suite in its brief and quoted counts, and said "I would ship this". The record's own judgment:
the Opus review is far the more complete, and the Codex review, which ran nothing and read narrowly,
still produced four findings Opus did not, two of them at the wire rather than in the copy. Two
findings were reached independently by both, D106 and D110, and those are the only two.

**One finding is the argument for running reviews at all.** D113, "The absent MCP policy claims a
safety behaviour nothing implements, and the qualification decision 41 rested on has never rendered."
Each reviewer found one half and neither half alone is a P1: Codex found the missing wiring, Opus
found the label and the help line promising that read-only tools run automatically. Together they
show that an untouched server and an explicit "Ask for write and delete" preset produced a
byte-identical empty policy on the wire, under a label promising behaviour nothing implemented.
Fixed at `223b017bf9`, delta-checked at the wire and on the screen with the pre-fix control swapped
back in to prove the probe discriminates. It is the one P1 that landed complete, and it opened two
follow-on findings of its own.

**Three severities moved on verification**, each argued in its own section: one down from P1 because
the precondition turned out to be unreachable through any shipped surface, one up from P3, one down
from P2. One claim in each direction was checked rather than accepted.

**What no one verified**, recorded so the next round starts there rather than rediscovering it: the
Playwright acceptance suites were not run by either reviewer, the gateway integration layer ran with
93 of 101 cases skipped, no screen reader was driven, mutation testing was not done, the API-key path
was read rather than driven, and runner and client changes were probed in memory rather than inside
the container. The record names the largest of these itself: everything driven went against the
deployable mock rather than a real MCP server.

---

## 4. Automated tests

Counts as the records state them. The suite table below was measured on 2026-09-13 and predates both
the rebase and the redesign; the acceptance runs beneath it are current.

| Suite | Last recorded result |
| --- | --- |
| API unit, `oss/tests/pytest/unit/gateways/` | 838 passed |
| API unit, `oss/tests/pytest/unit/secrets/` | 198 passed |
| API integration, `oss/tests/pytest/integration/gateways/` | 28 passed |
| API acceptance, `oss/tests/pytest/acceptance/gateways/` | 40 passed |
| SDK acceptance | 126 passed, 2 skipped |
| Services integration | 14 passed |
| Services acceptance, the mock harness matrix | 27 passed in 322 seconds |
| Runner unit | 194 files, 3424 passed |
| Runner acceptance | 23 passed |
| Chat package unit | 91 files, 1064 passed |
| Web, `web/oss` unit | 529 passed, 1 skipped |
| Mobile unit | 235 passed |

**The browser acceptance suites are current and green.** At integration head `fac66e01b8`, both MCP
specs pass, 11 of 11, recorded in the acceptance run attached to the pull request comment:

| Spec | Result |
| --- | --- |
| `settings/mcp-connect.spec.ts` | 8 passed, 0 failed, 57.1 seconds |
| `playground/mcp-agent-config.spec.ts` | 3 passed, 0 failed, 88.1 seconds |

That run matters beyond the numbers. The OAuth case now asserts that the sheet is waiting on the
provider's window, so the assertion ran against the real flow for the first time, and two previously
failing cases pass. The suite is one case larger than before, from a new check that a taken name is
refused even where the address is the same.

**Read those two green rows with one caveat the QA record insists on.** The OAuth case has failed,
passed, failed and passed across four passes, and its risky step took 1.6 seconds of a 9.9 second
budget. Treat a pass as a won race until a further run says otherwise.

**Three things a count alone hides.** The browser acceptance suite is a manual gate step, in those
words, because the preview job it would otherwise run in serves no mock container. Both mock-backed
OAuth suites skip in CI unless a flag is set and two mock containers exist, and no workflow sets it.
And the gateway integration layer was, until D97, dialling the wrong database port, skipping 93 of
101 cases and exiting 0. It now runs 101 of 101; the remainder, that nothing checks the identity of
the database that answers, is D128 and open.

---

## 5. Real-provider and real-model evidence

Two proofs answering two different questions. Conflating them is the mistake this section prevents.

### Real providers: does the gateway work against a server we did not write?

Recorded in `qa.md` section "Real providers: Linear and Axiom", after a person completed both consent
flows in a browser.

| Server | `initialize` | Reported name and version | Tools advertised |
| --- | --- | --- | --- |
| Linear | 200 | `Linear MCP` 1.0.0 | 79 |
| Axiom | 200 | `Axiom MCP Server` 0.1.3 | 28 |

Both lists are the provider's own. One Linear read tool, `list_teams`, was called through the gateway
and returned the workspace's five real teams. Per-tool permission is proved against that real server
by three Pi runs read from the gateway's request log: on `ask` approved the tool call lands between
the two model calls; on `ask` denied the two model calls sit back to back with no MCP request between
them; on `deny` the tool is never offered.

Getting there took three fixes a mock could not have forced, which is the argument for this row
existing. Both runner clients sent a protocol-version header on the request that negotiates it, so a
conforming server answers 400. The Pi client stripped event-stream framing only when a body began
with `data:`, and a real reply begins with `event: message`. And the client stamped a metadata
envelope the upstream then validated against rules the client did not satisfy. Linear enforces all
three and the mock enforced none, so every mock cell passed while a real upstream refused every turn.
The mock has since been made as strict as a real server.

**The write cell is not run**, by product decision rather than test failure. A throwaway write was
authorized in a scratch team; the workspace holds five real active teams and no scratch one, and an
issue created in any of them is visible to the people who work there. The driver exists and is proved
against the mock.

**The largest remaining unknown, in the round-4 record's own words**, is that everything driven in
the redesign went against the deployable mock. No recorded QA round drove a real MCP server.

### The real-model matrix: does a model actually choose the tool?

Nine cells, three harnesses crossed with the three mock MCP namespaces. **Nine of nine pass.**

| Harness | Protocol | Route | Model |
| --- | --- | --- | --- |
| Pi | Chat Completions | OpenRouter | `~deepseek/deepseek-v4-flash-latest` |
| Claude Code | Messages | OpenRouter | `anthropic/claude-haiku-4.5` |
| Codex | Responses | OpenAI direct | `gpt-5.4-mini` |

Nine rather than twenty-seven is the complete equivalent set: the mock matrix's third axis is the LLM
namespace, and two of its three values are the mock provider, so a real model can only arrive through
a custom endpoint. Every cell raised the approval gate, parked, resumed on approval and produced a
tool output carrying the marker, and every closing sentence is the model's own rather than the mock's
fixed string. Total cost 19 cents on OpenRouter plus a few cents on OpenAI.

**The 27 of 27 figure is a different suite answering a different question.** That is the mock harness
matrix, which drives a deterministic mock and proves the plumbing. It remains the deterministic gate.
Neither number replaces the other.

---

## 6. Design implementation

The designer's MCP screens were reimplemented after the rest of this work was evidenced, so the
release has to be evidenced against them.

**Seven work packages.** Shared primitives and the token bridge, then the data layer, then four in
parallel (the connect sheet, the agent rail and add-server drawer, the permission drawer, the Settings
registry), then mobile parity and the chat banner. Each ships rendered tests and Storybook stories.
The per-package reports are held outside the repository; the two foundation packages wrote none, and
their work is described inside the four that depend on them.

**Fifty-three recorded decisions**, in the design decisions record, against a spec digest of fourteen
screens and twenty-eight recorded ambiguities. Eight are flagged:

| # | What it decides | Flagged to |
| --- | --- | --- |
| 1 | Primary actions are the app's ink primary in light mode, not the spec's brand yellow | designer |
| 10 | Reconnecting a key-authenticated server reuses the key sheet, URL and name locked | designer |
| 22 | A rename does not change an agent's frozen tool prefix, which the spec assumed it would | designer |
| 33 | The row menu keeps both `Disconnect` and `Remove`, five items where the spec drew four | designer |
| 36 | A newly added server writes no server permission, rather than the spec's `Allow all` | designer |
| 38 | A per-tool write on an `allow` server keeps the unnamed tools on `allow` | round-4 reviewers |
| 45 | The absent policy gets a preset of its own and `Ask for write and delete` writes a real shape | designer |
| 52 | A server's read-only hint becomes an allow rule with no person in the loop | designer |

**Read 33, 36 and 52 first.** The first two reverse something the spec draws, and both for the same
reason: the spec drew a screen, the screen implied a behaviour, and the behaviour made something
necessary impossible. Reading `Disconnect` as a deletion left no way to revoke a token without losing
every per-agent configuration built on the connection. Writing `allow` when a server is added would
let every tool of a server nobody has looked at run unapproved. Decision 52 is the one that most
deserves a second opinion: `Ask for write and delete` allows by name whatever tools a server marks
read-only, which turns a server's own advisory hint into an allow rule with no person in the loop.

**Two permissions findings came out of integration, different in kind.** Decision 38 is a deliberate
choice: on a server saved as `allow`, writing the first per-tool value also records `allow` as the
default for unnamed tools, so they keep the value their rows already show. It is pinned by a case and
flagged for round 4. Decision 42 is a defect the integrator found and fixed: picking
`Ask for write and delete` on a server holding both a permission and a floor cleared the floor and
left the permission, so every tool went on running without asking while the control read `Allow all`.
A person choosing the safer preset got the least safe outcome.

**A third came from the responsive sweep**, on a different axis. Two controls coloured themselves from
a variable that exists only through the desktop app's component library, so on the mobile app both
rendered at the inherited colour: an unstyled string on a shipped surface. Found by rendering every
MCP story at 430 pixels in both themes and looking, which is worth recording because no test asserts
on it and no diff reader would catch it.

**Coverage.** 209 Storybook story files, and a new CI job, `run-storybook-build`, builds them, because
Storybook sits outside the turbo build graph and would otherwise go unbuilt.

**Two API gaps ship unclosed**, both drawn in the spec, each rendering a seam that returns nothing
today so the surface is right the day its field arrives. #6907 is the connection health field behind
an `Unreachable` status, so rows show `Connected` or `Login expired` only. #6908 is the probe response
body behind `Show response`, so that control never appears.

**User documentation is rewritten against the shipped components**, not the spec, which differs from
what shipped in eight places. The MCP guide and the MCP server reference are updated; the agent
configuration reference gained one sentence and the harnesses concept page needed no change.

---

## 7. Product QA

Reports are held outside the repository. Rounds 1 to 4B ran against the pre-redesign screens and
their recordings were lost when the development box rebooted; their findings are not in doubt,
because every disposition and fix revision is written down in the round records. Rounds 5 onward are
recorded.

| Round | Head | Scenarios | Result |
| --- | --- | --- | --- |
| 5 | `c4d8588682` | 5 | 2 pass, 3 not driven on harness timeouts rather than product failures |
| 6 | five heads, `91142ccb4c` to `c43cee3644` | 8 plus one added check | none passed at both widths; the added check passed at both |
| 6b | `c3580e24a2`, `3879833e3e` | 9 | 4 of 9 at both widths |
| 6c | `f5286cd828` | 11 | 6 of 11 at both widths; both acceptance suites green for the first time |
| 6c rerun | `fac66e01b8` | 7 | 5 of 7 at both widths |
| 6d | the head carrying the D131 fix | owed | **not run**, see below |

**One coverage limit, established late and worth stating plainly.** Every row labelled "desktop" in
rounds 6 through 6d was the **mobile app at 1440 by 900**, not the classic app. The rounds' login
helper always entered through the mobile app, and this deployment sends a browser with no stored
preference to the mobile app at any viewport. QA has relabelled its report. So the recorded rounds
cover one app at two widths, 1440 and 430, each in its own context with its own login and recording.

The classic app's MCP surfaces are covered elsewhere, and that coverage is real: the Settings
registry, the connect sheet and the playground agent configuration are driven by the two Playwright
acceptance suites, 11 of 11 on the candidate, and by web7's live tables. The agent screens are served
by the mobile app by design, so there is no classic surface for them to miss. No harness work is
planned in this release to close the gap; it is recorded as a limit rather than a defect.

**The rounds were worth running, and round 6c is the clearest case.** It found the release's one P1
and it corrected two earlier rounds. Round 6 and 6b had both reported that the server accepts a second
connection under a name already in use, filed as a high-severity defect. Round 6c drove it properly
and found the API does refuse duplicates; what the earlier rounds hit was the connect journey adopting
an existing connection when the name and the address are both the same, which is deliberate recovery.
The report says so in as many words: "That was wrong, and this report corrects it."

**The P1 the recorded rounds found.** Reconnect opens its sheet, shows the probe result card at 700
milliseconds, and leaves both `Connect` and `Cancel` disabled at 746 milliseconds, 2.2, 5.2, 10.2,
15.0, 25.1 and 40.1 seconds. Network calls mentioning gateways, MCP or OAuth in those 40 seconds:
none. The empty network log is the sharpest part of the finding. A follow-up run proved the defect is
not in any one entry point: the Settings row menu and the permission drawer's banner behave
identically, and the chat notice is unproven rather than exonerated.

**Round 6d ran.** It is the recorded pass on `0e039373c9`, the head carrying the Reconnect fix. Five
of eleven scenarios pass at both widths. The headline is that the fix holds and is measured: the
reconnect sheet's `Connect` and `Cancel` now enable in 450 milliseconds, where before they were dead
past 40 seconds. The sheet sends no request until `Connect` is pressed, measured unfiltered over ten
seconds, which matches the journey's documented behaviour; the round's own assertion checked the
wrong press and failed a working journey twice before it was corrected.

Both of the round's product failures have since been resolved, and one of them was not a defect. The
chat reconnect notice reported absent **did not reproduce**: the verifier ran the same route twice,
on the head it was filed against and again on the final candidate, and the card is in the document
both times on both apps. The likeliest reason is the coverage limit above, that a browser with no
stored preference reaches the mobile app at any viewport, so a check at desktop width silently tests
the mobile app unless the view is pinned. The rejected-key failure was real and is fixed. Four further failures are harness limits in the rail-row helper and the file card, each diagnosed
in the report.

| Round 6d artifact | Where |
| --- | --- |
| Report | attached to the pull request comment |
| Scenario recordings, the mobile app at 1440 and 430 | attached to the pull request comment |
| Live reconnect evidence, three entry passes at both widths, with network logs | attached to the pull request comment |
| Acceptance results | 11 of 11 on `0e039373c9`, log attached to the pull request comment, and 11 of 11 again with retries disabled on an independent live rerun |
| Final live table on the candidate `e1108531c7`, sixteen checks, all passing at both widths | attached to the pull request comment |
| The earlier table on `004e37d804` | attached to the pull request comment |

**What the recorded rounds have not covered.** No round drove a real MCP server; everything went
against the deployable mock. Three scenarios fail on harness limits rather than product defects and
are named as such in each report. And the chat reconnect notice at phone width is recorded as
unproven rather than passing.

---

## 8. Rollback and disable

Rehearsed on the development stack, on a web image built from the candidate, with a project's real
data in place: three consented OAuth connections, their stored grants, and the endpoints referencing
them.

With the MCP gateway switch off, the MCP data plane refuses with a typed envelope carrying
`mcp_gateway_disabled`, the MCP control plane refuses, and the LLM control plane and the vault secrets
still answer 200. The switch refuses the plane it names and leaves the rest alone. The settings tab
hides too, which took an image built from the candidate to show, because the entrypoint that publishes
the flag to the browser is baked into the image rather than mounted in.

Setting the flag back restored everything: the same five endpoints, the same three grants, and the
same tool counts of 79 and 28 through the gateway, with no reconnect and no consent. The disable is a
switch rather than a teardown.

The migration's downgrade is deliberately a no-op and says so in its own docstring. It was rehearsed
on a scratch database restored from the deployment's own, never against the live one. Both directions
ran clean, with a byte-identical grant slug set across the round trip.

---

## 9. Deferred on purpose

Each is filed rather than remembered, and each is a decision a reviewer can disagree with.

- **#6892. Codex agents see only the first page of a paginated MCP tool list.** The gap is in Codex's
  own client; Pi, Claude Code and the product's tool list all follow the cursor.
- **#6893. An MCP endpoint's timeout above the gateway default is ignored during a run.** Honouring it
  means carrying the resolved budget on the run's wire, a contract change across three layers.
- **#6894. Consent returns to a bare settings page when the app and the API sit on different
  origins.** The shipped topology mounts the API under the app origin, so this affects split-host
  deployments only.
- **#6896. A disconnected server's turn shows both the plain notice and the raw harness failure
  card.** Whether the sentence should replace the card is a product decision.
- **#6897. The mobile agent configuration is not driven by the acceptance suite.** This is the coverage
  that would have caught D94 before QA did.
- **#6907 and #6908.** The two API gaps behind the `Unreachable` status and `Show response`, section 6.
- **#6911 to #6921, plus #6926, #6927 and #6928.** Round 4's deferrals. Two of them are P2 and neither concerns what this release changed.

Three more sit outside the release for scope rather than priority: #6879, a reconnected connection
that can still read as needing a reconnect, because atomicity needs a new column; #6880, host
derivation stripping a path prefix from the wrong string; and #6882, test-account sandbox mount trees
that are never removed.

Six findings in the running log stay open as tracked debt, with no P0 and no P1 among them: OR63,
OR65, OR66, OR68, OR76 and OR81. Five are also tracked in `cleanups.md`.

---

## 10. What is open, and how far anything was verified

**One thing blocks the release, and it is not a defect.** The review gate has seen none of this work,
because the branch that configures its passes is unpushed. The push closes it. What has to be held is
that its completion is **confirmed rather than assumed**: a refusal above the 300-file cap reports as
a passing check, which is how this finding arose in the first place.

**No P1 is open and no product defect is open.** Every finding raised against the product either
landed a fix that was checked in the round or is deferred to a filed issue with its reason.

**Four P2s are deferred and none concerns what this release changed**: a relayed refusal retried as a
session expiry, a refused connect leaving a row that reads connected, a secret that cannot be created
from inside the sheet, and a stored pane preference that hides the phone conversation. Fourteen P3s
are open and none is release-shaped.

**How far it was driven, which changed late and for the better.** On both apps: a wrong key reaches
the rejected-key screen naming its status, in one call where it previously took eleven; a revoked
session no longer claims the server rejected the key; the reconnect path completes at both widths
from three entry points; the notice renders; and the acceptance pair is 11 of 11 with retries
genuinely off.

**Three things are proven at the code and not on the page**, listed so their absence is not read as
coverage: the prototype-key denial, which needs a server willing to advertise such a tool; the readers
failing closed, which needs a sender using the other field convention; and a session expiring inside a
narrow window that could not be forced live.

**One pattern recurred five times.** A guard gets written, the defect is genuinely closed, and
nothing exercises the guard. Four of the five closed once someone looked; one is still open as a P3.

**A second pattern cost more than any single finding, so the record carries it.** A reported
chat-notice regression was neither a product defect nor either mechanism proposed for it. The model
declined to attempt the tool call and answered conversationally, and the assertion fired while the
turn was still running. QA retracted the report; the explanation offered for it was wrong and is
recorded as wrong, because it fitted both runs while having no evidence on the path it named, and it
reached the fix author and the coordinator before a transcript settled it. **An explanation that fits
the observations is not the same as one with evidence on the path it names.**

**What the final check established.** At the pushed head, removing the notice card kills five cases;
removing the hide's scoping kills two, including the one guaranteeing an unexplained failure stays
visible; breaking the card's action kills six; and the ported configuration-pane case kills one.
Production attribution is exact: 364 files against 368 before the merge, with all four differences
accounted for.

**One blind spot, stated rather than left to be discovered.** The rule that decides whether a server
refused a credential tells our own failures from a third party's by the shape of the body, so a
third-party body byte-identical to one of ours is misread as our own session expiring. No rule keyed
on shape can avoid that. It fails toward telling the person their session is the problem, which is the
safer of the two wrong answers.

**One thing this index deliberately does not quote.** A mutation count attached to D95 and D98 was
reported, corrected and left unverified. Neither number is repeated here.

---

*Sources: `MCP-RELEASE-HANDOFF.md`, `mcp-release-gate.md`, `mcp-release-status.md`, `qa.md`,
`open-reviews.md`, `cleanups.md`, `reviews/round-1.md` through `round-4.md`,
`reviews/coderabbit-pass-1.md`, `reviews/coderabbit-pass-2.md`, the design decisions record,
the per-package design reports, and the QA round reports, all held outside the repository.*

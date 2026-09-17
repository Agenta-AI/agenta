# MCP execution status

Updated: 2026-09-16.

Product scope is confirmed and the target UX is implemented. Every journey the release claims now
has live evidence: the connection flow, connection identity, per-tool permissions approved and
denied against a real provider, the recovery journeys, real models driving the harness matrix, and
the plane disabled and re-enabled with nothing lost. Release readiness is not established, and what
is left is verification and the fixes it keeps producing. Three independent review rounds, two
CodeRabbit passes and four rounds of UI QA are now on record. Each verification round has found
real defects in the fixes it was sent to check, including one that shipped a syntax error into the
page it was written to repair, so the rounds are earning their keep rather than rubber-stamping.

**The rebase has happened.** The branch sits on `origin/main` `e5643f00f5` as of 2026-09-16, so every
revision named in this file below the candidate row predates it. Every round-3 blocker is fixed and
verified, the per-tool permission divergence is closed at the wire with all five readers agreeing,
the round-4 dialog defect is fixed on both surfaces, and the runner test fixture that was the last
blocking item in code is closed. **Nothing blocks in code.** The D94 residual, a New MCP server
sheet that closes itself when it is opened and then left untouched, now has a cause and a fix on the
web side and is waiting only on live measurement against the served candidate.

**The scope then grew, deliberately.** The designer's MCP screens are reimplemented across seven
work packages, integrated, simplified and served. That is the surface the release is now evidenced
against, so the recorded QA rounds cover the redesign rather than the screens it replaced, and review
round 4 read the design packages alongside everything else.

**Round 4 closed at ninety-three findings, D95 to D187, checked against `8f8d6eb16a`, the candidate
plus its two closing test commits. No P0, and no P1 open.** **One thing blocks the release and it is
not a defect**: the review gate has seen none of this work, because the branch that configures its
passes is unpushed, so the push closes it. The only thing to hold is that its completion is confirmed
rather than assumed, since the failure mode is a refusal that reports as a pass, which is how that
finding arose. **No product defect is open.** Every finding raised against the product either landed
a fix that was checked in the round or is deferred to a filed issue with its reason. Four P2s are
deferred and none concerns what this release changed: a relayed refusal retried as a session expiry,
a refused connect leaving a row that reads connected, a secret that cannot be created from inside the
sheet, and a stored pane preference that hides the phone conversation. Fourteen P3s are open and none
is release-shaped. Decisions 53 to 58 were recorded while those fixes landed, and several overturn an
earlier ruling and say so.

**The live position, which changed late and for the better.** Everything an earlier refresh of this
file described as unproven on the page has since been driven. A wrong key reaches the rejected-key
screen naming its status, on both apps, in one call where it previously took eleven. A revoked
session no longer claims the server rejected the key. The reconnect path completes at both widths
from three entry points, and the reconnect notice renders. The acceptance pair is eleven of eleven
with retries genuinely off.

**Three things are proven at the code and not on the page**, listed so their absence is not read as
coverage: the prototype-key denial, which needs a server willing to advertise such a tool; the
readers failing closed, which needs a sender using the other field convention; and a session expiring
inside a narrow window that could not be forced live.

**One pattern recurred five times, and it is the most useful thing this record has to say to whoever
maintains this code next.** A guard gets written, the defect is genuinely closed, and nothing
exercises the guard. Four of the five closed once someone looked; one is still open as a P3.

**One blind spot, stated rather than left to be discovered.** The rule that decides whether a server
refused a credential tells our own failures from a third party's by the shape of the body, so a
third-party server whose body is byte-identical to one of ours is misread as our own session
expiring. No rule keyed on shape can avoid that. It fails toward telling the person their session is
the problem, which is the safer of the two wrong answers.

**One piece of real-provider evidence, and what it is not.** Every driven check in this record went
against the deployable mock. The exception is manual: Mahmoud connected Linear and several other real
servers to this candidate by hand and they work. There is no transcript and it closes nothing, so it
is not a check. It is worth a sentence because two earlier rounds concluded the residual risk sits in
client seams only a real server exercises, and this is the first evidence of any kind that those
seams hold.

## Candidate revisions

**Every revision in the table below the first was rewritten by the rebase.** The branch was rebased
onto `origin/main` `e5643f00f5` on 2026-09-16, so each hash below names a commit as it existed
before that rebase. They stay in the record because each measurement was taken against the tree that
hash pointed at, and the rebase preserved content rather than changing it, so the reading each one
carries is still the reading that was taken. They can no longer be checked out from the pushed
branch. Anyone reproducing a range needs the pre-rebase reflog or the pull request's own force-push
history.

Two things had to survive the rebase and did. The gitleaks fingerprints are anchored to a commit, a
file and a line, so they were regenerated last, after the rebase and immediately before the push.
The CodeRabbit filter blocks were re-measured, because the file counts they were sized against
changed.

| Revision | What it is | Notes |
| --- | --- | --- |
| `CANDIDATE_SHA` | **The rebased head, and the release-ready candidate** | Base `e5643f00f5`. Every row below this one predates the rebase. This is the only revision the gate's evidence index names. |
| `60d71db7d6` | The head UI QA round 4B ran against | Verified before and after each rerun. Seventeen commits had landed since when this row was written: eleven on the API side from CodeRabbit pass 2 and from D54 and D76, and six on the web side, including D88's editor label and the round-4 fixes for D3, D4, D5 and D6. The branch moves under fix batches, so a row measured elsewhere names its own revision. |
| `5c67a2e871` | The revision independent review round 3 read, and the fix for round 4's critical | It repairs the callback page's inline script, which `c82e131791` had shipped as an unterminated string literal. `664838e419` landed during the round and is treated as part of that head. |
| `d50739d927` | The revision UI QA round 4 tested | It carried six fixes: D50 (`4ee17eab78`), the blocked-popup return route (`c82e131791`), D51 and D52 (`1dfece1e66`), D53 (`d50739d927`), the tool filter (`a3ac5f33b0`), and a quadratic refusal-marker read (`d4a6eab93a`, which also clears the CodeQL alert). Round 4 passed four and failed two. |
| `664838e419` | The revision CodeRabbit pass 2 read | 238 files. |
| `4c698fb068` | The last revision CI was read at before the rebase | 73 checks passing. Before the CodeQL fix landed. |
| `23dc332d94`, `99b270da8d`, `73befe23f0` | Earlier interim heads, not candidates | `23dc332d94` completes round-2 D31 with its web half. `99b270da8d` fixes CodeRabbit's N3, the last release-relevant finding of the incremental review. `73befe23f0` removed a stack trace from a gateway error body. |
| `b0ac98f7f7` | Candidate 2, pushed | The last candidate cut before the rebase. No candidate 3 was cut; the rebased head above supersedes it. |
| `3d0bff5dee` | Candidate 1, pushed; the revision independent review round 2 read | Base main `236619ebb768`. Round 2 read two ranges at this revision: everything since round 1 across the tree, and the entire frontend, which had never been reviewed. |
| `528204c3d9` | The revision independent review round 1 read | 67 files against base `6df148cb39`, api, sdks and services only. Frontend, docs and hosting were out of scope for that round. The round record is `reviews/round-1.md`. |
| `6df148cb39` | The baseline this work started from | Recorded here so a later reader can reproduce any range in this file. |

**What candidate 2 adds over candidate 1.** Seven round-2 fixes: the connect journey finishing at
all (D22, `cd9e6f2c16`), a journey that is no longer mounted once and never reset (D23,
`40ed49f5a1`), the client-registration pin surviving the first token refresh (D24, `98e1ddb6e4`,
which had re-opened round-1 D6), the API half of giving discovery its own write instead of replaying
the endpoint row (D31, `cb3a277fdc`), comparing the credential a reconnect changes rather than the
row holding it (D33, `dd8f6066e3`, which had re-opened round-1 D21), Claude MCP rules that resolve
the way the runner gate does (D37, `341a9c16c6`), and a bounded probe (D38, `fd278ec1ca`). D26
closed with D22.

It also carries four pieces of housekeeping that matter to the gate. Two gitleaks fingerprints
silence a scan failure on test placeholders in an earlier commit (`b22103906d`); they are anchored
to a commit, a file and a line, so they were regenerated after the rebase and before the push. The
CodeRabbit filters now repeat the organization's own exclusion patterns
(`380fb211f4`). The services acceptance suite asks the deployment which planes it serves and skips
the LLM-plane cells when the plane is off (`4c700242a2`), and preview environments opt the LLM
gateway back on (`12de9af964`) so the coverage is kept; that template change is additive-first and
reaches clones only once Mahmoud applies it to the live Railway template. And the gateway mocks no
longer restart on unrelated edits to the api source tree (`1279bca935`), which was killing in-flight
requests and wiping the mock issuer's registered clients mid-consent.

The harness matrix is honest for the first time. The suite at
`services/oss/tests/pytest/acceptance/test_agent_gateway_route.py`
reported 27 of 27 green at the baseline, and nine of those cells, all
the Codex ones, passed on a call that never left the sandbox: the round-trip check accepted the
marker anywhere in the body and any tool result at all, including a refusal. Tightening that check
turned the nine red, which was the correct reading, and restoring a measured Codex fallback rather
than a guessed one (`0ef39557e0`) turned them green for real. The suite now reports 27 passed in
322s with every cell reaching the mock MCP server. A green row here is still not proof on its own;
read it beside the gateway's own request log, as `qa.md` says.

## Status

| Work | Status | Evidence / next action |
| --- | --- | --- |
| Product decisions and handoff | Documented | `release-decisions-2026-09-15.md` and `MCP-RELEASE-HANDOFF.md`. |
| Independent plane switches | Implemented | Each gateway plane has its own product switch (`79db42dade`). `AGENTA_LLM_GATEWAY_ENABLED` defaults to false and `AGENTA_MCP_GATEWAY_ENABLED` to true, both in `api/oss/src/utils/env.py`. The SDK falls back to the pre-gateway path when a plane is disabled (`6e8303a760`), which closes the premise that previously blocked this row: the vault call site was deleted rather than gated, and it is now restored when the API answers `llm_gateway_disabled`. The frontend hides the MCP endpoints tab when the gateway is off (`6b4e80c123`). The legacy-path changes no flag covers are dispositioned in OR82, all six kept. |
| LLM plane off-mode | Verified live | `acceptance/gateways/test_llm_gateway_disabled_acceptance.py` passes four of four against the integrated EE dev stack with the LLM plane off (`88f3863643`). The whole gateway acceptance directory reports 23 passed and 20 skipped in that mode, the skips being exactly the LLM suites while every MCP suite still passes. |
| Multiple accounts and connection identity | Verified live | An agent names the connection it means rather than a label (`a241608686`). Live evidence in `qa.md`, section "Connection identity", driven through the API as a browser drives it against commit `1762cc19fc`: a disposable account, a real session, the mock issuer's own endpoints, the real callback and a real `tools/call`. Unit and integration coverage in `integration/gateways/test_mcp_oauth_connection_identity.py`. |
| Grant rekey migration | Verified live | Grants are keyed on the connection rather than the server URL (`bfef8e3bdb`, `2d9a735bd2`), the migration survives an occupied destination (`6972c570b3`) and reports what it leaves behind (`f133fe435f`). Run against the deployment's own rows in `qa.md`, section "The migration, run against the deployment's own rows": both real-provider connections migrated silently and needed no reconnect, six connections that had been sharing one grant row now read as needing authorization, and no grant row is referenced by more than one connection. Eleven grant rows became ten. Coverage in `integration/gateways/test_mcp_oauth_grant_rekey_migration.py`. |
| URL-first Connect flow | Implemented | Register-then-connect is replaced by one URL-first journey (`3aabda12f3`), backed by a read-only server probe (`e1cc2a8a71`). The list moved into a shared settings section both hosts render (`1712960cc4`), the mobile app gained the tab (`2bc9a05f29`), and an agent picks a connection instead of describing one (`7bf052bc43`). Disconnect keeps the connection (`3fb9b8aeca`). Browser evidence is the Playwright row below; the recorded UI QA pass is round 5, on the rebased candidate. |
| Per-tool permissions | Verified live | SDK policy (`e5e9957d90`), fail-closed runner intake (`90c4c2f231`), and the agent-configuration editor on both hosts (`0308fb9c7e`). Live evidence in `qa.md`, section "MCP permissions: discovery, policy, call, approval, resume": fourteen cells pass across Pi, Claude Code and Codex, covering deny, ask-rejected, ask-approved, allow, per-tool over server, per-tool deny, sibling deny, and two connections rendering one tool name. Every cell is read against the gateway's own request log rather than the model's reply. No real model credential is used; the cells run against the compose mock LLM, which is sufficient because the gate is what is under test. Unit coverage: `web/packages/agenta-entities/tests/unit/mcpToolPolicy.test.ts`, `web/packages/agenta-entity-ui/tests/unit/mcpToolPermissions.render.test.tsx`, `services/runner/tests/unit/mcp-permission-intake.test.ts`. |
| Reconnect and recovery journeys | Verified live | An upstream that refuses the stored grant is treated as a reconnect rather than relayed as a 401 (`024afa4061`, OR83). A connection holding no authorization is offered a reconnect (`44728bf68d`, OR84) and the refusal's connect action now reaches the caller (`ebde9ae1a8`, OR85). Live evidence in `qa.md`, section "A disconnected MCP connection offers the way back (OR85)", which also records the three layers that each dropped the refusal body. Integration coverage against real Postgres and a controlled upstream in `integration/gateways/test_mcp_oauth_connect.py` (`6db7d11245`). |
| Audit | Implemented, one gap deferred | An MCP call records what it did, how long it took and which run made it (`b9f6ce0b24`). Round-1 finding D11 stays deferred with its closure stated in the code: a refusal raised before the audit recorder produces no audit event. |
| Real-provider OAuth registration | Verified live, registration and consent only | The client-resolution fix (`508ea1a024`) precedes the first successful registrations, and two providers hold OAuth clients and grants created after it. A client registration is now keyed on the stored redirect URI rather than the issuer alone (`ab3944ef67`, OR78), and a registration the grants still need is kept (`d1d2eb0e72`, round-1 D6). Discovery through policy to execution against a real provider is proved; see the row below. |
| Tools and permissions on a real provider | Verified live, read-only; the write cell is not run | The blocker cleared: both providers were re-consented in a browser into a disposable project, and `qa.md` section "Real providers: Linear and Axiom" records the first evidence that a real server's registration, consent and discovery work end to end. Through `POST /gateways/mcps/custom/{slug}`, Linear answers `initialize` as `Linear MCP` 1.0.0 advertising 79 tools and Axiom as `Axiom MCP Server` 0.1.3 advertising 28, both the provider's own lists. One read tool, Linear's `list_teams`, was then called and returned the workspace's teams: the first `tools/call` this project has made to a real MCP server through the gateway. Two traps are written down for anyone repeating it, because each costs an hour: the data plane reads `X-AG-Credentials` and ignores `Authorization`, answering a bare 401 that reads like an unconsented connection, and a real server frames its reply as SSE, so a client calling `.json()` sees zero tools rather than failing. The throwaway write is not run: the authorization was for a scratch team and the workspace has none, only five real active teams whose issues the people who work there would see. The driver for allow, ask-approve, ask-deny and read-only exists and is proved against the mock; it needs a team name from Mahmoud, and a quiet-looking real team is not a substitute. **The agent path now works, and per-tool permission is proved against a real server.** Three Pi agent runs in `qa.md` section "The agent path, through a Pi agent run", all read from the gateway's request log rather than from what the model said: on `ask` approved, the `tools/call` lands between the two model calls and the tool returns the workspace's five real teams; on `ask` denied, the two model calls sit back to back with no MCP request between them and the model stops rather than reshaping the call; on `deny`, the tool is never offered and discovery stops after `tools/list`. That pair of approve and deny is the difference this row could not show before, visible as one line in a log rather than as a claim about the model. Getting there took three fixes a mock could not have forced: D54's protocol version on `initialize`, D56's SSE framing (`a96b45c400`), and OR91's `_meta` envelope that the upstream then validated (`005207efe7`). Judging the read-only cell needs one distinction that cost a false failure first time: the harness raises its own gate for its shell tool whenever the model inspects its environment, so a cell asserting on gates has to resolve each gate to a tool name and ignore the ones that are not the server's. |
| MCP OAuth consent end-to-end | Implemented; mock-verified, browser leg pending | `acceptance/gateways/test_mcp_gateway_oauth_consent_acceptance.py` passes on the demo stack against the direct address, and the gateway acceptance directory is green with the mocks on. The two earlier obstacles are fixed: the session cookie scheme mismatch (`e0365826d8`) and the published-address mismatch, which `AGENTA_MOCK_MCP_GATEWAY_PUBLIC_URL` settles (`9190854e7d`). The mock issuer also has a registration endpoint now (`bfd05732e0`) and both ways the gateway names itself to an issuer are covered (`82bb0ed1ea`). The browser leg is now driven too: UI QA round 3 ran the whole journey against the public address, with a real `window.open`, a real cross-page callback, the popup closing itself and the parent dialog completing. One thing is still exercised nowhere, and it is worth stating plainly rather than implying: the mock issuer has no consent screen, so nobody has read a provider's consent page and clicked Authorize on it. Abandonment was driven by aborting the authorize navigation before a code is issued, which is what abandoning a real consent page does. |
| Browser acceptance suites | Verified live, and a manual gate step | The suite that drove the old flow is replaced by seven cases in `web/oss/tests/playwright/acceptance/settings/mcp-connect.ts`, driven by the OSS and EE `mcp-connect.spec.ts` files (`548d1e4aef`): connect without authentication, the name suggested from server metadata, a duplicate display name refused in the field, two connections to one URL kept apart, remove, the tool list on a connection, and the OAuth path through the mock issuer ending in a disconnect that keeps the connection. The OAuth case needs `PLAYWRIGHT_HOST_RESOLVER_RULES` so the browser resolves the address the issuer publishes. Exercising the flow against a running stack found and fixed four defects reading alone had not: a Disconnect offered on a connection holding no grant, a journey that never left tool discovery, a connected state showing two buttons both labelled Done, and journey state surviving into the next attempt. **All seven pass** against the integrated EE dev stack on the direct address, in 1.7 minutes, with no MCP variables exported. **This suite is a manual gate step, in those words.** It runs by default now rather than skipping on two variables that were set nowhere (D25), and it fails with an actionable sentence when the mock upstream does not answer rather than reporting green. It is deliberately not wired into the Railway workflow: that job points at a deployed preview which runs no mock container, so enabling it there would fail for the absence of a fixture rather than for a defect. Closing that gap is the same job D19 and the row below describe. Until it exists, the pass is recorded here, by hand, against the revision tested. Over the public tunnel the suite ran six of seven, twice; the seventh was D53, the deployment's mock gateway configuration rather than a defect, and it is fixed at `d50739d927` by dialling the mock where it publishes itself. A flake in the suite's own waits was fixed separately (D49, `3fe16196a3`), an assertion that matched the wrong message at D51 and a missing attempt check at D52 (`1dfece1e66`), and the agent playground is now driven as it actually behaves (`ba4875a1f4`, `2b59e67cb6`). No tally has been recorded since those landed, so the current pass rate is unknown and owed; the rebased-head run settles it. |
| Mock-backed OAuth suites in CI | Pending, deliberately deferred | Both mock-backed suites skip unless `AGENTA_GATEWAYS_MOCKS_ENABLED` is true and the two mock containers exist. No workflow sets that variable, names either container, or brings a compose stack up, and the one job running the api acceptance layer points at a deployed preview rather than starting a stack. Closing the gap needs a new job that builds the dev API image, brings a dev stack up inside the runner and calls the stack test script. Round-1 finding D19 records the same gap from the host side. Not a blocker for this release. |
| Independent review round 1 | Documented, closed | Two reviewers read `528204c3d9` independently. Codex at medium reasoning said do not ship on seven findings; the second reviewer said ship with fixes on two. After verification and merge: seventeen findings, closing at zero open, seventeen closed, one withdrawn and four deferred. Record and per-finding verification in `reviews/round-1.md`; round closed in `91083db1b7`. |
| Independent review round 2 | Documented, open | Two reviewers read `3d0bff5dee` independently, across everything that changed since round 1 and the whole frontend, which had never been reviewed and was given the weight of a first review. Both said do not ship. After verification and merge: twenty-four findings plus four quality notes, no P0, five P1. The five blocking findings were D22, D23, D24, D25 and D26. All five are now closed, D31 included once its web half landed (`23dc332d94`). **The round record is the count of record: thirty-four closed, five part fixed and ten open, with no P1 remaining.** An earlier refresh of this file carried twenty-eight closed, four part fixed and fifteen open with one P1; that count predates four fixes and is superseded. Read `reviews/round-2.md` rather than this row when the numbers matter. The round has since absorbed the findings that QA and the real providers produced rather than opening a separate log for them: D54 the protocol version on `initialize`, D55 the returned traceback, D56 and D57 the two Pi client defects, D58 the mock made as strict as a real server, and D59 deferred with a stated closure. Nothing was withdrawn: every mechanism either reviewer described was confirmed against the code. |
| Independent review round 3 | Documented, closed | Two reviewers read `5c67a2e871` against base `236619ebb768`. Twenty-eight findings, no P0, five P1, plus D90 found and closed during the round. All five blocking findings fixed and verified. D88, the per-tool policy divergence, reopened after its first fix reached one reader of five and left the wire unchanged, and is closed at the wire with all five readers agreeing. The round closed at D94. Record in `reviews/round-3.md`. |
| Independent review round 4 | Documented, open | Two reviewers read `0dcf27bf0c` against base `e5643f00f5`, verified at `b9de76fcef`. The scope was two bodies of work: the round-3 fixes and the rebase, and the MCP screen redesign, seven work packages reimplementing every MCP surface on both apps, which is the larger half and which no previous round had read. **The verdicts disagreed, and that is the round's most useful output.** Codex filed one P1 and five P2 and closed with "this review does not establish release readiness", having run none of the suites in its brief because a read-only sandbox could not materialise the candidate. A fresh Opus reviewer with no history in rounds 1 to 3 filed no P1, ran every suite in its brief, quoted counts, and said it would ship. The Codex review read narrowly and ran nothing, and still produced four findings Opus did not, two of them at the wire rather than in the copy. Two findings were reached independently by both, and those are the only two. **The record closes at ninety-three findings, D95 to D187**, checked against `8f8d6eb16a`, no P0. By verified severity: 4 P1, 45 P2, 39 P3, with five rows carrying none, so the columns sum to 88 against 93 rows and the record says so. All four verified P1 have landed fixes that were delta-checked in the round, with every mutation rerun rather than taken from the fix's own report. Record in `reviews/round-4.md`. |
| Design implementation | Integrated and served; QA, simplify and review owed | The designer's MCP screens are reimplemented across **seven work packages**: shared primitives and the token bridge, the data layer, then the connect sheet, the agent rail and add-server drawer, the permission drawer and the Settings registry in parallel, then mobile parity and the chat banner. The integration head is `91142ccb4c`, deployed on the demo stack. Every surface is drawn by shared components both apps render, so classic and mobile land in the same commits, and each package ships rendered tests and Storybook stories. **The settled answers are `design/design-decisions.md`, thirty-six numbered decisions** against a spec digest of fourteen screens and twenty-eight ambiguities; five are flagged for Mahmoud and the designer. Two of those matter to anyone reading the product: the row menu keeps both `Disconnect`, which gives the login back and keeps the row, and `Remove`, which deletes, five items where the spec drew four, because the spec draws no way to delete at all; and a newly added server writes no server permission, so its tools follow the agent's own policy rather than running unapproved. **Four things the spec draws need data the API does not return**, and they ship without it: #6907 the connection health field behind an `Unreachable` status, and #6908 the probe response body behind `Show response`, with #6909 the cached tool count closed as a duplicate of #6907. Each renders a seam that returns nothing today, so the surface is right the day the field arrives. User documentation is rewritten against the shipped components rather than the spec, which differs from what shipped in six places. |
| D94 and its residual | Fixed, live verification pending; owner web | D94 was not a dialog defect: one configuration intent minted a session per tap, so a second tap remounted the workspace under the first and took the open pane with it, which is why the sheet closed itself and `Create` sat inert. Fixed on mobile by allowing one navigation at a time with the latch released on both outcomes (`9b41e8d639`) and on desktop by stopping the config-only view remounting the panel on a self-commit (`887e4d7f77`). The mobile acceptance path that would have caught it is deferred as #6897. **The residual now has a cause and a fix**, and it is numbered as the residual under D94 rather than as a new finding. The symptom was a New MCP server sheet that closes itself when it is opened and then left untouched. The cause is a save the person did not ask for: the agent auto-saves a new revision 1.5 seconds after any edit, and saving empties the draft. The shared configuration pane read **any** emptied draft as the person having discarded their edits, and a discard remounts the form to clear editor state. That remount sits above the open sheet, so the sheet went with it. Only the mobile app reached it, because classic switches to the new revision before the draft clears, so the emptied draft is never read in the discarded sense there. **The fix distinguishes a commit consuming the draft from a person discarding it**, with all three commit paths now marked as consuming, and the pane no longer remounts on a commit. A six-case predicate test pins the rule, which is the right shape for a defect whose whole content is one predicate reading two different events as one. The commits are cherry-picked onto the candidate; their revisions go in at `D94_RESIDUAL_SHAS`. **This row stays "live verification pending" until the fix is measured on the served candidate**, which round 5 takes. A fix verified against the finding and not against the running product is what reopened D88, and that lesson is close enough to this one to apply it. |
| Running finding log | Documented | `open-reviews.md` runs OR36 to OR90, fifty-five findings: forty-eight closed, six open and one withdrawn, recounted from its own headings on 2026-09-16. OR91 was opened and closed after that recount and has no entry there; read it in `qa.md` instead. The six open are OR63, OR65, OR66, OR68, OR76 and OR81, unchanged for days. No P0 and no P1 remain; the highest open severity is P2, carried by OR76 alone, and the other five are debt tracked in `cleanups.md` as CU15 to CU17, CU19 and CU20. The findings added since the last refresh all came from running the product against something real: OR87 an endpoint needing no key never offered to an agent, OR88 a custom connection naming Anthropic registered as an OpenAI one, OR89 the traceback returned to a browser, OR90 a subscription connection sent to a gateway with no route for it, and OR91 the `_meta` envelope the client sent and the upstream then validated. |
| User-facing documentation | Documented | The MCP how-to and the two reference pages describe the implemented flow: the Connect journey, connection identity, the per-tool permission editor, the gateway connection shape and the permission fields. Every harness now accepts connected MCP servers, which the concepts page reflects. The two doc pages carry a notice that they await release verification; remove it once the round-5 UI QA pass lands. |
| CodeRabbit review | Two passes complete and triaged; a final pass owed | The file-count cap is worked around by a branch-scoped `path_filters` block (`2637a5651b`), which now also repeats the organization's own exclusion patterns (`380fb211f4`); see the section at the end of this file. Pass 1 covered production source and infrastructure at `3d0bff5dee`, the first review CodeRabbit has performed on this pull request since it began refusing it on 2026-08-14. It posted 39 findings: 19 inline as Major and 20 as Minor inside a collapsed summary section that is easy to miss. All are dispositioned in `reviews/coderabbit-pass-1.md` as 23 real, 4 not applicable and 12 deferred, and every real one's fix revision is recorded there. A later incremental review added N3, which is fixed (`99b270da8d`), and N5, a credential-invalidation race deferred as issue #6879 because closing it properly needs a schema change out of scope for this gate. Pass 2 ran at `664838e419` over 238 files: the tests, the configuration that runs them, and the infrastructure and repository configuration pass 1 excluded. 15 findings, 6 Major and 9 Minor by CodeRabbit's labelling, dispositioned in `reviews/coderabbit-pass-2.md` as 9 real, 4 deferred and 2 not applicable. Both halves of the split have now been reviewed, which was the point of splitting. **A final pass on the rebased head is owed**, run with the source-side filter block, with the file count re-measured first: pass 1 was at 288 files against 300 when last measured, and a pass that crosses the cap becomes a silent skip reported as a passing check. A skip is not approval, so confirm the banner was absent before reading it. A push during the opening minute of a review also cancels it silently while its check row still reads "Review completed"; that happened once on pass 2. |
| Real models through the gateway | Verified live | The mock matrix stays the deterministic gate; this sits beside it and proves what a mock cannot, that a model chooses the tool, reads its result and reports it. Nine cells in `qa.md` section "The real-model matrix", three harnesses crossed with the three mock MCP namespaces, which is the complete equivalent set rather than a subset: the mock matrix's third axis is the LLM namespace, and a real model can only arrive through a `custom` endpoint. Nine of nine pass. Pi on `~deepseek/deepseek-v4-flash-latest` and Claude Code on `anthropic/claude-haiku-4.5` run through OpenRouter, which is what removes the Anthropic-credit blocker; Codex runs on `gpt-5.4-mini` direct from OpenAI, because it validates the model id against a list compiled into its binary. Total cost 19 cents on OpenRouter plus a few cents on OpenAI. Every cell raised the approval gate, parked, resumed on approval and produced a `tool-output-available` carrying the marker, and every closing sentence is the model's own rather than the mock's fixed string. The models were chosen by probing each candidate with a real tool on each protocol, not by reading a capability listing, after the cheapest listed candidate proved inconsistent across two identical probes and the second cheapest made no tool call at all. |
| UI QA | Five recorded rounds; one coverage limit | Reports are held outside the repository. Rounds 1 to 4B ran against the pre-redesign screens and their recordings were lost when the development box rebooted; their dispositions and fix revisions are written down, so no finding rests on the video. Round 5 drove five scenarios, two passing and three not driven on harness timeouts rather than product failures. Round 6 drove eight scenarios plus an added check at five heads, and none of the original eight passed at both widths. Round 6b drove nine, four passing at both. Round 6c drove eleven, six passing at both, and reran seven on the integration head with five passing at both. **One coverage limit, established late.** Every row labelled "desktop" in rounds 6 through 6d was the mobile app at 1440 by 900, not the classic app: the rounds' login helper always entered through the mobile app, and this deployment sends a browser with no stored preference to the mobile app at any viewport. QA has relabelled its report. The recorded rounds therefore cover one app at two widths, 1440 and 430, each in its own context with its own login and recording. The classic app's MCP surfaces are covered instead by the two Playwright acceptance suites, eleven of eleven on the candidate, and by web7's live tables; the agent screens are served by the mobile app by design, so no classic surface is missed there. No harness work closes this in the release, and it is recorded as a limit rather than a defect. **Round 6c is the round that earned the series.** It found the release's only high-severity defect, the Reconnect deadlock, and it corrected two earlier rounds: what rounds 6 and 6b had filed as a server accepting a duplicate name turned out to be the connect journey adopting an existing connection when the name and the address both match, which is deliberate recovery. Its report says so in as many words. |
| Recorded product QA | Captured; one round owed | Scenario recordings exist for rounds 5, 6, 6b and 6c at both widths, with per-step screenshots and the network log beside each, plus four targeted probes recorded end to end: the Reconnect deadlock, the same stall from two entry points, a preset followed by a per-tool override surviving a reopen, and an override surviving Done and a reopen. The recordings from rounds 1 to 4B are gone and the screens they covered no longer exist, so they are not recaptured. **Round 6d is owed**, the recorded pass on the head carrying the Reconnect fix. |
| CI | Runs again on the rebased head | Read at `4c698fb068` before the rebase: 73 checks pass. The conflict with main that made GitHub skip the `pull_request` workflows is resolved by the rebase, so a full run is available again and is the first since the conflict began. Two things had to survive the rebase and did: the gitleaks fingerprints were regenerated last, because they are anchored to a commit, a file and a line; and the CodeRabbit filter blocks were re-measured, because the redesign moved the file counts. A new job builds Storybook, which sits outside the turbo build graph and would otherwise go unbuilt. The web acceptance job is failing and is ignored by decision, which is a decision to record rather than a result to cite. |
| Rollback and disable | Verified live | `qa.md` section "Rollback and disable", rehearsed on the development stack with a project's real data in place: three consented OAuth connections, their grants, and the endpoints referencing them. With `AGENTA_MCP_GATEWAY_ENABLED=false` the MCP data plane refuses with a typed envelope carrying `mcp_gateway_disabled`, the MCP control plane refuses, and the LLM control plane and the vault secrets still answer 200, so the switch refuses the plane it names and leaves the rest alone. The settings tab hides too, which took an image built from the candidate to show: the entrypoint that publishes the flag to the browser is baked into the image rather than bind-mounted, so an older image cannot be made to carry it by recreating the container, and a first attempt wrongly recorded the tab as staying visible. Setting the flag back restored everything, the same five endpoints and three grants and the same tool counts of 79 and 28, with no reconnect and no consent. The disable is a switch rather than a teardown. The migration's `downgrade()` is deliberately a no-op and says so in its own docstring; rehearsed on a scratch database restored from the deployment's own, both directions ran clean with a byte-identical grant slug set across the round trip. |
| Deferred, with issues filed | Documented | Deliberately not fixed for this release, each filed rather than remembered. #6892 Codex agents see only the first page of a paginated tool list. #6893 a raised per-endpoint timeout is ignored during a run. #6894 a blocked-popup consent lands on a bare settings page where the app and the API answer on different origins. #6896 a disconnected server's turn shows both the plain notice and the raw harness card. #6897 the mobile agent-configuration acceptance path. #6907 the connection health field behind an `Unreachable` status, and #6908 the probe response body behind `Show response`, both shipping as seams that return nothing so the surface is right the day the field arrives. **#6911 through #6921, plus #6926, #6927 and #6928, are round 4's deferrals.** Three more sit outside the release for scope: #6879, #6880 and #6882. Round-2 D11 and D59 stay deferred with their closures stated in the code. |
| MCP release gate | NOT READY | **Nothing open is a defect.** One thing blocks, and the push closes it. 1. **Confirm the merge with main.** The first push showed the branch 195 commits behind, and main is merged in as one commit, `6bc881dfc4`, rather than a rebase, so the review history stays addressable. Main's rewrite of the mobile chat turn row re-homed the reconnect notice, the run-failure callout and the retry into its activity timeline, and main's own configuration-pane mechanism replaced this release's fix for the stored pane preference, with the test ported onto main's mechanism and issue #6930 left open under it. The merge produced three findings of its own, which is why a clean merge is not the same as a correct one: the retryable class gate had to be ported into main's version of the callout; the overview screen lost its edit-config behaviour to a prop main computes and never passes; and one file merged without conflict while importing a module the merge had deleted, which only the type-check caught. The chat surface was re-checked on the merged head by a targeted QA pass and both acceptance suites; see the evidence comment on the pull request for the results. 2. **The push.** The review gate has seen none of this work, because the branch that configures its passes is unpushed. 3. **CI** on the pushed head, the first full run since the branch began conflicting with main. 4. **Both CodeRabbit passes**, at 140 and 182 files, **confirmed complete rather than assumed**. That confirmation is the whole of this step: the failure mode is a refusal above the 300-file cap that reports as a passing check, which is how the finding arose in the first place. 5. **The evidence post**, with the recordings attached and the release-ready revision named in one place. |
| LLM SDK and wallet work | Later | Not required for MCP readiness. Wallets are on a separate branch. |

**A correction, because an earlier reading of this file named the wrong cause.** The agent path's
failure against a real provider was first attributed to a doubled `/api` prefix. That prefix is
inert on this stack and is being handled separately, as a stack override and a filed issue. The
causes were three defects in a row that only a real server could find, and the pattern they share is
the point. D54: both runner MCP clients sent `MCP-Protocol-Version` on the `initialize` request,
which is the request that negotiates it, so a server enforcing the transport specification answers
400. D56: the Pi client stripped SSE framing only when a body began with `data:`, and a real reply
begins with `event: message`, so its first request threw and the server was dropped as a failed
handshake. OR91: the client stamped an `_meta` envelope that the upstream then validated against
rules the client did not satisfy. Linear enforces all three. The compose mock enforced none of
them, so every mock cell and every real-model cell passed while a real upstream refused every turn.
A suite built entirely on obliging mocks measures the client against itself. Three things now break
that circularity and are worth defending as such: the real-server probe case, the real-model matrix,
and the mock made as strict as a real server (D58, `14ef19e60b`).

## Waiting on Mahmoud

Three items are outside the team's reach. Each blocks something in the gate.

1. **Name a scratch team for the Linear write.** The driver is ready and proved against the mock.
   The workspace holds five real active teams and no scratch one, and an issue created in any of
   them is visible to the people who work there, so no substitute is acceptable.
2. **Apply the Railway template.** The preview LLM-plane flag is committed but additive-first, so
   it reaches clones only once `apply.sh` converges the live template. Until then a preview stack
   serves no LLM gateway, and the cells that prove a gateway refusal reaches the caller with its
   code cannot run there.

   Those cells now FAIL rather than skip when the plane is off (D77), because a suite that reports
   green while running nothing is the thing that record exists to stop. So the preview job carries
   `AGENTA_TESTS_EXPECT_LLM_GATEWAY=off` in `.github/workflows/44-railway-tests.yml`, which says
   out loud that this run expects a stack without the plane. **Delete that line when the template
   apply lands**, or the preview goes on covering nothing and goes on saying so quietly.
3. **Delete CodeRabbit's 2026-09-12 learning** against repository-wide path filters. It predates
   the branch-scoped approach and argues against the fix that got the review to run at all.

## Decision history

Mahmoud confirmed project-wide multiple accounts, stable slugs and IDs, editable names, configured
selection, our own MCP gateway, deferred infrastructure work and phased release. He clarified that
LiteLLM SDK applies only to LLM evaluation. He requested the integration-style MCP Connect flow,
auditability in this PR and autonomous work through the release-ready gate with Astra medium and
CodeRabbit feedback loops.

Name suggestions and authentication discovery use fallbacks because arbitrary server metadata is
not guaranteed. Runtime proof now covers the target UX on the paths listed above, driven through
the API and the runner against a live deployment, and three rounds of UI QA cover a person using
the product in a browser.

## Known limitations

Two, both understood, both filed, both shipping as they are.

**Codex agents see only the first page of a paginated tool list (D91, #6892).** A server that lists its
catalogue across several pages is only partly visible to an agent on Codex: the model is never told
the rest of the tools exist, so the turn reads as a model that chose not to use one. Pi and Claude
Code both follow the pagination cursor, and so does the tool list in the UI. This one is not ours:
the gap is in Codex's own MCP client. It was measured while fixing the same defect in the runner's
client (D69), by moving the marker tool to the last page so the harness matrix had to follow the
cursor to find it. Nine Pi cells and nine Claude Code cells pass, and all nine Codex cells fail.
The marker went back on the first page rather than holding the matrix red on a limitation we cannot
fix, because a permanently red suite hides every other regression. It carries a finding number so
that it is not rediscovered later as a gateway bug; the entry is in `reviews/round-3.md`.

**A raised per-endpoint `timeout_seconds` is ignored during a run (#6893).** Setting an endpoint's
timeout above the gateway default looks like it applies and does not: a tool call is still bounded
by the default and cancelled at it. Nothing carries the stored value to the runner, so the client
bounds a call by a constant derived from the gateway's budget rather than by a resolved
per-endpoint setting. Found as a residual of D65, whose own defect, a ten-second handshake bound
applied to tool calls as well, is fixed. Honouring the setting means carrying the resolved budget
on the run's MCP wire, which is a contract change across the API, the SDK and the client.

**A blocked-popup consent still lands on a bare settings page when the app and the API are on
different origins (#6894).** D71 ships as the origin allowlist and nothing more: the callback page
now posts the consent result to every origin the deployment declares, which is the half that
matters for a deployment answering at more than one address. The other half is the tab-return
fallback, which sends a person to a scoped path the tab wrote down before it left. Where the app
and the API sit on different origins that storage is not readable, so the fallback lands on the
bare settings page instead of where the person started. Deferred rather than missed.

## Open decisions

One, and it ships as it is unless someone says otherwise.

**Where the tool list is shown after connecting.** The connect journey has two endings, decided by
the host that opened it. From settings the dialog stays open, discovers the server's tools and
shows them. From an agent's configuration it closes the moment the connection exists, so the form
can take the connection and the person can carry on; tool discovery never renders there, and the
tools are seen afterwards from the connection's entry in settings. Deliberate for now: someone
adding a server mid-configuration is in the middle of another task, and a tool list they did not
ask for is an interruption. The counter-argument is that the tools are what the connection is for,
and the agent path is exactly where its permissions are about to be set. Written up with the
mechanism in `mcp-connection-ux.md`, to be decided on evidence from both paths rather than now.

## Getting this pull request reviewed by CodeRabbit

CodeRabbit refuses a review above 300 changed files and reports the refusal as a passing check, so
its green mark on this pull request means nothing was read. The cap is a platform limit rather than
a setting, and neither a plan change nor `@coderabbitai full review` gets past it, because the count
is checked before the review runs.

Files excluded by path filters are not counted. CodeRabbit's own skip comment listed seven files
ignored by the organization's filters and then reported 518 files selected against 525 changed,
which is the subtraction made visible. CodeRabbit also reads this configuration from the branch
under review, so filters committed here scope to this pull request and change nothing for any other
one.

`inheritance: true` does **not** merge this array with the organization's. Asking
`@coderabbitai configuration` on the pull request returned a `path_filters` list sourced entirely
from "Repository YAML (base)" and holding only the repository's own entries: for this field a
repository list replaces the organization's rather than appending to it. The first review therefore
ran with the organization's lock-file and generated-code exclusions dropped, and seven generated
files were reviewed as though hand-written. Those three patterns are now repeated explicitly at the
top of the block in `.coderabbit.yaml` and have to be kept in step with the organization's settings
by hand. Assume the same replacement behavior for any other array a repository config sets.

The review therefore runs in two passes, each well under the cap:

| Pass | Contents | Files |
| --- | --- | --- |
| 1 | Production source and infrastructure. The `path_filters` block now in `.coderabbit.yaml` | 265 |
| 2 | Tests. Swap that block for the inverse list and request another review | 179 |

Counts were measured at the revision that folded the organization's patterns back in, against base
`236619ebb768`, and the rebase moved the base to `e5643f00f5`, so both numbers are stale by
construction. **Re-measure before the final pass rather than trusting these numbers.** For the
record, the first review actually ran at 270 files, because it went out before those three patterns
were restored. If a later pass approaches the cap, move infrastructure and configuration into pass 2
before splitting anything.

Run each pass with `@coderabbitai full review` after pushing, and confirm the skip banner is gone
before reading the findings. Wait a minute after triggering before pushing anything else: a push
during the opening minute of a review cancels it silently while the check row still reads "Review
completed", which happened once on pass 2. Design-doc markdown under `docs/design/` is in neither
pass: it is this team's working notes, not shipped code.

**The block must be deleted before this pull request merges.** Left in place it would narrow reviews
for every future pull request in the repository. Confirm `git diff main -- .coderabbit.yaml` is empty
before merging. CodeRabbit also stored a learning on 2026-09-12 advising against repository-wide path
filters for this pull request; that advice predates the branch-scoped approach described here and
must be removed from its learnings so it does not argue against the fix.

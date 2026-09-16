# Independent review round 3 — the final candidate

Two reviewers read the same candidate independently. This file records what they found, what
survived verification, and what each finding is waiting on. The running log stays in
[open-reviews.md](../open-reviews.md); the round-2 record, which this one builds on, is
[round-2.md](round-2.md).

**Reviewed revision:** `5c67a2e871`, against base `236619ebb768`. One commit landed during the
round and is treated as part of this head: `664838e419`, recorded as D90 below.
**Scope:** `git diff 3d0bff5dee..5c67a2e871` — roughly sixty fixes closing D22 to D61, the
CodeRabbit pass-1 findings and their residuals, three rounds of UI QA, and several defects found
only against real providers.

The brief for this round was deliberately different from round 2. Six review passes had already
dispositioned the space, so both reviewers were asked to check whether each fix closes what it
claims, at the right depth, without opening something new — not to re-derive the findings.

Every line number below was read at `5c67a2e871`. Paths are relative to the repository root; host
and container details are omitted.

## The two reviews

**Codex.** An external reviewer at medium reasoning effort, read-only, given the delta, the seven
highest-risk seams, and every record as claims to check. Verdict: **would not ship unchanged**, on
three P1 findings and four P2. It also returned a fix-by-fix disposition table covering twenty-two
of the round-1 and round-2 fixes.

```bash
codex exec -m gpt-6-astra -c model_reasoning_effort=medium --sandbox read-only \
  --color never -C <repository root> "$(cat <briefing>)"
```

The CLI reported `codex-cli 0.153.4`, `model: gpt-6-astra`, `reasoning effort: medium`.

**Second reviewer.** A breadth sweep of the same delta, looking for what the fixes introduced rather
than what they closed, with most findings proved by mutating the product and watching the suite
rather than by reading. Verdict: **would not ship unchanged**, on four P1 findings, twelve P2 and
nine P3.

## Counts

| | P0 | P1 | P2 | P3 | Total |
| --- | --- | --- | --- | --- | --- |
| Codex, as filed | 0 | 3 | 4 | 0 | 7 |
| Second reviewer, as filed | 0 | 4 | 12 | 9 | 25 |
| **After verification and merge** | **0** | **5** | **13** | **10** | **28** |
| **Plus one found and closed during the round** | | | **1** | | **D90** |

Two findings were reached independently by both reviewers, which is the strongest signal in the
round: the multi-event event-stream parse, and the response-body read that no bound or cancellation
watches. Neither reviewer found a P0.

## What blocks the release

**Five findings, and two of them are the same mistake in different places: a client that reads only
the shape it was shown. All five are now fixed and verified.** One finding has since been reopened:
**D88**, whose fix reached one reader of five and left the wire unchanged. It blocks until the two
halves in flight land.

### D62. A connection's tool filter silently does nothing against a server that frames its tool list — FIXED at `419fcafdbf`

`api/oss/src/core/gateways/mcps/service.py:1186`

`_filter_tool_list` parses the relayed body with `json.loads` and, on a decode error, returns the
result unchanged. It fails open. Streamable HTTP servers frame replies as event streams — this
candidate's own mock comment records that as measured fact about a real provider — so the filter's
`json.loads` fails and the whole catalogue is advertised.

**A person restricts a connection to three read tools and the model is offered everything the server
has.** Execution is enforced separately, so this is catalogue disclosure and wasted turns rather
than unauthorised execution.

**The last automated coverage was removed by a change this review praised.** D58 taught the mock to
frame `tools/list` as an event stream, which was the right fix for the client-side blind spot and
also silently ended the one path that exercised this filter. No test feeds a framed body to it; the
only case uses plain JSON, a shape no real upstream produces. Verified: the filter code, the mock's
framing, and the absence of any framed case.

**Fixed** by `419fcafdbf`, verified. The filter now reads every `data:` payload of an event stream
and rewrites only the frame that carries the tool list, finding it by inspecting each payload rather
than by taking the last one — so a notification sent before the response does not hide it, which is
**D63**'s shape handled here rather than repeated. Everything else in the body is returned exactly as
it arrived, and a surviving entry is never renamed. Seventy cases pass; pinned before the fix, the
framed case and the notification-before-the-list case both fail.

Worth noting what the second case means: this filter now handles the multi-event shape that the
runner's own parser still does not, so two places in the same release read the same wire with
different competence. That is D63, and it is still open.

### D63. The runner's shared parser cannot read a conforming multi-event response — FIXED at `e246098149`

`services/runner/src/extensions/pi-mcp.ts:211`

`readMcpResponseJson` collects every `data:` line across the whole body and joins them. A server that
sends a notification before its result therefore produces two JSON documents joined by a newline,
which fails to parse, and the client reports no tools and drops the server. The transport permits
notifications before the response.

**Both reviewers found this independently, and both executed it.** The browser client added in this
same candidate gets it right, reading the last frame that carries a result or an error. So the two
clients this release ships now disagree about the same wire — which is D56's lesson arriving one
layer down: sharing one parser fixed the divergence between the probe and the Pi client, and left
this one.

**Fixed** by `e246098149`, verified, and it goes further than the finding asked. The stream is parsed
event by event and the frame taken is the one whose id matches the request, rather than the last one
that happens to carry a result — so a notification **after** the answer is skipped too, and two
requests sharing a stream cannot take each other's replies. The same defect was fixed one layer down
in the API probe, which had been taking the last `data:` line. Six cases fail pinned before the fix,
including the two the finding did not name.

### D64. The three clients advertise two different protocol revisions — FIXED at `e7c6665701`

`services/runner/src/extensions/pi-mcp.ts:36` says `2026-07-28`; the browser client
(`web/packages/agenta-entities/src/mcpEndpoint/core/mcpRpc.ts:21`) and the backend probe
(`api/oss/src/core/gateways/mcps/probe.py:69`) both say `2025-06-18`.

Verified by reading the three constants. Codex adds that the newer revision requires the request
metadata OR91 removed, which would make the removal correct for the older revision and wrong for the
one the Pi client claims. **That half is not established here** — the specification text was not
read — but the internal disagreement needs no external source: one product, three clients, two
claims about the wire, and a mock whose new strictness was derived from one of them.

**Fixed** by `e7c6665701`, verified: all three now offer `2025-06-18`, so only the Pi client moved,
and the mock negotiates down rather than refusing.

**The call to move down rather than up is the right one, and worth recording as a decision.** A
client should claim only what it implements. The later revisions add requirements to the request
envelope that none of these three implements or reads back, and claiming a revision we do not
satisfy is exactly what OR91 cost us against a real server, which validated our envelope against the
revision we had *named*. Choosing the revision whose requirements we meet makes that removal correct
rather than merely convenient. Implementing the newer envelope is a larger change across three
clients with no evidence of need behind it.

### D65. The Pi client's ten-second bound overrides the gateway's own thirty-second budget — FIXED at `3dc7be51bc`

`services/runner/src/extensions/pi-mcp.ts:48`, against
`api/oss/src/core/gateways/mcps/providers/http/adapter.py:27`

CR10's request timeout is applied to every call, including `tools/call`, whose peer is the Agenta
gateway. The gateway allows thirty seconds upstream and an endpoint may raise it further. Any tool
that takes between ten and thirty seconds — an ordinary search against a real provider — now fails
the turn, and a raised per-endpoint timeout is silently overridden. The second reviewer proved it by
driving the real registration against a fetch answering inside the gateway's budget: rejected at
10001 ms.

**Fixed** by `3dc7be51bc`, verified. The handshake keeps its short bound, which is a liveness check
and should stay one, and a tool call is bounded by a constant mirroring the gateway's own upstream
budget, with a comment naming the file to raise alongside it. The client refuses any URL that is not
a gateway route on this deployment, so there is exactly one peer to budget for, which is what makes
the mirrored constant honest rather than a guess.

**One residual, documented in the code and deferred:** an endpoint whose stored timeout is raised
above the gateway default is still capped, because nothing carries that stored value to the runner.
Closing it is a wire-contract change. The deferral is right for this release and the residual is
real — a per-endpoint timeout above the default does not take effect for a Pi tool call.

### D66. M8's provenance preference can replace a registration that existing grants still need — FIXED at `b592bd8cc4`

`api/oss/src/core/gateways/mcps/oauth/storage.py:397`, `:537` — **Codex's, and not reproduced here.**

A usable unmarked registration at one callback, plus a marked one created after the address moved,
makes the selection prefer the marked row; the connect path then rejects its callback coverage,
registers another client, and the write overwrites the first row. Grants still pin the first slug,
which now holds a different client, so their next refresh presents the wrong one. Codex reports
executing the selection method with that arrangement.

This is the fourth finding at this seam. Each one has been the next layer of the same mistake, and
that is the argument for treating the next fix here as a design change rather than another patch.

**Fixed** by `b592bd8cc4`, verified, and it is the design change rather than another patch. Coverage
now decides candidacy and provenance only orders what is left: a registration is a candidate only if
it covers the callback this deployment sends, so a marked row left from a previous address cannot
displace the unmarked one this address's grants pin. Rows for other callbacks are kept exactly where
they are, never selected and never written over, because the grants issued against them renew by
presenting them. A caller resolving for no particular address keeps every candidate, which is what a
grant predating the reference needs.

Fifty-one cases pass. Pinned before the fix, two fail: a marked registration for another callback
displacing this one, and a moved callback registering beside the row its grants pin. The second is
Codex's scenario end to end, which is the one I had not reproduced myself; it is reproduced now, by
the fix's own case failing without it.

## Found during the round and already closed

### D90. The consent watch was installed after the popup had been sent to the provider

`web/packages/agenta-entities/src/mcpEndpoint/hooks/useMcpConnectJourney.ts` — found by the web
agent's own investigation, closed at `664838e419`, verified here.

A provider that answers without a consent screen can be back at the callback before the next
statements run, and the completion it posts then arrives at a window with nothing listening. Nothing
recovers from that: the poll notices only a **closed** popup, which it reports as a failure, so a
success nobody heard waits out the three-minute timeout while the connection sits authorized behind
it, and the person is told the authorization did not complete.

The order is now listen, then navigate. Its case records both events and asserts the sequence, so it
fails against the old order rather than restating the new one — thirteen cases pass.

**Two things make this worth more than its size.** The mock issuer has no consent screen and
redirects straight through, so on a local stack the race was not exotic, it was the common path; a
provider that already holds a grant behaves the same way. And the failure inverts the invariant the
connect journey was built around. Round 2's D29 established that a failure must never read as a
success; this is a success reading as a failure, with the grant already stored. Both come from the
same place — the browser inferring an outcome it did not witness — and the fix is the same in
spirit: do not start the thing whose answer you cannot hear.

## The other findings

Thirteen P2 and ten P3, recorded in full in the round's working file. The ones worth naming here:

- **The bound and the cancellation stop at the response headers** (`pi-mcp.ts:295-309`, `:350`).
  Found independently by both reviewers. `post()` clears its timer and removes the caller's abort
  listener when `fetch` resolves, and the body is then read with nothing watching, so an upstream
  that answers and stalls holds the call and a cancelled turn cannot end it. This is CR10's own
  defect, half closed.
- **D68, D55's other traceback site — fixed at `8405da1d1b`, verified.** OR89 gated the traceback in
  the normalizer; the invoke-failure handler still returned it and ignored the flag the documentation
  advertises. Both of its branches now withhold it, and the routing layer gained the failure log that
  makes withholding cost an operator nothing. The switch moved beside `failure_code_of`, which is the
  part that matters: one request cannot get two different answers from the two modules, and a case
  drives both sites in the same test with the flag off and then on. Nineteen cases pass; pinned before
  the fix, four fail, including that one.
- **Two user-visible fixes are unguarded on both apps.** Reverting the whole classic half of r3-D2
  and QA-D6 leaves `web/oss` unchanged at 524 passed; reverting the whole mobile half leaves
  `web/mobile` unchanged at 227. The package-level logic is pinned; neither app's copy is.
- **CR12's read-back asks the wrong key space** (`useGatewayConnectFlow.ts:127`), passing a server
  slug where an integration key is expected, and never compares the answer to the target. Rewriting
  the fixture to a different connection entirely leaves all six cases green.
- **Two suites became skips rather than failures** (`services/oss/tests/pytest/utils/gateways.py:45`,
  and the browser suite's default mock port). That is D25's shape a fourth and fifth time: a suite
  that reports green while running nothing, or against another stack.

  **D77, the services half, is fixed at `800c9d3aa2` and verified.** The helper is renamed from
  skipping to requiring, and a deployment with the plane off now fails the suite unless the run says
  out loud that it expected one, through `AGENTA_TESTS_EXPECT_LLM_GATEWAY`. The refusal names both
  ways out. Making the opt-out explicit is the right shape, since the defect was a configuration
  nobody had to say anything about. **One consequence to expect rather than discover:** that
  variable is set nowhere in the repository yet, so until the workflow entry lands, a preview run
  against a stack with the plane off goes red instead of green. That is the intended direction and
  still a change in what the pipeline reports.

- **D80, the real-server probe case, is fixed at `f3d52f10af` and verified.** Reachability is now
  decided by the deployment rather than by the test runner's own network, which is the machine that
  matters, and the probe's problem carries how the attempt failed so that a firewalled container
  skips while a gateway that received an answer it could not read still fails — which is the
  regression the case exists for. It passes here against the live provider through the deployment.

## The testing-infrastructure findings, closed

Four of the round's smaller findings were about how this work is measured rather than what it does.
All four are fixed and verified, and two of them changed behaviour rather than only coverage.

**D70 — the handshake probe screened its configured headers too** (`8748f4d730`). M19 protected the
Pi client from a configured header displacing a protocol one; the probe still spread configured
headers over its own, and did so by exact key, so `Accept` and `accept` would both survive and the
request would carry a folded value. A server configuration that set any of the three broke the probe
in a way that reads as an unreachable server rather than as the configuration it is, and reported
that server as failed before the client this probe exists to protect ever ran. The screen is now the
same exported list rather than a copy, which is the fix that keeps the two from drifting again.
Sixty-eight cases pass; pinned before it, three fail.

**D83 — the resolver queue is no longer charged to the resolution** (`035e84dc3c`). One bound
covering both waits meant that with every thread busy, an address that resolves in a millisecond was
told it could not be resolved in time: a sentence about the address, when the operator's problem was
a saturated gateway. There are now two bounds, a caller that gives up queueing frees its slot, and
the probe reports the two causes separately. Eighty-four cases pass across the egress and probe
suites; pinned before it, three fail, including the one that asserts a busy gateway says so.

**D82 — D33's guard is driven from the relay** (`d3ef9e3743`). The guard was held only by cases that
called it directly with a token computed by hand, so nothing proved the relay reaches it, or reaches
it with the token that call actually presented. It does now, and twenty-four integration cases pass
against a real database.

**D81 — the generated client's tests run in CI** (`9414adfe02`). The guard added for CodeRabbit's M6
sat in a directory no workflow executed. It runs now, and the commit adds a case asserting that CI
still names it, so the guard cannot quietly lose its runner a second time.

## D71, the split-origin return — one reading fixed, one deferred

`8afb5ef267`, verified. The finding had two readings and they turn out to deserve different answers.

**The reading that was fixed is the one with a security shape.** The consent result is posted to the
opener with an exact target origin, and a single configured value meant a deployment reachable at a
second address delivered the result nowhere: the dialog waited out its timeout while the connection
sat authorized behind it. The page now names every origin the deployment declares, published web URL
first. A post whose target does not match the opener is simply not delivered, so this widens which of
the deployment's own windows can be reached without widening who can read the message.

Two properties I checked rather than took, because they are what separate this from a widening:

- **The origins come from configuration, never from the request.** They are loaded from
  `AGENTA_APP_ORIGINS` through the environment object; nothing in the callback path reads the Host
  header. A page that trusted the address the browser arrived on would post to whatever a caller
  wrote there, which would have turned a delivery fix into a disclosure.
- **The API's own origin is not offered.** That is where the page is served from, not where the app
  is, so a deployment publishing no app address still sends nobody anywhere.

Eighteen cases pass; pinned before the fix, six fail, including the one that keeps the configured
address first and the one that drops nonsense among declared origins.

**The reading that was deferred is the remembered return path on a split-host deployment**, where
the web app stores its route in its own storage and the API origin cannot read it. Deferred to an
issue rather than fixed, and the argument holds: the shipped topology mounts the API under the app
origin, so the path already returns there, and the fallback lands on the connections list rather than
anywhere wrong. Worth being precise about what stays true — on a deployment that does split them, a
blocked popup still loses the originating surface.

## D88, REOPENED — the divergence was fixed in one reader of five

`247bfbc9f1`, verified. The finding was that the Claude settings matrices cross every server
decision with every per-tool decision and then ask about the one tool the table names, so the other
half of the ladder — a tool the table does **not** name, which is what the new-tool default exists
to decide and what a server adds between two runs — was never reached.

**Adding that case found a real disagreement rather than a gap.** The adapter resolved an unnamed
tool as the new-tool default, then the whole-server permission, then ask. The runner's intake gives
a declared table with no floor beside it `ask` and deliberately never consults the whole-server
permission, on the stated principle that a human decides for anything the table does not name. So a
server permission of `allow` beside any per-tool table emitted a whole-server allow, and a tool the
author had never named ran unapproved under Claude while the same saved configuration raised a gate
under Pi.

**The divergence ran in the unsafe direction**, which is why resolving it toward the runner rather
than the adapter is the right call: the gate is the authoritative side, and the adapter's job is to
describe it, not to decide differently. One hundred and eighty-five cases pass; pinned before the
fix, seven fail, all of them unnamed-tool combinations.

### Reopened, because that fixed the rendering and not the wire

`247bfbc9f1` changed how the Claude **native rules** render. It did not change what goes on the
wire. On the committed head, `MCPPolicy.resolved_new_tool_permission`
(`sdks/python/agenta/sdk/agents/mcp/models.py:157`) still reads
`new_tool_permission or permission or "ask"`, and `to_wire` sends that value as
`newToolPermission`, which the runner honours verbatim. So a server permission of `allow` beside any
per-tool table still puts `newToolPermission: "allow"` on the wire, and a tool the author never named
still runs unapproved — **under every harness, not only Claude.** Verified on the committed head.

A fifth reader has the same fallback: `resolvedNewToolPermission`
(`web/packages/agenta-entities/src/mcpEndpoint/core/toolPolicy.ts:69`) drives the editor's
"Inherits" label, so the editor also tells an author the wrong thing about an unnamed tool.

**Both halves are in flight** — the SDK resolver with a cross-reader matrix, and the web reader with
its mobile mirror — and the record stays open until they land, so it never reads closed while the
wire is wrong.

**My closure was wrong, and the reason is worth keeping.** I verified the adapter's ladder, read its
tests, ran them, and pinned the pre-fix revision to watch seven cases fail. All of that was true and
none of it asked the question that mattered: whether the same ladder existed upstream of the thing I
was looking at. D88's own finding was that one policy has several readers; I then verified a fix to
one reader and reported the finding closed. Checking a fix against the finding is not the same as
checking it against the system, and this round has now produced that lesson three times — in D59,
where I inferred a backend gap from one file, in D61, where a green suite sat over a script that
never parsed, and here.

This is the fourth finding in this candidate where the same policy was read differently in two
places, after D37, D57 and D63. Three of the four resolved toward the runner.

The residual this review noted — two mirrors of the runner's resolver in one file, the older of them
still encoding the superseded ladder — is closed at `2ad4d45a36`, verified. There is one mirror now,
and it takes the table's presence separately from the tool, because the runner's opt-in is what the
policy declared rather than what this tool matched. That distinction is the whole finding, so having
it in the mirror's signature is what keeps the copy honest.

Checked rather than assumed: restoring the old adapter ladder now fails seven cases **through the
single mirror**, where before the cleanup those cases were carried by a second one. One hundred and
eighty-five pass. A mirror that disagrees with the thing it mirrors is how D88 started, so it was
worth the small commit.

## The rest of the runner batch

**D67 — the response body is read inside the bounded region** (`1d95a9c931`). The timer and the
caller's abort listener used to be released when the headers arrived, leaving the body read watched
by nothing, so an upstream that answered and then stalled held the call and a cancelled turn could
not end it. One case fails pinned before the fix, and its own comment says which shape it is written
against.

**D69 — the tool-list cursor is followed, bounded twice** (`54b482dd02`). Pi requested one page and
ignored the cursor, so an author could configure a tool in the editor that Pi never registered. It
now follows pages, stops if a server hands back the cursor it was just given, and stops at the same
page cap the browser client uses. Three cases fail pinned before the fix, one for each of those
three behaviours.

**D91 — Codex's own MCP client does not follow tool-list pagination.** Measured while fixing D69, and
recorded as a known limitation rather than a defect of this product: a paginated catalogue exposes
only its first page to a Codex agent, and that is the harness's behaviour, not the gateway's. It is
numbered so it is not rediscovered as a gateway bug. The mock matrix keeps its probe tool on the
first page and says why, which is the right accommodation: measure what we can control, and document
what we cannot.

## The web batch, delta-checked

Eleven commits, `5a73a056b2` to `8a73143b43`. Seven close their finding outright and were proved by
mutation: **D73** (both apps' halves pinned independently, five and three cases failing when each is
reverted), **D74**, **D78**, **D85** (deleting the structural branch fails exactly the new case),
**D87**, **D89** (restoring the whitespace-stripping shell fails on `y es` and nothing else), and
**D76**, whose code matches the port allocator though the browser suite was not run to prove it.

**D74 and D78 were checked at the rendered surface**, not only in the changed file, because that is
the distinction the reopened D88 turned on.

D74 settles correctly: its case drives the flow with a live but unrelated connection in the list and
asserts the **settled output the agent receives** is `connected: false`, which is the exact shape the
old code got wrong. Both key spaces and the invalid-connection case are covered, and the read-back no
longer passes a server slug as an integration key. Seven cases pass.

D78's fix is correct and its assertion stops one level short. The two predicates are pinned — a
notice-only turn is not an empty turn, and a notice counts as the turn's answer — and the rendered
turn's `hidden` flag and the pending-turn gate both derive from those predicates, so the surface
behaviour follows. What is not asserted is the surface itself: no case builds the view models and
checks that a notice-only turn following an answerless one survives. That is the level the finding
was measured at.

### Three that close only part of what they claim

- **D72.** The harness no longer reproduces the pre-fix wording, which was half the finding. The
  line the finding actually names, the refusal sentence at its three product call sites in both
  apps, is still untested; neither app has a case importing those components. The gap moved from
  "the harness lies" to "the harness is honest and still is not the app" — which is the gap D73
  exists to close, left open beside it.
- **D75.** The component gained a test file and eight cases, covering the late-result guard and the
  readable failure. The tool filter, the second fix the finding names, has no case in that file; it
  is covered in the sibling reader and in the pure function, so it is unguarded in the component
  rather than in the system.
- **D84.** The three sealing props are pinned. The handler's own guard is not: removing it alone
  leaves all four cases green.

### D86 leaves the chat package red, and the disposition needs one correction

`8a73143b43` removed `endpointId` from the notice as an orphan. It is not orphaned in the tests: a
case in the transcript replay suite still asserts it, and **the package is red on the branch** —
confirmed at head `397c45079b`, one failure, `keeps the reconnect endpoint, which is the only thing
the reader can act on`.

The removal itself is right: the card resolves its endpoint from the notice's slug, not from that
field. So the fix is the stale assertion, not the field. Worth deciding rather than deleting on
sight, because the case's own title argues the field was the reader's affordance.

**On keeping `registerChatSkin`: the carve-out is right and its stated reason is not.** The
resolvers that read the store are live product code, five of them. The writer has no product caller
at all, so the store is empty at runtime and every reader falls through to its default. Deleting the
writer alone would leave five resolvers consulting a store nothing can fill, which is worse than
today, and the override route is real and documented — so keep it. But "three live readers" should
read as "the socket is wired and documented, the plug is not in use", or the record claims a
capability is in service when what exists is the extension point.

**On dropping D84's mask-click case: the reasoning does not hold, and it was measured.** The comment
says jsdom's dismissable layer ignores a synthesized pointer event. It does not: dispatching one on
the overlay calls the close handler once while unsealed and not at all while sealed, and with **both**
seal halves removed it calls it again. The case passes with the prop deleted because the handler's
own guard catches it — the right symptom, the wrong mechanism. And the browser suite does not cover
that route: there is no mask or overlay click anywhere in the acceptance suites. The omission is
worth reversing, because the handler guard is the one half of the seal nothing pins and the mask is
exactly what it defends.

## The fixes that hold

Codex's disposition table judged twenty-two earlier fixes at the code level and found the great
majority closed: D22, D23, D24, N3, D28, D29, D30, D31, D32, D35, D36, OR88, D37, D38, D46, D50, the
compressed-response regression and M18. The second reviewer independently mutated about fifty
guards across the API, runner, SDK and web halves and found each one caught — the list is in the
working file so a fourth pass does not repeat it.

That is the useful shape of this round: the fixes mostly hold, and what remains is concentrated in
the client seams that only a real server exercises.

## What this round says about the candidate

Round 2 found that a suite built on obliging mocks measures the client against itself. This round
finds the next version of that: a mock taught to behave like a real server closed one blind spot
(D58) and opened another (D62), because the code under it had never seen the framing either. The
same shape produced D63 and D64. Every one of the five blocking findings is a client reading only
the shape it was shown.

The fixes in this candidate are good, and the record of how each was verified is unusually complete.
What is not yet true is that the product has been exercised against the range of behaviour a
conforming server may produce. The real-server probe case, the completed real-model matrix and the
Pi run against a live provider are the three places that break the circularity, and all three arrived
late. A fourth is now owed: a fixture set of conforming-but-awkward responses — multi-event frames,
notifications before results, paginated catalogues, slow bodies — that every one of the three clients
is driven against.

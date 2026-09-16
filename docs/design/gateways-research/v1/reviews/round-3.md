# Independent review round 3 — the final candidate

Two reviewers read the same candidate independently. This file records what they found, what
survived verification, and what each finding is waiting on. The running log stays in
[open-reviews.md](../open-reviews.md); the round-2 record, which this one builds on, is
[round-2.md](round-2.md).

**Reviewed revision:** `5c67a2e871`, against base `236619ebb768`.
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

Two findings were reached independently by both reviewers, which is the strongest signal in the
round: the multi-event event-stream parse, and the response-body read that no bound or cancellation
watches. Neither reviewer found a P0.

## What blocks the release

**Five findings, and two of them are the same mistake in different places: a client that reads only
the shape it was shown.**

### D62. A connection's tool filter silently does nothing against a server that frames its tool list

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

### D63. The runner's shared parser cannot read a conforming multi-event response

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

### D64. The three clients advertise two different protocol revisions

`services/runner/src/extensions/pi-mcp.ts:36` says `2026-07-28`; the browser client
(`web/packages/agenta-entities/src/mcpEndpoint/core/mcpRpc.ts:21`) and the backend probe
(`api/oss/src/core/gateways/mcps/probe.py:69`) both say `2025-06-18`.

Verified by reading the three constants. Codex adds that the newer revision requires the request
metadata OR91 removed, which would make the removal correct for the older revision and wrong for the
one the Pi client claims. **That half is not established here** — the specification text was not
read — but the internal disagreement needs no external source: one product, three clients, two
claims about the wire, and a mock whose new strictness was derived from one of them.

### D65. The Pi client's ten-second bound overrides the gateway's own thirty-second budget

`services/runner/src/extensions/pi-mcp.ts:48`, against
`api/oss/src/core/gateways/mcps/providers/http/adapter.py:27`

CR10's request timeout is applied to every call, including `tools/call`, whose peer is the Agenta
gateway. The gateway allows thirty seconds upstream and an endpoint may raise it further. Any tool
that takes between ten and thirty seconds — an ordinary search against a real provider — now fails
the turn, and a raised per-endpoint timeout is silently overridden. The second reviewer proved it by
driving the real registration against a fetch answering inside the gateway's budget: rejected at
10001 ms.

### D66. M8's provenance preference can replace a registration that existing grants still need

`api/oss/src/core/gateways/mcps/oauth/storage.py:397`, `:537` — **Codex's, and not reproduced here.**

A usable unmarked registration at one callback, plus a marked one created after the address moved,
makes the selection prefer the marked row; the connect path then rejects its callback coverage,
registers another client, and the write overwrites the first row. Grants still pin the first slug,
which now holds a different client, so their next refresh presents the wrong one. Codex reports
executing the selection method with that arrangement.

This is the fourth finding at this seam. Each one has been the next layer of the same mistake, and
that is the argument for treating the next fix here as a design change rather than another patch.

## The other findings

Thirteen P2 and ten P3, recorded in full in the round's working file. The ones worth naming here:

- **The bound and the cancellation stop at the response headers** (`pi-mcp.ts:295-309`, `:350`).
  Found independently by both reviewers. `post()` clears its timer and removes the caller's abort
  listener when `fetch` resolves, and the body is then read with nothing watching, so an upstream
  that answers and stalls holds the call and a cancelled turn cannot end it. This is CR10's own
  defect, half closed.
- **D55 is closed on one path and open on another** (`sdks/python/agenta/sdk/decorators/routing.py:575`).
  OR89 gated the traceback in the normalizer; the invoke-failure handler still returns it and ignores
  the flag the documentation advertises.
- **Two user-visible fixes are unguarded on both apps.** Reverting the whole classic half of r3-D2
  and QA-D6 leaves `web/oss` unchanged at 524 passed; reverting the whole mobile half leaves
  `web/mobile` unchanged at 227. The package-level logic is pinned; neither app's copy is.
- **CR12's read-back asks the wrong key space** (`useGatewayConnectFlow.ts:127`), passing a server
  slug where an integration key is expected, and never compares the answer to the target. Rewriting
  the fixture to a different connection entirely leaves all six cases green.
- **Two suites became skips rather than failures** (`services/oss/tests/pytest/utils/gateways.py:45`,
  and the browser suite's default mock port). That is D25's shape a fourth and fifth time: a suite
  that reports green while running nothing, or against another stack.

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

# MCP execution status

Updated: 2026-09-16.

Product scope is confirmed and the target UX is implemented. The connection flow, connection
identity, per-tool permissions and the recovery journeys now have live evidence against a running
deployment. Release readiness is not established. Two independent review rounds have run and the
second is still open: its five blocking findings are closed except D25, the browser acceptance
suite that skips on every run and reports the skip as a pass. The remaining items are listed in
the gate row at the bottom of the table.

## Candidate revisions

| Revision | What it is | Notes |
| --- | --- | --- |
| `b0ac98f7f7` | Candidate 2, pushed | The current candidate. Everything in the table below is measured here unless a row names another revision. |
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
to a commit, a file and a line, so they must be regenerated last if this branch is ever rebased or
squashed. The CodeRabbit filters now repeat the organization's own exclusion patterns
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
| URL-first Connect flow | Implemented | Register-then-connect is replaced by one URL-first journey (`3aabda12f3`), backed by a read-only server probe (`e1cc2a8a71`). The list moved into a shared settings section both hosts render (`1712960cc4`), the mobile app gained the tab (`2bc9a05f29`), and an agent picks a connection instead of describing one (`7bf052bc43`). Disconnect keeps the connection (`3fb9b8aeca`). Browser evidence is the Playwright row below; no recorded UI QA pass yet. |
| Per-tool permissions | Verified live | SDK policy (`e5e9957d90`), fail-closed runner intake (`90c4c2f231`), and the agent-configuration editor on both hosts (`0308fb9c7e`). Live evidence in `qa.md`, section "MCP permissions: discovery, policy, call, approval, resume": fourteen cells pass across Pi, Claude Code and Codex, covering deny, ask-rejected, ask-approved, allow, per-tool over server, per-tool deny, sibling deny, and two connections rendering one tool name. Every cell is read against the gateway's own request log rather than the model's reply. No real model credential is used; the cells run against the compose mock LLM, which is sufficient because the gate is what is under test. Unit coverage: `web/packages/agenta-entities/tests/unit/mcpToolPolicy.test.ts`, `web/packages/agenta-entity-ui/tests/unit/mcpToolPermissions.render.test.tsx`, `services/runner/tests/unit/mcp-permission-intake.test.ts`. |
| Reconnect and recovery journeys | Verified live | An upstream that refuses the stored grant is treated as a reconnect rather than relayed as a 401 (`024afa4061`, OR83). A connection holding no authorization is offered a reconnect (`44728bf68d`, OR84) and the refusal's connect action now reaches the caller (`ebde9ae1a8`, OR85). Live evidence in `qa.md`, section "A disconnected MCP connection offers the way back (OR85)", which also records the three layers that each dropped the refusal body. Integration coverage against real Postgres and a controlled upstream in `integration/gateways/test_mcp_oauth_connect.py` (`6db7d11245`). |
| Audit | Implemented, one gap deferred | An MCP call records what it did, how long it took and which run made it (`b9f6ce0b24`). Round-1 finding D11 stays deferred with its closure stated in the code: a refusal raised before the audit recorder produces no audit event. |
| Real-provider OAuth registration | Verified live, registration and consent only | The client-resolution fix (`508ea1a024`) precedes the first successful registrations, and two providers hold OAuth clients and grants created after it. A client registration is now keyed on the stored redirect URI rather than the issuer alone (`ab3944ef67`, OR78), and a registration the grants still need is kept (`d1d2eb0e72`, round-1 D6). Discovery through policy to execution against a real provider is still unproven; see the row below. |
| Tools and permissions on a real provider | Pending, blocked | Read-only discovery against the two connected real providers still cannot run from a caller with a usable credential. Both endpoints belong to one project whose only member is a personal account, that project holds no API key, and keys are stored hashed. The outbound leg is fine: both servers answer the expected challenge from the API container. Unblock by re-consenting both providers into a QA-owned project, which also yields the product-visible tool list and permission editor this row needs. |
| MCP OAuth consent end-to-end | Implemented; mock-verified, browser leg pending | `acceptance/gateways/test_mcp_gateway_oauth_consent_acceptance.py` passes on the demo stack against the direct address, and the gateway acceptance directory is green with the mocks on. The two earlier obstacles are fixed: the session cookie scheme mismatch (`e0365826d8`) and the published-address mismatch, which `AGENTA_MOCK_MCP_GATEWAY_PUBLIC_URL` settles (`9190854e7d`). The mock issuer also has a registration endpoint now (`bfd05732e0`) and both ways the gateway names itself to an issuer are covered (`82bb0ed1ea`). What remains unproven is the leg no test covers: a real browser opening the consent page on a publicly resolvable issuer. |
| Browser acceptance suites | Verified live, and a manual gate step | The suite that drove the old flow is replaced by seven cases in `web/oss/tests/playwright/acceptance/settings/mcp-connect.ts`, driven by the OSS and EE `mcp-connect.spec.ts` files (`548d1e4aef`): connect without authentication, the name suggested from server metadata, a duplicate display name refused in the field, two connections to one URL kept apart, remove, the tool list on a connection, and the OAuth path through the mock issuer ending in a disconnect that keeps the connection. The OAuth case needs `PLAYWRIGHT_HOST_RESOLVER_RULES` so the browser resolves the address the issuer publishes. Exercising the flow against a running stack found and fixed four defects reading alone had not: a Disconnect offered on a connection holding no grant, a journey that never left tool discovery, a connected state showing two buttons both labelled Done, and journey state surviving into the next attempt. **All seven pass** against the integrated EE dev stack on the direct address, in 1.7 minutes, with no MCP variables exported. **This suite is a manual gate step, in those words.** It runs by default now rather than skipping on two variables that were set nowhere (D25), and it fails with an actionable sentence when the mock upstream does not answer rather than reporting green. It is deliberately not wired into the Railway workflow: that job points at a deployed preview which runs no mock container, so enabling it there would fail for the absence of a fixture rather than for a defect. Closing that gap is the same job D19 and the row below describe. Until it exists, the pass is recorded here, by hand, against the revision tested. |
| Mock-backed OAuth suites in CI | Pending, deliberately deferred | Both mock-backed suites skip unless `AGENTA_GATEWAYS_MOCKS_ENABLED` is true and the two mock containers exist. No workflow sets that variable, names either container, or brings a compose stack up, and the one job running the api acceptance layer points at a deployed preview rather than starting a stack. Closing the gap needs a new job that builds the dev API image, brings a dev stack up inside the runner and calls the stack test script. Round-1 finding D19 records the same gap from the host side. Not a blocker for this release. |
| Independent review round 1 | Documented, closed | Two reviewers read `528204c3d9` independently. Codex at medium reasoning said do not ship on seven findings; the second reviewer said ship with fixes on two. After verification and merge: seventeen findings, closing at zero open, seventeen closed, one withdrawn and four deferred. Record and per-finding verification in `reviews/round-1.md`; round closed in `91083db1b7`. |
| Independent review round 2 | Documented, open | Two reviewers read `3d0bff5dee` independently, across everything that changed since round 1 and the whole frontend, which had never been reviewed and was given the weight of a first review. Both said do not ship. After verification and merge: twenty-four findings plus four quality notes, no P0, five P1. The five blocking findings were D22, D23, D24, D25 and D26. Candidate 2 closes all of them except D25, and part-closes D31. What stays open is D25 and the rest of the connect-journey and web findings, which are P2 and P3. Nothing was withdrawn: every mechanism either reviewer described was confirmed against the code. Record in `reviews/round-2.md`. |
| Running finding log | Documented | `open-reviews.md` runs OR36 to OR86, fifty-one findings: forty-four closed, six open and one withdrawn, recounted from its own headings on 2026-09-15. The six open are OR63, OR65, OR66, OR68, OR76 and OR81. No P0 and no P1 remain; the highest open severity is P2, carried by OR76 alone. The other five are debt, each also tracked in `cleanups.md`. |
| User-facing documentation | Documented | The MCP how-to and the two reference pages describe the implemented flow: the Connect journey, connection identity, the per-tool permission editor, the gateway connection shape and the permission fields. Every harness now accepts connected MCP servers, which the concepts page reflects. The two doc pages carry a notice that they await release verification; remove it once the UI QA pass lands. |
| CodeRabbit review | Pass 1 complete, triage pending | The file-count cap is worked around by a branch-scoped `path_filters` block (`2637a5651b`), which now also repeats the organization's own exclusion patterns (`380fb211f4`); see the section at the end of this file. Pass 1, production source and infrastructure, completed on `3d0bff5dee`. Its findings are not yet triaged, and pass 2 over the tests has not been run. A skip is not approval, so confirm the banner was absent before reading either pass. |
| MCP release gate | NOT READY | Remaining mandatory items: a UI QA round 1 report; D25 fixed, so the browser acceptance specs stop skipping, then a recorded run of them; CodeRabbit pass 1 triaged and pass 2 run; the round-2 findings still open dispositioned, and a round 3 over candidate 2; recorded QA over a public callback in a real browser; real-provider execution evidence from discovery through policy to a tool call; and CI green on the final candidate. Current external blockers, all needing Mahmoud or an account change: the ngrok account is at its endpoint cap, which limits how many stacks can hold a public callback address at once; the Anthropic key has no credit and the mounted Claude login is empty, so no real Claude model run is possible; the Linear grant carries no write permission, so no upstream side effect can be shown against it; both real providers still need re-consenting into a QA-owned project; the Railway template apply that lands the preview LLM-plane flag has not run, so preview CI still skips those cells; and CodeRabbit's 2026-09-12 learning against repository-wide path filters must be deleted so it does not argue against the branch-scoped fix. |
| LLM SDK and wallet work | Later | Not required for MCP readiness. Wallets are on a separate branch. |

## Decision history

Mahmoud confirmed project-wide multiple accounts, stable slugs and IDs, editable names, configured
selection, our own MCP gateway, deferred infrastructure work and phased release. He clarified that
LiteLLM SDK applies only to LLM evaluation. He requested the integration-style MCP Connect flow,
auditability in this PR and autonomous work through the release-ready gate with Astra medium and
CodeRabbit feedback loops.

Name suggestions and authentication discovery use fallbacks because arbitrary server metadata is
not guaranteed. Runtime proof now covers the target UX on the paths listed above, driven through
the API and the runner against a live deployment. What it does not yet cover is a person using the
product in a browser, which is the UI QA round the gate is waiting on.

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
`236619ebb768`, and the branch grows by a few files an hour while this work runs. Re-measure before
each pass rather than trusting these numbers. For the record, the first review actually ran at 270
files, because it went out before those three patterns were restored. If a later pass approaches the cap, move infrastructure and configuration into pass 2
before splitting anything.

Run each pass with `@coderabbitai full review` after pushing, and confirm the skip banner is gone
before reading the findings. Design-doc markdown under `docs/design/` is in neither pass: it is this
team's working notes, not shipped code.

**The block must be deleted before this pull request merges.** Left in place it would narrow reviews
for every future pull request in the repository. Confirm `git diff main -- .coderabbit.yaml` is empty
before merging. CodeRabbit also stored a learning on 2026-09-12 advising against repository-wide path
filters for this pull request; that advice predates the branch-scoped approach described here and
must be removed from its learnings so it does not argue against the fix.

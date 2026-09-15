# MCP execution status

Updated: 2026-09-16.

Product scope is confirmed and the target UX is implemented. The connection flow, connection
identity, per-tool permissions and the recovery journeys now have live evidence against a running
deployment. Release readiness is not established: the remaining items are listed in the gate row
at the bottom of the table, and none of them is code.

## Candidate revisions

| Revision | What it is | Notes |
| --- | --- | --- |
| `3d0bff5dee` | Candidate 1, pushed | Base main `236619ebb768`. Everything in the table below is measured at this revision unless a row names another. |
| `528204c3d9` | The revision independent review round 1 read | 67 files against base `6df148cb39`, api, sdks and services only. Frontend, docs and hosting were out of scope for that round. The round record is `reviews/round-1.md`. |
| `6df148cb39` | The baseline this work started from | Recorded here so a later reader can reproduce any range in this file. |

Candidate 1 has moved on from the reviewed revision. Round 2 must read `3d0bff5dee` or later, and
must include the frontend, which round 1 did not.

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
| Browser acceptance suites | Implemented, not yet run and recorded | The suite that drove the old flow is replaced by seven cases in `web/oss/tests/playwright/acceptance/settings/mcp-connect.ts`, driven by the OSS and EE `mcp-connect.spec.ts` files (`548d1e4aef`): connect without authentication, the name suggested from server metadata, a duplicate display name refused in the field, two connections to one URL kept apart, remove, the tool list on a connection, and the OAuth path through the mock issuer ending in a disconnect that keeps the connection. The OAuth case needs `PLAYWRIGHT_HOST_RESOLVER_RULES` so the browser resolves the address the issuer publishes. Exercising the flow against a running stack already found and fixed one defect, a Disconnect offered on a connection holding no grant. A full recorded pass is still owed. |
| Mock-backed OAuth suites in CI | Pending, deliberately deferred | Both mock-backed suites skip unless `AGENTA_GATEWAYS_MOCKS_ENABLED` is true and the two mock containers exist. No workflow sets that variable, names either container, or brings a compose stack up, and the one job running the api acceptance layer points at a deployed preview rather than starting a stack. Closing the gap needs a new job that builds the dev API image, brings a dev stack up inside the runner and calls the stack test script. Round-1 finding D19 records the same gap from the host side. Not a blocker for this release. |
| Independent review round 1 | Documented, closed | Two reviewers read `528204c3d9` independently. Codex at medium reasoning said do not ship on seven findings; the second reviewer said ship with fixes on two. After verification and merge: seventeen findings, closing at zero open, seventeen closed, one withdrawn and four deferred. Record and per-finding verification in `reviews/round-1.md`; round closed in `91083db1b7`. |
| Running finding log | Documented | `open-reviews.md` runs OR36 to OR86, fifty-one findings: forty-four closed, six open and one withdrawn, recounted from its own headings on 2026-09-15. The six open are OR63, OR65, OR66, OR68, OR76 and OR81. No P0 and no P1 remain; the highest open severity is P2, carried by OR76 alone. The other five are debt, each also tracked in `cleanups.md`. |
| User-facing documentation | Documented | The MCP how-to and the two reference pages describe the implemented flow: the Connect journey, connection identity, the per-tool permission editor, the gateway connection shape and the permission fields. Every harness now accepts connected MCP servers, which the concepts page reflects. The two doc pages carry a notice that they await release verification; remove it once the UI QA pass lands. |
| CodeRabbit review | Pending | The file-count cap is worked around by a branch-scoped `path_filters` block (`2637a5651b`); see the section at the end of this file. No pass has been obtained yet, and a skip is not approval. |
| MCP release gate | NOT READY | Remaining mandatory items: a UI QA round 1 report; a recorded run of the browser acceptance specs; a CodeRabbit pass on both passes; independent review round 2 against candidate 1 or later, including the frontend; recorded QA over a public callback in a real browser; real-provider execution evidence from discovery through policy to a tool call; and CI green on the final candidate. Current external blockers: the ngrok account is at its endpoint cap, which limits how many stacks can hold a public callback address at once; the Anthropic key has no credit and the mounted Claude login is empty, so no real Claude model run is possible; the Linear grant carries no write permission, so no upstream side effect can be shown against it; both real providers still need re-consenting into a QA-owned project; and CodeRabbit's 2026-09-12 learning against repository-wide path filters must be deleted so it does not argue against the branch-scoped fix. |
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
one. `inheritance: true` merges arrays child-first, so the organization's exclusions still apply on
top.

The review therefore runs in two passes, each well under the cap:

| Pass | Contents | Files |
| --- | --- | --- |
| 1 | Production source and infrastructure. The `path_filters` block now in `.coderabbit.yaml` | 259 |
| 2 | Tests. Swap that block for the inverse list and request another review | 179 |

Counts were measured at the revision that added this note, against base `236619ebb768`, and the
branch has grown substantially since. Re-measure before each pass rather than trusting these
numbers. If a later pass approaches the cap, move infrastructure and configuration into pass 2
before splitting anything.

Run each pass with `@coderabbitai full review` after pushing, and confirm the skip banner is gone
before reading the findings. Design-doc markdown under `docs/design/` is in neither pass: it is this
team's working notes, not shipped code.

**The block must be deleted before this pull request merges.** Left in place it would narrow reviews
for every future pull request in the repository. Confirm `git diff main -- .coderabbit.yaml` is empty
before merging. CodeRabbit also stored a learning on 2026-09-12 advising against repository-wide path
filters for this pull request; that advice predates the branch-scoped approach described here and
must be removed from its learnings so it does not argue against the fix.

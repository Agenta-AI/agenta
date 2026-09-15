# Independent review round 2 — the full MCP gateway release candidate

Two reviewers read the same candidate independently and without seeing each other's work. This file
records what they found, what survived verification against the code and the tests, and what each
finding is waiting on. It is the round record; the running finding log stays in
[open-reviews.md](../open-reviews.md).

**Reviewed revision:** `3d0bff5dee`, against base `236619ebb768`.
**Round-1 reviewed revision, for the delta range:** `528204c3d9`.

**Scope.** Two ranges. `git diff 528204c3d9..3d0bff5dee` is everything that changed since round 1
across the tree: the round-1 fixes themselves, a new read-only server probe, a registration endpoint
on the mock OAuth issuer, four refactors, and the whole new frontend. `git diff
236619ebb768..3d0bff5dee -- web` is the entire frontend of the pull request. Round 1's scope was
`api sdks services` only, so nothing under `web/` had ever been reviewed, and it was given the
weight of a first review rather than a delta. 137 files and about 11,700 insertions in the first
range; 91 files and about 7,500 insertions in the second.

The branch has moved on since. Every line number below was read at `3d0bff5dee` and should be
confirmed against the revision you are reading rather than trusted, because other work lands in the
same files.

Every path in this document is relative to the repository root. Paths to scratch files, host
directories and container names are deliberately omitted.

**One finding is already closed.** `cd9e6f2c16` landed after the snapshot these reviewers read and
closes D22; the verification is recorded in its own section below.

## The two reviews

**Codex.** An external reviewer run at medium reasoning effort, read-only, given both diff ranges,
the decisions document, the round-1 record, the open findings and the QA record, and told to verify
every claim against the code rather than trust the briefing. Verdict: **do not ship**, on five
findings.

The exact invocation, with local paths replaced by placeholders:

```bash
codex exec -m gpt-6-astra -c model_reasoning_effort=medium --sandbox read-only \
  --color never -C <repository root> "$(cat <briefing>)"
```

The CLI reported `codex-cli 0.153.4`, `model: gpt-6-astra`, `provider: openai`,
`sandbox: read-only`, `reasoning effort: medium`. The model string on record is the one the CLI
header printed: **gpt-6-astra at medium reasoning**. The run used 308,753 tokens.

The briefing is not committed. It pasted the review-quality angles verbatim, gave the head and base
commits and both diff ranges, named the priority areas — the URL-first Connect journey, the per-tool
permission editor, the agent configuration's connection reference, disconnect and remove, name
normalization parity with the API's `tool_prefix`, OAuth popup security, mobile parity and
accessibility on the frontend; the round-1 fixes, the probe, the mock issuer registration, the four
refactors and the plane flags on the backend — and instructed the reviewer not to re-raise a
dispositioned round-1 finding without new evidence.

**Second reviewer.** An independent read of the same scope with the same priority areas, reading the
components and the tests rather than the documents' claims about them, and re-reading the round-1
fix sites. Verdict: **do not ship**, on five findings, three of which are about the frontend and two
about the suite that was supposed to catch them.

## Counts

| | P0 | P1 | P2 | P3 | Total |
| --- | --- | --- | --- | --- | --- |
| Codex, as filed | 0 | 5 | 9 | 1 | 15, plus 3 quality |
| Second reviewer, as filed | 0 | 5 | 9 | 3 | 17, plus 4 quality |
| **After verification and merge** | **0** | **5** | **14** | **5** | **24, plus 4 quality** |
| **As this file is written** | **0** | **4** | **14** | **5** | **1 closed, 27 open** |

Eleven findings overlapped and are merged; they are marked "both" below. Three Codex severities were
lowered on reachability and none was raised, and each change is argued in the finding's own section.
As in round 1 the two reviewers disagreed about severity far more than about fact: every mechanism
either of them described was confirmed against the code, and nothing was withdrawn.

## Disposition table

`Fix rev` is the commit that resolves the finding, and is empty while one is owed. `Verified`
records whether the mechanism was re-read against the code by the merge, and — once a fix lands —
whether that fix was read against the finding and its test.

| ID | Src | Sev | Evidence | Disposition | Fix rev | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| D22 | both | P1 | `web/packages/agenta-entities/src/mcpEndpoint/core/connectJourney.ts:311`, `web/packages/agenta-entity-ui/src/mcpEndpoint/McpConnectJourney.tsx:263` | Fix, blocking | `cd9e6f2c16` | **yes**, code and spec; suite run still owed |
| D23 | both | P1 | `web/packages/agenta-settings-ui/src/mcp/McpServersSection.tsx:247`, `hooks/useMcpConnectJourney.ts:75` | Fix, blocking | | mechanism, code |
| D24 | Codex | P1 | `api/oss/src/core/gateways/mcps/oauth/storage.py:366`, `:222`, `oauth/service.py:456`, `:483` | Fix, blocking. Re-opens D6 | | mechanism, all four sites |
| D25 | reviewer 2 | P1 | `web/oss/tests/playwright/acceptance/settings/mcp-connect.ts:106`, `:297` | Fix or record, blocking the gate | | mechanism, repo-wide grep |
| D26 | reviewer 2 | P1 | `mcp-connect.ts:190`, `:219`, `:236` | Fix with D22 | `cd9e6f2c16` | **partly**, code read; suite run still owed |
| D27 | both | P2 | `hooks/useMcpConnectJourney.ts:160`, `api/oss/src/apis/fastapi/gateways/mcps/router.py:889` | Fix | | mechanism, both sites |
| D28 | both | P2 | `hooks/useMcpConnectJourney.ts:274-295` | Fix | | mechanism, code |
| D29 | reviewer 2 | P2 | `core/connectJourney.ts:181`, `hooks/useMcpConnectJourney.ts:331`, `McpConnectJourney.tsx:117` | Fix | | mechanism, code |
| D30 | reviewer 2 | P2 | `core/connectJourney.ts:185` | Fix | | mechanism, code |
| D31 | both | P2 | `hooks/useMcpConnectJourney.ts:220`, `McpConnectJourney.tsx:104`, `router.py:541-554` | Fix the duplicate; narrow the write | | mechanism, code |
| D32 | both | P2 | `web/packages/agenta-entities/src/mcpEndpoint/api/api.ts:142-181` | Fix | | mechanism, spec and two in-repo clients |
| D33 | Codex | P2 | `api/oss/src/dbs/postgres/gateways/mcps/dao.py:265`, `oauth/storage.py:229` | Fix. Re-opens D21 | | mechanism, code |
| D34 | Codex | P2 | `hooks/useMcpConnectJourney.ts:156-169`, `McpConnectJourney.tsx:96` | Fix with D23 | | mechanism, code |
| D35 | both | P2 | `web/packages/agenta-shared/src/api/env.ts:146`, `api/oss/src/utils/env.py:112` | Fix | | mechanism, both parsers |
| D36 | Codex | P2 | `web/packages/agenta-entity-ui/src/secretProvider/ProviderConnectionCard.tsx:156`, `:358`, `secret/core/providerFields.ts:176` | Fix | | mechanism, code |
| D37 | Codex | P2 | `sdks/python/agenta/sdk/agents/adapters/claude_settings.py:137` | Fix or document | | mechanism only; not run against live Claude |
| D38 | Codex | P2 | `api/oss/src/core/gateways/mcps/probe.py:161` | Fix | | mechanism, code |
| D39 | reviewer 2 | P2 | `mcp-connect.ts:166`, `:270`, `mcpConnectJourney.test.ts:82`, `mcpEndpointConnectStatus.render.test.tsx:189` | Fix the assertions | | mechanism, all four |
| D40 | reviewer 2 | P2 | `hooks/useMcpConnectJourney.ts:67`, `mcpEndpointApi.test.ts:189` | Fix the gap | | mechanism, configs and suites |
| D41 | Codex | P3 | `core/connectionName.ts:36`, `core/agentReference.ts:47`, `api/oss/src/core/gateways/mcps/service.py:207` | Fix the truncation; accept the rest | | mechanism, both implementations |
| D42 | both | P3 | `core/toolPolicy.ts:83` | Fix | | mechanism, code |
| D43 | reviewer 2 | P3 | `McpConnectionDetail.tsx:95-106` | Fix with D31 | | mechanism, code |
| D44 | reviewer 2 | P3 | `core/connectionState.ts:10` | Fix | | mechanism, code |
| D45 | reviewer 2 | P3 | `core/connectionName.ts:69` | Fix | | mechanism, code |
| Q1 | both | P2 | `McpConnectJourney.tsx:98-106`, `hooks/useMcpConnectJourney.ts:189` | Quality, altitude. The root of D22, D23, D29, D30, D31 and D34 | | mechanism, code |
| Q2 | both | P2 | `McpConnectionDetail.tsx:66-83`, `McpToolPermissions.tsx:77-93` | Quality, reuse and efficiency | | mechanism, code |
| Q3 | reviewer 2 | P3 | `McpConnectionDetail.tsx:74`, `McpToolPermissions.tsx:85` | Quality, reuse | | mechanism, code |
| Q4 | Codex | P3 | `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx:212` | Quality, simplification | | **not verified** |

**Four findings still block the release: D23, D24, D25 and D26.** D22 is fixed and verified. D23
makes the journey unrepeatable and reconnect impossible. D24 undoes a round-1 fix on the first token
refresh. D25 and D26 are the reason none of this was caught before the review: the only end-to-end
suite has never run in CI, and its gating variables are set nowhere in the repository.

## D22, fixed and verified

**The finding.** `finish()` dispatched `saved`, which moved the journey to `discovering_tools`, and
nothing listed any tools. `tools_loaded` and `tools_failed` appeared in the event union, in the
reducer's own `case` arms and in `mcpConnectJourney.test.ts`, and nowhere else in `web/`.
`discovering_tools` is in `BUSY_STATES`, so `ModalFooter` disabled Cancel, and `CONFIRM_LABEL` had
no entry for it, so the primary action was disabled too. Every successful connect ended on
"Connected. Looking for tools…" with both buttons greyed out and only the dialog's X, Escape or a
mask click to escape.

**The fix,** `cd9e6f2c16`, read against the finding:

- The hook gained `loadTools`, which calls `listMcpTools` for the connected slug and dispatches
  `tools_loaded`, or `tools_failed` carrying the gateway's own refusal sentence. A journey with no
  slug dispatches an empty list rather than hanging, so every path terminates.
- The dialog drives it on entering `discovering_tools`, alongside the existing effects for `saving`
  and `discovering_scopes`.
- The five connected states gained a `Done` confirm label, and `handleConfirm` closes directly
  rather than going through the cancel path, so closing a journey that succeeded no longer runs the
  cancellation branch.
- `ModalFooter` gained `hideCancel`, so a finished journey shows one button instead of two both
  reading "Done", one disabled. That was a separate wart the second reviewer noted in passing.
- The acceptance spec now closes the journey in all five cases that connect, which is what surfaces
  the next step rather than leaving it behind an open dialog. That also closes **D26**, whose
  mechanism was that the later role-based locators could not resolve inside an `aria-hidden`
  subtree.

**What the fix does not close.** `discovering_tools` remains a busy state with the cancel hidden, so
while the list is loading there is still no enabled button; it is transient now, but a
`listMcpTools` call that never settles would reproduce the symptom. Escape during that window is
safe, because `isConnected` covers `discovering_tools` and so `cancelDeletesEndpoint` answers false
there — which is not true of `saving`, and that is D29. The fix also adds a third independent caller
of `listMcpTools`, which is Q2's concern rather than a new defect, and it inherits D32: a server
whose handshake the browser client cannot complete now reads as a connected server with no tools in
the journey as well as in the drawer.

**Still owed.** A recorded run of the acceptance suite. The commit message says the spec was run
against a stack and that the run is what found the defect, which is the strongest evidence in this
round that the suite is worth having; D25 is the observation that CI does not run it.

## The other blocking findings

### D23. The settings journey is mounted once and never reset — P1

`McpConnectJourney` is rendered unconditionally with `open={connecting}` and no `key`
(`McpServersSection.tsx:247`). Its `reconnect` prop is read twice and only at mount: `useReducer`'s
lazy initializer (`hooks/useMcpConnectJourney.ts:75-79`) and `endpointRef`'s initial value (`:85`).
`destroyOnClose` on `EnhancedModal` destroys the modal's children, not the component that owns the
hook, so the hook's state survives every close.

**Cost.** Choosing Reconnect on an existing connection opens the journey at URL entry with
`endpointId` still null, so it repairs nothing and, carried through, creates a second connection
instead of restoring the one that was picked. A second Connect MCP reopens the dialog holding the
previous attempt's state. Only a page reload resets it.

**Suggested fix.** Mount a fresh controller per attempt, keyed by project and selected connection,
or give the hook an explicit reset the open handler calls.

### D24. The first token refresh erases the client-registration pin the D6 fix added — P1

`get_client_info_for_grant()` (`oauth/storage.py:366`) reads `grant.client_registration_slug` and
returns that registration, but never assigns `self.resolved_registration_slug`. Only
`get_client_info()` (`:363`) and `set_client_info()` (`:419`) do. `refresh_grant()` calls
`get_client_info_for_grant(stored)` (`oauth/service.py:456`) and then `write_tokens(refreshed)`
(`:483`), and `write_tokens` writes `client_registration_slug=self.resolved_registration_slug`
(`storage.py:222`), which is still `None`.

**Cost.** The pin survives the initial grant and dies on the first renewal. Every later refresh falls
back to `_find_provider(current_address=False)`. That is D6's own scenario: after the deployment's
public address changes there are two registrations at one issuer, and the fallback can return the
client these tokens were never issued against, so the refresh is refused and a working connection
dies until someone reconnects it.

**Re-opening D6.** D6 is recorded closed and verified, and the initial write does preserve the
registration. The renewal does not, and the fix's test does not run two consecutive refreshes. That
is new evidence about an unexercised path, which is the bar this round was given.

**Suggested fix.** Assign the slug in `get_client_info_for_grant` on both branches, and add an
integration case that refreshes twice against two registrations at one issuer and asserts the pin
still names the first.

### D25. The browser acceptance suite skips on every run, and a skip reports as a pass — P1

`test.skip(!mockBaseUrl, …)` in `beforeEach` (`mcp-connect.ts:106`) gates all seven cases on
`AGENTA_MOCK_MCP_GATEWAY_URL`, and the OAuth case adds a gate on `PLAYWRIGHT_HOST_RESOLVER_RULES`
(`:297`). Neither variable is set anywhere in the repository: not in the workflow that runs
Playwright, not in the compose files, not in the test harness script. Both are documented as things
an operator exports by hand ([qa.md](../qa.md), [mocks.md](../mocks.md)).

**Cost.** The only end-to-end coverage this feature has does not execute in CI, and the run reports
green. [mcp-release-status.md](../mcp-release-status.md) already records that a pass is owed; what
it does not record is that the suite is invisible to CI rather than merely unrun. D22 is the
demonstration: the suite found it the moment somebody ran it by hand.

**Suggested fix.** Either wire both variables into the workflow and the stack it runs against, or
make the suite fail rather than skip when they are missing. If this suite is to stay a manual gate
step, say so in `mcp-release-status.md` in those words and record the manual pass before release.

### D26. The acceptance suite could not pass while D22 stood — P1, fixed with D22

After each connect the journey modal stayed open and nothing closed it. `EnhancedModal` renders a
Radix dialog in modal mode, so the page behind it is `aria-hidden` under a full-screen overlay, and
the later steps resolved `getByRole("button", {name: "Connect MCP"})` (`mcp-connect.ts:190`) and a
row's kebab (`:219`, `:236`) through the accessibility tree, which cannot see inside an
`aria-hidden` subtree. The row assertions that passed are CSS locators, which is why the earlier
steps looked healthy. `cd9e6f2c16` closes the journey in every connecting case. Verified by reading;
a recorded run is still owed, which is D25.

## The P2 findings

**D27. The blocked-popup fallback navigates the tab away with no return path.** When `window.open`
returns null the hook does `window.location.assign(redirectUrl)`
(`hooks/useMcpConnectJourney.ts:160-164`), destroying the single-page app and the in-memory journey.
The comment claims the callback returns the person to where they were. It does not: the callback
page posts only to `window.opener`, absent on this path, then calls `window.close()`, which a
browser ignores for a tab a script did not open (`router.py:889`). A blocked popup strands the
person on the API's origin under "This tab will close automatically", with any unsaved agent
configuration gone. Mobile browsers and in-app webviews block popups far more aggressively than
desktop, and `/m` is the production default. Fix: give the callback a top-level return when there
is no opener, and correct the comment either way.

**D28. Manual authentication reports success without contacting the server.**
`submitManualCredential` saves the secret reference and dispatches `verify_succeeded`
unconditionally (`hooks/useMcpConnectJourney.ts:274-295`), though the state is called `verifying`
and the UI says "Verifying…". A wrong header name or secret reads as connected until an agent run
fails. [mcp-connection-ux.md](../mcp-connection-ux.md) specifies Verify as a step of this path.
Recovery is also OAuth-only: `router.py:525` refuses a reconnect for a non-OAuth endpoint, so the
offered action cannot repair an API-key connection. Fix: reuse the probe with the credential
attached, or perform one handshake through the data plane, and let `verify_failed` carry the
refusal.

**D29. A cancel between consent and the refetch deletes the connection just authorized.**
`cancelDeletesEndpoint` is true whenever the row was created here and `isConnected` is false
(`core/connectJourney.ts:181`), and both `saving` and `awaiting_consent` qualify. The modal's
`onCancel` is `handleClose`, and Escape and a mask click reach it even while the footer's Cancel is
disabled. The credential exchange happens server-side in the callback, so a person who authorizes
and then presses Escape during the `refreshEndpoints()` round trip deletes a row whose grant the API
has already stored, orphaning it at the provider. `mcp-connection-ux.md` states the invariant this
breaks. Fix: treat consent success as the point of no return, or move `saving` into the connected
set.

**D30. Retry from a failed create or verify moves to a state nothing drives.** `RETRY_TARGET` sends
`create_failed` to `creating` and `verify_failed` to `verifying` (`core/connectJourney.ts:185`),
both busy states, and nothing re-invokes `submitName` or `submitManualCredential`. Pressing Try
again replaces the error with a permanent spinner. `check_failed` and the three consent failures are
fine, because the component re-calls their operation directly. This is the same shape as D22 and the
same fix pattern applies.

**D31. Every OAuth connect discovers scopes twice, and discovery writes the whole endpoint row
back.** `submitName` awaits `discoverScopes` itself (`hooks/useMcpConnectJourney.ts:220-222`), and
the `endpoint_created` transition it dispatched first has already moved the status to
`discovering_scopes`, which fires the component effect that calls it again
(`McpConnectJourney.tsx:104`). Server-side each discovery reads the endpoint, performs outbound
I/O, then writes the snapshot it read back through `_as_edit(endpoint)` — a full replace carrying
`secret_id` and `flags` (`router.py:541-554`). Two outbound round trips and two full-row writes per
connect, and a window in which a slow discovery writes back a `secret_id` that is no longer current.
Codex filed this P1 as a re-opening of D3; lowered to P2 on reachability, because D3's fix narrowed
the service's credential writes and this route's full replace was not within it, and because the
clobber needs a discovery in flight while a callback writes, which the ordinary first connect does
not produce. The duplicate call is the new evidence. Fix: give discovery one caller, and have the
route patch only the OAuth metadata it owns.

**D32. The tool-list client speaks an incomplete MCP handshake and reports protocol failures as an
empty catalogue.** `listMcpTools` (`api/api.ts:142-181`) sends `initialize` then `tools/list` with
no `notifications/initialized` between them, omits the `Accept: application/json,
text/event-stream` pair the transport specification requires, does not carry the negotiated
protocol-version header on the second call, assumes a decoded JSON body rather than a Streamable
HTTP event stream, and ignores pagination. Anything it cannot read becomes `[]` (`:177`). The
runner's own client sends the initialized notification
(`services/runner/src/extensions/pi-mcp.ts:233`), and the backend probe already parses an SSE-framed
handshake (`probe.py:104-123`). A standards-compliant server can therefore be shown as exposing no
tools, which reads as an empty server rather than a client failure and leaves the permission editor
with nothing to edit. Not verified against a third-party server; verified against the specification
and against the two implementations in this repository that do it properly. Fix: move tool discovery
behind a control-plane route that reuses the gateway's own MCP client, rather than keeping a third
MCP client in the browser. That also removes the browser's need to mint a data-plane credential.

**D33. Invalidate compares a secret row id, which a reconnect does not change.** The D21 fix skips
invalidation when `dbe.secret_id != secret_id` (`dao.py:265`). An OAuth reconnect updates the
existing grant row rather than creating one — `write_tokens` finds the grant by the
connection-keyed slug and calls `_update` (`oauth/storage.py:229`) — so `secret_id` is identical for
token A and token B, and a late 401 carrying token A's handle passes the check and marks the freshly
repaired connection invalid. D21's test substitutes a different secret row, which is the
disconnect-then-connect path; the Reconnect button does not go that way. One unnecessary "Needs
authorization" after a successful repair, self-correcting, hence P2. Fix: compare a credential
generation rather than the container's id.

**D34. Consent startup that finishes after cancel or unmount installs a watch nothing owns.**
`driveConsent` awaits `beginMcpConnect` and only then installs the watch
(`hooks/useMcpConnectJourney.ts:156-169`). If the dialog unmounts or the person cancels during that
await, the cleanup runs against a `stopWatchRef` that is still null, and the watch is installed
afterwards, holding a listener, an interval and a three-minute timeout on a dead attempt. The same
missing ownership applies to creation: cancelling before `createMcpEndpoint` resolves cannot delete
the row that arrives after. OR67 closed with the watch's own teardown, which is correct for an
installed watch; this is the window before installation. Fix: an attempt generation checked after
every await.

**D35. An operator who disables the gateway with `0`, `off` or `no` still gets the whole UI.** The
API's `_parse_bool_env` returns `value.lower() in _TRUTHY` (`api/oss/src/utils/env.py:112`), so all
three read as off. The frontend's `isMcpGatewayEnabled` returns true for everything but the literal
string `false` (`web/packages/agenta-shared/src/api/env.ts:146`). The operator switches the plane
off and keeps a settings tab, a Connect journey and an agent-config surface whose every request the
API refuses with a 403. Fix: one accepted vocabulary, normalized where the value is already mirrored
into the browser.

**D36. Saving an existing custom model connection silently declares the OpenAI protocol.** A
connection whose record declares no protocol opens on `DEFAULT_ENDPOINT_PROTOCOL`, which is OpenAI
(`secret/core/providerFields.ts:176`), and the form sends `protocol` on every save
(`ProviderConnectionCard.tsx:156`, `:358`), so a name-only edit turns that default into a
declaration. A declared protocol then gates harness eligibility through `effectiveHarnesses`
(`secret/core/agentModelCandidates.ts:127-142`), and `secret/core/connections.ts:625-630` states the
hazard in its own words: an Anthropic gateway narrowed this way loses every Claude Code row in the
picker. This is frontend code and runs whether or not the LLM gateway is enabled, so "the LLM plane
ships disabled" does not cover it. Fix: keep "undeclared" until someone picks a protocol.

**D37. Claude's generated native rules cannot express a per-tool exception to a server denial.** The
adapter emits both a whole-server rule and per-tool rules (`claude_settings.py:137`). Claude's
permission precedence is deny over ask over allow across all matching rules, not
most-specific-wins, so server `deny` plus tool `allow` resolves to deny, and `new_tool_permission`
is not translated at all. The cost is over-restriction and spurious prompts rather than a bypass:
the runner's own gate is still authoritative at execution and fails closed. The divergence is
between what the editor says an agent may do and what the harness does. The mechanism is read from
the adapter; the precedence claim comes from Claude's documented rule ordering and was not
reproduced against the pinned runtime, so treat the cost as predicted rather than observed. Fix:
emit the resolved per-tool decision only, and translate `new_tool_permission` into the server-level
rule.

**D38. The probe has neither a response-size bound nor a total deadline.** `client.post`
(`probe.py:161`) buffers the whole response before anything inspects it, and the read timeout is an
inactivity timeout rather than a total elapsed deadline, so a slow trickle keeps a worker occupied.
The caller must hold `EDIT_MCP_ENDPOINTS`, so this is an authorized capability rather than an open
one, and it is the only gap found in an otherwise well-built boundary. Fix: stream with a byte cap
and a total-elapsed timeout. A local bound on the probe, not the deferred streaming redesign.

**D39. Four assertions are proved by text the frontend renders regardless of the backend.**
`mcp-connect.ts:166` asserts the duplicate-name message, which `connectionNameProblem` renders
client-side from the in-memory list without ever submitting, so the API's
`mcp_connection_name_taken` refusal and the `name_taken` reducer path are never reached.
`mcp-connect.ts:270` asserts a hardcoded sentence from `McpConnectionDetail.tsx:166`.
`mcpConnectJourney.test.ts:82` dispatches `tools_loaded` itself, which is what made D22 look
covered. `mcpEndpointConnectStatus.render.test.tsx:189` asserts the markup contains "disabled",
satisfied by the button's own `disabled:opacity-50` class whenever it renders, so dropping the
`disabled` prop ships a live Connect button on a read-only agent config, green.

**D40. The hook that holds most of this round has no test at all.** The package's vitest config runs
in a `node` environment with no React plugin, so it cannot render a hook
(`hooks/useMcpConnectJourney.ts:67`), and no `agenta-entity-ui` test mounts the real dialog.
Untested: the synchronous-popup contract, the blocked-popup fallback, that `trustedOrigins` is wired
into the watch at all, cancel deleting a journey-created row and not a reconnect, `endpointRef`
preventing a duplicate create, the `name_taken` join, the auth-mode mapping, `finish()`'s chain,
`submitManualCredential`, `skipAuthentication`, and unmount teardown. Separately,
`mcpEndpointApi.test.ts:189` asserts `listMcpTools`'s method and headers but never its URL, and that
URL is the one built by string surgery (`api/api.ts:148`).

## The P3 findings

**D41. Name normalization disagrees at two edges.** `normalizeConnectionName`
(`core/connectionName.ts:36`) is trim-then-replace over `[^A-Za-z0-9_]`, which is exactly what
`tool_prefix` does (`api/oss/src/core/gateways/mcps/service.py:207`). Two edges differ: a JavaScript
regular expression without the `u` flag replaces each UTF-16 unit, so an astral character becomes
two underscores where Python makes one; and `toolPrefixFromName` (`core/agentReference.ts:47`)
truncates at 128 characters where the backend does not, so two names differing only past character
128 pass the backend check and collide in the stored agent prefix. Codex filed P2; lowered to P3
because both need a deliberately constructed name and neither has a security consequence. Fix the
truncation by refusing an over-long name in the field.

**D42. A tool named after an `Object.prototype` member resolves to a function.**
`core/toolPolicy.ts:83` indexes a plain object that came off the wire, so a tool called `toString`
returns an inherited function, which is truthy, and `effectiveToolPermission` reports it as an
explicit permission. The runner had this defect on the Composio side and fixed it with a `Map`
(`services/runner/src/mcp-permission.ts:77-80`). Display only: the editor is the sole consumer.

**D43. A rename posts back the credential handle the client last saw.**
`McpConnectionDetail.tsx:95-106` sends `secret_id`, `data` and `flags` from an endpoint object that
can be thirty seconds stale (`state/atoms.ts:36`), so a rename racing a reconnect in another tab
writes the stale handle back. The fix is the one D3 chose on the server: write the columns the
operation owns.

**D44. An unauthenticated endpoint reads Ready even when the gateway marked it invalid.**
`core/connectionState.ts:10` returns `ready` for `auth_mode === "none"` before consulting
`flags.is_valid`.

**D45. The name suggestion can return a name the API will refuse.** After a hundred collisions
`core/connectionName.ts:69` returns the bare `base`, the one name it has already established is
taken, contradicting the file's own stated contract. Return null and let the caller ask.

## Quality findings

**Q1 — asynchronous work in the journey has two owners. P2, altitude.** Some transitions are driven
imperatively by the hook, some by component effects, and several states are driven by nobody
(`McpConnectJourney.tsx:98-106`, `hooks/useMcpConnectJourney.ts:189`). The endpoint identity is held
twice, in the reducer and in a ref, because the reducer's state is not readable from inside an async
step. D22, D23, D29, D30, D31 and D34 are all this one seam, and both reviewers named it the largest
piece of unnecessary complexity in the frontend independently. The simpler form is one controller
that owns executing each operation, correlating its result with the attempt that started it, and
cancelling it, with the component rendering state and dispatching intent. A state machine whose
states have no drivers is not a state machine. `cd9e6f2c16` gives `discovering_tools` a driver,
which is the right local fix and leaves the seam.

**Q2 — two components fetch and cache the same tool catalogue, and the journey is now a third.
P2, reuse and efficiency.** `McpConnectionDetail.tsx:66-83` and `McpToolPermissions.tsx:77-93` each
re-implement the same four-state loader and each mint a gateway credential and run a two-call
handshake on mount; neither discards a late result after the selected connection changes, and the
drawer's effect depends on the whole endpoint object, so it refetches whenever the list refreshes.
The package already has the pattern to reuse: an `atomWithQuery` keyed by project
(`state/atoms.ts:25`). Key one by project and connection slug, and let the journey read the same
query.

**Q3 — two tool-list failures are shown as an HTTP status line. P3, reuse.**
`McpConnectionDetail.tsx:74` and `McpToolPermissions.tsx:85` render `(error as Error)?.message`,
which for an Axios rejection is "Request failed with status code 409". `gatewayRefusalMessage`
(`core/refusal.ts:22`) exists for exactly this and is used at six call sites in the journey, and
`cd9e6f2c16` uses it for the journey's own tool failure.

**Q4 — the asynchronous prepare-commit stage in the config drawer has no implementation. P3,
simplification.** `AgentTemplateControl.tsx:212`. Filed by Codex and **not verified by this merge**;
recorded so it is not lost, and it should be confirmed before anyone acts on it.

## Checked and found correct

Recorded so a third round does not spend time here.

- **The new probe is safe by construction.** `probe.py:151` goes through `open_egress`, which
  resolves the name, refuses blocked ranges, pins the connection to the address it checked and
  carries the original host as SNI (`egress.py:144-201`); `egress_client` keeps no cookies and
  follows no redirects; the probe sends no credential; its transport errors go through
  `classify_transport_error` rather than quoting the exception; and the route is gated on
  `EDIT_MCP_ENDPOINTS` rather than VIEW (`router.py:487`). Both reviewers looked for an SSRF or
  reflection path and neither found one. D38 is a resource bound, not a boundary failure.
- **The D1 fix is thorough.** The classifier (`egress.py:248-305`) is a closed vocabulary, and the
  two classes whose text can quote the credential or an upstream echo are marked unloggable.
- **The four refactors are behaviour-preserving**, agreed by both reviewers. `run_claims.py:20`
  keeps the non-empty-string and list-valued rules the four call sites had; `flags.py:32` with
  `exceptions.py:93` builds the identical typed 403; the overlapped Pi handshakes consume their
  results in configuration order; the SDK fallback trim reads the same status off the refusal.
  Handshake failure-detail propagation is an intentional behaviour change rather than a
  simplification.
- **Per-tool policy means the same thing in all three places for a valid policy.**
  `resolvedNewToolPermission` (`core/toolPolicy.ts:67`) matches
  `MCPPolicy.resolved_new_tool_permission` (`sdks/python/agenta/sdk/agents/mcp/models.py:146`); the
  SDK emits the camelCase pair only when the author opted in, so an existing configuration produces
  a byte-identical wire; the runner treats the table as authoritative and refuses an ambiguous name
  (`services/runner/src/mcp-permission.ts:143`); and the editor refuses a permission for a tool the
  include filter hides, matching the SDK's validator. D37 is the exception and it sits at the
  native-rule layer, not this one.
- **The agent's connection reference is keyed on the slug.** `core/agentReference.ts:55` stores
  `{type, namespace, slug}`, the older `{type: "http", url}` shape is read and never written, a
  rename changes the label only, and a reference to a removed connection refuses rather than
  resolving to another.
- **The disconnect path is right.** It revokes the grant and keeps the row; the atom writes the
  returned endpoint straight into the cache rather than leaving the row reading Authorized during a
  refetch (`state/atoms.ts:84`); and the menu item is hidden for anything but a ready OAuth
  connection, which is what the route accepts.
- **The OAuth attempt is validated server-side.** The completion message carries no nonce, but the
  state parameter is generated cryptographically (`oauth/state.py:22`) and the callback looks it up,
  checks the initiating user, consumes it atomically and enforces expiry (`oauth/service.py:238`).
  The frontend's origin check is exact (`core/connectMessage.ts:31`) and its trusted set is built
  from the configured API URL alone, so no tenant-supplied MCP URL reaches it. The missing frontend
  correlation is a freshness matter, not a path to a stolen grant.
- **`watchOauthConsent` and its test are the strongest work in the frontend half.** One outcome per
  attempt, an idempotent `stop()` releasing listener, poll and timeout together, a closed popup read
  as failure, a timeout so every attempt terminates, and a test that injects timers and a fake popup
  and posts a valid completion from an untrusted origin to prove the origin check fires. D34 is the
  window before this watch exists, not a defect in it.
- **The mobile tab is real parity, not a reduced surface.** `web/mobile` mounts the same
  `McpServersSection` the classic app does (`web/mobile/src/features/settings/SettingsScreen.tsx:217`),
  behind the same flag helper and the same visibility rule, and the consent popup is opened inside
  the tap handler with no preceding await, which is what WebKit requires. It inherits every finding
  above and adds none. Two mobile notes worth someone's time but not findings in their own right:
  the agent-config Connect control is a roughly nineteen-pixel touch target
  (`McpServerConnectAction.tsx:69`), and
  `web/mobile/src/features/settings/settingsTabs.ts:46` still says this app lists no MCP tab, which
  is how a reviewer skips mobile QA.
- **Good tests, not to be re-checked:** `mcpConnectWatch.test.ts`, `mcpConnectMessage.test.ts`,
  `mcpEndpointDisconnect.test.ts`, `mcpGatewayGate.test.ts`, `mcpGatewayRefusal.test.ts`, and six of
  the seven functions covered in `mcpEndpointApi.test.ts`.

## Round-1 findings not re-raised

D11, the remainder of D12, D18 and D19 are deferred with stated closures in
[round-1.md](round-1.md) and nothing found here contradicts them. Both reviewers re-read D1, D2,
D10, D20 and the runner's ambiguous-name refusal and found no contrary evidence. D6 is re-opened as
D24 and D21 as D33, each on a path the original fix's test does not exercise. D3 is not re-opened;
D31 records the related route and says why it is a lesser thing.

## What this is not

A release sign-off. It covers what these two reviewers raised over the two ranges they were given,
and nothing wider. No suite was executed for this round: the findings are read from the code and the
tests, and D25 and D26 are precisely the observation that the suite which would have caught the
largest one is invisible to CI. It was run by hand once, and it immediately found D22 — which is the
clearest argument in this round for wiring it in. [mcp-release-status.md](../mcp-release-status.md)
said the remaining release work was none of it code; on this candidate that was not true.

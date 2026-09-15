# Review findings

## Active review findings

The record runs OR36 to OR81, forty-six findings: thirty-seven closed, eight open and one
withdrawn.
Entries numbered below OR36 predate that record and are all closed.

Eight findings are open. OR69 heads this section but counts as neither open nor closed: it was
withdrawn on 2026-09-13, and its entry stays in place so the reading is not repeated. No P0 and no
P1 remain: OR79, opened and closed on 2026-09-15, was the last P0 and OR80 the last P1, and both
are closed. The highest severity open is P2, carried by OR76 alone; the other six entries are
debt and carry no severity. The open set is OR63, OR65 to OR68, OR76 and OR81. The six debt entries
are also tracked as CU15 to CU20 in `cleanups.md`, which records why each is still open. None of
the seven waits on a design decision. OD24 to OD27 in `open-designs.md` are all decided. Every open
entry states the closure that would settle it and the test that would prove it. A finding that
closes moves to the closed record below.

---

### OR78. A client registration is keyed on the issuer alone, so a changed public URL silently reuses one the server will refuse

`api/oss/src/core/gateways/mcps/oauth/storage.py` addresses a stored client registration by
`_issuer_slug(issuer)`, a `uuid5` of the issuer URL, and `_find_provider` matches on
`issuer_url` alone. The redirect URI is not part of the key, and nothing compares the stored
registration's redirect URI against the current one. Present in the branch as of 2026-09-15.
Severity P2.

A registration is bound to the redirect URI it was created with. So when a deployment's
public address changes, which happens whenever a tunnel is added, rotated or dropped, the
next connect finds the old registration, sends its `client_id`, and the authorization server
refuses it: the client it knows is registered against an address the request no longer uses.
Nothing re-registers, so the endpoint stays unconnectable until someone deletes the record by
hand, and the error the user sees is the authorization server's, which says nothing about
redirect URIs.

This has not bitten yet, and that is worth recording precisely so the next reader does not
over- or under-rate it. The vault currently holds no `oauth_provider` record at all. The
Linear failure investigated on 2026-09-15 looked like this and was not: it was the client
identity strategy, closed separately, and the absence of any stored registration is what
proved it. So this is a latent defect found while refuting a hypothesis, not an observed one.

Closure: a registration is reused only when it still matches the callback URL the deployment
would send, and a changed callback URL produces a fresh registration rather than a refusal.
Either the key includes the redirect URI, or the lookup compares the stored registration's
redirect URI against the current one and re-registers on a difference. Proven by a case
beside `api/oss/tests/pytest/unit/gateways/test_gateways_mcp_oauth_registration_fallback.py`
that stores a registration, changes the deployment's public URL, and asserts the next begin
registers again rather than sending the stale `client_id`.

---

### OR81. Disconnecting a connection deletes its grant locally and never tells the authorization server

Added 2026-09-15 alongside the connection-keyed grant. Debt, carried deliberately; no severity.

`api/oss/src/core/gateways/mcps/oauth/storage.py::delete_grant` removes the vault row, and
`MCPOAuthConnectService.disconnect` is the only caller. Nothing is sent to the authorization
server, so the access token and the refresh token stay live upstream until they expire. A person
who disconnects an account has told Agenta to stop using it, and Agenta does stop; what they have
not got is the provider forgetting the authorization Agenta still holds material for.

Why it is still open: RFC 7009 revocation needs a `revocation_endpoint`, which this deployment does
not read out of authorization-server metadata today, and a server that advertises none cannot be
revoked at anyway. Adding the discovery, the call, and the behaviour when the call fails — a
disconnect must still disconnect — is more than the connection-identity change should carry.

Closure: `disconnect` reads the revocation endpoint from the authorization server's metadata,
presents the grant there, and deletes the row whether or not the revocation succeeded. Proven by a
case beside `api/oss/tests/pytest/integration/gateways/test_mcp_oauth_connection_identity.py` where
the local provider records the revocation and a provider advertising no revocation endpoint still
disconnects. Also tracked as CU20 in `cleanups.md`.

---

### OR69. The Daytona runner puts the user's provider keys into the sandbox environment, around the gateway entirely — WITHDRAWN, the file was the wrong runner

This entry was wrong and is kept only so the reading is not repeated. It read
`sdks/python/agenta/sdk/engines/running/runners/daytona.py:140-200,286-291` as the agent's Daytona
backend and concluded that a gateway-routed run still ships the user's provider keys into the
sandbox. Three checks, each of which alone settles it, say otherwise.

**It is a different runner.** That file is the custom-code evaluator's sandbox. Its entry point is
`execute_code_safely` in `sdks/python/agenta/sdk/engines/running/sandbox.py:46`, which takes
`correct_answer` and returns a score. The agent runner is `services/runner/src`, a separate
component, and the evaluator file contains the string "gateway" zero times.

**The agent path attaches no provider credential at all.** A gateway-routed connection is built at
`sdks/python/agenta/sdk/agents/connections/endpoints.py:245-254` with `credential_mode="none"` and
an empty `credentials` list, which is what `specs-wp13.md` promised.

**The agent runner never ships a plaintext key to Daytona anyway.** It delivers credentials as
`dtn_secret_<id>` references that Daytona's own egress proxy substitutes host-pinned
(`services/runner/src/providers/daytona-credential-delivery.ts`). The sandbox holds placeholders.

**And nothing here is this branch's.** `git diff origin/main...HEAD` touches no file under
`sdks/python/agenta/sdk/engines/running/runners/`.

What remains true is narrower and older than the entry claimed: the custom-code evaluator's Daytona
sandbox receives vault-derived provider values as ordinary environment variables. That predates this
work, has no gateway component, and belongs in an issue outside this document set rather than in a
finding against this branch.

---

### OR63. The gateways domain imports its transport, so the dependency direction runs inward from FastAPI

`core/gateways` cannot be tested or reused without FastAPI, and two deployable web applications live
inside the domain layer. Present in the branch as of 2026-09-13.

`api/oss/src/core/gateways/mcps/providers/agenta/adapter.py:6` imports `HTTPException` and `Request`
from FastAPI at runtime, and `Request` appears in the domain signatures at `:19` and `:35`.
`HTTPException` is caught and converted to `ValueError` at `:87-88` rather than raised, which is the
milder half of the same coupling. `api/oss/src/core/gateways/mcps/service.py:68` imports `Request`
under `if TYPE_CHECKING`, so it costs nothing at runtime but keeps the transport type in the domain's
vocabulary at `:384`. `api/oss/src/core/gateways/mcps/service.py:453-455` constructs an adapter that
calls `ToolsRouter`, so the domain reaches back into transport to execute a tool. Two FastAPI
applications sit inside the domain as well:
`api/oss/src/core/gateways/llms/providers/mock/app.py:24` and
`api/oss/src/core/gateways/mcps/providers/mock/app.py:32`. The neighbouring layers are clean: `dbs/`
and `core/secrets/` import no transport.

Closure: `core/gateways` imports no web framework, tool execution enters through a domain interface,
and the mock applications live in development infrastructure. Proven by an import-boundary test
beside `api/oss/tests/pytest/unit/gateways/` asserting no module under `core/gateways` imports
`fastapi`.

---

### OR65. The test suites replace the boundaries where the guarantees actually fail

The suites are green, and they could not see any of the defects this review found. Present in the
branch as of 2026-09-13.

The unit suites substitute fake DAOs and fake adapters, so they establish nothing about database
tenancy, migration compatibility or upstream request semantics, which is where OR36, OR40, OR46 and
OR62 live. `api/oss/tests/pytest/unit/gateways/test_gateways_llm_relay_adapter.py:231` supplies the
title-cased header that hides OR37.
`api/oss/tests/pytest/unit/gateways/test_gateways_mcp_router.py:166-170` builds a bare FastAPI app
and `:173-178` replaces `get_auth_scope`, so the real middleware never runs and OR47 is invisible.
`api/oss/tests/pytest/unit/gateways/test_gateways_llm_service.py:217-282` holds five tests that
assert only that the service forwards to its DAO and returns what the DAO returned. The SSRF golden
vectors (`sdks/python/oss/tests/pytest/utils/ssrf_guard_vectors.py`, fixture at
`sdks/python/oss/tests/pytest/unit/golden/ssrf_guard_vectors.json`) derive their expected values from
the same `ipaddress` predicates the guard uses, so they are regression coverage against drift rather
than an independent oracle, and no vector can detect a guard that is never called. They also cover
the SDK and the runner only; `api/` has no golden-vector consumer, and
`api/oss/src/core/webhooks/utils.py:12-21` is a third copy of the same six predicates.

The acceptance suites that do exercise a real socket never run in CI. `AGENTA_GATEWAYS_MOCKS_ENABLED`
is set in the two development compose files and in `hosting/docker-compose/test.sh` and nowhere else,
so the PR preview has neither the flag nor the two mock containers. Ten tests across
`api/oss/tests/pytest/acceptance/gateways/test_llm_gateway_proxy_acceptance.py`,
`test_mcp_gateway_proxy_acceptance.py` and
`sdks/python/oss/tests/pytest/acceptance/agents/test_mcp_gateway_routing_acceptance.py` skip there.
They ran red before they were gated, so the gate costs no coverage, but it does mean every
real-socket gateway test depends on somebody running the stack by hand.

The missing test is one real path end to end: the real middleware, the real gateway service, a
migrated database and a controlled upstream, driven with a second tenant present and with a
sandbox-held credential.

Closure: that path exists as an integration case and fails when any of OR36, OR37, OR40, OR46, OR47
or OR62 is reintroduced. Proven by the case itself, under
`api/oss/tests/pytest/integration/gateways/`.

---

### OR66. Audit records omit the decisions that were made and the outcomes that resulted

The audit trail cannot answer what the gateway refused, what tool was called, or what a call cost.
Present in the branch as of 2026-09-13.

Model and tool refusals happen before the recorded authorization path, so a refusal leaves no record
of itself. A streaming failure keeps the status assigned when the response was first received
(`api/oss/src/core/gateways/llms/service.py:529-530`, set once at
`api/oss/src/core/gateways/llms/providers/passthrough/adapter.py:180`), so a stream that fails
mid-flight is recorded as the 200 it started as.
`api/oss/src/core/gateways/policy/audit.py:26-45` builds the record without the MCP method or tool
and without any usage field, although `GatewayTarget.method` and `.tool` exist at
`api/oss/src/core/gateways/policy/dtos.py:96-97` and `GatewayOutcome.usage` at `:122`, and
`service.py:531` populates the latter.

Closure: every refusal is recorded, a stream records its final status, and the record carries the MCP
method, the tool and the usage fields. Proven by cases beside
`api/oss/tests/pytest/unit/gateways/` asserting an audit record exists for a refused model, for a
refused tool, and for a mid-stream failure with the failing status.

---

### OR67. The MCP connect dialog leaks a message listener and an interval on every open

Closing the connect dialog while the authorization popup is still open leaves a `message` listener
and a polling interval behind, and every reopen adds another pair. Present in the branch as of
2026-09-13.

`web/oss/src/components/pages/settings/MCPEndpoints/MCPConnectDialog.tsx:126` registers the listener
and `:128` starts the interval, both inside the `handleConnect` callback at `:69-143`. The `cleanup`
function at `:93-99` runs only from the message handler or from the popup-closed poll. Neither fires
when the dialog unmounts, and there is no `useEffect` teardown.

Closure: the listener and the interval are torn down when the dialog unmounts. Proven by a case
beside `web/oss/tests/` that opens and unmounts the dialog with the popup still open and asserts no
listener and no interval remain.

---

### OR68. The migration downgrade is only partially reversible, and its upgrade takes a lock it does not bound

Running `downgrade()` leaves a database the previous revision's code cannot read. Present in the
branch as of 2026-09-13.

`api/oss/databases/postgres/migrations/core_oss/versions/oss000000030_add_gateway_endpoints.py:156-168`
drops both gateway tables, their indexes and the two gateway enums. It leaves the `OAUTH_GRANT`
member added to `secretkind_enum` at `:27`, which PostgreSQL cannot remove, and it leaves every
OAuth vault row written under that kind. The previous revision's `SecretKind` cannot deserialize
those rows. Separately, creating the foreign keys at `:69-78` and `:132-141` takes
`SHARE ROW EXCLUSIVE` on the referenced `projects` and `secrets` tables, which blocks writes to both
for the duration on a busy database.

Closure: `downgrade()` states in its own body what it cannot reverse and what that leaves behind, and
the upgrade bounds its lock wait. Proven by reading the revision: the docstring names the retained
enum member and the retained rows, and the upgrade sets a `lock_timeout`.

---

### OR76. An OpenAI Chat Completions stream records no usage unless the caller asked for it

A streamed call on `/v1/chat/completions` meters nothing, while the same call on Responses or on
Messages meters every time. Present in the branch as of 2026-09-14. Severity P2.

Responses and Messages report usage without being asked, so the drain finds it on both planes.
Chat Completions reports streaming usage only when the request carries
`stream_options.include_usage`. The gateway relays request bytes as it received them and adds
nothing, so a caller who omits that field gets a stream with no usage in it for the drain to read.
The call then records no usage at all rather than a zero, which keeps an absent count
distinguishable from a measured zero, and leaves the route unmetered.

Severity is P2 because nothing prices usage yet. No bill is wrong, no quota is wrong and no user
sees anything. This is a gap the metering work has to settle, not a defect with a consequence
today.

The trade is recorded under OR49 in the closed record, and whoever settles this should read it
before repeating the experiment. Adding `stream_options.include_usage` to a request that did not
carry it was tried and backed out: it breaks byte-preserving relay on that path, it re-chunks the
response, and it risks a `400` from upstreams that reject unknown fields.

Closure: the caller sets the field, not the relay. Every gateway-routed Chat Completions request
that a harness issues carries `stream_options.include_usage` because the connection path put it
there, so the stream arrives carrying usage and the relay keeps passing bytes through untouched.
That means the Pi extension, the Codex configuration and the Claude harness each set it on the
requests they build, and each is verified separately, because they construct their requests in
three different places and a fix in one proves nothing about the others. Proven per harness by a
case asserting the outbound request carries the field, plus a streamed cell in
`services/oss/tests/pytest/acceptance/test_agent_gateway_route.py` asserting the recorded usage
matches the upstream's own totals for that harness.

The relay stays out of it. Nothing in `providers/passthrough/adapter.py` should add the field, and
a future reader who reaches for that shortcut should read the OR49 record first.

## Closed review record

### OR79. The Pi harness never gates an MCP tool, so a server configured `deny` executes anyway — CLOSED, and the gate became a required argument rather than an optional one

`registerPiGatewayMcpTools` in `services/runner/src/extensions/pi-mcp.ts:330-342` registers every
discovered MCP tool with an `execute` that calls the upstream directly. No approval gate runs
first. Compare `services/runner/src/extensions/agenta.ts:357` and `:380-381`, where every
executable custom tool raises `piDialogAllows` before it relays. Present in the branch as of
2026-09-15. Severity P0.

`MCPPolicy.permission` is therefore dead configuration on Pi, in both directions. An `ask` server
runs unattended with no approval card, and a `deny` server runs too. The word `permission` does not
appear anywhere in `pi-mcp.ts`, and `PiGatewayMcpServer.policy` is declared as
`{ tools?: { mode?: "all" | "include"; names?: string[] } }` (`pi-mcp.ts:33`), so the field has no
place in the type the Pi extension consumes even though the JSON that reaches
`AGENTA_AGENT_GATEWAY_MCP_SERVERS` still carries it. `PiGateKind` is
`"pi-builtin" | "pi-custom-tool"` (`services/runner/src/engines/sandbox_agent/pi-gate-envelope.ts:32`),
so there is no gate identity an MCP tool could even be raised under: a hand-rolled dialog would
fail closed at the unknown-tool branch in
`services/runner/src/engines/sandbox_agent/acp-interactions.ts:625-633`.

This is the one invariant the release gate states outright — a rejected call must have no upstream
side effect — and on Pi it does not hold. Observed on a running EE deployment on 2026-09-15: an
agent whose only MCP server carried `policy.permission: "deny"` emitted no approval frame, the
tool returned `isError: false`, and the API access log recorded the `tools/call` on the gateway
route after the model call. The same configuration on Claude Code parked correctly, which is what
makes this a Pi-path defect rather than a wire or SDK one: the SDK serialises `permission` and the
runner receives it. `serverPermissionsFromRequest`
(`services/runner/src/engines/sandbox_agent/runtime-policy.ts:121-131`) records it, and only the
ACP harnesses ever read the result.

Closure: the registered `execute` raises a real gate before `client.call`, under a new
`pi-mcp-tool` gate kind, with a fail-closed intake so a permission that is not exactly `allow`,
`ask` or `deny` denies rather than falls through to the run default. Proven by a unit case
asserting a `deny` server's tool returns the refusal text without the client being called, an
`ask` server's tool raises the gate, and an `allow` server's tool executes unprompted; plus a live
cell on Pi repeating the three-way ask/deny/allow run above and reading the gateway's own request
log to confirm a denied call never reaches it.

**Closed 2026-09-15.** `registerPiGatewayMcpTools` now takes a gate as a REQUIRED fourth argument
and every registered `execute` raises it before `client.call`, under a new `pi-mcp-tool` gate kind.
Required rather than optional on purpose: an optional gate is the same defect with a longer fuse,
because one caller that forgets to pass it restores the hole, and the signature now makes a
gateless registration impossible to write.

The decision itself is not made in the sandbox. The envelope carries `mcpServer` and `mcpTool` as
IDENTITY, and the runner reads the permission from the run's own request through
`buildPiGateDescriptor`, which fails closed for a server the run did not configure — so a
fabricated server name cannot resolve against the run's default permission. Intake moved to
`services/runner/src/mcp-permission.ts`, which both the runner and the bundled Pi extension import,
so the rule cannot drift between harness families again. A `deny` tool is now dropped from the
advertised catalog outright, the way the Composio search filter already drops one.

Proven by `services/runner/tests/unit/pi-gateway-mcp.test.ts` (a denied tool is never registered;
an ask tool refused at the gate performs no `tools/call`; an allowed one does) and
`tests/unit/pi-gate-envelope.test.ts` (the policy is read from the run, not the envelope; an
unconfigured server fails closed). Live re-proof on the demo stack is recorded in the release
evidence.

---

### OR80. Pi rewrites an MCP server's name into its tool names, so the permission lookup misses and two connections collapse into one — CLOSED, by carrying the identity rather than parsing it back out

`piMcpToolName` (`services/runner/src/extensions/pi-mcp.ts:232-235`) builds a Pi tool name as
`mcp__${normalize(server)}__${normalize(tool)}` where `normalize` replaces every character outside
`[A-Za-z0-9_]` with `_`. The permission map is keyed on the server's raw name
(`services/runner/src/engines/sandbox_agent/runtime-policy.ts:127`), and `serverPermissionFor`
(`services/runner/src/engines/sandbox_agent/acp-interactions.ts:901-917`) recovers the key by
parsing it back out of the tool name. Present in the branch as of 2026-09-15. Severity P1.

Two consequences, and the second is the one that outlives any single fix.

A server named `mock-mcp` becomes `mcp__mock_mcp__echo`, so a lookup for `mock_mcp` in a map keyed
`mock-mcp` misses. Today that costs nothing only because OR79 means Pi never performs the lookup;
the moment Pi gates, every hyphenated or dotted server name silently loses its policy and falls
through to the run default. The two harness families already disagree on the spelling for the same
configured server, which is what makes the mismatch easy to miss in review: on the same agent the
Pi run reported `mcp__mock_mcp__echo` while the Claude run reported `mcp__mock-mcp__echo`.

The normalization is also not injective, so distinct connections can produce one tool name.
Observed on a running deployment on 2026-09-15 with two servers on one agent, `mock-mcp` and
`mock.mcp`: both registered `mcp__mock_mcp__echo`, the run completed against whichever registered
first, and nothing in the operator-visible logs said so. The collision guard at `pi-mcp.ts:317-327`
does not catch this — it fires only for a name Pi already holds that this module did not register,
and it logs inside the sandbox. Two accounts on one server are the release's own headline case
(`release-decisions-2026-09-15.md`, account identity), so a naming scheme that cannot keep them
apart is not survivable.

Closure: identity is the connection's stable slug, carried explicitly beside each server rather
than recovered by parsing a display name, and the permission map is keyed on that same slug. The
connection experience document already requires this — match policy and calls by stable connection
identity plus upstream tool identity, and a renamed display label must not reset policy
(`mcp-connection-ux.md`). Proven by a unit case asserting that two servers whose display names
normalise alike keep distinct tool names and distinct policies, and that a server whose name
contains a character the harness rewrites still resolves its own permission.

**Closed 2026-09-15.** Two changes, one per consequence.

Pi no longer recovers identity by parsing: the gate envelope carries `mcpServer` and `mcpTool`
verbatim, and the permission table is keyed on the same server name the wire used. The ACP lookup,
which must still parse because the harness renders the name, now lets the configured server names
arbitrate rather than the punctuation — it takes the longest configured name the rendered string
starts with, so a server called `acme__prod` resolves to itself instead of to `acme`.

The collision is refused rather than resolved. When two different configured servers rewrite to one
Pi tool name, neither is registered and the registration fails loudly, because whichever registered
first would otherwise answer for both and the model would reach one account's tool believing it had
reached the other's. The cross-server check runs BEFORE the warm-turn no-op, which is the fix
rather than an optimisation: `ours.has(name)` is true for a name the OTHER server registered a
moment earlier, so the no-op used to swallow exactly this case.

Proven by `services/runner/tests/unit/pi-gateway-mcp.test.ts` (a hyphenated server reaches its own
policy; two servers that render alike are both refused) and
`tests/unit/sandbox-agent-acp-interactions.test.ts` (a server whose name contains the separator
resolves, and the longest match wins).

The stable connection slug the connection work introduces drops into one call site,
`mcpPermissionsFromRequest`: the table gains a second key and nothing downstream moves.

---

### OR77. The agent config's MCP server form cannot choose OAuth, so the playground cannot express an OAuth server — CLOSED, and OAuth is a registration choice rather than a stored credential

**What the defect was.** The `Authentication` select in
`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/McpServerFormView.tsx` rendered OAuth
as a `disabled` option behind a `Soon` badge, and its change handler returned early on that value.
The settings MCP endpoints drawer could register an OAuth server. The agent config form, which is
the obvious place an author adds a server, could not. The documented product path was therefore
unreachable from the surface users actually use, and the playground could not express an OAuth
server at all. P2: no security consequence, and a product path that does not exist. It sat under
OR31's notes as a placeholder rather than as a tracked finding.

**OAuth is selectable, and the authorization happens in place.** The option is enabled. The row
carries a needs-authorization state with a connect action, `McpServerConnectAction`, and that action
runs the same discover, scope dialog, popup and connected-message flow the settings page runs. The
author never leaves the playground.

**OAuth is a registration choice, not a stored credential, and this constraint shapes the design.**
`MCPCredentials` in `sdks/python/agenta/sdk/agents/mcp/models.py:33` is a discriminated union of
`none` and `header_secret_refs`, and `MCPConnection` sets `extra="forbid"` at `:42`. Writing
`credentials.type` of `"oauth"` into a config therefore fails validation on every run of that agent,
not once at save time. So the draft carries the choice, registration sends `auth_mode: "oauth"`, and
`normalizeMcpDraftCredentials` rewrites the committed credentials back to `none`. The form reads the
OAuth state back off the endpoint row rather than off the config, through
`resolveMcpAuthenticationType`. A future reader who moves the choice into `credentials` reintroduces
the defect, and it breaks the run rather than the save. The `keepsOAuth` behaviour that stops an
edit disconnecting an already-registered row is unchanged.

**The connect flow moved out of the app layer into the packages.** Three features drive it now: the
settings dashboard, the agent chat's connect widget and this form. The API calls, the
connection-state logic and the endpoint atoms are in `@agenta/entities` under a new `mcpEndpoint`
subpath. The dialog and the connect action are in `@agenta/entity-ui`. The packages take `axios` and
`getAgentaApiUrl` from `@agenta/shared/api` and use the host query client rather than the singleton.
Thin re-export shims in the old app paths were removed, because the app's lint bars re-exporting
from `@agenta` packages, so every call site imports the package directly. No new dependency was
needed.

The mobile app needs no change. It renders the same control from `@agenta/entity-ui` and
bind-mounts the same packages directory.

Tests: three suites in `@agenta/entity-ui`. `tests/unit/mcpServerAuthentication.test.ts` asserts the
form writes the OAuth marker and reads OAuth back off the endpoint row a saved config cannot
express. `tests/unit/mcpEndpointRegistration.test.ts` asserts registration emits
`auth_mode: "oauth"` and keeps the marker out of the saved config, with
`normalizeMcpDraftCredentials` cases beside it.
`tests/unit/mcpEndpointConnectStatus.render.test.tsx` asserts the connect status renders across the
grant states and on a read-only config. The moved
tests are `tests/unit/mcpConnectMessage.test.ts`, `tests/unit/mcpConnectionState.test.ts` and
`tests/unit/mcpEndpointApi.test.ts` in `@agenta/entities`. Both package suites are green, at 803
cases in `@agenta/entity-ui` and 1700 in `@agenta/entities`.

### OR75. The MCP relay has no injected-credential echo scanner, so an upstream that returns the grant it was sent hands it to the caller — CLOSED, and an MCP credential header is endpoint-named rather than fixed

**What the defect was.** `relay` in
`api/oss/src/core/gateways/mcps/providers/http/adapter.py` layered the endpoint's own
`Authorization`, an OAuth access token or a direct vault secret onto the upstream request, and then
returned the upstream's status, headers and body untouched. Nothing read either on the way back. An
upstream that returned the bearer it was sent, in an error body or a debug header, handed a
write-only vault credential to the agent run that made the call. The LLM plane refuses exactly that,
on both.

**The MCP relay scans what the LLM relay scans.** A new module reuses the LLM plane's
`CredentialEchoScanner` and its `upstream_echoed_credential` envelope, and all three MCP relays call
it on the response header block and on the buffered body. The MCP relay does not stream. It reads
the whole response before it returns, so detection is sufficient and no withholding path was built.

**One difference is worth recording.** An LLM credential always travels in a fixed header. An MCP
credential travels in whichever header the endpoint registered, so there is no single name to read.
Every header the adapter puts above the caller is therefore normalized and scanned one at a time.

Tests: cases beside `api/oss/tests/pytest/unit/gateways/test_gateways_http_mcp_adapter.py` driving
an upstream that returns the grant in its body and an upstream that returns it in a header.

### OR54. MCP API-key registration has no working credential binding on either side — CLOSED, and the transport is the one the SDK already uses without a gateway

**What the defect was.** The registration form sent `auth_mode: api_key` and no `secret_id`, which
is the exact combination `api/oss/src/core/gateways/mcps/service.py` refuses with
`SecretNotFoundError`. Attaching a secret by hand did not finish the path either, because the HTTP
adapter built its `Authorization` header from an OAuth grant's `access_token` and read nothing else,
so an API-key secret produced no header at all. Both halves were broken, so no API-key MCP endpoint
could ever relay.

**The key travels in the header the endpoint registered.** The adapter sends the secret's value
verbatim under that header name, with no scheme prefix, and falls back to a bearer header when the
endpoint registered no header name. An OAuth grant is unchanged and still uses its own token type.
The route carries the header name only. The value is read from the vault inside the adapter and
never crosses the registration surface.

**The frontend binds the secret.** The registration payload builder resolves the drawer's secret
slug to a secret id and states the binding in the create body and in the edit body, so an edit no
longer drops what the create established.

**Why that transport.** It is what the agent config already expresses, and what the SDK sends when
it dials the same server directly with no gateway in the path. The upstream therefore sees the same
request either way, which is the property the gateway is supposed to preserve.

Tests: a case in `web/packages/agenta-entity-ui/tests/unit/mcpEndpointRegistration.test.ts`
asserting the payload carries a `secret_id`, and cases beside
`api/oss/tests/pytest/unit/gateways/` asserting an API-key endpoint relays under its registered
header name and under the bearer fallback.

### OR58. Brokered builtin MCP endpoints carry no tool allowlist, so any member can call any tool — CLOSED, and brokered calls now refuse everything until the connect flow records a grant

**What the defect was.** A brokered builtin endpoint was built with a route and nothing else, so its
tool filter took the `MCPToolFilter()` default with `allowlist=None`, and
`GatewayEndpointFilter.allows` reads `None` as allow-all. A brokered endpoint is one Agenta holds
credentials for on a tenant's behalf, which is where allow-all is wrong specifically.

**The endpoint is built with an explicit list from the connection.** The meaning of an absent
allowlist is unchanged. Four readers share that field, and flipping the default to deny would dark
every builtin LLM endpoint and every stored custom MCP endpoint at once, so the fix is local to the
construction site rather than global to the field.

**The residual, plainly.** Nothing writes the connection's tool list yet, so a brokered call now
refuses every tool. That is safe today because the brokered MCP route has no live caller: gateway
connections resolve through the tools route instead. It stops being safe the moment that route
ships, so the connect flow must record the grant before then.

Tests: a case in `api/oss/tests/pytest/unit/gateways/` asserting a brokered builtin endpoint refuses
a tool it was not granted.

### OR56. Three components disagree about which MCP method performs discovery — CLOSED, and `initialize` is the only method every server must answer

**What the defect was.** The Pi extension sent `server/discover`, the sandbox-agent handshake sent
`initialize`, and the builtin Agenta adapter answered neither, refusing anything that was not
`tools/call` after `tools/list`. Three components, three vocabularies, one protocol.

**The lifecycle is now one sequence.** `initialize`, then the `initialized` notification, then
`tools/list`, then `tools/call`. `server/discover` was never a client obligation, and the two MCP
clients Agenta does not control open with `initialize` and cannot be told otherwise, so
`initialize` is the only method every server must answer.

**All three moved to it.** The Pi extension opens with `initialize`. The handshake probe imports the
shared method constants instead of restating the strings, so the two runner paths cannot drift
again. The builtin adapter answers `initialize` and returns `202` for a notification that carries no
id, which is what a JSON-RPC notification requires.

Tests: a case beside `api/oss/tests/pytest/unit/gateways/test_mock_mcp_adapter.py` and a runner case
in `services/runner/tests/unit/`, asserting the runner's discovery call and the adapter's accepted
method are the same string.

### OR59. MCP tool registration collides from the second turn of a session, and the tools disappear — CLOSED, and ownership is tracked rather than read off the harness

**What the defect was.** The gateway MCP tools are re-registered on every `before_agent_start`. The
collision guard seeded its registered-name set from `pi.getAllTools?.()`, which on a warm session
already held the previous turn's registrations, so from turn two every name collided with itself.
The per-tool catch logged and continued, so each tool was skipped in turn and the run proceeded with
none of them. Nothing surfaced it.

**Ownership is now tracked per harness instance.** The extension records which names it registered
on which harness, so re-registering a name it already owns is a no-op and only a name someone else
owns is a real collision. A real collision is logged per tool, and the remaining servers still
register rather than the run losing all of them, and it is surfaced to the caller rather than
swallowed.

Tests: a case in `services/runner/tests/unit/pi-gateway-mcp.test.ts` driving two turns on one
session and asserting the second turn still has the tools.

### OR48. Streaming cleanup is not shielded from cancellation, so an aborted stream is never metered and its upstream connection is never closed — CLOSED, and the regression test has to cancel the way Starlette does

**What the defect was.** Usage was recorded in a bare `finally` that awaits, and the upstream
response was closed the same way. Starlette cancels the task scope when the client disconnects, and
an `await` inside a `finally` in a cancelled scope raises immediately, so a caller who disconnected
mid-stream left an open upstream connection and no usage record. The same shape appeared at four
sites across the service and the passthrough adapter.

**A shared helper runs each cleanup detached and shielded.** All four sites call it. The cleanup
therefore completes after the scope is cancelled, and the helper re-raises the cancellation rather
than swallowing it, so the disconnect still propagates as a disconnect. Normal completion is
unchanged: the same cleanup runs on the same path.

**One property of the test is load-bearing.** It cancels through an `anyio` cancel scope, which is
what Starlette does. A plain task cancel passes against the unfixed code, so a test written that way
would have proved nothing.

Tests: a case beside `api/oss/tests/pytest/unit/gateways/test_gateways_llm_nonstreaming_drain.py`
that cancels a consuming task partway through a stream and asserts the usage record was written and
the upstream response was closed.

### OR49. Streamed calls record no usage, and the only consumer of usage discards it — CLOSED for the streams that report it, and an OpenAI Chat Completions stream still reports nothing unless the caller asked

**What the defect was.** The drain scanned backwards through a capped tail of the stream. Anthropic
sends `input_tokens` in `message_start`, at the front, so it was never in the tail. The audit record
never read `outcome.usage` anyway, although the service populated it and the DTO declared it. Every
streamed call therefore metered as nothing.

**The drain reads forward and merges field by field.** Anthropic's head and its tail are both
captured, and a Responses terminal event larger than any tail is found rather than missed. The audit
record now carries the counts, so the field has a consumer.

**The gap that remains, because it is load-bearing.** The gateway does not add
`stream_options.include_usage` to a request that did not ask for it, so an OpenAI Chat Completions
stream meters nothing unless the caller asked. Adding the field was tried and backed out. It breaks
byte-preserving relay on that path, it re-chunks the response, and it risks a `400` from upstreams
that reject unknown fields, all to populate a sink nothing prices yet. A stream that reports nothing
records no usage at all rather than a zero, so an absent count stays distinguishable from a measured
zero. OR76 carries the open half.

Tests: cases beside `test_gateways_llm_nonstreaming_drain.py` driving a streamed Anthropic response
and a streamed Responses stream through the real service and asserting the recorded usage matches
the upstream's own totals.

### OR51. Saving a secret resets the endpoint's governance fields — CLOSED, by naming both halves of the write rather than adding a field to it

**What the defect was.** The secret save built a full endpoint replace and omitted everything it did
not map, so `flags` arrived as the create default. Rotating a provider key therefore reactivated a
disabled endpoint, dropped its model denylist and cleared its token ceiling, and the operator saw no
notice, because the action they took was saving a key. The MCP drawer did the same thing from the
browser, sending a full `PUT` with no `flags` against a mapping that documents itself as a full
replace.

**The write names both halves.** Secret-owned, and rewritten on every save: name, description,
secret id, provider key, the route's base URL, API version, region and Vertex project, and the model
allowlist. Endpoint-owned, and carried from the stored row: flags, the model denylist, settings,
route headers, tags and meta. Route extras are merged key-wise, so a routing key the secret owns is
updated without discarding a key the endpoint owns. The MCP drawer echoes the stored row's flags
back rather than omitting them.

Tests: cases in
`api/oss/tests/pytest/unit/gateways/test_gateways_llm_endpoint_registrar.py` and
`web/packages/agenta-entity-ui/tests/unit/mcpEndpointRegistration.test.ts` that disable an endpoint,
save the secret, and assert it is still disabled with its denylist and its ceiling intact.

### OR52. The registrar drops the routing fields Bedrock and Vertex need, so cloud provider configurations cannot become working endpoints — CLOSED, and only a region-only Bedrock configuration was broken

**What the defect was.** The registrar mapped `base_url` and `api_version` and nothing else, while
`LLMEndpointRoute` also carries `region` and `extras`. Vertex refuses unconditionally without
`vertex_project` from `route.extras`, so no Vertex configuration could route at all.

**Region and the Vertex project carry through.** Both are translated from the vault's own spelling
into the route's, so a provider configuration written through the dashboard registers an endpoint
that routes.

**The correction the entry already carried.** Bedrock accepts a base URL or a region, so only a
region-only Bedrock configuration was broken. A Bedrock configuration naming a base URL routed
before this change and routes after it.

**The tests changed shape too.** The conversion is exercised through the real routing and auth
adapters rather than against the mapped dictionary. Asserting on the mapping is what let this
through in the first place: the mapping was self-consistent and the adapters read fields it never
wrote.

Tests: cases in `test_gateways_llm_endpoint_registrar.py` that map a Bedrock region-only
configuration and a Vertex configuration and assert the resulting route builds a URL and signs a
request.

### OR53. A standard connection cannot be selected by slug, so explicit credential choice is lost — CLOSED, and the missing backfill stays a separate concern

**What the defect was.** The frontend preserves a standard connection's slug and the SDK sends it as
`connection_slug`, but the service treated any supplied slug as a custom endpoint or a builtin and
fell back to custom, so `custom/my-openai-key` was not found for a standard OpenAI connection.
Omitting the slug was not a workaround: resolution then took the first matching provider secret with
no disambiguation, so a project holding two keys for one provider got whichever came back first.

**A standard connection is addressable by its slug.** `standard/<connection slug>` resolves
alongside `standard/<provider family>`. The resolver tries the family first, so every reference that
resolved before resolves to the same place. An unknown slug still fails as a custom endpoint, which
is the behaviour a typo should get. The lookup returns the secret id and the provider key only, so
no credential crosses the resolve endpoint.

**What stays out.** Existing custom connections still have no endpoint rows, because the migration
performs no backfill. That is a data migration, and it changes nothing about standard selection, so
it stays a separate concern rather than a condition of this closure.

Tests: cases in `test_gateways_llm_service.py` asserting that a standard connection slug resolves to
its own secret, that the provider family still resolves, and that an unknown slug fails as a custom
endpoint.

### OR62. The schema does not constrain an endpoint's secret to the endpoint's project, so tenancy rests on one query filter — CLOSED in the persistence layer, because a composite foreign key was not available

**What the defect was.** The foreign key covered `secret_id` alone, on both endpoint tables and in
the migration, while the primary key beside it is composite on `(project_id, id)`. The schema
already knew the tenancy shape and did not apply it here. Resolution did check ownership, so a
cross-project reference resolved to nothing rather than to another project's secret, which is why
this was hardening rather than a leak. What remained was that the whole guarantee rested on one
filter in one code path, with no backstop, and an endpoint could hold a reference that was silently
dead.

**The check sits in the persistence layer.** It is called from the four DAO write methods, which is
where all six write paths funnel, including the registrar, which bypasses the service entirely. A
write naming a secret the project does not own is refused, reusing the existing invalid-secret
error rather than introducing a new one.

**Why not the composite foreign key.** It was not available rather than merely risky. The secrets
table has no unique constraint on `(project_id, id)` to reference. Its `project_id` is nullable,
because a secret may be organization-scoped. And adding the constraint would take an
access-exclusive lock plus a validation pass that aborts on any existing row outside the rule.

Tests: a case in
`api/oss/tests/pytest/integration/gateways/test_gateways_llm_endpoints_dao.py` that writes an
endpoint referencing another project's secret and asserts the write is refused.

### OR45. `POST /gateways/mcps/credentials/agenta` issues a narrowed credential with no permission check — CLOSED, and the bound is two layers deep because a true per-run bound is not derivable

**What the defect was.** The endpoint hands out a credential narrowed to a chosen set of tools, and
the caller chose the set. A `gateway_run_id` claim was the only gate. Unlike every other handler in
the file, this one ran no permission check, and it dumped and signed the caller-supplied `tools`
list verbatim without comparing it to anything. Any holder of a run credential could name any
`call_ref` reachable in the project.

**The permission is the one the credential is spent under.** The handler now requires
`USE_MCP_ENDPOINTS`, which is what the relay authorizes on every call through the builtin Agenta
bridge. Nobody can mint what they could not spend. The issued value carries the gateway audience
too, so it cannot be presented back to this route to buy a wider one, and it cannot be spent off the
data plane.

**The bound has two layers**, in `api/oss/src/core/gateways/mcps/providers/agenta/entitlement.py`. A
presenting credential that already carries a tool list confines the request to a subset of that
list, matched on the whole name and call_ref pair, because a rename is a widening: the name is what
the model reads when it picks a tool. A credential carrying no list may name only call_refs the tool
route will actually dispatch, which is a registered platform handler, one of the two runtime gateway
refs, a well-formed workflow reference, or a connection slug. Exceeding either layer is refused with
the shared envelope under `agenta_tool_not_entitled`, naming each refused tool, and no credential is
signed.

**The limit.** A true per-run bound is not derivable on the server. `gateway_run_id` is a signed
claim with no row behind it, and the run's own tools are resolved by the party asking, the SDK
inside the workflow service. The catalog bound is what remains. Each of its four shapes still
resolves against the caller's own project, and re-checks its own permission, when the credential is
finally spent.

**The live matrix does not reach this route.** All 27 cells declare the mock provider, so none of
them mints an Agenta credential. The route was verified by hand against the live stack instead.

Tests: eight cases in `api/oss/tests/pytest/unit/gateways/test_gateways_mcp_router.py`. They cover a
caller with no invocation claim, a caller without the permission, the audience on the issued value,
a call_ref outside the callback catalog across five spellings, every shape the tool route dispatches
across seven, a request widening a carried tool set, a request renaming a carried call_ref, and a
subset of a carried set signed as asked.

### OR70. The credential-echo scanner reads the response body only, so a key returned in a response header reaches the caller — CLOSED, found by reviewing the repair rather than the original code

**What the defect was.** The scanner that refuses a response echoing the injected provider key read
the body and nothing else. An upstream answering 200 with that key in a header of its own, say
`X-Debug-Auth`, had the header copied onto Agenta's own response by `response_headers` in
`api/oss/src/apis/fastapi/gateways/utils.py`, which strips only hop-by-hop names and `set-cookie`.
The caller read the credential without a byte of the body carrying it.

**The header block is scanned too, before either response shape is built.**
`CredentialEchoScanner.detects_headers` joins names and values into one CRLF-separated block, the
way they travelled, and searches it for every injected value. An injected value cannot itself
contain CRLF, so a match always lies inside a single header line and the join cannot manufacture
one. A detection closes the upstream response and refuses under the same
`upstream_echoed_credential` envelope the body path uses, before the error path reads a body and
before the streaming generator starts.

Tests: `test_a_credential_returned_in_a_response_header_is_refused` in
`api/oss/tests/pytest/unit/gateways/test_gateways_header_contract.py`.

### OR71. A credential split across two streamed chunks reaches the caller before the split is detected — CLOSED, by withholding bytes rather than watching them leave

**What the defect was.** Found by reviewing the repair rather than the original code. The streaming
scanner searched each chunk together with the tail of the one before it, so it did notice a
credential straddling two chunks. It noticed after the first chunk had already reached the caller.
Split a 26 byte key at byte 25 and 25 bytes escape, leaving one byte to guess.

**The relay withholds what could still become the credential.** `CredentialEchoRelay` in
`api/oss/src/core/gateways/dtos.py` appends each chunk to what it holds, searches the whole buffer,
and releases everything except the longest suffix that is still a proper prefix of an injected
value. That suffix is the only part the next chunk can complete into the credential, and every byte
before it is already proven not to start one. A stream that does not resemble the credential
therefore withholds zero bytes, so the ordinary path gains no latency. A stream that does resemble
it withholds at most one byte less than the value's length, because a suffix as long as the value is
a match and refuses instead. `flush` releases the held tail when the body ends, since a prefix that
reaches the end of the stream is a prefix that never completed.

**The residual.** A stalled upstream leaves those bytes pending until it sends more or closes. The
held run is always shorter than the credential, so the delay is bounded, but it is real on a stream
whose bytes happen to trail into a prefix of the key.

Tests: in the same file, `test_a_credential_split_one_byte_from_its_end_never_reaches_the_caller`,
`test_a_stream_that_never_echoes_is_relayed_whole_and_undelayed`,
`test_relay_withholds_only_what_could_still_become_the_credential` and
`test_relay_releases_a_held_tail_when_it_turns_out_to_be_innocent`.

### OR72. `provider.extras` entries travel as authentication headers while the public projection scrubs a fixed vocabulary — CLOSED, by dropping the mapping rather than allowlisting it

**What the defect was.** Found by reviewing the repair rather than the original code. `_custom_auth`
copied every `extras` entry out as a header, one per entry, whatever the entry was named. The
vault's public projection strips a declared vocabulary of SDK configuration keys and nothing else.
Two definitions of "credential" therefore disagreed. A write-only record carrying a
credential-shaped extras entry, `X-Api-Key` say, both authenticated with that value and returned it
in plaintext.

**A custom endpoint authenticates with its provider key and nothing else.** The extras-to-header
mapping is gone from `api/oss/src/core/gateways/llms/providers/passthrough/auth.py`. Every remaining
extras key the platform reads as credential material, `aws_bearer_token_bedrock` and
`vertex_ai_credentials`, is named by a routing strategy and classified in the shared vocabulary,
whose parity test fails the build on an unclassified key.

**Why this direction.** An allowlist of permitted extras-as-headers would reopen the moment someone
added a key to it without classifying it on the redaction side, which is exactly how this arrived.
With no mapping at all there is nothing to add to.

**The cost.** An endpoint that smuggled a header credential through `extras` now gets a 401. That
header must move to the endpoint's own registered `headers`, which travel by design. Those headers
are endpoint configuration, readable by anyone who can read the endpoint, so a secret placed there
is not write-only and does not pretend to be.

Tests: `test_custom_authenticates_with_its_key_and_sends_no_extras_as_headers` and
`test_a_credential_shaped_extras_entry_is_neither_sent_nor_returned` in
`api/oss/tests/pytest/unit/gateways/test_gateways_llm_auth_strategies.py`, and
`test_custom_provider_secret_injects_bearer_and_leaves_extras_behind` in
`test_gateways_llm_relay_adapter.py`.

### OR73. Vertex credentials are minted before the egress boundary runs, so a tenant can name a loopback `token_uri` — CLOSED, by checking the document before the library receives it

**What the defect was.** Found by reviewing the repair rather than the original code. Minting the
Vertex token is an outbound call the gateway never makes itself. google-auth POSTs to the
`token_uri` written inside the tenant-supplied service-account document, over its own transport, and
it does so while the authentication headers are still being built, before the egress boundary has
seen anything. A tenant could name `http://127.0.0.1:8080/token` in a document they control and have
the platform dial an internal address with no check at all.

**Every URL in the document is checked first.** `_guarded_credential_document` in
`api/oss/src/core/gateways/llms/providers/passthrough/auth.py` walks the parsed document, collects
every URL-shaped string, and puts each one through the shared egress boundary before the document
reaches the library. Field names are not enumerated, because which URL a given google-auth version
dials is the library's business and moves between releases: a service account also carries
`auth_uri` and two certificate URLs, and a workload-identity document carries `token_url`,
`token_info_url`, `service_account_impersonation_url` and a `credential_source.url`. The checks run
concurrently, so a document with four URLs costs one resolution's latency. A document naming an
executable credential source is refused outright, because nothing a tenant stores may name a program
for the platform to run.

**What this does not cover.** A file-based credential source is not checked as a path, and it is
legitimate for self-hosted workload identity. And the check reads the bytes rather than wrapping the
library's transport, so it proves what the document says, not what google-auth eventually dials.
Wrapping the transport would mean tracking a dependency's internals across versions, and it would
still leave the same question about every other library that reads one of these documents.

Tests: in `api/oss/tests/pytest/unit/gateways/test_gateways_egress.py`,
`test_vertex_token_uri_pointing_at_loopback_is_refused_without_minting`,
`test_vertex_credential_urls_other_than_token_uri_are_checked_too`,
`test_vertex_credential_naming_an_executable_source_is_refused` and
`test_vertex_document_with_public_urls_still_mints`.

### OR74. Pinning rewrites the URL host, so two hostnames on one address share a TLS connection checked for the first — CLOSED, by keeping one client per original origin

**What the defect was.** Found by reviewing the repair rather than the original code. Pinning swaps
the URL's host for the literal address the boundary checked, and httpcore keys connection reuse on
that rewritten origin: `can_handle_request` compares scheme, host and port only. The SNI hostname
rides in the request extensions and is read at handshake time, so it never enters the pool key. The
relay adapter held one client for every tenant. Two hostnames resolving to one address therefore
shared a single TLS connection, and the second tenant's provider key travelled over a connection
established, and certificate-checked, for the first tenant's hostname.

**Clients are kept per original origin.** `RelayLLMAdapter` holds an ordered map from the registered
origin, which is the lowercased scheme, host and port, to that origin's own client, capped at 64
entries with the least recently used dropped. Connection reuse is a per-origin concept to begin
with, so partitioning on it loses nothing. An evicted entry is dropped rather than closed, because a
response may still be streaming from it; its connections retire once the last reader finishes.

Tests: in `api/oss/tests/pytest/unit/gateways/test_gateways_egress.py`,
`test_two_hostnames_on_one_address_do_not_share_a_pooled_connection`,
`test_repeated_calls_to_one_origin_still_share_a_pool`, and
`test_pooled_clients_keep_the_pin_and_refuse_redirects`, which asserts that the pin, the SNI name,
the absent cookie jar and the no-redirect guarantee are all still in place on a pooled client.

### OR41 / OR47. The OAuth state carries the PKCE verifier in readable form and is not bound to the browser that started the flow, and the callback is rejected by the middleware before its handler runs — CLOSED, and the middleware exemption became safe only once the state stopped carrying anything

The two closed together, because one change closes both.

**What the defect was.** State was a signed but readable payload carrying the PKCE verifier, so the
authorization server could decode it and PKCE protected nothing. It was never consumed, so it
replayed for its full hour. Completion was not bound to the browser that began the flow, and the
callback took project and user out of the state without comparing them to anyone. A hostile server
could therefore replay a victim's state with its own code and land its own tokens in the victim's
project.

**The state is now a handle, and a record holds what it used to carry.** State is an opaque
high-entropy value that encodes nothing. A row in `mcps_oauth_attempts` holds the verifier, the
user, the project, the endpoint id, the issuer, the token endpoint and the redirect URI.

**Postgres rather than Redis, for three reasons.** The callback can land on any replica. The browser
is away at a consent screen while the row exists, so a rolling restart must not drop every
in-flight connection. And the row is tenant data that cascades from its project.

**Exactly one callback wins.** Consumption is a single `DELETE ... RETURNING`, so one of two
concurrent callbacks takes the row and the other finds nothing. Expiry sits outside that predicate
on purpose, so an expired handle is consumed rather than left probeable. A sweep runs every five
minutes from the cron service. `complete()` takes the endpoint from the stored id rather than a
server-URL lookup, and refuses a caller who does not match the record before consuming anything, so
a refused attempt burns nothing and writes nothing. Migration `oss000000031`, parented on
`oss000000030`, single head, upgrade and downgrade both applied against a scratch database first.

**OR47 follows from it.** The callback is exempt from the auth middleware now. Its URL is fixed and
query-free, so the middleware could only ever resolve the caller's default scope, which has nothing
to do with the attempt, and a bare JSON 401 inside a popup is a dead end. The exemption widens
nothing: the handler resolves the SuperTokens session itself and refuses without one, and everything
it acts on comes from the attempt record. Verified on a live stack that a cookieless callback
renders the connect card rather than a 401.

Tests: cases across `api/oss/tests/pytest/unit/gateways/test_gateways_mcp_oauth_service.py`,
`api/oss/tests/pytest/unit/gateways/test_gateways_mcp_router.py` and
`api/oss/tests/pytest/integration/gateways/test_mcp_oauth_attempts_dao.py`, covering a replayed
state, an expired attempt, a callback from another user, a callback with no session, and one of two
concurrent callbacks winning against real Postgres.

### OR42. OAuth discovery trusts the server it is authenticating against, so a hostile MCP server can name its own token endpoint — CLOSED, by fetching the authorization server's metadata from the issuer itself rather than from the MCP server

**What the defect was.** Discovery took the authorization and token endpoints verbatim from the
upstream's own metadata, with no origin check and no HTTPS requirement. A hostile or compromised
server could name its own token endpoint and receive the user's authorization code together with
Agenta's registered client secret. The same file reflected raw upstream bodies into user-visible
errors, which turned any discovery weakness into a read primitive.

**Two checks chain back to what the tenant registered.** The protected-resource metadata's
`resource` must be same-origin with the registered server URL. The authorization server metadata's
`issuer` must equal the issuer that document names. HTTPS is required throughout, gated on the
gateway's own egress flag rather than a second switch. User-visible errors carry the status and the
origin, never the upstream body, and the validation-error strings that used to carry it are gone.

**The metadata comes from the issuer, and that is the whole security property.** It is fetched from
the issuer's own well-known URL, derived from the issuer identifier alone: RFC 8414 section 3.1
first, then RFC 8414 section 5, then OpenID Connect Discovery section 4.1, tried in that order. It
is never read from the MCP server's own document, and never from a URL that server supplies. The
authorization, token and registration endpoints are then accepted exactly as the issuer's own
metadata publishes them, whatever their origin, because an endpoint in that document is named by the
authorization server about itself. An endpoint the issuer's metadata does not publish is still
refused: a document missing `authorization_endpoint` or `token_endpoint` does not parse, so the
candidate is skipped and discovery ends in a refusal rather than in an endpoint guessed from
elsewhere.

**This entry previously recorded a same-origin rule on the three endpoints, and the cost that came
with it.** Both are gone. The rule required the authorization, token and registration endpoints to
sit on the issuer's origin, and it ruled out any authorization server that splits them. Requiring it
on top of issuer-sourced metadata bought nothing, and the shape it excluded is common: Google
publishes its issuer as `accounts.google.com` and takes tokens at `oauth2.googleapis.com`. A split
authorization server of that kind works now.

**The limit, unchanged.** None of this stops a hostile MCP server naming an authorization server it
owns outright. That flow is self-consistent, and the user sees the attacker's own login page.
Discovery answers where an issuer says its endpoints live, never whether the issuer is honest.

Tests: `api/oss/tests/pytest/unit/gateways/test_gateways_mcp_oauth_client.py`. Four cases carry the
relaxation: `test_discover_accepts_a_token_endpoint_the_issuer_publishes_on_another_origin`,
`test_discover_takes_the_endpoints_from_the_issuer_not_from_the_mcp_servers_own_document`,
`test_discover_refuses_when_the_issuers_metadata_publishes_no_token_endpoint` and
`test_discovery_asks_the_issuers_own_well_known_urls_in_rfc_order`. The two cases that refused a
split origin are gone with the rule they pinned.

### OR55. Stored refresh tokens are never used, so an endpoint reports READY while every call fails — CLOSED

No refresh grant was ever executed, so once an access token expired the endpoint kept reporting
READY while every call failed with 401.

An expired or nearly expired grant is now exchanged and stored before use, through the shared egress
client. A lock per project and server, with a re-read after acquiring, means the second caller in a
worker finds a live token and exchanges nothing. Across workers a losing exchange re-reads and
accepts the winner's token, and only a still-expired re-read raises. A refresh that fails marks the
connection invalid and raises a typed refusal carrying the connect affordance, so the user is told
to reconnect rather than watching 401s.

Tests: six cases in `api/oss/tests/pytest/unit/gateways/test_gateways_mcp_oauth_service.py` and four
in `api/oss/tests/pytest/unit/gateways/test_gateways_mcp_service.py`.

### OR61. The OAuth registration write races, so concurrent callbacks hit an unhandled unique violation — CLOSED, by letting Postgres arbitrate rather than locking in Python

The registration write did a read-modify-write on a deterministic slug, so concurrent callbacks hit
an unhandled unique violation.

Postgres arbitrates now. The unique constraint surfaces as a domain conflict, and the loser re-reads
and applies its write as an update. Nothing locks in Python.

Tests: two cases in `api/oss/tests/pytest/integration/gateways/test_mcp_oauth_storage_race.py`,
against real Postgres.

### OR40 / OR64. No egress check runs at request time on the LLM plane or on MCP OAuth discovery, and the egress boundary is duplicated instead of shared — CLOSED, and the first attempt enforced nothing because it read a flag that defaults to on

The two were recorded together and closed together, because one module closes both.

**What the defect was.** Registration validated a URL once, and the request that followed connected
to whatever the hostname resolved to at that moment. The LLM relay built its request against the
stored URL and sent it, with no resolved-address check and no connection pinning anywhere in the
file. MCP OAuth fetched the `resource_metadata` URL an upstream supplies in its `WWW-Authenticate`
challenge with no check at all, which is how a discovery fetch reached the cloud metadata address.
The MCP HTTP adapter did it correctly, and it did it alone. That is what OR64 named: the outbound
boundary existed once per plane, or once and not at all.

**One module, and it is the only way out.** `api/oss/src/core/gateways/egress.py` is now the only way
the gateway makes an outbound call. It resolves the hostname once and refuses if any returned address
is blocked, rather than only the first, so a name answering with one public address and one private
address does not pass. It pins by swapping the host for the checked literal address, while the
registered authority travels as `Host` and SNI keeps TLS verifying the real name, so the connection
lands on the address that was checked and the certificate still has to match. It never follows a
redirect, because a redirect names a second destination nobody validated. It carries the header
allowlist and the no-store cookie jar from `api/oss/src/core/gateways/dtos.py`. Resolution runs off
the event loop, because `getaddrinfo` blocks and both planes sit on the request path. The MCP HTTP
adapter's private copy is deleted and the adapter calls the shared module, so `api/` holds one copy of
the address predicates, in `api/oss/src/core/webhooks/utils.py`, rather than three. Every OAuth client
call goes through the module too, the `resource_metadata` URL included.

**The guard enforces by default, and the first attempt did not.** This is the part the original entry
understated. The first implementation read `AGENTA_INSECURE_EGRESS_ALLOWED`, which defaults to true,
so it resolved and pinned while the range check and the https requirement were inert. The module was
present, its tests passed, and a deployment that changed nothing was still open. A new gateway-owned
`AGENTA_GATEWAYS_INSECURE_EGRESS_ALLOWED` defaults to false and governs the gateway alone. Webhooks
keep their own flag and their own default, so changing that remains a separate decision. Verified
live: in the deployed API, with the webhooks flag permissive and the gateway flag unset, the cloud
metadata address and a private address were both refused while the configured mock host was admitted.
The one exemption is the operator's own configured mock hosts while the mocks flag is on, plus the
existing host allowlist, so a tenant cannot name their way into it.

**Both proxy entry points admit headers by the same allowlist.** The adapters already dropped the
caller's cookie and Authorization before the wire, so nothing leaked to an upstream. The session
still travelled through the service and the policy plane to get there. It is refused at the entry
point now.

Tests: `api/oss/tests/pytest/unit/gateways/test_gateways_egress.py`, 24 cases, plus the 27 live
harness cells still passing with the check enforcing.

### OR38. The credential handed to the sandbox is a general-purpose platform token that can read the vault — CLOSED for the credential the gateway hands the agent

**What the defect was.** One value served two roles. The SDK read the platform authorization it was
handed and passed that same value on as the sandbox's gateway credential, and the value was minted
with `SECRET_RESOLVE_GRANT`. The auth middleware accepted `X-AG-Credentials` on any route. A vault
request from the sandbox therefore authenticated and came back with secret values in plaintext.

**The sandbox now receives its own credential.** It carries an audience of the gateway plus the
project and the run, and no grants. The audience is checked inside token verification, which every
entry path funnels through, so the credential is refused with an explicit 401 on any non-gateway
route rather than falling through to anonymous. Minting refuses to put an audience and a grant on one
token, and verification refuses a token that presents both, so only a forgery carries both and a
forgery is rejected. The exchange route sits outside the data plane, so what it issues cannot buy
another.

**An audience rather than a new grant.** A grant widens a general-purpose token. This needed the
opposite axis: a credential that authenticates one surface and nothing else.

**Nothing lost the `secret-resolve` grant.** The services tier, which runs with the auth middleware
disabled, keeps it at both mint sites, and so does the runner's refresh through the permissions
check. What changed is that the sandbox stopped reusing a granted token. The runner needed no change.
The SDK did, because the SDK was the component handing the platform authorization to the sandbox, and
two SDK tests that asserted the sandbox held the caller's own credential now assert it holds the
exchanged one.

Tests: `api/oss/tests/pytest/unit/gateways/test_gateways_sandbox_credential.py`, whose cases drive the
real auth middleware in front of the real exchange route rather than a substitute for either, plus
the 27 live cells passing with 56 credential exchanges logged during the run.

**The scope, stated plainly.** OR38 closes the credential the gateway hands the agent, and that is
the whole of it. It needs no caveat about a second road to the same secret, because the agent path
carries no provider key to the sandbox. A gateway-routed connection is built with
`credential_mode="none"` and an empty credential list at
`sdks/python/agenta/sdk/agents/connections/endpoints.py:245-254`. On the Daytona backend the agent
runner delivers credentials as placeholder references that the egress proxy substitutes, not as
plaintext (`services/runner/src/providers/daytona-credential-delivery.ts`). An earlier version of
this paragraph pointed at OR69 for a wider hole; OR69 was withdrawn on 2026-09-13, and its entry at
the top of the active section says why.

### OR36 / OR37. A proxied request relays the caller's session cookie and Authorization header upstream, and the injected authorization header is merged case-sensitively — CLOSED, and the strip list was replaced rather than widened

The two were recorded together and closed together, because they are one boundary.

**What the defect was.** The relay stripped a single header, `x-ag-credentials`, and forwarded
everything else, so the caller's Agenta session cookie and Authorization header reached a
tenant-configured upstream. The injected `Authorization` was merged into a plain dict beside the
caller's lowercase `authorization`, so the upstream received two values of one case-insensitive
field and chose which to honour. One pooled `httpx.AsyncClient` held a process-wide cookie jar, so an
upstream's `Set-Cookie` came back on the next tenant's call.

**The boundary is now deny-by-default.** `FORWARDABLE_REQUEST_HEADERS` in
`api/oss/src/core/gateways/dtos.py` names every request header that may reach an upstream:
`content-type`, `accept`, `anthropic-version`, `anthropic-beta`,
`anthropic-dangerous-direct-browser-access`, `openai-organization`, `openai-project`, `openai-beta`,
`mcp-session-id`, `mcp-protocol-version`, `idempotency-key`, `x-agenta-mock-profile`, and the
`x-stainless-` prefix, which covers vendor SDK telemetry as a prefix because that set grows with each
SDK release. A second list, `NON_FORWARDABLE_REQUEST_HEADERS`, refuses `authorization`, `cookie`,
`x-ag-credentials`, `proxy-authorization`, `host` and the hop-by-hop names by name. None of them sits
on the allowlist, so the refusal list is a second line of defence rather than the boundary itself: it
keeps holding if the allowlist is ever widened. Both planes read the same function.
`GATEWAY_ONLY_HEADERS` no longer exists.

**OR37 closed with it.** Outbound headers are assembled in `httpx.Headers` and assigned by name, so
the gateway's credential replaces a caller's header in any casing instead of joining it. The dict
merge that made `authorization` and `Authorization` separate keys is gone from the relay.

**Cookies travel in neither direction.** Every gateway `httpx` client is handed `NoCookieJar`, which
neither stores an upstream `Set-Cookie` nor sends a `Cookie`. `httpx` rebuilds any `Cookies` object
it is given and keeps only the raw jar, which is why the guarantee lives on the jar rather than on
the wrapper. On the way back, `set-cookie` is stripped from the relayed response in
`api/oss/src/apis/fastapi/gateways/utils.py`, because that response is returned on Agenta's own
origin.

**One behaviour reversed, deliberately.** An MCP endpoint registered without a secret used to borrow
the caller's `Authorization` for its upstream call. It now calls that upstream unauthenticated. OD15
in `open-designs.md` records the reversal, since pass-through of the caller's credential was half of
what that decision originally settled.

Tests: `api/oss/tests/pytest/unit/gateways/test_gateways_header_contract.py`, which owns the outbound
header boundary for both planes, thirteen cases in total across this entry and OR39. Four drive a
caller cookie and a lowercase `authorization` through the LLM relay and the three MCP adapters and
assert neither reaches the upstream while the gateway's own credential does, once.
`test_allowlisted_header_travels_and_an_arbitrary_one_does_not` pins the shape of the list rather
than its contents. `test_upstream_set_cookie_is_not_returned_to_the_caller` and
`test_upstream_cookie_is_not_replayed_on_a_later_call` cover the jar, the second driving two
sequential relays through one adapter where the first upstream answers with `Set-Cookie`.

### OR39. An upstream can return the injected provider key to the caller through the response body — CLOSED, by refusing rather than redacting

A relayed response went to the caller unread. An upstream that echoes the Authorization header it
received, which several providers do in an error body, handed Agenta's provider key to the sandbox.

The relay now scans every response for the value it injected. `CredentialEchoScanner` in
`api/oss/src/core/gateways/dtos.py` searches each chunk together with the tail of the one before it,
kept at one byte less than the longest secret, which is the longest prefix a split can leave behind.
A credential straddling two SSE frames is therefore caught. The scheme prefix is dropped before
scanning, so an upstream echoing the bare key rather than the whole header is caught too, and values
under eight bytes are not scanned for at all, because scanning for them would refuse a response over
a coincidence.

A detection refuses the call with the shared typed envelope under the code
`upstream_echoed_credential`. Redaction was the alternative and it lost on both halves: a key an
upstream is willing to print is a key to rotate rather than to paper over, and nothing is wrong with
the request, so there is no retry that helps until the rotation happens. The scanner does nothing
when no secret was injected, so an endpoint with no credential relays byte for byte as before.

Tests: in the same header-contract file,
`test_non_streaming_body_echoing_the_credential_is_refused` and
`test_streamed_credential_split_across_two_chunks_is_refused`, which splits the credential mid-value
across two chunks on purpose. Beside them,
`test_a_body_without_the_credential_still_relays_when_one_was_injected` and
`test_no_injected_secret_means_no_scan` pin the two ways the scan must stay out of the way, and two
unit cases pin the minimum length and a value split across three chunks.

### OR43. Write-only OAuth secrets still return credentials from the vault — CLOSED, and there were two leaks rather than one

Marking an OAuth secret write-only withheld one field per kind, and only that field. A write-only
`oauth_grant` therefore returned its `refresh_token`, which is the longer-lived of its two
credentials.

`CREDENTIAL_FIELDS` in `api/oss/src/core/secrets/redaction.py` now names every credential-bearing
field per kind, and the projection clears all of them. The single-field map other callers read, the
presence report and the update carry-over, is derived from the new one as the first field of each
kind, so their behaviour does not move. One field per kind was the wrong shape: it redacted what
someone remembered rather than what is credential-bearing.

The second leak was a spelling. The extras scrub read a container attribute named `extras` while the
OAuth DTOs declare `extra`, which is how a second copy of the client secret survived inside
`extra.client_info` regardless of the write-only flag. Three things changed. `set_client_info` in
`api/oss/src/core/gateways/mcps/oauth/storage.py` dumps the registration with
`exclude={"client_secret"}`, so the duplicate is not written. `get_client_info` reads the secret back
from the outer field. And the scrub reads both spellings and walks nested maps, so rows written
before the fix stop leaking on their next read rather than waiting for a rewrite.

Tests: `api/oss/tests/pytest/unit/secrets/test_write_only_oauth.py`, four cases. A write-only grant
returns neither of its tokens, a registration stores its secret once, a write-only provider returns
no client secret anywhere in its response, and a row written in the old shape is still redacted.

### OR44. The model allowlist checks one field while the whole request body is forwarded — CLOSED, and the fields the gateway cannot read are refused rather than dropped

`model` was the whole allowlist check while the body travelled to the upstream unchanged, so
`{"model": "gpt-4o", "models": ["forbidden-model"]}` passed an endpoint allowing only `gpt-4o` and
the forbidden fallback ran when the primary failed.

`_check_allowlist` in `api/oss/src/core/gateways/llms/service.py` now measures every entry of
OpenRouter's `models` fallback array against the same allowlist, by the same exact-string match the
primary gets. Exact matching was never the weakness and is untouched. A `models` value that is not a
list of model ids is refused, because the allowlist cannot read it.

A routing field whose effect on model selection the allowlist cannot evaluate is refused under the
code `routing_field_not_allowed`: `provider`, `route`, `preset` and `fallbacks`. Each of them decides
which model or which upstream actually serves the call, so forwarding one forwards a routing decision
nobody checked. Refusing beats ignoring for two reasons worth recording. A field a provider ships
later would otherwise reopen the allowlist silently, which is the defect in this entry repeating
itself under a new name. And aliases and fallbacks are outside this increment by `models.md`, so
refusing costs no supported behaviour today. A JSON null names no routing, so only a field carrying a
value is refused.

Tests: in `api/oss/tests/pytest/unit/gateways/test_gateways_llm_service.py`,
`test_a_forbidden_fallback_model_beside_a_permitted_one_is_refused`,
`test_a_fallback_list_of_permitted_models_still_relays`,
`test_fallback_entries_are_matched_exactly_like_the_primary_model`,
`test_a_fallback_field_that_is_not_a_list_of_model_ids_is_refused`,
`test_a_routing_extension_the_gateway_cannot_check_is_refused` over each of the four fields, and
`test_a_null_routing_extension_is_not_treated_as_routing`.

### OR46. The migration omits a secret-kind enum value the code writes, so MCP OAuth cannot complete on a migrated database — CLOSED, and the test generalises rather than names the value

Revision `oss000000030_add_gateway_endpoints` added `OAUTH_GRANT` to `secretkind_enum` and not
`OAUTH_PROVIDER`, which is the kind the OAuth client storage writes on the first dynamic client
registration. Every deployment upgraded through the migrations, which is every deployment that is not
a fresh `create_all`, failed there.

The revision now adds both. Verified against the running development database, whose enum carried
seven labels and lacked this one, and then against a scratch database migrated from empty, which came
back with eight labels and accepted a cast of the literal. `downgrade()` states in its own body that
`ALTER TYPE ... ADD VALUE` is not reversible, so both members stay on the enum after a downgrade,
inert without the tables the revision creates and harmless when `upgrade()` runs again.

Tests: `api/oss/tests/pytest/unit/secrets/test_secret_kind_migrations.py`. It derives both sides, the
members of `SecretKind` that the code can write and the values the OSS migration chain declares, and
compares the two sets. The entry proposed an integration case that stores a provider registration on
a migrated database. The derived comparison was chosen instead because it names neither kind, so the
next kind added without a migration fails it too, rather than the one kind anyone happened to think
of.

### OR50. The output-token ceiling is optional in practice, and the first recognised alias masks the rest — CLOSED

A configured ceiling refused nothing when a request named no maximum, and
`{"max_tokens": 1, "max_completion_tokens": 99999}` passed a ceiling of ten, because the parser
returned the first alias it recognised.

`_enforce_ceilings` in `api/oss/src/core/gateways/llms/service.py` now measures every alias its
protocol spells. `_requested_max_output_tokens` reads a numeric string and a float as the numbers
they spell, so a client sending `"999999"` is measured rather than waved through for being the wrong
type, while `bool` stays excluded because `true` is not a token count. A request that names no usable
maximum has the endpoint's ceiling written into its body, under the alias correct for its protocol:
`max_tokens` for Chat Completions and Messages, `max_output_tokens` for Responses. Chat Completions
is written with `max_tokens` rather than `max_completion_tokens` because that is the spelling every
OpenAI-compatible upstream in the catalogue understands. A request above the ceiling is still refused
rather than clamped, which is what D25 requires, and only an endpoint that carries a ceiling has its
body rewritten at all.

Tests: in `api/oss/tests/pytest/unit/gateways/test_gateways_llm_service.py`,
`test_a_request_naming_no_maximum_leaves_with_the_ceiling_written_in` per protocol,
`test_the_second_alias_is_checked_not_only_the_first_one_found`,
`test_a_maximum_that_names_no_usable_count_gets_the_ceiling_instead`,
`test_a_non_integer_maximum_above_the_ceiling_is_still_refused`,
`test_a_maximum_at_exactly_the_ceiling_passes_untouched` and
`test_an_endpoint_with_no_ceiling_relays_the_body_byte_for_byte`.

### OR57. A mock endpoint is callable with the mock flag off — CLOSED

`deployment_kind` accepted `mock` as an unvalidated enum member, and `MockLLMAdapter` was registered
unconditionally. Dispatch selects an adapter from the endpoint's stored deployment kind and never
consults the flag, so a mock endpoint returned 200 on a process where
`AGENTA_GATEWAYS_MOCKS_ENABLED` was false.

The mock adapters are now registered only when that flag is set, read through the shared `env` object
as `env.mock_gateways.enabled`: `mock` on the LLM registry, `mock` and `mock_http` on the MCP
registry. With the registration absent, a row persisted as `mock` raises `LLMAdapterNotFoundError`
rather than dispatching. Creating an endpoint with a mock deployment kind while the flag is off is
refused under the code `gateway_mocks_disabled`, so the row is not written in the first place.

Tests: `api/oss/tests/pytest/unit/gateways/test_gateways_mock_flag_gate.py`. Three cases cover
creation with the flag off, with the flag on, and a real deployment kind under both. The gate case
reads the registration site itself, parsing the adapter dictionaries out of
`api/entrypoints/routers.py`, so it fails if a third mock adapter is ever registered outside the
flag, which is the way this defect would return.

### OR60. The caller's model string is interpolated into cloud URL paths unescaped — CLOSED, and the grammar is the control rather than escaping

Azure puts the model in `/openai/deployments/{model}` and Vertex in `…/models/{model}:{action}`.
Neither escaped it and neither restricted its characters, so a value such as `x/../..` walked out of
the deployment's own prefix and reached arbitrary paths under the organisation's cloud credentials.

`is_path_safe_model_identifier` in
`api/oss/src/core/gateways/llms/providers/passthrough/validation.py` admits a model only when every
slash-separated segment matches `[A-Za-z0-9][A-Za-z0-9._:-]*`, which is the character class real
model ids use and which excludes a segment that is a run of dots. Anything else is refused under the
code `invalid_model_identifier`, and the check runs where the model becomes a path segment, for Azure
and for Vertex alike.

Escaping was rejected rather than added on top. Agenta's qualified `<provider>/<kind>/<model>`
spelling is what the playground sends, so `/` is a real separator between admitted segments and
percent-encoding it would break the spelling live QA depends on. Within the admitted class only `:`
is reserved, and Vertex's `{model}:{action}` needs that colon to stay literal. The character class is
the whole control, and escaping would exclude nothing it does not already exclude.

Tests: in `api/oss/tests/pytest/unit/gateways/test_gateways_llm_routing_strategies.py`, fifteen
spellings driven through Azure and through Vertex, covering dot segments, an encoded separator, a
query or fragment that truncates the rest of the route, an absolute URL, a backslash, a space and a
newline. Beside them, cases asserting a plain model id and Agenta's qualified spelling still build
their URLs. The entry proposed these cases in
`test_gateways_llm_deployment_base_urls.py`; they sit beside the URL builder they guard instead.

### OR34. The AI providers drawer closes itself and discards the form — CLOSED, and the drawer was not what closed it

`Settings / AI providers / Add provider` opened a drawer that closed on its own, with no
interaction, no save and no notice. Measured on `agenta-ee-dev-gateways` on 2026-09-13: open and
untouched at 40 seconds, gone at 50, with everything typed into it discarded.

Nothing in the drawer does this. On a development deployment the mobile app's Next hot-module-reload
websocket at `/m/_next/hmr` fails its handshake through Traefik, so the development client falls back
to reloading the whole page every 50 to 60 seconds. The reload takes the page, and every open form
goes with it. The drawer is one casualty among all of them. A production build runs no such client,
does not reload, and the drawer holds.

Closure: closed as a development-deployment artefact rather than a dashboard defect. The follow-up
belongs to hosting and not to this document set: proxy the mobile hot-reload websocket in the
development compose and Traefik configuration so the development client keeps its connection.

---

### OR35. The API keys page offers no way to create a key — CLOSED, and it is not this branch's

`Settings / API keys` renders an empty state that invites the reader to generate a key, and no
control that generates one exists anywhere in the page. Measured on `agenta-ee-dev-gateways` on
2026-09-13: the empty state is the whole page, and the DOM carries no create button, menu item or
link.

The defect reproduces on `main` and has no gateway component. The mobile `SettingsScreen` hardcodes
`canEdit` to `false`, so the create control never renders for anyone.

Closure: tracked as https://github.com/Agenta-AI/agenta/issues/6803, outside this document set.

---

### OR26. The dashboard can configure a custom provider that no run can use — CLOSED in the vault, not in the browser

Two things were recorded under this number. One of them did not survive a check against the design
set, so the entry leads with the defect that did.

**The product gap.** Saving an OpenAI-compatible provider through `Settings / AI providers` wrote
a `custom_provider` **secret** and stopped there. `POST /gateways/llms/endpoints/query` still
returned `count: 0` afterwards. The runtime half was already converted: the SDK asks
`POST /gateways/llms/resolve` with the secret's slug as `connection_slug`, the gateway found no
endpoint row, and the run died on its first turn. Every agent configured this way failed, on every
harness.

D20 settles which side was wrong. Standard endpoints are generated and never stored; **only custom
endpoints become rows.** A `custom` provider that produces no row is therefore missing its half of
the contract, and the resolve call is right to refuse. Reproduced by hand: creating the row through
`POST /gateways/llms/endpoints/` with the secret's slug and a matching `provider_key` made the
same dashboard agent run end to end, `200` on
`/gateways/llms/custom/<slug>/v1/chat/completions`. Nothing else had to change, which is what
identified the creation path as the single missing piece.

**What was withdrawn.** This entry also read the absence of a `builtin/mock` control as a product
gap: the model picker returns `No data` for both `mock` and `agenta`, `Add provider` lists the real
providers plus `OpenAI-compatible endpoint` and nothing else, and `Add MCP server` is a free-form
name, URL and authentication form with no catalogue. Those observations hold, but they are a defect
in `qa.md`'s procedure rather than in the product. `scope-checklist.md` has no dashboard,
playground, picker or frontend row anywhere; its wave 2 is "every caller converted", the callers
being the SDK and the services rather than a UI, and the only frontend work in the whole document
set is the wave 3 MCP OAuth consent flow. `implementation-status.md` calls builtin `agenta` and
`mock` development-only test providers, and `mocks.md` is stronger still: the mock entries "are
generated in development only. Production neither lists them nor accepts their routes." A dashboard
control for picking a development-only test provider would contradict that sentence rather than
satisfy it.

So the procedure asked for a gate that was never in this increment's scope. `qa.md` now stops
naming `builtin/mock` and specifies the `custom` namespace, which *is* meant to be
operator-configurable, naming the builtin routes only as an HTTP-level precondition the way the
acceptance matrix already does. The live check kept its value either way, because the substituted
`custom` run is what found the product gap above, OR31, OR32, and the real cause behind OR23, OR27,
OR29 and OR30.

**Why it closed server-side.** This entry proposed closing it in the browser, on the
provider-creation path in `web/packages/agenta-settings`. It closed in the vault instead, and the
slug is the reason. The endpoint is keyed on the secret's slug; the SDK sends that slug to
`POST /gateways/llms/resolve` as `connection_slug`; and the slug is derived server-side, by
`VaultService._create_secret` through `get_slug_from_name_and_id`. The caller that builds the
payload does not know it yet, so a browser-side registration would have to guess the key the
resolver will ask for.

Server-side also covers what the one browser path does not. `transformCustomProviderPayloadData` is
a second frontend payload builder over the same secret; the SDK, direct API callers and the
Playwright vault fixtures write the secret without passing through any frontend at all. And a
delete removes the endpoint row with the secret, instead of leaving the orphan the schema's
`ON DELETE SET NULL` would otherwise produce.

**The shape.** `LLMEndpointRegistrarInterface` in `api/oss/src/core/secrets/interfaces.py` declares
the port on the secrets side. `LLMEndpointRegistrar` and the pure mapping
`map_custom_provider_secret_to_endpoint` in `api/oss/src/core/gateways/llms/registrar.py` implement
it over `LLMEndpointsDAOInterface` alone. `VaultService._register_llm_endpoint` and
`_deregister_llm_endpoint` in `api/oss/src/core/secrets/services.py` call it, and
`api/entrypoints/routers.py` wires it. The port is declared on the secrets side and implemented on
the gateways side because `SecretsResolver` already wraps `VaultService` and `LLMGatewayService`
takes that resolver: injecting the gateway service into the vault would close a construction cycle.
Registration is an upsert keyed on the slug, so a secret written before this change heals on its
first edit.

**The defect live QA caught in the first version of the fix**, recorded because it is the kind that
comes back. The mapping wrote the endpoint's model allowlist as bare model slugs, while the harness
sends Agenta's qualified `<provider slug>/<kind>/<model slug>` key and `GatewayEndpointFilter.allows`
is exact membership. Every gateway-routed run returned `403 model_not_allowed`, on a provider that
was now correctly registered. `custom_provider_model_allowlist` admits both spellings,
deduplicated. An empty model list still maps to an empty allowlist rather than to the `None` that
means unrestricted.

Measured live on 2026-09-13 from the dashboard, with no API call standing in for any step. Saving a
provider registers one endpoint row, read back at `POST /gateways/llms/endpoints/query`, with a
slug matching the secret, a `provider_key` following the declared protocol, and an allowlist
carrying both spellings of every model. Editing the provider updates that same row in place, same
id and same slug, with no duplicate. Deleting the provider removes it.

Tests: `api/oss/tests/pytest/unit/gateways/test_gateways_llm_endpoint_registrar.py` and
`api/oss/tests/pytest/unit/secrets/test_llm_endpoint_registration.py`; plus
`test_a_qualified_model_key_is_relayed_and_not_refused_as_not_allowed` and
`test_an_unlisted_model_is_still_refused_on_a_registered_custom_provider` in
`api/oss/tests/pytest/unit/gateways/test_gateways_llm_service.py`.

### OR31. The dashboard offers harness and route combinations the runtime refuses — CLOSED, and the Codex part was reclassified before it closed

Four places let the operator build a configuration that cannot run, with no warning at
configuration time and no explanation at run time. Three were dashboard defects and are closed. The
fourth was not a dashboard defect at all, and its diagnosis did not survive a second reading; the
record is corrected below rather than repeated.

**The provider form offered no protocol choice.** Its `Harnesses` control accepted Claude Code on
an OpenAI-compatible endpoint. The model picker then offered that model under a `Claude Code`
group, and the run failed with `422 provider 'openai' is not supported by harness 'claude'` while
the user saw only `Message wasn't sent — try again.` The combination itself is legitimate:
declaring the endpoint's `provider_key` as `anthropic` and giving it an Anthropic-protocol model
makes the same harness run end to end through `/gateways/llms/custom/<slug>/v1/messages`, which is
how the happy LLM cell was passed. What the form was missing is the protocol declaration, since it
offered an OpenAI-shaped endpoint and nothing else.

**Codex looked like a dead end on any custom endpoint.** It accepted the same combination and
failed from inside the harness: `model '<provider>/custom/<model>' is not available on this run …
Allowed values: gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, gpt-5.2`.

**The `MCP servers` section was hidden whenever Pi was selected**, and Pi is the one harness whose
gateway LLM leg works out of the box. A server configured under Claude Code disappeared from the
panel on switching to Pi and came back on switching away, so it was hidden rather than deleted. It
was also inert, and nothing told the operator that the server they configured would not be used.

**`Add MCP server` did not route the URL it asked for.** A server named `gw-mock-mcp` pointed at a
builtin mock gateway route went out as `POST /gateways/mcps/custom/gw-mock-mcp`: the name became a
`custom` slug and the supplied URL was discarded.

Smaller, same family, and untouched by this work: the picker renders several options with identical
accessible names (`echo`, `echo`, `echo`, one per harness), the harness carried only by a visual
group header. It is a labelling defect with no runtime consequence, and nothing here changed it.

**(a) The provider form declares its protocol — closed.** `CustomProviderDTO.protocol` in
`api/oss/src/core/secrets/dtos.py` takes `openai` or `anthropic` and becomes the endpoint's
`provider_key`. The form control lives in `ProviderConnectionCard.tsx`, with its field catalog entry
in `web/packages/agenta-entities/src/secret/core/providerFields.ts`.

`harnessSupportsProviderKind` in `.../secret/core/connections.ts` checked only
`deployments.includes("custom")` for a custom kind and never the provider family, which is what made
Claude Code offerable on an OpenAI-compatible endpoint. It now also requires the harness's custom
family to match the declared protocol, reusing the existing `customRouteFamily` mirror of the SDK's
`HARNESS_CUSTOM_DEPLOYMENT_PROVIDERS` rather than adding a second copy of that table.
`customRouteAdmitsModel` prefers the declaration over its per-model vendor guess.

An **undeclared** protocol narrows nothing, deliberately. This is a grandfather rule, not a default:
records written before the field existed include Anthropic gateways with a saved Claude policy, and
reading their silence as OpenAI-compatible would take every Claude Code row out of their picker.
Those keep the vendor guess. `declaredEndpointProtocol` in `.../secret/core/connections.ts` is where
the two paths part. New records always declare, because the form writes a protocol on every save, so
the legacy path only ever serves records that predate the field. Both paths are pinned in
`web/packages/agenta-entity-ui/tests/unit/connectionPicker.test.ts`: the five legacy Claude Code
cases, and beside them `offers a declared anthropic endpoint under Claude Code, and under neither Pi
nor Codex`, `keeps a declared openai endpoint on Pi and Codex even when its models are
Anthropic-named`, and `lets a declared anthropic endpoint hand Claude Code its OpenAI-named models
too`.

Two options, not the three the entry implied. The relay serves all three route suffixes on any
custom endpoint and only the provider family changes behaviour, so a chat-completions versus
responses choice would have no effect on anything.

Tests: the new cases in `web/packages/agenta-entities/tests/unit/provider-connections.test.ts` and
`.../agent-model-candidates.test.ts`.

**(b) Pi renders the MCP servers row — closed.** The gate is a capability, not a frontend harness
list: the panel renders the section when the harness publishes `mcp.user_servers`, and the `pi_core`
entry in `sdks/python/agenta/sdk/agents/capabilities.py` passed no `mcp` argument at all. That
contradicted the shipped runner, which registers gateway-backed HTTP MCP tools for Pi and tests them
in `services/runner/tests/unit/pi-gateway-mcp.test.ts` and `sandbox-agent-pi-assets.test.ts`. Pi now
declares the same user-server capability as Claude Code and Codex, with its one real constraint
recorded beside the entry: its extension takes an already-resolved gateway route, not a direct
author URL. Tests: `sdks/python/oss/tests/pytest/unit/agents/connections/test_capabilities.py` and
`web/packages/agenta-entity-ui/tests/unit/connectionUtils.test.ts`.

**(c) `Add MCP server` routes its URL — closed.** Saving a server registers the custom MCP endpoint
that carries the URL, in
`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/mcpEndpointRegistration.ts`,
and writes the derived slug back onto the config item's name, so the value the SDK routes on and the
row it resolves cannot drift. An existing slug is updated rather than duplicated, preserving its
`secret_id` and never downgrading an OAuth row. A failed registration keeps the drawer open with the
backend's own message instead of saving a config item that cannot run. This is what D35 already
required. Test: `web/packages/agenta-entity-ui/tests/unit/mcpEndpointRegistration.test.ts`.

**(d) Codex on a custom endpoint — RECLASSIFIED, then CLOSED, and both the conclusion and the
remedy above were wrong.** The refusal is not a Codex limitation. The runner holds no model list of
its own. The `Allowed values` text comes from the `sandbox-agent` client's pre-check against the
config options `codex-acp` advertised, which come in turn from the codex binary's baked model table.
Both are checks on a model CHANGE. `codex-acp` accepts an unknown model id DECLARED in
`$CODEX_HOME/config.toml`, takes it verbatim as the thread's model, and unshifts it onto the front
of the selectable options — so the same id that cannot be switched to is accepted when it is
declared.

The entry's proposed remedy did not follow from the finding. It asked the `Harnesses` control to
stop offering Codex on a custom endpoint, which this fix would then have had to undo. Codex's
custom-surface family is `openai`, so the OR31a protocol filter already offers Codex on an
OpenAI-compatible endpoint and withholds it from an Anthropic one, which is the correct end state
for that control whatever the model pin does.

The fix is the pin. `codex_settings.py`, which already writes the whole `model_providers` block for
a gateway route and deliberately omitted the model, now writes the model scalar beside
`model_provider` — on gateway-routed managed runs only, since a managed run on a first-party
provider already asks for an id the catalogue knows. The id written is the one
`wire_model_connection` puts on the wire, so the config's model and the model the runner would ask
for are one string. `environment.ts` then skips the model change, because a declared model is
already selected and the call is the only thing left that can fail. It reads the pin out of the
rendered config rather than re-deriving the condition from the request, so it cannot decide a model
was pinned on a run where it was not.

The `<provider>/<kind>/<model>` prefix is deliberately left alone: the bare slug is equally absent
from Codex's catalogue, so stripping it fixes nothing on its own.

**Measured live on 2026-09-13**, on `agenta-ee-dev-gateways`, driving the product endpoint with a
custom endpoint auto-registered exactly as the provider form writes it. Before: `500`, `model
'<slug>/openai/echo' is not available on this run … Allowed values: gpt-5.6-sol, gpt-5.6-terra,
gpt-5.6-luna, gpt-5.5, gpt-5.2`. After: `200`, and the turn ends with the mock's round-trip
confirmation `mock MCP echo: <marker>`. The nine Codex cells of
`services/oss/tests/pytest/acceptance/test_agent_gateway_route.py` still pass, so the harness's
own catalogue ids are unaffected.

Two caveats the pin carries, neither a failure. Codex prepends one line to its first answer —
`Warning: Model metadata for <id> not found. Defaulting to fallback metadata` — because an
unlisted id has no baked metadata; `model_context_window` is the config key that would silence it,
and it is not written here because no honest value for an arbitrary custom model is available.
And `createModelId` defaults an unknown model to `medium` reasoning effort with no
`supportedReasoningEfforts`, so the session advertises no thought-level option and anything setting
thought level for Codex must tolerate its absence.

Tests: `test_gateway_route_declares_the_model_codex_would_refuse_to_switch_to`,
`test_a_non_gateway_managed_run_still_leaves_the_model_to_the_runner` and
`test_a_gateway_run_with_no_resolved_model_writes_no_model_scalar` in
`sdks/python/oss/tests/pytest/unit/agents/adapters/test_codex_settings_layers.py`; the
`codexConfigPinnedModel` and "a Codex run whose config declares the model" blocks in
`services/runner/tests/unit/sandbox-agent-model.test.ts`, the second of which drives the whole
engine and asserts the session is never asked to change model.

**Measured live on 2026-09-13**, on `agenta-ee-dev-gateways`, from the dashboard, with no API call
standing in for any step. The `Harnesses` control disables Claude Code with "Incompatible with this
provider" on an OpenAI-compatible endpoint and enables it on an Anthropic one; Pi and Codex are
enabled and disabled the other way round. Pi completes a turn through
`POST /gateways/llms/custom/<slug>/v1/chat/completions`, `200`. Claude Code completes a turn through
`POST /gateways/llms/custom/<slug>/v1/messages?beta=true`, `200`. On the MCP leg, for Pi and for
Claude Code, the `tools/call` reaches the mock and the assistant turn ends with the mock's
round-trip confirmation, `mock MCP echo: <marker>`.

Both MCP cells needed a precondition that is not obvious from the product, so `qa.md` step 4 now
carries it. The prompt must contain the acceptance marker the mock keys on
(`MCP-ACCEPTANCE-[A-Za-z0-9_-]+`, read by `_mcp_marker` in the mock adapter), and on the Anthropic
Messages path the server must be named `mock-mcp`, because `_default_mcp_echo_tool` returns the
hardcoded tool name `mcp__mock-mcp__echo` for that protocol. A plain-English prompt makes the cell
look like a product failure when it is not.

### OR33. A non-streaming relay never recorded its call — CLOSED, and the reading held

Raised from the wallets side as a reading of the code, not a reproduction, while specifying the
usage hand-off that Wave 2 hangs off `GatewayPolicyService.record`. The reading held, and the
first test written against it failed on all three protocols.

**What happened.** `LLMGatewayService` recorded in a `finally` after the body generator
terminated, which is right for a stream because Starlette iterates a `StreamingResponse` to
exhaustion. The non-streaming caller does not iterate: `LLMGatewayProxy._relay` takes one chunk
with `anext` and builds a plain `Response`. The generator was left suspended at its `yield` and
never closed, so the `finally` — and `policy.record`, and the `gateways.called` audit event —
ran only when the abandoned generator was finalised, at garbage collection, outside the request.
`result.usage` was still `None` when it did, because `_single_chunk_body` assigns usage on the
statement AFTER its yield. Non-streaming is the default (`stream` defaults to `False`), so this
was every ordinary call, and it was invisible precisely because the thing it dropped is the
event you would look at.

**Why neither suite caught it.** `test_gateways_llm_service.py` drains the body by
comprehension, which is the contract the service honours; the proxy's own tests run against a
mock service and never reach the recording. The defect lived in the seam, where both layers look
right in isolation.

**The repair.** The candidate offered two, and the choice belonged to whoever owns the relay. The
narrower one — assigning usage before the yield — fixes the value but not the timing: the record
would still wait for garbage collection. So the service now branches on `context.stream`, which
it already parses. A stream keeps today's arrangement exactly. A non-streaming call is drained by
the service, recorded while the call is still the call, and handed back as a replay of the bytes
it consumed. `duration_ms` is unchanged and still unpopulated; that is a separate gap on
`GatewayOutcome`, as is the absence of any cached-token field on `GatewayUsage`.

One thing improved on the way past. The drained chunks are joined, so an adapter whose
non-streaming answer arrives in more than one chunk no longer reaches the caller as its first
chunk alone. The relay adapter coalesces with `aread()` and was never affected; the guarantee is
for every other adapter.

Tests: `api/oss/tests/pytest/unit/gateways/test_gateways_llm_nonstreaming_drain.py`, which
composes the real service, the real relay adapter and the real proxy over an `httpx.MockTransport`
upstream and asserts, for chat completions, responses and messages alike, that `policy.record`
has been called once with a populated `usage` by the time the response exists. Verified to fail
on all three before the change (`record_calls == []`). Beside it,
`test_a_multi_chunk_non_streaming_body_is_joined_not_truncated` pins the join at the service
level, and `test_successful_non_streaming_call_records_before_it_returns` replaces the case that
encoded the old, caller-drains contract.

### OR28. Harness compatibility of the typed refusal — CLOSED, and one harness was worse than recorded

The finding's three rows were measured before OR27 closed, and re-measuring them was the first
step of the fix rather than a reason to discount them. Re-measured live on 2026-09-12 against
`agenta-ee-dev-gateways`, one turn per harness on each plane, driving the endpoint the playground
drives (`POST /services/agent/v0/invoke`, `Accept: text/event-stream`,
`x-ag-messages-format: vercel`).

**The control plane no longer has a harness axis.** OR27 moved that refusal upstream of the
harness entirely: the SDK resolver refuses before a run starts, so Pi, Claude Code and Codex all
answer `422`, `failure_code: endpoint_not_found`, `LLM endpoint not found: custom/<slug>`. There
is nothing left for a harness to mangle.

**The data plane still had one, and Codex's row was worse than the finding recorded.** Against a
`403 model_not_allowed`:

- **Pi** and **Claude Code** ended the run under the generic `runner_error`, with the gateway's
  refusal readable only as prose in `errorText`. No `code`, no `retryable`, no `next_step`.
- **Codex** reported the refused run as a **success**: HTTP `200`, `stop_reason: end_turn`, and
  the refusal sitting in the transcript as if the model had said it. The finding called Codex's
  card "the best of the three surfaces and the weakest of the three payloads"; on this plane it
  had no payload at all and reported the failure as its own opposite.

Four changes, one refusal.

The live `error` event gains a `detail` field carrying the gateway's `{code, message, retryable,
next_step, details}`. The terminal result has carried `errorDetail` since OR25, but the live leg
had no field for it, and `_error_parts` suppresses the terminal frame once a live error has gone
out — so the browser saw the refusal and nothing machine-readable. `code` and `detail.code` stay
separate fields because they answer different questions: one picks a recovery path, the other says
what the gateway refused.

A refusal a harness folded into its ANSWER now fails the turn, beside the existing swallowed-Pi
recovery in `run-turn.ts`. The `⟦agenta_code:…⟧` marker is what identifies it; text without one is
left alone, so a model quoting a refusal is not mistaken for a model receiving one.

The recovery runs at the runner's transport boundary (`writeRecord` in `server.ts`) rather than
inside one engine path. `engine.ts` applied `withGatewayErrorDetail` on its own one-shot path, but
the session path builds its result in `session-coordinator.ts` and never passes through that call
— so a pooled run, which is every playground run, answered differently from a one-shot run.

`parseFromBody` accepts a bare gateway body, not only a wrapped `{"error": {…}}`. Pi's error
helper unwraps `error` before reporting, so its text carried the whole envelope and the scan read
none of it; the bare shape is accepted only when its `message` carries the marker.

On the SDK side `_error_parts` takes the event's `detail` and the gateway's code replaces the
generic `runner_error` on the `data-agent-error` frame. A NAMED runner class
(`starter_credits_exhausted`) still wins, because the client has its own recovery path for it.

Measured after, same three harnesses, same plane: `failure_code: model_not_allowed` and an
`errorDetail` on every one; Pi carries the full envelope including `next_step`, Codex and Claude
Code carry `code`, `message` and `retryable`, which is the marker's ceiling. Codex fails the run.

Tests: `test_a_data_plane_refusal_reaches_the_caller_with_its_code` and
`test_a_control_plane_refusal_reaches_the_caller_with_its_code` in
`services/oss/tests/pytest/acceptance/test_agent_gateway_refusal.py`, parametrized over the three
harnesses and run against the live stack; `tests/unit/gateway-refusal-envelope.test.ts` in the
runner, which pins the envelope on the event, the bare-body shape, the transport boundary and the
folded refusal; and
`sdks/python/oss/tests/pytest/unit/agents/adapters/test_vercel_stream_refusal_envelope.py`, which
pins the frame the client reads.

### OR32. A server that fails its MCP handshake vanishes from the run — CLOSED

The runner now probes the MCP `initialize` handshake itself, once per session, for every
configured server. Reading the harnesses was not an option: the Claude ACP adapter emits no MCP
status frame of any kind, so a failed server is indistinguishable there from a server nobody
configured. Probing once is the only way the same failure becomes the same notice on all three.

Each failure is logged at warn with the server name and the status, and rides a new
`mcp_server_failed` event as a NON-FATAL notice — the turn still runs, it just runs without that
server's tools, which is what actually happened. The outcome lives on the environment rather than
the turn, so a pooled warm turn reports it too: the session outlives the cold turn that probed,
and the person driving turn three has no other way to learn that a server never joined. The SDK's
Vercel egress projects it as `data-mcp-server-failed`; its `elif` chain has no fallthrough, so an
event it does not name is dropped in silence, which is how this would have been lost on the last
hop.

Two harness-specific halves came with it. Codex's own synthetic `mcp__<server>__startup` failure
frame, which the runner discarded as transcript noise, now becomes the same notice — it is the
server's verdict from inside the sandbox, which the runner's probe cannot see. Pi no longer lets
one server's refusal escape `before_agent_start` and kill the whole turn; it skips that server's
tools and names it, as the ACP harnesses already did.

What the probe does not prove: it runs from the runner's network vantage, which is the sandbox's
only on a local run. A `connected` outcome is evidence, not a guarantee. The refusal the gateway
itself returns — the case this exists for — holds either way.

Tests: `tests/unit/mcp-handshake-notice.test.ts` in the runner, which classifies each way a
handshake fails and then drives the whole engine once per harness, asserting the turn still
succeeds and names the server; the Codex frame is pinned in
`tests/unit/session-keepalive-engine.test.ts` beside the tool-call suppression it belongs to; Pi's
non-fatal registration in `tests/unit/pi-gateway-mcp.test.ts`; and the egress in
`sdks/python/oss/tests/pytest/unit/agents/adapters/test_vercel_stream_mcp_notice.py`.

### OR27. A gateway control-plane refusal reaching the user with no code and no message — CLOSED

Two changes, one per side, following the OR25 precedent.

On the gateway, `gateway_error_envelope` in `apis/fastapi/gateways/exceptions.py` builds the
shared `{code, message, retryable, next_step, details}` shape, and `handle_gateway_exceptions`
now sends it as the HTTP `detail` for every refusal a caller must act on: the not-found error on
both planes (`endpoint_not_found`) and the operator's switch (`endpoint_inactive`). `details`
names the endpoint target and nothing else, because this body reaches the browser and the harness
transcript. That arm is shared with the MCP management routes, so their `404` body changes shape
too; one shape whichever side refused was the point, and nothing reads that `detail` (the web
client's global handler reads `error.message`).

On the SDK, `GatewayConnectionRefusedError` in `sdk/agents/connections/errors.py`, raised from
`VaultConnectionResolver.resolve`, which now reads the response body instead of only its status.
`from_response` tolerates every reachable shape, because all of them are: the envelope, a bare
string `detail` from a route that has not adopted it, FastAPI's validation-error list, the generic
object an intercepted server fault sends, and a body that is not JSON at all. `failure_code`
becomes the gateway's own `code`, so `failure_code_of` carries it onto the status at both
normalizer seams. A `5xx` keeps a server status, because that one genuinely is a server fault;
every other refusal reads `422`, like every other resolution failure.

Measured live on 2026-09-12, one turn whose connection slug was never registered. Before: HTTP
`500`, `message=connection resolution failed (HTTP 404)`, no failure code. After: HTTP `422`,
`message=LLM endpoint not found: custom/<slug>`, `failure_code=endpoint_not_found`.

One thing is deliberately unchanged. `status.type` is still the generic
`v1:sdk:unknown-workflow-invoke-error`, because the running normalizer uses one type for every
exception that is not an `ErrorStatus`, and OR25 closed on those same terms. The status, the code
and the message are what a caller acts on, and all three are now right.

Tests: `test_a_404_envelope_survives_into_the_typed_refusal`,
`test_a_422_envelope_survives_into_the_typed_refusal`,
`test_a_bare_string_detail_still_carries_a_code_and_the_message`,
`test_a_control_plane_fault_keeps_a_server_status` and
`test_an_unreadable_refusal_body_still_names_the_status` in
`sdks/python/oss/tests/pytest/unit/agents/platform/test_connections_http.py`, which is the file
that owns the resolver's HTTP boundary and its fake-client fixture;
`test_resolve_of_a_missing_endpoint_refuses_with_a_code` and
`test_resolve_of_a_deactivated_endpoint_refuses_with_a_code` in
`api/oss/tests/pytest/unit/gateways/test_gateways_llm_router.py`; and
`test_a_control_plane_refusal_reaches_the_caller_with_its_code` in
`services/oss/tests/pytest/unit/agent/test_gateway_route.py`, which pins what the normalizer puts
on the status.

### OR29. `PUT` on an LLM endpoint and `provider_key` — CLOSED, and the mechanism was different

The finding's headline and its consequence both hold. Its diagnosis did not survive a second
measurement, so the record is corrected here rather than repeated.

`PUT` never destroyed a stored `provider_key`. `map_llm_endpoint_edit_to_dbe` left the column
alone deliberately and said so in its docstring. What it did was silently ignore a `provider_key`
in the request body, because `LLMEndpointEdit` had no such field and pydantic dropped the extra.
Measured live on 2026-09-12: create with `provider_key=openai`, `PUT` the same body, read back,
and the key is still `openai` and the slug still resolves `200`. Create with no provider, `PUT`
one in, and the response is `200` with no provider anywhere. The QA run's helper created its
endpoint without a `provider_key`, which is why the read after its edit showed none.

So the defect is that the edit path cannot set the provider, not that it strips one. The dead end
is the same either way: an endpoint saved without a provider fails every run against it, and
recreating it was the only repair.

Closed by `provider_key` on `LLMEndpointEdit` plus one conditional in
`map_llm_endpoint_edit_to_dbe`. It is the only field this `PUT` does not overwrite when omitted.
Every other field is a full replace, but a request that says nothing about the provider must not
be able to strip the one field the endpoint cannot resolve without, and no product path un-sets
it. The finding's second half, the resolve-time `500`, is closed as part of OR30.

Tests: `test_edit_sets_a_provider_key_on_an_endpoint_that_had_none`,
`test_edit_replaces_an_existing_provider_key` and
`test_edit_omitting_provider_key_preserves_the_stored_one` in
`api/oss/tests/pytest/unit/gateways/test_gateways_mappings.py`;
`test_edit_endpoint_round_trips_provider_key` in
`api/oss/tests/pytest/integration/gateways/test_gateways_llm_endpoints_dao.py`, which proves it
against a real row; and `test_edit_endpoint_carries_provider_key_to_the_service` plus
`test_edit_endpoint_omitting_provider_key_says_nothing_about_it` in
`api/oss/tests/pytest/unit/gateways/test_gateways_llm_router.py` for the request DTO.

### OR30. Two unhandled `ValueError`s on the resolve route — CLOSED

`LLMConnectionProviderRequiredError` and `LLMEndpointProviderMissingError` in
`core/gateways/llms/types.py`, raised at the two sites in `resolve_agent_connection`, with two new
arms in `handle_gateway_exceptions` mapping both to `422` and the shared envelope, under the codes
`gateway_provider_required` and `gateway_endpoint_provider_missing`. The provider-missing message
names the endpoint, because repairing that row is the operator's next move.

The invariant underneath is `LLMGatewayConnectionResolution.provider_key`, a required field: a
provider-less resolution cannot be constructed whatever a caller does. The typed errors are the
seam guard in front of it, which is the arrangement OR25 landed.

Measured live on 2026-09-12. A body carrying only `model`, and a slug naming an endpoint with no
provider, both answered `500` with "An unexpected error occurred". They now answer `422` with a
code, a message and a `next_step`.

Tests: `test_resolve_agent_connection_without_a_provider_or_a_slug_is_typed`,
`test_resolve_agent_connection_of_a_provider_less_endpoint_is_typed` and
`test_resolve_agent_connection_of_a_provider_less_endpoint_accepts_a_request_provider` in
`api/oss/tests/pytest/unit/gateways/test_gateways_llm_service.py`; plus
`test_resolve_without_a_provider_or_a_connection_refuses_with_a_code` and
`test_resolve_of_a_provider_less_endpoint_refuses_with_a_code` in
`api/oss/tests/pytest/unit/gateways/test_gateways_llm_router.py` for the envelope at the boundary.

### OR23. Deterministic native-MCP acceptance for Codex and Claude Code — CLOSED, and the cause was the mock

The finding read the symptom as a harness problem: Codex and Claude Code have native MCP clients
that "do not consume that generic response", so the entry asked for a captured native exchange per
harness. The cause was on our side, and one tier below where anyone was looking.

`MockMCPAdapter` dispatched `server/discover`, `tools/list` and `tools/call`, and answered
everything else with a transport failure. `initialize` and `notifications/initialized` are the
first two calls of every MCP session, so no spec-compliant client could get past them. Pi passed
only because its extension calls `tools/list` directly and skips the handshake. That also explains
the shape of the failure: Claude's cells returned a tool result with no echo marker rather than a
connection error, because the client gave up on the server, not on the route.

Closed by making the mock answer the opening exchange: `initialize` (echoing the client's
`protocolVersion`, with `capabilities.tools` and `serverInfo`), any notification (`202`, no body,
since answering a notification is itself a protocol violation), and `ping`. An unknown method is
now JSON-RPC error `-32601` at HTTP 200, which is the server answering rather than the transport
failing. The conventions are lifted from the runner's own MCP tool server
(`services/runner/src/tools/tool-mcp-http.ts`) so two mock servers cannot answer the same protocol
two ways.

The same change closes a divergence between the mock's two tiers, which would have misled whoever
debugged this next. The in-process route answered an unknown method with `502` and a text detail
while the socket route answered `501` with the bare string "mock upstream request failed". Both now
emit the same JSON-RPC body, and the deployable app's remaining transport-failure path speaks
JSON-RPC too.

**Measured on 2026-09-12, after the fix.** `test_agent_harness_calls_echo_through_each_mock_mcp_gateway_route`
is green on all 27 cells: nine Pi, nine Codex, and the nine Claude cells that were the whole of
this finding. No captured native fixture was needed, and the non-strict expected failures the
entry asked to retain can go.

Tests: `test_initialize_completes_the_handshake`,
`test_initialize_without_a_version_uses_the_pinned_one`,
`test_initialized_notification_is_accepted_with_no_body`,
`test_any_notification_is_accepted_rather_than_answered`, `test_ping_answers_an_empty_result` and
`test_unrecognized_method_is_a_json_rpc_error_not_a_transport_failure` in
`api/oss/tests/pytest/unit/gateways/test_mock_mcp_adapter.py`; the whole of
`api/oss/tests/pytest/unit/gateways/test_mock_mcp_envelope_parity.py`, which drives both tiers with
the same request and compares the bytes; and the acceptance matrix above.

### OR24. Plain-HTTP non-loopback deployments cannot use the gateway — CLOSED

D37 exempts loopback from the https requirement and nothing else, which left a whole
deployment shape unable to use a gateway at all: a self-hosted instance reached at a
plain-http address that is not loopback (an IP, or a LAN name). Every gateway-routed
resolution failed, because the bearer could not be sent to the deployment's own base URL.

The two legs also disagreed about which URLs they would accept, so the shape was not merely
refused, it was refused inconsistently. The SDK rejected a routable plain-http gateway while
the runner accepted one, and the runner's loopback set omitted `host.docker.internal`, which
the SDK has always treated as loopback. A connection could therefore pass the SDK and be
refused inside the sandbox, or the reverse.

Closed by `AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED`, default off, following
`AGENTA_INSECURE_EGRESS_ALLOWED`'s precedent of a named opt-in a trusted single-tenant
deployment may set. It is deliberately narrow. It covers only our own credentials into our
own gateway: a provider's secret (`opaque_http`) keeps D37's rule unconditionally, since the
reason there is a host we do not control, and the Daytona credential-endpoint rules are
untouched, since a remote sandbox dials across the internet. Both legs now read the same
variable and share one loopback set, so they cannot answer differently.

One implementation seam per leg, both holding the transport rule in a single place:
`is_effective_https_endpoint` in `sdk/agents/connections/models.py`, and
`isEffectiveSecureEndpoint` plus `gatewayInsecureHttpAllowed` in
`engines/sandbox_agent/run-plan.ts`.

Tests: `test_plain_http_to_a_routable_host_is_refused_with_the_flag_off`,
`..._when_the_flag_is_unset`, `..._is_allowed_with_the_flag_on`,
`test_the_opt_in_never_covers_a_provider_secret` and
`test_the_opt_in_does_not_widen_https_or_loopback` in
`sdks/python/oss/tests/pytest/unit/agents/test_gateway_credentials.py`; the
`gateway credentials over plain http` block in
`services/runner/tests/unit/gateway-credentials.test.ts`, which covers both flag states, the
loopback exemption in all three states, and the provider-secret exclusion. The existing
runner case that asserted a routable plain-http host was accepted is rewritten to assert the
loopback route it was named for, since its old expectation was the disagreement itself.

The tests set the variable explicitly in every case and the SDK root conftest strips it
unless a case carries `allow_insecure_env`. `test.sh` sources the deployment env file with
`set -a`, so a stack that enabled the flag would otherwise disable the default under test for
the whole process — the same trap `AGENTA_INSECURE_EGRESS_ALLOWED` already documents.

### OR25. HTTPS refusal surfaced as an unhandled 500 — CLOSED

With the opt-in off, the refusal reached the caller as a pydantic `ValidationError` escaping
`ResolvedConnection`, which the running normalizer could only report as
`v1:sdk:unknown-workflow-invoke-error`, HTTP 500, with a traceback. An operator whose only
mistake was serving the deployment over plain http saw a server fault and no way to act on it.

Closed by `GatewayInsecureEndpointError` in `sdk/agents/connections/errors.py`, raised at
`build_gateway_resolved_connection`, the one seam every gateway connection passes through. It
follows the `EndpointResolutionError` precedent (`status_code = 422`, a message naming the
variable that changes the answer) and carries `error_detail`, the same
`{code, message, retryable, next_step, details}` envelope the runner recovers from a gateway
data-plane refusal, so a caller reads one shape whichever side refused. `code` is
`gateway_insecure_endpoint`, `retryable` is false, `next_step` names the flag, and `details`
carries the gateway base URL, which is the deployment's own address and never a credential.

The model validator keeps raising underneath it, deliberately: it is the invariant no
construction path can dodge, while the typed error is what the real path produces.

Test: `test_the_refusal_is_typed_and_names_the_flag` in
`sdks/python/oss/tests/pytest/unit/agents/test_gateway_credentials.py`, which asserts the
status, the failure code, every envelope field, and that the credential value appears nowhere
in the body. `test_the_flag_lets_the_same_construction_succeed` and
`test_an_https_gateway_never_consults_the_flag` pin the two paths that must not raise.

### OR18. SDK malformed error detail — CLOSED

`result_from_wire()` now accepts `errorDetail` only when it is a JSON object. Any other value is
discarded while the original run failure is preserved. Regression cases cover strings, arrays, and
numbers.

### OR19. Static rewrite mutable defaults — CLOSED

`LLMStaticFieldRewrite` now uses Pydantic `Field(default_factory=...)` for both mutable fields.
The unit suite proves two instances cannot share either collection.

### OR21. IPv6 SSRF range — CLOSED, no code change required

`::/3` covers addresses beginning `000` through `1fff`; public IPv6 begins at `2000::/3`, so it is
not blocked. The API uses Python `ipaddress` directly. The runner table and boundary vectors are
generated from the same Python source; fixture regeneration and 82 TypeScript vector checks pass,
including public IPv6 addresses.

### OR22. Non-boolean LLM `stream` — CLOSED

All three LLM protocol parsers now reject a non-boolean `stream` value rather than applying Python
truthiness. The shared unit cases cover strings, numbers, null, and arrays on every door.

### OR20. Static rewrite serialization — CLOSED

The Vertex Messages rewrite has a semantic JSON contract. It removes `model`, adds
`anthropic_version` when absent, and preserves every other JSON value. Whitespace, escaping, and
object-key order are not preserved because the request is parsed and serialized. Regression
coverage makes the non-byte-preserving behavior explicit.

### OR4. Three duplicated auth-scheme enums — ANSWERED, and the question was mis-framed

The same `oauth | api_key` enum, and the same ready / needs-auth / needs-input state machine,
exist as a connection, a tool and a trigger variant. The question was whether they collapse into
one definition or whether the duplication is load-bearing.

**Neither.** The gateways are a separate domain, so they define their own copy, and the three
existing ones are outside the current scope (D15) — not ours to collapse. A draft that unified
them at the older domain's root, with its leaves aliasing over, was rejected: it would have
coupled the gateways to an integrations domain through the back door, which is worse than a
fourth definition.

If all four ever converge, the neutral home is `core/shared/dtos.py`, which already holds the
shared identifier, slug and header types. Available later; not done now, and not a prerequisite
for anything. `entities.md` §4.1 carries the reasoning and the definitions.

### OR6. Wire secret arrays — CLOSED

If the gateway holds all upstream secrets, the runner wire's per-server secret
arrays and the model secret array should collapse to a single gateway token. Review
what still populates them, and whether the `local_use` secret category can be removed
outright once cloud-reseller signing moves to the gateway.

**Nothing populates them with a real upstream secret on the connected path.** The model's
`ModelConnection.credentials` stays empty (`build_gateway_resolved_connection` in
`connections/endpoints.py`) and its one token rides `gatewayCredentials`; each MCP server's
`connection.credentials` (`mcp/resolver.py`'s `_resolve_gateway`) holds exactly one entry, our
own `X-AG-Credentials`, whatever secret refs the author named. Both are covered by the shared
golden (`model_connection.gateway.json`, asserted by both `test_gateway_credentials.py` and
`gateway-credentials.test.ts`) and by `mcp/test_resolver.py`, which now also proves the
per-server collapse across more than one server.

**`local_use` is not removable, and does not need to be.** It is dead on the connected path —
`_resolve_from_secrets` routes every deployment, including bedrock and vertex, through the
gateway with `credentials: []` — but stays reachable from the two offline, standalone-SDK
resolvers (`EnvConnectionResolver`, `StaticConnectionResolver`), which run with no Agenta backend
and so have no gateway to hold a cloud-reseller secret on their behalf; the sandbox in that mode
signs with a real value because there is no other account to sign with. `daytona-secret-plan.ts`
already scopes its `local_use` allowlist to exactly that reasoning.

### OR16. Gateway credential/header boundary — CLOSED by PR #6049 review

Automated review found that both data-plane proxies were stripping a caller's ordinary
`Authorization` header while forwarding `X-AG-Credentials`, which is Agenta's own gateway
credential. That reverses the intended trust boundary for a custom upstream. The same review
found that runner header names and values could be interpolated into newline-delimited harness
configuration without HTTP field-name validation.

**Verified and closed.** Both proxies now remove only `X-AG-Credentials` and retain an upstream
`Authorization` header. The runner accepts only RFC token-style header names and newline-free
values before materializing Pi or Claude configuration. Regression tests cover the two forwarding
rules and newline/colon injection attempts. The review also closed adjacent implementation-only
findings: the `request_connection` schema now requires exactly one of `integration` or `target`,
the migration header names its actual parent revision, and adapter/mock exception text is not
returned to callers. The generated `mock` provider is explicitly development-only and excluded
from the user-facing provider-catalogue parity claim.

### OR17. Bedrock/Vertex `base_url` registration and coverage — CLOSED by WP32

OD19 settled the meaning of `base_url`: Bedrock stores a host and Vertex stores a host plus their
shared project/location prefix; each protocol door appends only its own tail. The implementation
now validates that shape and uses registered Bedrock/Vertex fixtures with explicit endpoint
values.

**Verified closed.** Unit coverage in
`test_gateways_llm_deployment_base_urls.py` rejects malformed hosts, paths, query strings, and
fragments. The registered-fixture integration suite
`test_gateways_cloud_endpoint_url_fixtures.py` covers each supported door and static rewrite.
The OSS/EE acceptance suite `test_cloud_endpoint_base_urls_acceptance.py` proves a configured
endpoint is used without a fallback to a different endpoint or capability.

### OR1 / OR12. MCP OAuth client and SDK contract — CLOSED by WP30/WP31

The original review left two connected questions open: use the official MCP OAuth client rather
than a bespoke implementation, and prove its secret-backed `TokenStorage` contract through the
dashboard connection flow.

**Verified closed.** WP30 pins the official MCP SDK and implements its token storage over secret
handles only. Its unit suites cover storage, state, registration fallback, and no-token
serialization; `test_mcp_oauth_connect.py` covers the local-provider integration flow; and
`test_mcp_gateway_oauth_acceptance.py` proves authorization followed by a real gateway tool call.
WP31 adds the OSS/EE settings consent, callback, reconnect, and scope-step-up coverage in
`web/{oss,ee}/tests/playwright/acceptance/settings/mcp-oauth.spec.ts`.

---

## Closed review record (continued)

### OR9. Model call sites — CLOSED, and recounted

Counted twice. **Six sites across three shapes**, not the four first recorded. See
`raw/model-call-sites.md`, which also records what the first count got wrong.

Five sit in one SDK file, `sdks/python/agenta/sdk/engines/running/handlers.py`: three chat calls
(two through a shared retry wrapper, one bypassing it) and two similarity evaluators using the
OpenAI client directly for embeddings. The sixth is the harness inside the sandbox. **The API
calls no models at all**, and the runner only picks and checks a model id.

Three things carried into the design. The embeddings sites are deferred with the whole evaluator
path (D15) rather than forcing a route now. The `llm_v0` handler's module-level key assignment
must not reach a shared process, as an outcome of the conversion rather than a gate in front of
it — see OR13. And **the routing library's `Router` class is never instantiated anywhere in this
repo**, so none of its retry, fallback or load-balancing behaviour is inherited by moving the
call.

### OR13. Module-level provider keys — CLOSED, and the handler is not unused

One handler sets provider keys on module-level attributes of the routing library, which is
process-wide state and would be a cross-tenant leak in a shared process.

**Not a prerequisite either.** That pattern exists because nothing hands the handler a resolved
connection; proper injection through the gateway is what removes it.

**The "reported unused" premise does not hold.** `llm_v0` is registered under
`agenta:builtin:llm:v0` and mounted at `/llm/v0` in `services/entrypoints/main.py` — a live,
reachable managed-workflow route, not dead code.

**Verified closed instead.** The module-attribute pattern is gone: `_call_llm_with_fallback`
resolves `provider_settings` per LLM entry (through the same slug-first resolver the prompt path
uses) and passes them as call kwargs, with no `setattr(litellm, ...)` anywhere in the tree. This
landed in commit `50d6a2b3ed` ("per-entry llm_v0 keys"), ahead of and independent of this review.
Two regression tests were added to `test_llm_v0_provider_key_binding.py` covering the no-module-
attribute invariant and concurrent-call isolation across two connections.

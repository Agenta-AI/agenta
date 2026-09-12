# Review findings

## Active review findings

### OR26. The dashboard can configure a custom provider that no run can use

Two things were recorded under this number. One of them did not survive a check against the design
set, so the entry now leads with the defect that did.

**The product gap.** Saving an OpenAI-compatible provider through `Settings / AI providers` writes
a `custom_provider` **secret** and stops there. `POST /gateways/llms/endpoints/query` still returns
`count: 0` afterwards. The runtime half is already converted: the SDK asks
`POST /gateways/llms/resolve` with the secret's slug as `connection_slug`, the gateway finds no
endpoint row, and the run dies on its first turn. Every agent configured this way fails, on every
harness.

D20 settles which side is wrong. Standard endpoints are generated and never stored; **only custom
endpoints become rows.** A `custom` provider that produces no row is therefore missing its half of
the contract, and the resolve call is right to refuse. Reproduced by hand: creating the row through
`POST /gateways/llms/endpoints/` with the secret's slug and a matching `provider_key` makes the
same dashboard agent run end to end, `200` on
`/gateways/llms/custom/<slug>/v1/chat/completions`. Nothing else had to change, which is what
identifies the creation path as the single missing piece.

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

So the procedure asked for a gate that was never in this increment's scope, and the choice of
repair is the author's. Either `qa.md` stops naming `builtin/mock` and specifies the `custom`
namespace, which *is* meant to be operator-configurable, naming the builtin routes only as an
HTTP-level precondition the way the acceptance matrix already does; or the dashboard grows a
development-only affordance, which then has to answer `mocks.md`'s production rule. `qa.md` now
takes the first way. The live check kept its value either way, because the substituted `custom` run
is what found the product gap above, OR31, OR32, and the real cause behind OR23, OR27, OR29 and
OR30.

Closure: the provider-creation path in `web/packages/agenta-settings` must register the LLM endpoint
alongside the `custom_provider` secret, keyed by the same slug the resolver will ask for, with
`provider_key` set from the protocol the operator chose (OR31). Proven by a Playwright acceptance
case beside `web/{oss,ee}/tests/playwright/acceptance/settings/mcp-oauth.spec.ts` that saves an
OpenAI-compatible provider and then asserts `POST /gateways/llms/endpoints/query` returns one row.
`qa.md` carries the API call that stands in for the missing registration in the meantime.

---

### OR31. The dashboard offers harness and route combinations the runtime refuses

Four places let the operator build a configuration that cannot run, with no warning at
configuration time and no explanation at run time.

**The provider form offers no protocol choice.** Its `Harnesses` control accepts Claude Code on an
OpenAI-compatible endpoint. The model picker then offers that model under a `Claude Code` group,
and the run fails with `422 provider 'openai' is not supported by harness 'claude'` while the user
sees only `Message wasn't sent — try again.` The combination itself is legitimate: declaring the
endpoint's `provider_key` as `anthropic` and giving it an Anthropic-protocol model makes the same
harness run end to end through `/gateways/llms/custom/<slug>/v1/messages`, which is how the happy
LLM cell was passed. What the form is missing is the protocol declaration, since today it offers an
OpenAI-shaped endpoint and nothing else.

**Codex is a dead end on any custom endpoint.** It accepts the same combination and fails from
inside the harness: `model '<provider>/custom/<model>' is not available on this run … Allowed
values: gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, gpt-5.2`. Codex compares the **full**
model key, provider prefix included, against a fixed catalogue, so no custom gateway model can ever
satisfy it, whatever the endpoint declares. This one is not a mismatch a better form repairs: the
`Harnesses` control should not offer Codex on a custom endpoint until that key shape changes.

**The `MCP servers` section is hidden whenever Pi is selected**, and Pi is the one harness whose
gateway LLM leg works out of the box. A server configured under Claude Code disappears from the
panel on switching to Pi and comes back on switching away, so it is hidden rather than deleted. It
is also inert, and nothing tells the operator that the server they configured will not be used.

**`Add MCP server` does not route the URL it asks for.** A server named `gw-mock-mcp` pointed at a
builtin mock gateway route went out as `POST /gateways/mcps/custom/gw-mock-mcp`: the name becomes a
`custom` slug and the supplied URL is discarded. Either the field routes, or it should not be a URL
field.

Smaller, same family: the picker renders several options with identical accessible names (`echo`,
`echo`, `echo`, one per harness), the harness carried only by a visual group header.

Closure, in the order the QA hit them. The provider form must let the operator declare the
endpoint's protocol, and the form and the model picker must consult the same capability table the
SDK enforces in `sdks/python/agenta/sdk/agents/capabilities.py`, so an unsupported pair is not
offerable. The Pi branch of the configuration panel must render the `MCP servers` row.
`Add MCP server` must either persist its URL as a custom MCP endpoint or stop asking for one.
Proven by package unit cases in `web/packages/agenta-entities` over the harness/provider
compatibility selector, plus a Playwright acceptance case asserting the `MCP servers` row is
present for all three harnesses.

---

## Closed review record

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

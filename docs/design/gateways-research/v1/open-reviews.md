# Review findings

## Active review findings

### OR23. Deterministic native-MCP acceptance for Codex and Claude Code

Pi's extension consumes the mock LLM's OpenAI tool-call response and now proves `echo` through
the builtin, standard, and custom mock MCP routes. Codex and Claude Code receive the same HTTP
MCP configuration, but their native MCP clients do not consume that generic response: Codex ends
the turn without an MCP call, and Claude returns its system reminder. The gateway routes are
therefore not automatically proven through either harness.

Add a deterministic fixture based on a captured native exchange for each harness, then require
the full-stack test to show MCP initialization, `tools/list`, `tools/call`, and the returned echo
marker for every mock namespace. Until then, retain the named non-strict expected failures and
run the dashboard procedure in `qa.md` with a real harness connection.

**Observed on 2026-09-12.** The automated matrix now separates the two harnesses. Every Pi and
every Codex cell of `test_agent_harness_calls_echo_through_each_mock_mcp_gateway_route` passes,
and all nine Claude cells fail, one per LLM-namespace and MCP-namespace pair, with a tool result
that carries no echo marker (`assert 'mock MCP tool call failed' == 'mock MCP echo …'`). So Codex
is no longer part of this finding on the automated path and Claude Code is the whole of it. The
escape hatch the entry relies on is also unavailable: the dashboard procedure in `qa.md` could not
reach the MCP leg for **any** harness on that date, for the reasons recorded in OR26 and OR31, so
"run the dashboard procedure with a real harness connection" is not currently an option.

---

### OR26. The dashboard cannot select or create any gateway LLM route

`qa.md` step 2 asks the operator to select the builtin LLM mock route (`builtin/mock`) in the
dashboard and run it. There is no such control. Searching the playground model picker for `mock`
and for `agenta` both return `No data`, and Settings / AI providers / Add provider offers the real
providers plus `OpenAI-compatible endpoint` and nothing else. The routes themselves are live:
`GET /gateways/llms/builtin/mock/v1/models` and the `agenta` equivalent both answer `200` with
`mock/echo`, `gpt-5.5` and `claude-sonnet-5`.

The `custom` namespace is no better, and that is the part that matters. Saving an
OpenAI-compatible provider through the AI providers page writes a `custom_provider` **secret** and
never creates the matching gateway endpoint: `POST /gateways/llms/endpoints/query` still returns
`count: 0` afterwards. The run then fails at the control plane, because the SDK asks
`POST /gateways/llms/resolve` for an endpoint that was never registered and receives `404`.

So the gateway LLM plane has no reachable product path at all. The acceptance matrix proves the
routes over HTTP, which is why this did not show up there; `qa.md` exists precisely to catch that
difference, and it did. D1 says everything transits a gateway with no bypass, and a plane a user
cannot reach is the bypass taken by default.

The same shape holds on the MCP side. `Add MCP server` is a free-form name, URL and authentication
form with no builtin catalogue, so `qa.md` step 4 cannot select the builtin mock MCP server
either.

Closure: the provider-creation path in `web/packages/agenta-settings` must create the LLM endpoint
alongside the `custom_provider` secret, or `resolve_agent_connection` in
`core/gateways/llms/service.py` must resolve a `custom_provider` secret that has no registered
endpoint. Proven by a Playwright acceptance case beside
`web/{oss,ee}/tests/playwright/acceptance/settings/mcp-oauth.spec.ts` that saves an
OpenAI-compatible provider and then asserts `POST /gateways/llms/endpoints/query` returns one row.
`qa.md` now carries the API call that stands in for the missing control in the meantime.

---

### OR27. A gateway control-plane refusal reaches the user with no code and no message

This is OR25's failure shape, reopened on a different seam. OR25 closed the case where the
insecure-endpoint refusal escaped as an unhandled `ValidationError` reported as
`v1:sdk:unknown-workflow-invoke-error` at HTTP 500. A missing or disabled endpoint still does
exactly that.

`POST /gateways/llms/resolve` for an unregistered endpoint answers `404` with
`{"detail":"LLM endpoint not found: custom/<slug>"}` — a bare string, not the
`{code, message, retryable, next_step, details}` envelope OR25 established as the one shape a
caller reads whichever side refused. `build_gateway_resolved_connection`'s caller in
`sdk/agents/platform/connections.py` then discards even that, because it reads only the status and
never the body. The running normalizer can therefore report only
`v1:sdk:unknown-workflow-invoke-error`, HTTP 500,
`message=connection resolution failed (HTTP 404)`, and the dashboard shows
`Message wasn't sent — try again.` An operator whose only mistake was an endpoint that does not
exist sees a server fault and no way to act on it, which is OR25's own description of the case it
closed. `qa.md` calls a failure to surface `code` a gateway or runner regression, and by that rule
this is one, on all three harnesses.

Closure, two changes following the OR25 precedent, one per side. `LLMGatewayRouter`'s resolve
route should refuse through `handle_gateway_exceptions` with the shared envelope, a `code` of
`endpoint_not_found` and a `next_step` naming the endpoint to register. `ConnectionResolutionError`
in `sdk/agents/platform/connections.py` should parse `error_detail` off the response and carry it
rather than reducing every refusal to a status code. Proven by a case beside
`test_the_refusal_is_typed_and_names_the_flag` in
`sdks/python/oss/tests/pytest/unit/agents/test_gateway_credentials.py` asserting that a `404`
body's `code` survives into the raised error, plus an API unit case on the resolve route asserting
the envelope shape.

---

### OR28. Harness compatibility of the typed refusal: what each one preserves

`qa.md` requires every harness to preserve the human message and the machine-readable `code`,
allows Pi or Claude Code to preserve the whole envelope, and accepts Codex preserving only
`message` plus the embedded marker if the UI offers a generic recovery path.

Measured on 2026-09-12 against a data-plane `403` (`model_not_allowed`) and, where the harness got
that far, a control-plane `404`:

- **Pi** preserves `code` and the message, but only as text inside the harness's own session
  recap, rendered as `[error: 403: {…,"code":"model_not_allowed"}]` rather than as an error
  surface. `retryable`, `next_step` and `details` are absent.
- **Claude Code** preserves nothing. The run ends at `Message wasn't sent — try again.`
- **Codex** renders a first-class error card with `Show more` and preserves the human message, but
  no `code`, `retryable`, `next_step` or `details`. Its card is the best of the three surfaces and
  the weakest of the three payloads, which inverts the expectation `qa.md` records.

None of the three reaches the complete envelope the design allows for Pi or Claude Code, and no
harness offers the generic recovery path that is the stated condition for accepting Codex's
reduced payload. Per the closing note in `qa.md` these are harness-compatibility findings and must
not be normalized away in the UI.

Closure: WP25 is the package that owns the trip back (`AgentErrorDetail` through harness, runner
and agent service). Proven per harness by extending the replay fixtures under
`services/oss/tests/pytest/acceptance/` with a refusal case that asserts `code` appears in the
agent-service response for Pi, Claude Code and Codex, rather than only in the transcript text.

---

### OR29. `PUT` on an LLM endpoint silently drops `provider_key`

`POST /gateways/llms/endpoints/` persists `provider_key` correctly. `PUT` on the same endpoint
with the same field returns `200`, and a subsequent read shows no `provider_key` at all. Nothing
in the response says the field was ignored.

The consequence is not cosmetic. `resolve_agent_connection` computes
`target.provider_key or provider_key` and, with neither present, raises
`ValueError("gateway endpoint has no provider")` at `core/gateways/llms/service.py:270`. That
`ValueError` is unhandled, so the caller receives HTTP 500 and the generic "An unexpected error
occurred. Please try again later or contact support." An endpoint edited through the update path
therefore breaks every run against it, and the only recovery is to delete and recreate it.

Two defects in one. The update path must round-trip `provider_key`, and an endpoint that reaches
resolve without a provider is a data-integrity violation that deserves a typed refusal rather than
a generic 500.

Closure: `LLMEndpointsDAO`'s update path plus the `edit_llm_endpoint` request DTO in
`apis/fastapi/gateways/llms/router.py`. Proven by an integration case beside
`api/oss/tests/pytest/integration/gateways/` that creates an endpoint with a `provider_key`, edits
an unrelated field through `PUT`, and asserts the key is still readable and still resolves.

---

### OR30. Two unhandled `ValueError`s on the resolve route become generic 500s

Beyond OR29's case, `POST /gateways/llms/resolve` with only `model` and neither `provider_key` nor
`connection_slug` raises `ValueError("an unnamed gateway connection requires a provider")`, also
unhandled, also a generic 500. A request missing a required combination of fields is a client
error and belongs at `422`, the status `EndpointResolutionError` and `GatewayInsecureEndpointError`
already use.

The pattern to follow is the one OR25 landed: keep the `ValueError` as the invariant no
construction path can dodge, and put a typed error in front of it at the seam every request passes
through. `handle_gateway_exceptions` already wraps this route, so the work is adding the cases
rather than adding a mechanism.

Closure: two new arms in `handle_gateway_exceptions` in `apis/fastapi/gateways/llms/router.py`.
Proven by unit cases on the resolve route asserting `422` and an envelope `code` for a body with
only `model`, and for an endpoint whose provider is missing.

---

### OR31. The dashboard offers harness and route combinations the runtime refuses

Three places let the operator build a configuration that cannot run, with no warning at
configuration time and no explanation at run time.

The provider form's `Harnesses` control accepts Claude Code on an OpenAI-compatible endpoint. The
model picker then offers that model under a `Claude Code` group, and the run fails with
`422 provider 'openai' is not supported by harness 'claude'` while the user sees only
`Message wasn't sent — try again.` Codex accepts the same combination and fails differently, from
inside the harness: `model '<provider>/custom/<model>' is not available on this run … Allowed
values: gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, gpt-5.2`. A harness whose model
catalogue is fixed cannot use a custom gateway model at all, so offering one is a dead end rather
than a misconfiguration.

`Add MCP server` has the mirror-image problem: the URL the operator types is not the URL that is
requested. A server named `gw-mock-mcp` pointed at the builtin mock gateway route went out as
`POST /gateways/mcps/custom/gw-mock-mcp` and returned `404`, because the server name becomes a
`custom` slug and the supplied URL is discarded. Either the field routes, or it should not be a
URL field.

And Pi, the one harness whose gateway LLM leg works end to end, has **no `MCP servers` row in the
configuration panel at all**, while Claude Code and Codex both do. No MCP server can be attached
to a Pi agent from the dashboard, which is why `qa.md` step 4 has no executable happy path on any
harness.

Smaller, same family: the picker renders three separate options all named `echo`, one per harness,
with the harness carried only by a visual group header and absent from the accessible name.

Closure, in the order the QA hit them. The provider form and the model picker must consult the
same capability table the SDK enforces in `sdks/python/agenta/sdk/agents/capabilities.py`, so an
unsupported pair is not offerable. The Pi branch of the configuration panel must render the
`MCP servers` row. `Add MCP server` must either persist its URL as a custom MCP endpoint or stop
asking for one. Proven by package unit cases in `web/packages/agenta-entities` over the
harness/provider compatibility selector, plus a Playwright acceptance case asserting the
`MCP servers` row is present for all three harnesses.

---

## Closed review record

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

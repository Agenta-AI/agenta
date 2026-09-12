# Review findings

## Active review findings

### OR36. A proxied request relays the caller's session cookie and Authorization header upstream, and one pooled client carries upstream cookies between tenants

Two defects share one root cause and one fix, so they are recorded together. A gateway call relays
the caller's Agenta session cookie and Authorization header to a tenant-configured upstream URL.
Reproduced against the worktree on 2026-09-13 with synthetic credentials: a `sAccessToken` cookie
reached the upstream. Reproduced separately: after one upstream answered with `Set-Cookie`, a later
call carrying a different tenant's provider key sent the first call's upstream session cookie.

`GATEWAY_ONLY_HEADERS = frozenset({"x-ag-credentials"})` at
`api/oss/src/core/gateways/dtos.py:10` is the entire strip list, and it holds that one header and
nothing else. Both planes use it:
`api/oss/src/core/gateways/llms/providers/passthrough/adapter.py:28`,
`api/oss/src/core/gateways/mcps/providers/http/adapter.py:34` and
`api/oss/src/core/gateways/mcps/providers/composio/adapter.py:33`. Every other header the caller
sends goes upstream. On the way back, `api/oss/src/apis/fastapi/gateways/utils.py:6-12` strips only
content and connection headers, so `Set-Cookie` reaches the browser on the API origin. The
cross-tenant cookie comes from a single retained `httpx.AsyncClient` at
`.../passthrough/adapter.py:124`, constructed once at import time in
`api/entrypoints/routers.py:1182`. An httpx client keeps a cookie jar, and that jar is now
process-wide. An allow-by-default strip list is the wrong shape for a credential boundary, because
every header added anywhere in the platform joins it silently.

Closure: the relay forwards an explicit allowlist of request headers and returns an explicit
allowlist of response headers, and the upstream client holds no cookie jar. Proven by a case beside
`api/oss/tests/pytest/unit/gateways/test_gateways_llm_relay_adapter.py` that sends a request
carrying a session cookie and an Authorization header and asserts neither reaches the upstream, and
by a second case that drives two calls through one adapter instance, the first answering with
`Set-Cookie`, and asserts the second sends no cookie.

---

### OR37. The injected authorization header is merged case-sensitively into a case-insensitive protocol, so two Authorization headers go upstream

A relayed request carries both the caller's `authorization` header and the gateway's injected
`Authorization` header. HTTP field names are case-insensitive, so the upstream sees one header with
two values, and which one it honours is the upstream's choice. Present in the branch as of
2026-09-13.

`api/oss/src/core/gateways/llms/providers/passthrough/adapter.py:48-51` builds the outbound headers
as plain dicts: line 48 copies the caller's headers, line 50 merges the route's headers, and line 51
merges `build_auth_headers`, which spells the name with a capital A
(`api/oss/src/core/gateways/llms/providers/passthrough/auth.py:15`, `:55`, `:85`, `:105`, `:109`).
Starlette normalises incoming names to lowercase, so `authorization` and `Authorization` are
separate dict keys and neither overwrites the other. The existing test at
`api/oss/tests/pytest/unit/gateways/test_gateways_llm_relay_adapter.py:217` is named for exactly
this overwrite, and it passes only because its input at line 231 is already title-cased.

Closure: outbound headers are assembled in a case-insensitive structure, so an injected name
replaces any casing of the same name. Proven by rewriting that test to supply the lowercase
`authorization` Starlette actually produces, and asserting the upstream receives one authorization
value, the gateway's.

---

### OR38. The credential handed to the sandbox is a general-purpose platform token that can read the vault

The gateway exists so that a sandbox never holds anything able to reach a provider key. The
credential the sandbox holds reaches provider keys directly. Reproduced against the worktree on
2026-09-13: the sandbox's gateway credential authenticated a vault request and returned secret
values.

`sdks/python/agenta/sdk/agents/platform/connections.py:1019` reads the platform authorization value
and passes it as the gateway credential at `:1068` and `:1099`, so one value serves both roles.
`api/oss/src/core/workflows/service.py:3038-3047` mints that value with `SECRET_RESOLVE_GRANT`.
`api/oss/src/middlewares/auth.py:64-67` accepts `X-AG-Credentials` on any route, not only on gateway
routes. `api/oss/src/apis/fastapi/vault/router.py:242-244` then returns write-only secret values in
plaintext to any caller holding that same grant. Each link is reasonable on its own; together they
give a sandboxed agent the platform identity the gateway was built to withhold from it.

Closure: the sandbox holds a gateway-audience credential that the vault routes reject, and the
middleware accepts `X-AG-Credentials` only on gateway routes. Proven by a case in
`api/oss/tests/pytest/unit/gateways/` that presents a sandbox gateway credential to
`GET /vault/secrets` and asserts a refusal, alongside the existing gateway relay cases proving the
same credential still relays.

---

### OR39. An upstream can return the injected provider key to the caller through the response body

A gateway response is relayed to the caller unread. An upstream that echoes the Authorization header
it received, which several providers do in an error body, returns Agenta's provider key to the
sandbox. Reproduced against the worktree on 2026-09-13 with a synthetic key: the key appeared in a
401 JSON body and again in a 200 SSE stream.

`api/oss/src/core/gateways/llms/providers/passthrough/adapter.py:170-177` converts 5xx statuses into
domain errors. Every other status, and every successful body, passes through. The body generators at
`.../adapter.py:196` and `:207` yield upstream bytes with no filtering, and
`api/oss/src/apis/fastapi/gateways/llms/proxy.py:350-366` returns those bytes to the caller on both
the streaming and non-streaming paths. Nothing between the upstream socket and the sandbox looks at
what is in the body.

Closure: a response body carrying the injected credential never reaches the caller. Proven by a case
beside `test_gateways_llm_relay_adapter.py` that drives an `httpx.MockTransport` upstream echoing the
Authorization value in a 401 body and again in an SSE frame, and asserts the credential appears
nowhere in what the proxy returns.

---

### OR40. No egress check runs at request time on the LLM plane or on MCP OAuth discovery, so a registered hostname can resolve to an internal address

Registration validates a URL once. The request that follows connects to whatever the hostname
resolves to at that moment. Reproduced against the worktree on 2026-09-13: an MCP OAuth discovery
fetch reached `http://169.254.169.254/latest/meta-data/`.

`api/oss/src/core/webhooks/utils.py:83` is `validate_url_format_and_literal_ip`, and its docstring
says what it does: it checks format and literal IP addresses, and defers hostname resolution to the
caller. On the LLM plane no caller performs that deferred check.
`api/oss/src/core/gateways/llms/providers/passthrough/adapter.py:151-156` builds the request against
the stored URL and sends it, with no resolved-address check and no connection pinning anywhere in
the file. MCP OAuth has the same hole on a different path:
`api/oss/src/core/gateways/mcps/oauth/client.py:124` takes a metadata URL the upstream supplies in
its `WWW-Authenticate` challenge and fetches it unguarded at `:131`. The ordinary MCP relay does this
correctly, at `api/oss/src/core/gateways/mcps/providers/http/adapter.py:110-127`: it resolves,
validates, and pins the connection to the resolved address. One boundary already exists; it is not
applied to every outbound call.

Two environment variables are easy to confuse here, and neither closes this. `AGENTA_INSECURE_EGRESS_ALLOWED`
governs the guard and defaults to true (`api/oss/src/utils/env.py:461`); that default is inherited
from `main` rather than introduced on this branch, and it means the guard is off unless a deployment
turns it on. `AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED`
(`sdks/python/agenta/sdk/agents/connections/models.py:59`, mirrored at
`services/runner/src/engines/sandbox_agent/run-plan.ts:440`) is a different control governing the SDK
and runner hop into Agenta, and has no bearing on upstream egress.

Closure: every outbound call on both planes resolves the hostname, validates the resolved address and
pins the connection, and the guard defaults to on. Proven by cases beside
`api/oss/tests/pytest/unit/gateways/test_gateways_ssrf_registration_gate.py` that drive the LLM relay
and the OAuth discovery fetch against a hostname resolving to a link-local address and assert both
refuse.

---

### OR41. The OAuth state carries the PKCE verifier in readable form, replays for an hour, and is not bound to the browser that started the flow

PKCE protects nothing on this flow, and a captured callback URL completes it. The state travels as
the `state=` query parameter, so the authorization server reads the verifier it is supposed to be
proved against. Present in the branch as of 2026-09-13.

`api/oss/src/core/gateways/mcps/oauth/state.py:19`, `:31` and `:41` put `code_verifier` into a JSON
payload that is base64url-encoded at `:48` and signed with HMAC-SHA256 at `:49-51`. A signature
authenticates; it does not conceal. `decode_state` at `:55` checks the signature at `:66` and the age
at `:75`, and never consumes the nonce minted at `:44`, so the same state replays for its full
lifetime. `api/oss/src/core/gateways/mcps/oauth/service.py:135` completes from the state alone, with
no reference to the current session, and
`api/oss/src/apis/fastapi/gateways/mcps/router.py:442` reads `project_id` and `user_id` out of that
state (`user_id` at `:465`) without comparing either to an authenticated principal. The route at
`:147-153` has no auth dependency.

Closure: the `state` parameter is an opaque single-use identifier, and a server-side authorization
attempt record holds the verifier, the session, the project, the endpoint, the issuer, the token
endpoint and the redirect URI. Proven by cases beside
`api/oss/tests/pytest/unit/gateways/` asserting that the state value contains no verifier, that a
second callback with the same state is refused, and that a callback presented under a different
session is refused.

---

### OR42. OAuth discovery trusts the server it is authenticating against, so a hostile MCP server can name its own token endpoint

A hostile MCP server can publish metadata naming its own token endpoint. Agenta then sends that
server the user's authorization code together with Agenta's registered client secret. Present in the
branch as of 2026-09-13.

`api/oss/src/core/gateways/mcps/oauth/client.py:103` takes the authorization server from the
upstream's own metadata document, and `:112-113` copies `authorization_endpoint` and `token_endpoint`
verbatim. `:156-170` accepts metadata from whichever candidate URL answers 200. No step compares the
result's origin against `server_url`, and nothing requires HTTPS; the MCP SDK types these fields as
`AnyHttpUrl`, which admits `http`. The same file reflects raw upstream response bodies into
user-visible errors at `:203` and `:277`, which turns the unguarded discovery fetch recorded in OR40
into a way to read internal responses.

Closure: discovery accepts an authorization server and token endpoint only over HTTPS and only from
the same origin as `server_url`, or from an explicitly configured issuer, and upstream response
bodies never appear in returned error text. Proven by cases beside
`api/oss/tests/pytest/unit/gateways/` that publish metadata naming a foreign token endpoint and
assert the flow refuses, and that assert an upstream error body does not appear in the message the
caller receives.

---

### OR43. Write-only OAuth secrets still return credentials from the vault

Marking an OAuth secret write-only does not withhold its credentials. `GET /vault/secrets` returns
the refresh token of a grant, and the client secret of a provider registration. Reproduced against
the worktree on 2026-09-13 with `write_only=True`.

`api/oss/src/core/secrets/redaction.py:31-39` maps exactly one primary field per secret kind, and
only that field is cleared (`:140-151`). For `oauth_grant` the mapped field is `access_token`
(`:38`), so the `refresh_token` declared at `api/oss/src/core/secrets/dtos.py:202` survives, and a
refresh token is the longer-lived credential of the two. For `oauth_provider` the mapped field is the
outer `client_secret` (`:37`), but
`api/oss/src/core/gateways/mcps/oauth/storage.py:150` writes a second copy of the whole registration,
client secret included, into `extra.client_info`. The extras scrub reads an attribute named `extras`
(`redaction.py:102`, `:153-156`) while `OAuthProviderSettingsDTO` declares the field as `extra`
(`api/oss/src/core/secrets/dtos.py:192`), so that blob is never scrubbed. One field per kind is the
wrong shape: it redacts what someone remembered rather than what is credential-bearing.

Closure: each secret kind declares an explicit public projection naming every field that may be
returned, and the duplicated client secret is not stored. Proven by a case beside
`api/oss/tests/pytest/unit/secrets/` that writes a write-only grant and a write-only provider
registration, reads both back through the vault route, and asserts no credential value appears
anywhere in either response.

---

### OR44. The model allowlist checks one field while the whole request body is forwarded

An endpoint restricted to one model routes a call to another. Reproduced against the worktree on
2026-09-13: `{"model": "gpt-4o", "models": ["forbidden-model"]}` passed an endpoint allowing only
`gpt-4o`, and OpenRouter documents `models` as fallback routing.

`api/oss/src/core/gateways/llms/service.py:502-505` is the whole allowlist check, and it reads
`context.model` and nothing else. `api/oss/src/core/gateways/llms/service.py:392-397` forwards the
original body to the adapter unchanged. Every other model-selecting field in that body therefore
travels unexamined. Exact-string matching is not the weakness; `GatewayEndpointFilter.allows`
correctly rejects case and unicode variants of a model name. The gap is the second field.

Closure: the gateway either rejects a body carrying a model-selecting field it does not check, or
checks every such field against the allowlist. Proven by a case in
`api/oss/tests/pytest/unit/gateways/test_gateways_llm_service.py` that sends an allowed `model`
beside a disallowed `models` entry and asserts the call is refused.

---

### OR45. `POST /gateways/mcps/credentials/agenta` issues a narrowed credential with no permission check

The endpoint exists to hand out a credential narrowed to a chosen set of tools. It performs no
permission check and no narrowing check, so the caller chooses the set freely. Present in the branch
as of 2026-09-13.

`api/oss/src/apis/fastapi/gateways/mcps/router.py:165` is the handler, and `:178` reads a
`gateway_run_id` claim. That claim is the only gate; unlike every other handler in the file, which
calls the permission check from `:206` onward, this one never does. `:186-193` then dumps and signs
the caller-supplied `tools` list verbatim, without comparing it against the tools the source
credential or the run actually resolved. A credential narrowed by the party being narrowed is not
narrowed.

Closure: the handler runs the same permission check as its neighbours, and the issued tool set is a
subset of the source credential's. Proven by cases in
`api/oss/tests/pytest/unit/gateways/test_gateways_mcp_router.py` asserting a caller without the
permission is refused, and that a request naming a tool outside the source credential is refused.

---

### OR46. The migration omits a secret-kind enum value the code writes, so MCP OAuth cannot complete on a migrated database

The first dynamic client registration fails at the database. Any deployment upgraded through the
migrations, which is every deployment that is not a fresh create-all, cannot finish an MCP OAuth
flow. Present in the branch as of 2026-09-13.

`api/oss/databases/postgres/migrations/core_oss/versions/oss000000030_add_gateway_endpoints.py:27`
adds one value to `secretkind_enum`, `OAUTH_GRANT`.
`api/oss/src/core/gateways/mcps/oauth/storage.py:153` writes `SecretKind.OAUTH_PROVIDER`. No
migration in the tree adds that member: the enum gains `CUSTOM_SECRET` in revision 005,
`WEBHOOK_PROVIDER` in `f0a1b2c3d4e5`, `SUBSCRIPTION_PROVIDER` in 029 and `OAUTH_GRANT` in 030, while
`SecretKind.OAUTH_PROVIDER` exists at `api/oss/src/core/secrets/enums.py:11` and the column is a real
PostgreSQL enum (`api/oss/src/dbs/postgres/secrets/dbas.py:23`). The unit suites use fake DAOs, so
nothing in them touches the enum. This gap is why so much of the OAuth path carries no evidence.

Closure: the migration adds `OAUTH_PROVIDER`, and a test writes that kind against a real database.
Proven by a case in `api/oss/tests/pytest/integration/gateways/` that stores a provider registration
through `OAuthClientStorage` on a migrated database and reads it back.

---

### OR47. The OAuth callback is rejected by the middleware before its handler runs

The browser returns from the authorization server with no Agenta cookie and receives 401. The
handler never runs. Reproduced against the worktree on 2026-09-13.

`api/oss/src/apis/fastapi/gateways/mcps/router.py:402` is `connect_callback`, and its docstring at
`:411-413` states that the route is an unauthenticated browser arrival. The public-endpoint list at
`api/oss/src/middlewares/auth.py:77-113` does not name it. It names the MCP client-metadata document
(`:111-112`) and the older tools OAuth callback (`:95-98`), so the shape was anticipated and this one
route was left out.

The exemption must not be added before OR41 is fixed. Today the handler trusts `project_id` and
`user_id` read out of the state, and exempting the route while that holds turns a signature check
into the only thing standing between an attacker and a tenant-scoped write.

Closure: the callback route is exempt from authentication and the handler derives its principal from
a server-side authorization attempt record. Proven by a case in
`api/oss/tests/pytest/unit/gateways/test_gateways_mcp_router.py` that drives the callback through the
real middleware with no cookie and asserts the handler runs.

---

### OR48. Streaming cleanup is not shielded from cancellation, so an aborted stream is never metered and its upstream connection is never closed

A caller who disconnects mid-stream leaves an open upstream connection and no usage record. Present
in the branch as of 2026-09-13.

`api/oss/src/core/gateways/llms/service.py:581-584` records usage in a bare `finally` that awaits,
and `api/oss/src/core/gateways/llms/providers/passthrough/adapter.py:216-218` closes the upstream
response the same way. Starlette cancels the task scope when the client disconnects. An `await`
inside a `finally` in a cancelled scope raises immediately, so neither the record nor the close
completes. The same shape appears at `service.py:556-565` and `adapter.py:203-204`.

Closure: both cleanup paths run under `asyncio.shield` or an equivalent, so a cancelled stream still
records and still closes. Proven by a case beside
`api/oss/tests/pytest/unit/gateways/test_gateways_llm_nonstreaming_drain.py` that cancels the
consuming task partway through a stream and asserts `policy.record` was called and the upstream
response was closed.

---

### OR49. Streamed calls record no usage, and the only consumer of usage discards it

Every streamed call meters as zero. Present in the branch as of 2026-09-13.

`api/oss/src/core/gateways/llms/providers/passthrough/adapter.py:89-92` reads usage by scanning
backwards through a capped tail of the stream (`:214`). Anthropic sends `input_tokens` in
`message_start`, at the front, so it is never in the tail. OpenAI sends streaming usage only when the
request carries `stream_options.include_usage`, which the gateway does not add, so there is nothing
to find in either position. The drain work is wasted anyway:
`api/oss/src/core/gateways/policy/audit.py` never reads `outcome.usage`, although
`api/oss/src/core/gateways/llms/service.py:531` populates it and
`api/oss/src/core/gateways/policy/dtos.py:122` declares it.

Closure: a streamed call records the same usage fields a non-streaming call records, and the audit
record carries them. Proven by cases beside `test_gateways_llm_nonstreaming_drain.py` that drive a
streamed Anthropic response and a streamed OpenAI response through the real service and assert the
recorded usage matches the upstream's own totals.

---

### OR50. The output-token ceiling is optional in practice, and the first recognised alias masks the rest

An endpoint configured with an output-token ceiling does not enforce one. Reproduced against the
worktree on 2026-09-13 under a ceiling of 10: a request supplying no maximum passed, and
`{"max_tokens": 1, "max_completion_tokens": 99999}` passed.

`api/oss/src/core/gateways/llms/service.py:516-517` returns without refusing when the parsed value is
`None`, which is the case for a request that names no maximum at all. The parser
`_requested_max_output_tokens` at `:137-148` iterates the protocol's alias tuple from `:130-134` and
returns the first integer it finds, so a small value in the first alias hides a large one in the
second. A ceiling that a request can decline by omission is not a ceiling.

Closure: the gateway writes the ceiling onto the outgoing request, covering the omitted case and
every alias for the protocol. Proven by cases in `test_gateways_llm_service.py` asserting that a
request with no maximum leaves with the ceiling set, and that a request naming two aliases leaves
with both at or below the ceiling.

---

### OR51. Saving a secret resets the endpoint's governance fields

Rotating a provider key reactivates a disabled endpoint, drops its model denylist and clears its
token ceiling. The operator receives no notice, because the action they took was saving a key.
Present in the branch as of 2026-09-13.

`api/oss/src/core/gateways/llms/registrar.py:123-132` builds an `LLMEndpointEdit` carrying freshly
mapped `data` and `flags`, and the edit is a full replace applied on every secret save at `:170-177`.
`flags` is never derived from the secret, so it arrives as the `LLMEndpointCreate` default. The MCP
side does the same thing from the browser:
`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/mcpEndpointRegistration.ts:89-102`
builds a full PUT with no `flags`, and
`api/oss/src/dbs/postgres/gateways/mcps/mappings.py:87-94` documents itself as a full PUT over the
editable surface and writes `dbe.flags = dto.flags.model_dump(...)`, where the default is
`is_active=True, is_valid=True`. Both are one defect: a field-ownership mistake. Secret
synchronisation owns credential and routing fields. Gateway policy belongs to whoever set it.

Closure: a secret save writes only credential and routing fields and leaves flags and policy
untouched. Proven by cases in
`api/oss/tests/pytest/unit/gateways/test_gateways_llm_endpoint_registrar.py` and
`web/packages/agenta-entity-ui/tests/unit/mcpEndpointRegistration.test.ts` that disable an endpoint,
save the secret, and assert it is still disabled with its denylist and ceiling intact.

---

### OR52. The registrar drops the routing fields Bedrock and Vertex need, so cloud provider configurations cannot become working endpoints

A Bedrock or Vertex provider configuration registers an endpoint that cannot route. Present in the
branch as of 2026-09-13.

`api/oss/src/core/gateways/llms/registrar.py:106-109` maps `base_url` and `api_version` only.
`LLMEndpointRoute` also carries `region` and `extras`
(`api/oss/src/core/gateways/llms/dtos.py:41-42`), and neither is populated. Bedrock routing at
`api/oss/src/core/gateways/llms/providers/passthrough/routing.py:83-90` needs one of `base_url` or
`region` and refuses when it has neither, so a configuration carrying only a region registers an
endpoint that refuses. Vertex is unconditional: `auth.py:96-102` requires `vertex_project` from
`route.extras` and refuses without it.

Closure: the registrar maps every field the routing and auth paths read, including region and the
Vertex project. Proven by cases in `test_gateways_llm_endpoint_registrar.py` that map a Bedrock
region-only configuration and a Vertex configuration and assert the resulting route builds a URL and
signs a request.

---

### OR53. A standard connection cannot be selected by slug, so explicit credential choice is lost

Naming a standard connection by slug fails to resolve, and omitting the slug lets the gateway pick a
credential on the caller's behalf. Reproduced against the worktree on 2026-09-13:
`custom/my-openai-key` was not found for a standard OpenAI connection.

The frontend preserves a standard connection's slug
(`web/packages/agenta-entities/src/secret/core/agentModelCandidates.ts:299`, carried onto the
candidate at `:319`) and the SDK sends it as `connection_slug`.
`api/oss/src/core/gateways/llms/service.py:258-270` treats any supplied slug as a custom endpoint or
a builtin, and falls back to custom; the standard path is reachable only through the `provider_key`
branch at `:271-273`. Omitting the slug is not a workaround, because
`api/oss/src/core/gateways/policy/resolution.py:103-119` then takes the first matching provider
secret with no disambiguation, so a project with two keys for one provider gets whichever comes back
first. Existing custom connections have no endpoint rows either, since the migration performs no
backfill.

Closure: a standard connection resolves by its slug, and the migration backfills endpoint rows for
existing custom connections. Proven by cases in `test_gateways_llm_service.py` asserting that a
standard connection slug resolves to its own secret, and by a migration test asserting a
pre-existing custom provider secret has an endpoint row after upgrade.

---

### OR54. MCP API-key registration has no working credential binding on either side

Registering an MCP server with an API key produces an endpoint that refuses every call. Present in
the branch as of 2026-09-13.

`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/mcpEndpointRegistration.ts:75-81`
sends `auth_mode: api_key` and no `secret_id`, and
`api/oss/src/core/gateways/mcps/service.py:696-707` raises `SecretNotFoundError` for exactly that
combination. Attaching a secret by hand does not finish the path, because
`api/oss/src/core/gateways/mcps/providers/http/adapter.py:57-72` builds the Authorization header from
an OAuth grant's `access_token` and reads nothing else, so an API-key secret produces no header.

Closure: the registration form binds a secret, and the HTTP adapter builds a header from an API-key
secret as well as from an OAuth grant. Proven by a case in
`web/packages/agenta-entity-ui/tests/unit/mcpEndpointRegistration.test.ts` asserting the payload
carries a `secret_id`, and a case beside
`api/oss/tests/pytest/unit/gateways/` asserting an API-key endpoint relays with the expected header.

---

### OR55. Stored refresh tokens are never used, so an endpoint reports READY while every call fails

An MCP OAuth endpoint works until its access token expires, then returns 401 on every call while
still reporting READY. Present in the branch as of 2026-09-13.

`api/oss/src/core/gateways/mcps/providers/http/adapter.py:67` uses the stored access token, and no
refresh grant is executed anywhere in the tree. The only grant type ever posted is
`authorization_code`, at `api/oss/src/core/gateways/mcps/oauth/client.py:251`. `refresh_token`
appears as an advertised registration capability (`oauth/client.py:185`,
`oauth/registration.py:28`) and as stored material (`oauth/storage.py:77`, `:93`), and nowhere as an
exchange.

Closure: the adapter refreshes an expired grant and stores the new tokens, and an endpoint whose
refresh fails reports that it needs authorization. Proven by a case beside
`api/oss/tests/pytest/unit/gateways/` that presents an expired grant, asserts a refresh exchange is
performed, and asserts the call succeeds with the refreshed token.

---

### OR56. Three components disagree about which MCP method performs discovery

A server that answers one component's discovery call refuses another's. Reproduced against the
worktree on 2026-09-13: the builtin adapter rejected `server/discover`.

`services/runner/src/extensions/pi-mcp.ts:167` sends `server/discover`.
`services/runner/src/engines/sandbox_agent/mcp-handshake.ts:171` sends `initialize`.
`api/oss/src/core/gateways/mcps/providers/agenta/adapter.py:46` handles `tools/list` and `:59-60`
refuses anything that is not `tools/call`, with the message "Agenta MCP supports only tools/list and
tools/call". Three components, three vocabularies, one protocol.

Closure: every component performs discovery with the same method, and the builtin adapter answers
it. Proven by a case beside
`api/oss/tests/pytest/unit/gateways/test_mock_mcp_adapter.py` and a runner case in
`services/runner/tests/unit/` asserting the runner's discovery call and the adapter's accepted
method are the same string.

---

### OR57. A mock endpoint is callable with the mock flag off

`AGENTA_GATEWAYS_MOCKS_ENABLED` does not prevent a mock upstream from serving traffic. Reproduced
against the worktree on 2026-09-13: a custom LLM endpoint declaring the mock deployment kind returned
200 with the flag false.

`LLMEndpointCreate` accepts `deployment_kind` as an unvalidated enum
(`api/oss/src/core/gateways/llms/dtos.py:78`, member at `:34`), and
`api/entrypoints/routers.py:1183` registers `MockLLMAdapter` unconditionally, unlike Composio at
`:1202-1211`, which is gated. Dispatch selects the adapter from the persisted deployment kind, so it
never consults the flag. The flag gates the catalogue
(`api/oss/src/core/gateways/llms/catalog.py:35`, `:90`) and the compose services, and neither sits on
this path. The MCP builtin route is closed by a different mechanism: `_mock_endpoints` returns an
empty list with the flag off (`api/oss/src/core/gateways/mcps/service.py:283`), so an unlisted mock
slug raises `MCPEndpointNotFoundError`. That leaves the MCP adapters registered but unreachable, and
the LLM mock reachable.

Closure: the mock adapters are registered only when the flag is set, and an endpoint declaring a mock
deployment kind is refused with the flag off. Proven by a case in
`api/oss/tests/pytest/unit/gateways/test_gateways_llm_service.py` that creates such an endpoint with
the flag false and asserts the call is refused.

---

### OR58. Brokered builtin MCP endpoints carry no tool allowlist, so any member can call any tool

Any workspace member holding `USE_MCP_ENDPOINTS` can call any tool on a brokered connection. Present
in the branch as of 2026-09-13.

`api/oss/src/core/gateways/mcps/service.py:316-337` builds a builtin endpoint with a route and
nothing else, so `tools` takes the `MCPToolFilter()` default
(`api/oss/src/core/gateways/mcps/dtos.py:58`) with `allowlist=None`.
`GatewayEndpointFilter.allows` at `api/oss/src/core/gateways/dtos.py:69-70` reads `None` as allow-all.
A brokered endpoint is one Agenta holds credentials for on a tenant's behalf, so allow-all is the
wrong default there specifically.

Closure: a brokered endpoint is built with an explicit allowlist, and an empty allowlist denies.
Proven by a case in `api/oss/tests/pytest/unit/gateways/` asserting a brokered builtin endpoint
refuses a tool it was not granted.

---

### OR59. MCP tool registration collides from the second turn of a session, and the tools disappear

A pooled session's second turn runs without the MCP tools its first turn had. Nothing reports it.
Present in the branch as of 2026-09-13.

`services/runner/src/extensions/agenta.ts:471-473` re-registers the gateway MCP tools on every
`before_agent_start`. `services/runner/src/extensions/pi-mcp.ts:231` seeds the registered-name set
from `pi.getAllTools?.()`, which on a warm session already holds the tools from the previous turn, so
`:254` throws `MCP tool name collision`. The per-tool catch at `:236-249` logs and continues, so each
tool is skipped in turn and the run proceeds with none of them.

Closure: re-registration on a warm session is a no-op rather than a collision, and a genuine
collision is reported to the caller. Proven by a case in
`services/runner/tests/unit/pi-gateway-mcp.test.ts` that drives two turns on one session and asserts
the second turn still has the tools.

---

### OR60. The caller's model string is interpolated into cloud URL paths unescaped

On an endpoint with an unrestricted allowlist, a model value such as `x/../..` reaches arbitrary
paths under the organisation's cloud credentials. Present in the branch as of 2026-09-13.

`api/oss/src/core/gateways/llms/providers/passthrough/routing.py:66` interpolates `route.model` into
the Azure path, and `:142` interpolates it into the Vertex path as
`…/models/{route.model}:{action}`. Neither escapes it, and neither restricts its characters. The
Vertex prefix at `:105-106` interpolates `region` and `vertex_project` the same way.

Closure: a model value is admitted only if it matches a strict character class, and path segments are
escaped. Proven by a case in
`api/oss/tests/pytest/unit/gateways/test_gateways_llm_deployment_base_urls.py` asserting a model
containing a path separator or a dot segment is refused, on Azure and on Vertex.

---

### OR61. The OAuth registration write races, so concurrent callbacks hit an unhandled unique violation

Two authorization flows completing at once against the same server produce an unhandled database
error. Present in the branch as of 2026-09-13.

`api/oss/src/core/gateways/mcps/oauth/storage.py:102` reads an existing grant before creating one,
and the slug it creates under is deterministic: `uuid5(NAMESPACE_URL, server_url)` at `:25-26`. Two
callers who both read nothing both create the same slug, and the second violates the unique
constraint. The provider path has the same shape at `:157` and `:169`.

Closure: the write is an upsert, or the unique violation is caught and retried as a read. Proven by a
case in `api/oss/tests/pytest/integration/gateways/` that runs two concurrent registrations for one
server URL against a real database and asserts both callers end with one stored registration.

---

### OR62. The schema does not constrain an endpoint's secret to the endpoint's project, so tenancy rests on one query filter

An endpoint row can be written referencing a secret that belongs to another project. Present in the
branch as of 2026-09-13.

The foreign key covers `secret_id` alone, at `api/oss/src/dbs/postgres/gateways/llms/dbes.py:20` and
`api/oss/src/dbs/postgres/gateways/mcps/dbes.py:20`, and in the migration at
`api/oss/databases/postgres/migrations/core_oss/versions/oss000000030_add_gateway_endpoints.py:74-78`
and `:137-141`. The primary key beside it is composite, `(project_id, id)`, so the schema already
knows the tenancy shape and does not apply it here.

Resolution does check ownership, which is why this is a hardening defect rather than a leak.
`_resolve_bound_secret` at `api/oss/src/core/gateways/policy/resolution.py:63-70` passes
`project_id` into `vault_service.get_secret_by_id`, and `SecretsDAO.get_by_id`
(`api/oss/src/dbs/postgres/secrets/dao.py:88-93`) filters on the id plus the project scope, so a
cross-project reference resolves to nothing rather than to the other project's secret. Route
authorization is sound on the same terms: every gateway DAO query filters on `project_id` plus id or
slug (`api/oss/src/dbs/postgres/gateways/llms/dao.py:91-92` and
`api/oss/src/dbs/postgres/gateways/mcps/dao.py:93-94` among others), so a guessed slug or UUID
returns 404. What remains is that the whole guarantee rests on one filter in one code path, with no
schema backstop, and an endpoint may hold a reference that is silently dead.

Closure: the foreign key is composite on `(project_id, secret_id)`, or endpoint writes reject a
`secret_id` the project does not own. Proven by a case in
`api/oss/tests/pytest/integration/gateways/test_gateways_llm_endpoints_dao.py` that writes an
endpoint referencing another project's secret and asserts the write is refused.

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

### OR64. `providers/passthrough` does not pass anything through, and the egress boundary is duplicated instead of shared

The names in this layer describe neither what the code does nor where the shared logic is. Present in
the branch as of 2026-09-13.

`api/oss/src/core/gateways/llms/providers/passthrough/` selects cloud routes
(`routing.py`), mints Vertex credentials (`auth.py`) and rewrites request bodies
(`adapter.py:137-141`). `upstreams/http`, or `relay` with explicit per-provider strategies, describes
that. `api/oss/src/core/gateways/policy/resolution.py` resolves vault credentials rather than
applying policy, while the allowlists and ceilings that are policy live in the protocol services
(`api/oss/src/core/gateways/llms/service.py:502`, `:516`). The split between `llms/` and `mcps/` is
right, and it is not what is duplicated. What is duplicated is the outbound egress boundary: URL
validation, connection pinning, header isolation and credential-safe responses each exist once per
plane, or once and not at all, which is the shape behind OR36, OR39 and OR40.

Closure: the outbound boundary lives in one shared module both planes call, and the layer names match
what the modules do. Proven by the OR36, OR39 and OR40 cases passing against both planes through that
one module.

---

### OR65. The test suites replace the boundaries where the guarantees actually fail

The suites are green, and they cannot see any of the defects above. Present in the branch as of
2026-09-13.

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

## Closed review record

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

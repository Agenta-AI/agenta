# Review findings

## Active review findings

---

## Closed review record

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

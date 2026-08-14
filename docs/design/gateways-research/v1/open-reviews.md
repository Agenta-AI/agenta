# Open reviews

Things to check against the code when the ports are implemented. Each is a claim to verify
or a seam to inspect, not a decision. Close an entry by recording what was found.

---

## Ports to define

### OR1. `TokenStorage` — delegate to the secrets service

The official MCP Python SDK defines a `TokenStorage` protocol and its `OAuthClientProvider`
handles everything above it. **Implement the protocol as a thin adapter over the secrets
service; do not write an OAuth client and do not add a second place secrets live.**

Verify the adapter stores only a `secret_id` on the gateway's own rows and resolves through
`get_secret_by_id`, matching the webhook dispatcher and SSO provider precedent, and that no
gateway response can serialize the secret **material**. The id itself is a handle and does
travel in responses — see `secrets.md` for why withholding it would break full-PUT edits.

To verify at implementation time:

- The protocol's exact method set and value types in the pinned SDK version.
- That `OAuthClientProvider` accepts our storage implementation unchanged.
- That the `redirect_handler` and `callback_handler` hooks can be wired to the dashboard
  connect flow rather than to a local browser opener, which is the shape the SDK's examples
  assume.
- Whether `client_metadata_url` (the Client ID Metadata Document path) works against the
  authorization servers we care about, and what the fallback to dynamic registration costs.

### OR2. Secret lookup signature

The lookup must take the owner as a parameter from the start even while the only answer is
the project (`secrets.md`). Review that no call site hardcodes the project, and that
the owner resolves from `AuthScope` rather than being passed separately.

### OR3. Model routing extraction

The model-routing logic to move behind the gateway is the provider-settings builder in the
SDK's secrets manager, not the callback handler in the SDK's model folder — the folder name
is misleading. Confirmed against the code.

**There are two copies of the builder**, differing only in which execution context they read
secrets from: the older routing context and the newer workflow context. The workflow copy is the
one both production chat call sites use. An extraction taking only one leaves a live second
implementation behind, so review that it takes both, plus the call, and leaves the observability
callback where it is.

---

## Seams to inspect

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

### OR5. `project_id`-only DAO signatures

Every connections DAO verb is keyed by project. Review each against OD2's outcome before
adding a user dimension, and check whether `create_connection`'s `user_id` parameter is
authorship only, as it currently appears to be.

### OR6. Wire secret arrays

If the gateway holds all upstream secrets, the runner wire's per-server secret
arrays and the model secret array should collapse to a single gateway token. Review
what still populates them, and whether the `local_use` secret category can be removed
outright once cloud-reseller signing moves to the gateway.

### OR7. Redaction deny-set

The per-run deny-set is built from every secret value on the wire. Once those collapse
to one short-lived token, review whether the deny-set construction still earns its
complexity.

### OR8. Provider enum coupling — enumerated

Verified, and there are more than the three previously flagged. Widen them together rather than
piecemeal; the full set, all in the Python SDK unless noted:

- The static model catalogue itself, eleven providers each with a model list, plus the flat
  model-to-provider map derived from it, plus the per-model cost table derived from that.
- Two secret-kind enums naming providers: one for standard providers, one for custom ones, which
  additionally carries the reseller deployment kinds.
- In the harness capability table: the set of providers reachable with a vault key, the
  subscription-authenticated set, per-harness model alias lists, and a per-harness map of which
  provider family that harness's OpenAI-compatible deployment accepts. **That last one is the
  table a gateway route has to satisfy.**
- The canonical provider-to-environment-variable map, which the runner **mirrors by hand** in
  TypeScript for its clear-then-apply step. Two copies that must agree.
- A hard-coded provider-to-base-URL map used when no custom endpoint is supplied.
- A provider-kind alias map fixing one vendor spelling.

Two of these are worth separating from the rest: the environment-variable map is duplicated
across languages, and the harness deployment map is the one the gateway must satisfy rather than
merely widen.

---

## Claims to re-verify

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

### OR14. The secrets read surface — close it once nothing needs it

The secrets read route returns plaintext material to any caller holding the view permission,
and the agent path resolves straight through it.

**This is an outcome, not a prerequisite.** Callers read that route because it is how they get
a provider key at all, so it cannot be restricted while they still depend on it. Once
everything goes through the gateway, nothing needs it — and that is the moment to close it.

Track it as the last review of the conversion, not the first. Parallel bring-your-own-secrets
work wants the same outcome, so coordinate on who closes it.

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

### OR15. The audit pipeline is lossy, and compliance is not — NOT GATEWAYS SCOPE

**Ruled out of this workstream.** The drop behaviour is the events domain's existing posture and
predates the gateways; WP4 emits onto it rather than changing it. If a compliance-grade class of
event is wanted, that is a change the events domain owns, raised there and not here.

The original finding, for the record:

Found while writing `entities.md`. The events stream the audit record rides (D22) **drops writes**
under a Redis outage and under its own first-layer quota, and its publish helper swallows
failures rather than surfacing them. That is a reasonable posture for telemetry and the wrong one
for a compliance record, which `policy.md` requires to be non-lossy.

**D22 stands** — one pipeline, no second audit table. This is a durability gap in the events
domain, not an argument for routing around it, and D12 is explicit that if the gateway needs
something the shared mechanism does not offer, the mechanism grows it.

Review at the point the audit record ships: what the drop rate actually is, whether a
compliance-grade class of event can be marked non-droppable within the existing stream, and who
owns that change. Coordinate with the events domain rather than solving it inside a gateway.

### OR10. Subscription-authenticated harnesses

A harness that authenticates with its own login injects no secret today. Verify what it
does when pointed at a gateway, and whether it must stay an exception to the transit rule.

### OR11. Existing policy checks on model calls

Establish what policy, if any, runs on each current model call site. This is the baseline
the gateway has to at least preserve.

### OR12. MCP SDK is not a direct dependency — CONFIRMED, with a wrinkle

Neither the runner nor any Python project declares an MCP SDK. Verified: no
`@modelcontextprotocol/*` entry in the runner's package manifest, and no `mcp` package in any of
the four Python lock files.

**The wrinkle: it is already resolved transitively and deliberately not used.** The runner's lock
file pins the official TypeScript SDK, but only underneath the harness adapter packages. The
runner's own internal MCP server — the loopback channel that delivers first-party tools to a
harness — **hand-rolls the JSON-RPC framing rather than importing it**, with a comment saying to
pin against whatever version the installed harness bundles if the framing drifts.

So adding an SDK is still a new dependency decision, and there is now a second question beside
version pinning: whether the gateway's own MCP surface follows the hand-rolled precedent or
breaks with it.

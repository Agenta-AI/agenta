# Open reviews

Things to check against the code when the ports are implemented. Each is a claim to verify
or a seam to inspect, not a decision. Close an entry by recording what was found.

---

## Ports to define

### OR1. `TokenStorage` — delegate to the secrets service

The official MCP Python SDK defines a `TokenStorage` protocol and its `OAuthClientProvider`
handles everything above it. **Implement the protocol as a thin adapter over the secrets
service; do not write an OAuth client and do not add a second place credentials live.**

Verify the adapter stores only a `secret_id` on the gateway's own rows and resolves through
`get_secret_by_id`, matching the webhook dispatcher and SSO provider precedent, and that no
gateway response can serialize the secret or its id.

To verify at implementation time:

- The protocol's exact method set and value types in the pinned SDK version.
- That `OAuthClientProvider` accepts our storage implementation unchanged.
- That the `redirect_handler` and `callback_handler` hooks can be wired to the dashboard
  connect flow rather than to a local browser opener, which is the shape the SDK's examples
  assume.
- Whether `client_metadata_url` (the Client ID Metadata Document path) works against the
  authorization servers we care about, and what the fallback to dynamic registration costs.

### OR2. Credential lookup signature

The lookup must take the owner as a parameter from the start even while the only answer is
the project (`secrets.md`). Review that no call site hardcodes the project, and that
the owner resolves from `AuthScope` rather than being passed separately.

### OR3. Model routing extraction

The model-routing logic to move behind the gateway is the provider-settings builder in the
SDK's secrets manager, not the callback handler in the SDK's model folder — the folder name
is misleading. Review that the extraction takes the builder plus the call, and leaves the
observability callback where it is.

---

## Seams to inspect

### OR4. Three duplicated auth-scheme enums

The same `oauth | api_key` enum exists as a connection, a tool, and a trigger variant. When
the gateway lands, review whether they collapse to one shared definition or whether the
duplication is load-bearing for domain independence.

### OR5. `project_id`-only DAO signatures

Every connections DAO verb is keyed by project. Review each against OD2's outcome before
adding a user dimension, and check whether `create_connection`'s `user_id` parameter is
authorship only, as it currently appears to be.

### OR6. Wire credential arrays

If the gateway holds all upstream credentials, the runner wire's per-server credential
arrays and the model credential array should collapse to a single gateway token. Review
what still populates them, and whether the `local_use` credential category can be removed
outright once cloud-reseller signing moves to the gateway.

### OR7. Redaction deny-set

The per-run deny-set is built from every credential value on the wire. Once those collapse
to one short-lived token, review whether the deny-set construction still earns its
complexity.

### OR8. Provider enum coupling

Prior research flagged several hard-coded provider couplings — a default provider value on
the tool config, a provider enum, a resolver allow-list that rejects unknown providers.
Verify each still exists and widen them together rather than piecemeal.

---

## Claims to re-verify

### OR9. Model call sites — CLOSED

Counted. Four paths, not two. See `raw/model-call-sites.md`.

Three sit in one SDK file: one chat call through the router, and two embeddings calls that
use the OpenAI client directly. The fourth is the harness inside the sandbox. **The API calls
no models at all**, and the runner only picks and checks a model id.

Two consequences carried into the design: the north port needs an embeddings route, and the
`llm_v0` handler's module-level key assignment must not reach a shared process. See OR13.

### OR13. The global key assignment — do this first

The `llm_v0` handler sets the provider key on **module-level attributes of the router
library** before it calls. That is process-wide state.

One tenant per workflow process makes it survivable today. A shared gateway process makes it
a **cross-tenant credential leak**: one caller's key stays set and serves the next caller.

Convert it to per-call arguments before or during the move. The provider-settings builder
already produces the correct shape, so the correct pattern exists in the same codebase.

Review that no other code assigns to the library's module attributes.

### OR10. Subscription-authenticated harnesses

A harness that authenticates with its own login injects no credential today. Verify what it
does when pointed at a gateway, and whether it must stay an exception to the transit rule.

### OR11. Existing policy checks on model calls

Establish what policy, if any, runs on each current model call site. This is the baseline
the gateway has to at least preserve.

### OR12. MCP SDK is not currently a dependency

Neither the runner nor the Python projects declare an MCP SDK directly. Adding one is a new
dependency decision, not an upgrade — review version pinning and the transitive situation in
the runner before assuming it is already available.

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

### OR14. The secrets read surface — close it once nothing needs it

The secrets read route returns plaintext material to any caller holding the view permission,
and the agent path resolves straight through it.

**This is an outcome, not a prerequisite.** Callers read that route because it is how they get
a provider key at all, so it cannot be restricted while they still depend on it. Once
everything goes through the gateway, nothing needs it — and that is the moment to close it.

Track it as the last review of the conversion, not the first. Parallel bring-your-own-secrets
work wants the same outcome, so coordinate on who closes it.

### OR13. Module-level provider keys — an outcome of the conversion

One handler sets provider keys on module-level attributes of the routing library, which is
process-wide state and would be a cross-tenant leak in a shared process.

**Not a prerequisite either.** That pattern exists because nothing hands the handler a resolved
connection; proper injection through the gateway is what removes it. The handler is also
reported unused and likely to be dropped, which may close this without any work.

Review at conversion time that nothing assigns to the library's module attributes, rather than
scheduling a fix ahead of the gateway.

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

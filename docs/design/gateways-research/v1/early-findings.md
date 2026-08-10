# Early findings

What is true in the tree today. Findings marked **(carried)** come from the prior
tool-gateway research and have not been re-verified here; everything else was read
directly in this branch's base.

## 1. The headline: both gateways are already expressible on the wire

The runner's `/run` contract models the two outbound consumers as parallel shapes — a
route, typed credentials, and a policy — and both can already point at a gateway without a
new field.

**Tool side.** `McpServerConfig.connection` is `{ type: "http", url, headers?,
credentials? }`, where every secret header is a typed `McpCredential` with
`usage: "opaque_http"`. The protocol's own commentary states that a gateway MCP server is
"the same shape too: it is an HTTP MCP server whose URL happens to be ours," and that
OAuth, when it lands, changes only who mints the token — not the wire.

**Model side.** `ModelConnection` carries `provider`, `deployment`, `endpoint.baseUrl`,
`credentialMode`, and typed `credentials`. `deployment: "custom"` is documented as "an
OpenAI-compatible third party such as OpenRouter **or a self-hosted gateway**," with the
route in `endpoint.baseUrl`.

So pointing a run at either gateway is, on the wire, a resolver change: emit our URL and
our token instead of the provider's URL and the provider's key. **The wire is not the
work.** This is the single most important finding for sequencing — it means the gateways
can be adopted per-run and rolled back per-run, without a contract migration, and without
touching the golden fixtures that pin the contract on both sides.

## 2. What the gateway actually removes

The current design has already pushed credential-hiding as far as the shape allows, and
the residue is exactly what a gateway deletes.

`ModelCredential.usage` has two values, and the split is about the **consumer**, not the
provider:

- `opaque_http` — a bearer token only the provider's server reads, over HTTPS, at a known
  host. On a remote sandbox it is replaced with a placeholder and substituted into the
  outbound request by the egress proxy, so an agent that dumps its own environment gets
  nothing useful.
- `local_use` — a secret consumed by a provider SDK **inside** the sandbox, which signs
  requests locally rather than transmitting the secret. Cloud-reseller access keys are the
  reason this exists: signing is local, so outbound substitution cannot work and **the
  sandbox must hold the real value**. The names allowed to claim it are kept to a short
  explicit allowlist precisely because this door loses the hiding.

Behind a gateway, signing happens at the gateway. `local_use` has no reason to exist for
gateway-routed runs — the escape hatch that currently forces real long-lived cloud
credentials into an agent-controlled sandbox closes. That is a security outcome, not a
refactor.

The same logic applies to the per-run redaction deny-set, which today is built from every
credential-bearing value across both consumers. Behind a gateway the run holds one
short-lived token, so the deny-set collapses to one entry with a lifetime measured in the
length of a run.

## 3. Where credentials live today

Two stores, two paths, and they are not the same path.

**Vault / secrets** (`api/oss/src/core/secrets/`, exposed under `api/oss/src/apis/fastapi/vault/`)
holds five kinds: `provider_key`, `custom_provider`, `sso_provider`, `webhook_provider`,
`custom_secret`. Model providers are enumerated in two flavours — a `StandardProviderKind`
list of direct providers, and a `CustomProviderKind` list that additionally covers the
cloud resellers and self-hosted deployments. **This enum pair is the closest thing to an
existing model-routing table, and it is already the right axis** (`provider` = who issued
the credential, `deployment` = how it is reached) — the same axis the wire uses.

**Gateway connections** (`api/oss/src/core/gateway/connections/`) holds third-party tool
authorizations as a local row referencing a provider-side connection id; tokens themselves
are not stored locally **(carried)**.

The consequence: the model plane and the tool plane already have *different* credential
stores with *different* scoping models. Unifying the policy plane means reconciling them,
which is a real decision rather than a detail — see `decisions.md`.

## 4. The ports that already exist

The tool side is a working ports-and-adapters implementation, and its shape is the
precedent the model side lacks:

| Domain | Path | Port |
|---|---|---|
| Catalog | `api/oss/src/core/gateway/catalog/` | browse providers/integrations |
| Connections | `api/oss/src/core/gateway/connections/` | authorization lifecycle |
| Tools | `api/oss/src/core/tools/` | list / get / execute |
| Triggers | `api/oss/src/core/triggers/` | subscription lifecycle |

Each carries `interfaces.py`, a `registry.py`, a `service.py`, and per-provider adapters.
A first-party provider already exists alongside the third-party one under
`core/tools/providers/agenta/`, which establishes that the registry is genuinely
multi-provider rather than a single-adapter abstraction wearing a port.

**There is no equivalent for models.** There is no `core/models/` port, no registry, no
adapter set — the model path resolves credentials from the vault and hands them out. This
asymmetry is the substance of the LLM-gateway work: the tool plane has the architecture and
needs a gateway backend; the model plane needs the architecture first.

## 5. Model calls have at least two distinct callers

These are separate callers that must be designed separately, not one path with variants.

- **Agent runs** resolve a `ModelConnection` and inject it into the sandbox, where the
  harness reads a provider key from an environment variable because that is what the
  underlying agent SDKs expect.
- **Workflows** go through the SDK's own model layer (`sdks/python/agenta/sdk/litellm/`),
  which resolves secrets via `sdks/python/agenta/sdk/managers/secrets.py` and calls the
  provider from the workflow process.

They differ in who resolves the credential, where the call originates, and what the
failure modes are. Both go through the gateway, each behind its own port, and the SDK
keeps the secret-fetch and secret-injection capabilities it has today — what changes is
that the adapter behind those capabilities calls the gateway instead of a provider.

This list is not proven exhaustive. Establishing the full set of model call sites is a
prerequisite for sizing the work, and it is in the verification backlog.

## 6. Identity is already user-scoped, and the gateway inherits it

Every authenticated call into the platform already resolves a four-part identity. The auth
middleware (`api/oss/src/middlewares/auth.py`) builds an `AuthContext` containing an
`AuthScope` of `organization_id`, `workspace_id`, `project_id`, and `user_id`. All four are
required: if any is missing the request is treated as unauthenticated rather than
half-populated. API keys are no exception — the key row carries the owning user, so
key-authenticated calls resolve to a user like any other.

**So the principal already exists, it is already user-scoped, and the gateway does not need
to invent one.** A call arriving at either gateway carries the same `AuthScope` that every
other call into the platform carries. Audit records, policy inputs, and metering dimensions
all key off it.

This is distinct from — and should not be confused with — how a *third-party* connection is
scoped upstream at the provider. Who is calling us is answered by `AuthScope`. Which stored
credential the gateway then uses on the caller's behalf is a separate binding, and the two
were previously conflated. They are independent: the caller is always a user, regardless of
whether the credential the gateway selects is shared across a project.

## 7. What already exists that the gateway should not rebuild

- **Approval / human-in-the-loop.** Tool configs already carry a `needs_approval` axis, and
  the runner already has the interaction machinery to pause a call for sign-off. Most
  open-source MCP gateways lack this **(carried)**; it is an asset, not a gap.
- **Per-tool allowlists.** `McpServerConfig.policy.tools` is already `all | include` with
  names — a tool-level filter on the wire, which is the multi-tenancy lever a gateway needs.
- **Egress policy.** Sandbox network policy is already declared and enforced on the remote
  provider as allow / block / CIDR allowlist. A gateway makes this dramatically more useful:
  once model and tool traffic both go to one host, an allowlist of *one* becomes a coherent
  posture rather than an unmanageable list of provider endpoints.
- **Tracing and metering.** Ingestion and the meter/entitlement layers exist. The gateway
  should emit into them, not beside them.

## 8. Consequences for the design

1. **For the runner caller specifically, adoption is cheap.** The wire already expresses a
   gateway route, so that caller changes on the resolver side only — the contract, the
   golden fixtures, and the harnesses are untouched. This is the exception, not the rule.
2. **Every other caller is a real change.** Each place that resolves a credential and calls
   a provider becomes a place that calls the gateway, behind its own port. The count of
   those call sites, not the wire, is the size of this work.
3. **The model plane needs the port structure the tool plane already has.** The tool plane
   has registries, interfaces, and multiple providers; the model plane has none of it. This
   is architecture work, and it is the larger half.
4. **Identity is not a blocker.** `AuthScope` already gives both gateways a user-scoped
   principal on every call. Audit, policy, and metering can be shaped against it now.
5. **The credential the gateway uses is a separate question from who is calling.** Keeping
   these apart is what makes per-user attribution cheap and per-user credentials optional.
6. **The strongest concrete security outcome is narrow:** gateway-routed runs stop putting
   long-lived cloud credentials inside agent-controlled sandboxes, because signing moves to
   the gateway.

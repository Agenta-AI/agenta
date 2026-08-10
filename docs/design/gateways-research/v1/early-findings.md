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

## 5. Two model paths, not one

A gateway that covers only the harness path leaves a hole.

- **Harness runs** resolve a `ModelConnection` and inject it into the sandbox, where the
  harness reads a provider key from an environment variable because that is what the
  underlying agent SDKs expect.
- **Workflow/playground runs** go through the SDK's own model layer
  (`sdks/python/agenta/sdk/litellm/`), which resolves secrets via
  `sdks/python/agenta/sdk/managers/secrets.py` and calls the provider from **inside the
  workflow process**.

These are independent today. If the gateway governs only the first, the second remains an
ungoverned egress path with direct vault access — and it is the path most user traffic
takes. Any claim of "all model calls transit the gateway" has to account for it.

## 6. The identity gap

Tool connections are **project-scoped, not per-user**: every member of a project shares one
authorization **(carried)**. The wire reinforces this — a run names its connection by a
portable slug, and the slug identifies a connection, not a person.

A gateway whose finest-grained principal is the project cannot answer "who called this,"
which is the first question governance, authorization, and compliance all ask. **This is a
prerequisite, not a follow-up**: the audit record's shape, the policy evaluation's inputs,
and the metering dimension all depend on what a principal is. Deciding it late means
rewriting all three.

The pieces to build it from exist — RBAC enforcement, a two-layer entitlement check, and a
tracing pipeline that already carries run context — but they have not been composed into a
single principal that both planes evaluate against.

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

1. Adopting either gateway is a **resolver-side** change plus a new service. The wire, the
   golden fixtures, and the harnesses are unaffected.
2. The model plane needs the port structure the tool plane already has — this is the larger
   half of the work, and it is architecture rather than integration.
3. The principal question must be settled before the audit, policy, and metering shapes.
4. "All model calls transit the gateway" requires the workflow path too, which is a second
   integration against the same gateway.
5. The strongest near-term security argument is narrow and concrete: gateway-routed runs
   stop putting long-lived cloud credentials inside agent-controlled sandboxes.

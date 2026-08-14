# Gateways: entities

The data model and its full stack, following the codebase's existing layering.
Column lists are the proposal, not migrations.

The gateways have no sibling domain to mirror, and — despite the name — the existing
`core/gateway/` is not it. That domain is an integrations surface ("connect my project to
GitHub"); this one is traffic transiting a boundary. §1 makes the argument. The gateways
are therefore a **new domain**, one parent holding both planes and their shared core,
which is D7 expressed as a directory: one system, two protocol surfaces, one policy core.

Three layout decisions are made here and argued in §1: the planes live under a new
plural parent `core/gateways/`, a **sibling** to the existing singular `core/gateway/`,
not inside it; the data plane and the management CRUD are **separate router objects** in
one API folder per plane; and the model plane's folder is named `llms/`, not `models/`.

```text
core/gateways/        <- NEW parent, sibling to the existing core/gateway/ (§1)
  dtos.py             our shared vocabulary — auth scheme, connection state,
                      connect affordance, endpoint config (§4)
  types.py            GatewaysError, the base exception
  policy/             the shared core both planes evaluate against (D7, D12)
    dtos.py           principal-adjacent DTOs: decision, target, outcome, secret triple
    types.py          policy + resolution exceptions
    interfaces.py     SecretsResolverInterface — the one lookup, owner-first (D10)
    resolution.py     the resolve() implementation over VaultService (WP2)
    service.py        GatewayPolicyService: authorize, audit, usage (WP3, WP4)
    audit.py          EventType members + attribute builders for the events stream (D22)
  llms/               the model plane (WP1, WP6, WP7)
    dtos.py           enums + core DTOs
    types.py          domain exceptions
    interfaces.py     LLMEndpointsDAOInterface + LLMUpstreamInterface (south port)
    registry.py       adapter key -> LLMUpstreamInterface
    catalog.py        the standard set, generated from the SDK's static provider
                      map and its direct base URLs (D20, D30)
    service.py        LLMGatewayService: management + the data-plane relay
    providers/
      passthrough/adapter.py   OpenAI-compatible upstreams, byte-for-byte relay
      translated/adapter.py    the routing library in-process: shape + reseller signing
      mock/adapter.py          the mock LLM endpoint (D23, WP5)
  mcps/               the tool plane (WP1, WP8, WP9)
    dtos.py
    types.py
    interfaces.py     MCPEndpointsDAOInterface + MCPUpstreamInterface
    registry.py       upstream kind -> MCPUpstreamInterface
    token_storage.py  the MCP SDK's TokenStorage protocol over the vault (WP17, OR1)
    service.py        MCPGatewayService: management + the transparent proxy
    providers/
      http/adapter.py          remote Streamable HTTP servers (custom)
      composio/adapter.py      the builtin/composio relay — reuses the brokered connection (D30)
      mock/adapter.py          the mock MCP server (D23, WP5)
dbs/postgres/gateways/
  llms/               dbas.py, dbes.py, dao.py, mappings.py
  mcps/               dbas.py, dbes.py, dao.py, mappings.py
apis/fastapi/gateways/
  exceptions.py       handle_gateway_exceptions(), written once (§9)
  llms/               models.py, router.py (management CRUD), proxy.py (OpenAI surface),
                      utils.py (call-context parsing off the body)
  mcps/               models.py, router.py (management CRUD), proxy.py (MCP surface),
                      utils.py (protocol header parsing)
```

The existing `core/gateway/`, `dbs/postgres/gateway/` and their tables are untouched in
this scope — including `gateway_connections`, whose ownership work is designed, not
scheduled (`secrets.md`).

Changed in place, in later work packages: `core/secrets/` gains the two OAuth kinds
(enum member, settings DTO pair, union arm, validator branch — WP16, §4);
`core/events/types.py` gains two `EventType` members (WP4, §4);
`core/access/permissions/types.py` gains six `Permission` members (§9).

Not shown: the deployable mocks. The adapter-level mocks above satisfy unit and contract
tests; Checkpoint A's acceptance tests additionally need the mocks running as compose
services in the local stack (`plan.md` WP5). Those are services, not entities, and are out
of this document's scope.

---

## 1. The tables

Two new, two reused, one deliberately left alone.

| table | what it is | what it is not |
| --- | --- | --- |
| `llms_endpoints` | one **custom** LLM endpoint: a reachable provider deployment, its route, its model allowlist, its configuration | not a model, and not the catalogue — standard endpoints are generated, never stored (D20, D30) |
| `mcps_endpoints` | one **custom** MCP server: its URL, auth mode, tool policy, configuration, and — when OAuth-protected — the `secret_id` pointing at its tokens | not a catalog of tools — the server owns its tool list (D19); not a token store — the `oauth_grant` secret is (D3, D14) |
| `secrets` *(reused)* | gains two kinds, `oauth_provider` and `oauth_grant`; the payload is one encrypted blob, so **no schema change** | not gaining an owner column — every gateway secret is project-owned, full stop (`out-of-scope.md`) |
| events stream *(reused)* | one audit record per call, carrying decision, principal, owner, payer and usage | not a new table and not a second pipeline (D22) |
| `gateway_connections` *(existing)* | untouched; a Composio-brokered MCP endpoint will reference a row here | not the endpoint registry, and not our domain — see below |

Reading it as a sentence: *a project registers custom endpoints on either plane, each
naming its own secret directly; a standard endpoint exists the moment a key exists for it;
a builtin endpoint exists because we run or broker it; and every call, allowed or denied,
becomes one event.*

### Why the planes are a separate domain, not members of `core/gateway/`

The skeleton proposed putting the planes inside the existing `core/gateway/`, and the
tempting argument for it — that the folder already has ports, a registry, services and
per-provider adapters, so the gateways "extend the family" — does not survive
examination. **Structural similarity is not domain kinship.** Every well-built domain in
this repo has ports, a registry and adapters; by that test the gateways belong everywhere,
which is to say the test proves nothing.

What `core/gateway/` actually is, read from its own contents rather than its name: its
DTOs are `CatalogIntegration`, `CatalogProvider`, `integration_key`; its one table is
`gateway_connections`; its consumers are tools and triggers; its only working provider is
Composio. It is an **integrations** domain — "connect my project to GitHub" — that happens
to be named "gateway". The name is the accident. What this design builds is different in
kind, not in degree: traffic transiting a boundary — identity, policy, secret injection,
audit, metering, per call, on the data path. The two share a word and nothing else, and a
domain boundary drawn on a shared word is how unrelated code grows entangled.

So the gateways are a **new domain**: `core/gateways/`, plural, a sibling of the existing
singular folder. The plural parent is deliberate and is D7 as a directory — one system,
two protocol surfaces (`llms/`, `mcps/`), one shared core (`policy/`), inside one parent —
where three loose top-level siblings would leave the policy core homeless and make the
"one design" claim invisible in the tree.

**The one genuine connection between the two domains, stated so nobody re-litigates it:**
a Composio-brokered MCP server will point at a `gateway_connections` row — the Composio
account that fronts it lives there, and our `mcps_endpoints` registry references
it the way any domain references another's entities. A registry referencing a
neighbouring domain's rows is normal, and it is not a reason to live in that neighbour's
folder.

**Why `llms/`, not `models/`.** A folder called `models` whose API layer contains a
`models.py` holding wire models is self-parody, and the product noun throughout `v1/` is
"the LLM gateway". `llms/`
and `mcps/` are also symmetric, which D19 says the two gateways are.

### Why the table names compact the domain to its plane

The tables are `llms_endpoints` and `mcps_endpoints` — the plane, then the
entity, both plural, and **no `gateway` anywhere in the name**.

Two things are being avoided. A `gateways_*` prefix would sort directly beside
`gateway_connections` in every schema listing and read as kin to a domain this design just
argued its way out of, even though `core/gateway/connections/` ↔ `gateway_connections` sets
a mirror-the-path precedent. And a `llm_gateway_*` infix spends a word on a qualifier that
earns nothing: within this schema the plane already says which gateway it is, and outside
it nobody is looking for these tables under `g`.

What is left is the domain compacted to the part that identifies it. Table names are read
far more often in isolation — in `psql`, in a migration, in an incident — than folder paths
are, so the name leads with the plane, which is what someone scanning a schema actually
needs.

The naming rule, stated once so nobody re-derives it wrongly: **directories, URL segments
and tables are plural** (`gateways/`, `llms/`, `mcps/`, `/gateways/llms/...`,
`llms_endpoints`); **symbols and operation ids keep the singular adjective and the
qualifier** (`LLMGatewayService`, `llm_gateway_chat_completions_standard`), because a class
name has no schema around it to supply the context a table name gets for free.

### The API folder, and why the data plane and the CRUD do not share a router object

The domain has an API folder per plane, `apis/fastapi/gateways/{llms,mcps}/` — unremarkable
in itself; every domain with HTTP surfaces has one. The part that needs deciding is
inside it.

The data plane and the management CRUD share the folder and the service; they do not
share a router class or its conventions.
The management CRUD follows the house shape — envelopes with `count`, `operation_id`,
`response_model_exclude_none`, a permission check per handler. The data plane must not: an
OpenAI-compatible surface and an MCP Streamable HTTP surface have **externally-fixed
shapes** — fixed paths, fixed error bodies, streaming, and a byte-for-byte relay constraint
(`scope-checklist.md`). Wrapping either in the house envelope breaks every client. So each
API folder holds `router.py` (house rules) and `proxy.py` (protocol rules), two router
objects wired separately at the entrypoint — the same move `triggers` makes with its
`router` and `admin_router`, for the same reason: one domain, two audiences with
incompatible conventions.

### Why the endpoint rows do not reuse `gateway_connections`

With the domain boundary drawn, this answers itself. `gateway_connections` is one
authorization of one integration — a provider-side account, a redirect flow, `is_valid`
driven by provider callbacks. An endpoint is a **route plus policy** — a URL, an
allowlist, a configuration — with a vault reference where a secret exists. Different
domain, different noun, different lifecycle; reuse would put our semantics on a table
tools and triggers read, and would leave `provider_key`/`integration_key` meaningless on
our rows. The tokens an OAuth flow eventually produces on the MCP side are named by the
endpoint's own `secret_id` (§2.1) — a project-owned server has exactly one secret to point
at, so the pointer lives on the row itself rather than in a table keyed by an owner nobody
stores (`out-of-scope.md`). The reuse that *is* correct is the reference stated above: a
Composio-brokered MCP endpoint points at its connection row; it does not become one.

### Why the endpoint names its secret directly

The vault holds the tokens (`oauth_grant`, D14); the gateway holds no secret material (D3).
But the vault payload is a `PGPString` blob — encrypted at rest, invisible to SQL — so
resolving a secret can never be a query inside `secrets`. Something unencrypted must point
at the vault row, and because every gateway secret is project-owned (`out-of-scope.md`),
that pointer needs no owner key of its own — it is one column, `secret_id`, on the endpoint
that uses it (§2.1). The row also gives the operational facts a home the payload cannot
serve — `is_valid` after a failed refresh (D18), the refresh attempt's outcome in `status`
— without decrypting anything. User-level secrets, should they ever ship, are a pure
add-on to this shape rather than a rework of it: a second table per plane narrowing the
answer for one member, with nothing here moving (`out-of-scope.md`).

### Why a provider key is a scan, not a stored binding

The asymmetry is deliberate and follows from what each secret *is*. An OAuth token is
**audience-bound**: minted for one server, by that server's authorization server — so the
binding `endpoint → secret` is a fact the row must carry, and `mcps_endpoints.secret_id`
carries it directly (§2.1). A provider key is bound to nothing but its provider: today it
is a freestanding vault secret discovered by scanning the project's secrets for the
provider (the SDK's settings builder does exactly this, `models.md`), and when user-owned
secrets arrive the same scan runs over the vault's own owner columns (`secrets.md`). A
generated `standard` endpoint has no row to hang a `secret_id` on in the first place —
existence itself is derived from the scan (D20) — so there is no per-endpoint fact to
record, and storing one would assert a pair nobody configures, the same cross-product
mistake the channels design refused for agents and spaces. The one place an LLM endpoint
does bind a specific secret, a custom endpoint, the binding is the same one column every
custom endpoint on either plane uses (§2.1).

### What is deliberately not a table

**Policy is derived, never stored.** The skeleton asked whether policy records exist. No:
every policy input already has a home — the permission catalog, the entitlement counters,
the per-endpoint configuration and tool allowlist on the endpoint rows, the static defaults
in code — and the decision is computed per call by `GatewayPolicyService` (§8). A stored
decision would need invalidation on every input; the existing two-layer entitlement pattern
(cached soft check, authoritative hard check) already answers the caching question and is
reused rather than reinvented (`policy.md`).

**Model routes are not rows.** A generated endpoint's route is derivable: a stable prefix,
the namespace marker — `standard` (D30, §2.3) — and the provider's own
name (D20). The provider-to-models catalogue
is already a static map in the SDK (`sdks/python/agenta/sdk/utils/assets.py`,
`supported_llm_models`, eleven providers), and the API already imports the SDK for exactly
this kind of static catalogue (`core/workflows/static_catalog.py`). `core/gateways/llms/catalog.py`
wraps that map; a builtin endpoint *exists* when a `provider_key` secret exists for its
provider, and stores nothing.

**Audit and usage are events, not tables.** One event per call into the existing events
domain (D22): `publish_event` onto the Redis stream, the `EventsWorker` behind it, the
existing query surface in front. Usage measures ride the same event's `attributes` rather
than a second write — the gateway is the only point that sees all of both planes, and
recording real usage from day one is the requirement that cannot be backfilled
(`policy.md`); the meters are a later consumer of the stream, not a schema this design
owns. §2.6 works through the shape.

**`gateway_connections` gains nothing.** The skeleton reserved "whatever the owner
dimension implies for lookup". The owner dimension lands in the resolution *signature* now
and nowhere in storage — user-level secrets are out of scope entirely, not deferred
(`out-of-scope.md`, D10); no column changes in this scope, here or anywhere else.

---

## 2. dbas

Abstract mixins declaring columns, composed from `dbs/postgres/shared/dbas.py`. The existing
gateway domain skips the `dbas.py` file entirely — `ConnectionDBE` composes the shared mixins
directly — but that works only while a domain has one table. These domains have two each,
so each gets a `dbas.py`, per the house rule that the file exists "when needed"
(`api/AGENTS.md`).

`ProjectScopeDBA`, `LifecycleDBA`, `IdentifierDBA`, `FlagsDBA`, `TagsDBA` and `MetaDBA` go
on every table, matching `gateway_connections`. The rest are answers to questions:

| mixin | add it when | in these domains |
| --- | --- | --- |
| `SlugDBA` | the entity is addressed by a stable name someone types or routes on | both endpoint tables — the slug is the URL identifier (§2.3) |
| `HeaderDBA` (`name`, `description`) | a human labels it in the UI | both endpoint tables |
| `DataDBA` | there is a typed payload the columns should not fragment | both endpoint tables |
| `StatusDBA` | an attempt against the outside world can fail | both endpoint tables — the last relay/probe failure, and on an MCP endpoint the last refresh outcome too (§2.5) |

There is no `UserScopeDBA` on the endpoint tables: custom endpoints are project-owned
configuration, and there is no owner dimension anywhere in this schema — every gateway
secret is project-owned, and user-owned *endpoints* are not designed anywhere in `v1/`
(`out-of-scope.md`).

```python
# dbs/postgres/gateways/llms/dbas.py

class LLMEndpointDBA(
    ProjectScopeDBA, IdentifierDBA, SlugDBA, LifecycleDBA,
    HeaderDBA, DataDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA,
):
    """One custom LLM endpoint: a provider deployment we reach (D19, D20)."""
    __abstract__ = True

    provider_key = Column(String, nullable=False)
    # String, not Enum: the provider set grows with the routing library's, and
    # gateway_connections.provider_key is already a String for the same reason.
    deployment_kind = Column(
        SQLEnum(LLMDeploymentKind, name="llmdeploymentkind_enum"), nullable=False
    )
    # Enum: the set is ours and closed — direct, custom, azure, bedrock,
    # sagemaker, vertex_ai — aligned with CustomProviderKind and the runner
    # wire's own `deployment` axis (services/runner/src/protocol.ts).
    secret_id = Column(UUID(as_uuid=True), nullable=True)
    # nullable: an endpoint with no secret is legitimate — the mock (D23),
    # an unauthenticated self-hosted server. FK with SET NULL, §2.1.
    # data: { route: {...}, models: {...}, settings: {...} } — §2.4


# dbs/postgres/gateways/mcps/dbas.py

class MCPEndpointDBA(
    ProjectScopeDBA, IdentifierDBA, SlugDBA, LifecycleDBA,
    HeaderDBA, DataDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA,
):
    """One custom MCP server: a registered upstream (D16, D19)."""
    __abstract__ = True

    auth_mode = Column(
        SQLEnum(GatewayAuthScheme, name="gatewayauthscheme_enum"), nullable=False
    )
    # oauth | api_key | none. `none` is the whole of the first checkpoint (D23);
    # `api_key` is declared but rejected by the service until the static secret
    # kind exists (D14) — the enum member costs nothing, a later migration would.
    secret_id = Column(UUID(as_uuid=True), nullable=True)
    # the `oauth_grant` secret when auth_mode is oauth — one column, because a
    # token is minted for exactly this server (D19, D3). NULL for `none`, and
    # until someone connects. FK with SET NULL, §2.1; a failed refresh flips
    # flags.is_valid and records the cause in status, never this column (§2.5).
    # data: { route: {...}, tools: {...}, settings: {...}, oauth: {...} } — §2.4
```

### 2.1 The secret reference and its constraint

The two existing precedents disagree. `webhook_subscriptions.secret_id` is a bare nullable
UUID with no constraint (`dbs/postgres/webhooks/dbas.py`); the SSO provider row carries
`nullable=False` plus `ForeignKeyConstraint(["secret_id"], ["secrets.id"],
ondelete="CASCADE")` (`api/ee/src/dbs/postgres/organizations/dbes.py`). The webhook shape
is the older and weaker one: a dangling `secret_id` there degrades to a `log.warning` at
dispatch time, which is tolerable for a signing key and not for a gateway secret.

Both tables take the constraint, and both choose the same delete behaviour:
`ondelete="SET NULL"`. Deleting a vault secret must not silently delete an endpoint's
configuration — the tool policy, the model allowlist, the timeouts survive, and calls fail
visibly with the needs-auth / needs-input state until someone rebinds. This is D18's
posture (a dead secret does not hide tools) applied to the row itself: secret death never
erases configuration. `CASCADE` here would let a vault cleanup — or a revocation — quietly
unregister a server, which is exactly the moment a caller needs the endpoint to stay
visible while reconnecting.

**Why the constraint at all, given the house rule that child-to-child references are
validated in the application layer.** That rule (followed by channels, stated in its
entities document) is about *domain* children — composite-scoped references across
sibling domain tables, validated in the service rather than FK'd. The secrets table is not
a domain sibling; it is the platform vault, `secrets.id` is a plain unique primary key, and
the reference is load-bearing for a security claim. The database keeping it honest costs
one constraint.

### 2.2 The owner dimension: in the signature now, nowhere in storage

D10 is a signature rule: every secret lookup takes the owner from the outset, even
while the only answer is the project. What that means layer by layer, so nobody
over-applies it:

- **The resolver takes the owner always.** `SecretsResolverInterface.resolve()` takes
  the full `AuthScope` and a `SecretMode`, and the mode logic consults
  `scope.user_id` (§7.2). This is the signature that is expensive to retrofit, and it is
  the one thing `plan.md` says the seed must get right.
- **No table takes the owner as a key.** An endpoint's `secret_id` names one
  project-owned secret and nothing here is keyed by a user — user-level secrets are out of
  scope entirely, not merely unscheduled (`out-of-scope.md`). The extension, if it ever
  ships, is additive: a second table per plane narrowing the answer for one member, with
  no change to either endpoint table.
- **The endpoint DAOs do not grow a user key.** Custom endpoints are project configuration;
  their verbs take `project_id` first and `user_id` only on writes, as authorship for
  `LifecycleDBA` — the house convention. Reading D10 as "every DAO verb keys on a user"
  would put a dead column on two tables.
- **The secrets table itself is untouched.** `out-of-scope.md` keeps the `(project, user)`
  owner for vault rows on the table as a possible extension without putting it on any
  schedule. Landing it later is a default column value, not a data migration, and no
  gateway signature moves — that is the point of taking the owner now.

### 2.3 The slug is the namespaced identifier

D16 requires the identifier in a gateway URL to carry a namespace — an id or a slug, never
a display name. The grammar, per D30:

```text
/gateways/mcps/builtin/agenta/{slug}                        builtin/agenta/tools
/gateways/mcps/builtin/composio/{integration}/{connection}  builtin/composio/notion/my-notion
/gateways/mcps/custom/{slug}                                custom/acme-notion

/gateways/llms/builtin/{provider}/...                       reserved, empty today
/gateways/llms/standard/{provider}                          standard/openai
/gateways/llms/custom/{slug}                                custom/acme-azure
```

**`builtin` carries a provider segment; each provider owns the grammar after it.** That is
what makes `agenta` a supplier rather than a namespace (D30): composio addresses a
connection as `{integration}/{connection}`, agenta serves its own endpoints under a bare
slug, and a third builtin provider would bring its own shape without disturbing either.

**The segment names are the codebase's own words, and that is the justification for the
three composio segments.** `provider`, `integration` and `connection` are `provider_key`,
`integration_key` and the connection's slug — the three columns of
`gateway_connections`'s unique key, `(project_id, provider_key, integration_key, slug)`,
minus the project, which comes from the token. The brokered URL simply spells the
brokered connection's identity; naming the segments anything else would invent a second
vocabulary for one set of values (D27).

- **`builtin`** — **our account pays**, which is the whole reason it is one namespace
  (D30). Generated, never a row. Two providers today. **`agenta`**: servers we implement
  and run, the mocks being its first members (D23), reached with our own minted token
  (D13); the runner's loopback channel is not in this picture — it is the runner's tool
  executor, not a transport, and the exclusion recorded in `notes.md` holds, with the
  slice that could eventually address the gateway directly tracked as `cleanups.md`
  item 5. **`composio`**: third-party servers backed by the Composio catalog the
  integrations domain already consumes, the path spelling the brokered connection's
  identity, the secret living at the broker behind the existing connection state
  machine. On the LLM plane `builtin` is **reserved with no members today** — it is where
  a model we supply the key for lands, and where metering will attach. Spelled without a
  hyphen because the namespace is a path segment.
- **`standard`** — a deployment whose wire we already know, **paid for with the user's own
  key** (D30). Generated, never a row. On the LLM plane: the standard-provider set (D20)
  — the provider's own key is the whole identifier (`standard/openai`), the set is the
  static catalogue (`core/gateways/llms/catalog.py`), and an endpoint exists when a
  provider key exists for it. On the MCP plane: **reserved, empty today**. The word is
  the secrets domain's own — a *standard* provider there is a standard target here, one
  word meaning one thing on both sides with no mapping between them.
- **`custom`** — stored endpoints, the only rows: a customer's own deployment or reseller
  on the LLM plane, a server the user brought by URL on the MCP plane. The name is the
  row's `slug`, one slug, unique per project (`uq_llms_endpoints_project_slug`,
  §3), validated by the shared `Slug` DTO's `URL_SAFE_SLUG` rule.

**Identifiers are slugs or keys, never display names — and an agenta slug may be nested.**
An agenta identifier is ours, defined in code, and may carry `/` separators
(`builtin/agenta/tools/search` is one endpoint whose slug is `tools/search`), so what
follows the provider segment is a **path**, not a single component — a routing fact §9
honours with a catch-all parameter, where composio and `custom` take fixed components. The
shared `Slug` validator governs what a *user* may type on a custom row; agenta identifiers
never pass through it, because nobody types them.

**All three are reserved on both planes, even where one is empty.** LLM's `builtin` and
MCP's `standard` have no members today; they exist anyway, because taking a keyword costs
nothing now, while discovering later that something else claimed the segment costs a
migration of live URLs (D30).

**The broker is named in the path, and that is deliberate** (D27). Hiding it behind a
stable name so a provider swap would not change URLs is wrong twice over: the provider is
part of a connection's identity, not an implementation detail —
that unique key above is *theirs plus ours together* — and a URL that survived a backend
swap would keep resolving while the user's tokens did not migrate, hiding a real breakage
instead of showing it. Naming the broker also lets a brokered server and a direct one to
the same vendor coexist without collision. The in-tree precedent agrees on both counts:
the tool call reference is `tools.{provider}.{integration}.{action}.{connection}`, and
the catalog routes are `/catalog/providers/{provider_key}/integrations/{integration_key}`.

**The extra segments on the tool plane are real structure, not an inconsistency.** On the
model plane the provider *is* the server (D19), so nothing follows it. A broker is not a
server — it fronts many integrations, each through a named connection — so the one being
addressed has to be spelled out. That is D19 applied honestly to a broker.

**There is no version segment in this grammar, on either plane.** The `/v1` an
OpenAI-compatible client sends belongs to the *upstream protocol's own path* — the client
appends `/v1/chat/completions` to whatever base it is handed, which is exactly why the
SDK's endpoint map stores `https://api.openai.com/v1` for OpenAI and a bare host for
Anthropic (`sdks/python/agenta/sdk/agents/connections/endpoints.py`). We hand out a base
ending `/v1` for that reason and no other. The tool plane has no equivalent: the whole
MCP protocol is a POST to the endpoint URL with no path after it, and the revision is
negotiated in a header (`mcp.md`). Versioning *our own* surface is a separate question
that applies to the whole API — no route in this codebase carries a version segment
today — and `contract.md` keeps it open. Nothing here invents one.

**`builtin` aliases the standard-provider path internally, and that is fine.** The secrets
domain calls a non-custom provider *standard* (`StandardProviderKind`,
`core/secrets/enums.py`), and the LLM plane resolves against that enum; the URL says
`builtin`. The gateway maps one to the other in exactly one place — `catalog.py`, whose
functions keep the internal *standard* vocabulary (§8). **A public path segment does not
owe its spelling to an internal enum.**

**The namespace selects the backend, which is why it earns a place in the path** rather
than in a column: a hit on `builtin/agenta` calls the Agenta tools; a hit on
`builtin/composio` calls the broker, reusing the connection the integrations domain
already brokered; a hit on `standard` calls the provider named by the segment, with the
user's own key; a hit on `custom` calls the upstream the endpoint row names, with the
secret we resolved for it (D30, §4.4). Every row is `custom` by
construction (D20 stores nothing else), so a namespace column would hold one value
forever. The DTO carries a `namespace` field stamped by the service — `CUSTOM` for rows,
the generated value otherwise — so one endpoint shape per plane serves all three
namespaces and a listing can merge them (§4).

### What a catalog entry has to hold

A dashboard user clicks *Notion*; they never type a URL. So something must already hold
the display name, the icon, the description and the URL — a catalog. What keeps this
design cheap is how little that is: **five fields, and that is all — name, icon,
description or category, and URL** (D27).

**Deliberately not stored: the OAuth endpoints, and not even the scope list.** Given the
server's URL, both are fetched at configuration time with no secret at all: an
unauthenticated call returns a challenge naming the protected-resource metadata, that
names the authorization server, and the authorization server's metadata publishes its
endpoints together with the scopes it supports. So the dashboard renders real scope
checkboxes from a live call rather than from a stored field — which is exactly what
connect-time scope selection requires (D17), and it means a server rotating its
authorization endpoints never invalidates a catalog entry.

Where the five fields come from, per namespace:

- **`builtin/composio`, MCP plane** — the Composio catalog contract we already consume:
  `CatalogIntegration` (`core/gateway/catalog/dtos.py`) carries `key`, `name`,
  `description`, `categories`, `logo`, `url` and `auth_schemes`. Nothing new is curated
  and nothing new is maintained; the gateway reads the same DTO the tools domain reads
  today.
- **`standard`, LLM plane** — the static provider catalogue the SDK already ships
  (`supported_llm_models`, §1), plus the direct base URL from the SDK's own endpoint map
  (`agents/connections/endpoints.py::direct_endpoint`), which the passthrough adapter
  dials; the same already-maintained-elsewhere property, from the other direction.
- **`builtin/agenta`** — in code, next to the servers themselves.
- **`custom`** — the user supplies the URL; everything else is discovered as above, and
  the name and description are theirs to type on the row.

Whether a small set of **direct** built-in servers ships alongside the Composio-backed
set — exercising our own OAuth client on purpose rather than only when a user pastes a
URL — is open in `open-designs.md` OD13. Nothing here changes either way: such servers
would be more code-defined catalog entries, the same five fields.

Tool names are untouched downstream of this identifier: the server is distinguished by its
URL, so the proxy is transparent per server (D16) — same tool names, same schemas, same
errors. The slug-grammar precedent for *why* names must never be rewritten is already in
the tree: `apis/fastapi/tools/utils.py::parse_tool_slug` accepts two separators because
OpenAI function names forbid dots, which is the kind of accommodation a renaming gateway
would be doing forever.

### 2.4 What is a column, and what goes in `data`

The test is the channels one, unchanged: a field is a column when the database must act on
it — a key, a constraint, an index, a worker's `WHERE` clause. Everything else that is
typed configuration goes in `data`. Applied here:

- **`provider_key`, `deployment_kind`, `auth_mode` are columns.** The management UI filters on
  them (`query_endpoints`), and `auth_mode` decides which service paths are even legal.
  They are **not the same three columns on both tables** — see below.
- **`route` is `data`.** Nothing queries it: the route lookup is by slug (§2.3), and two
  endpoints pointing at one URL with different filters is legitimate, so there is no
  uniqueness to enforce. It is read back whole and handed to the adapter — the exact
  profile of `external_locator` in the channels design.
- **`tools` / `models` are `data`.** The filter check happens in the service with the row
  already loaded; a filter is never a query predicate.
- **`settings` is `data`.** Timeouts and ceilings (D21) are read at call time off the row
  in hand. Per-endpoint, only on custom endpoints — generated endpoints take the code
  defaults, which is what "ours to define" means concretely.
- **`secret_id` is a column** — the FK acts on it (§2.1).
- **`expires_at` is not a column.** It lives inside the `oauth_grant` payload (§4.5), and
  nothing queries it: refresh is lazy, at use time when the token is stale, so there is no
  "expiring soon" worker to feed. A proactive refresh sweep, if one is ever built, promotes
  it to a column then.

### Why the two tables do not carry the same identity columns

`llms_endpoints` has `provider_key` and `deployment_kind` and no `auth_mode`;
`mcps_endpoints` has `auth_mode` and, on stored rows, neither of the other two. The
asymmetry is not an oversight, and the reason is the same on both sides: **each table
stores the axis that varies within it, and omits the one that is fixed by construction.**

**No `auth_mode` on an LLM endpoint, because there is only one mode.** Every model upstream
authenticates the same way — a key, presented as a header or as a request signature. There
is no OAuth against an LLM provider and no consent to obtain, so a column recording *how*
would answer `api_key` on every row that has a secret and `none` on the mocks. `secret_id`
already carries that distinction: set means authenticated, null means a NONE-scheme target
(D23). A second column expressing the same bit is a column that can disagree with itself.

**No `provider_key` or `deployment_kind` on a stored MCP endpoint, because a stored MCP
endpoint has no provider.** The MCP plane's protocol is one protocol over one transport:
a POST to a URL. `deployment_kind` exists on the LLM plane to say *which wire* — Azure's
dated API, Bedrock's signed region, an OpenAI-compatible reseller — and it selects the
adapter. On the MCP plane there is nothing to select: `custom` rows all reach
`HttpMCPAdapter`, and the only endpoints that *do* name a provider are the generated
`builtin` ones, whose provider comes from the URL segment or the brokered connection row,
never from storage.

That is why the MCP DTO carries `provider_key` and `integration_key` as **optional, never
persisted** fields: they are populated on generated `builtin` entries and are null on every
row. The DTO is the union of what any endpoint can be; the table is only what a `custom`
row needs.

**What the two tables do share** is everything the gateway does with an endpoint rather
than to it: `slug`, `secret_id`, `data`, `flags`, `status`, and the lifecycle columns. The
identity columns differ because identity is what differs between a model provider and a
tool server.

### The shape both planes share

`data` is the same three keys on both tables, plus one key each plane needs alone. The
names are the same words because they mean the same thing — a reader who has read one
endpoint document can read the other:

| key | LLM | MCP |
| --- | --- | --- |
| `route` | `base_url`, `headers`, plus `api_version`, `region`, `extras` | `base_url`, `headers` |
| the filter | `models` — `{allowlist, denylist}` | `tools` — `{allowlist, denylist}` |
| `settings` | `timeout_seconds`, `max_output_tokens` | `timeout_seconds` |
| plane-only | — | `oauth`: discovered authorization facts, cached (wave 3) |

Four rules hold across both, and they are the whole contract:

**One filter shape, one precedence.** An absent list is no constraint from that side;
`allowlist: []` refuses everything; `denylist` always wins over `allowlist`. Names are
matched exactly — a glob syntax would need its own decision, on both planes at once.
Nothing is filtered by default, and the `None`-versus-`[]` distinction is what keeps a
field nobody filled in from reading as *refuse everything*. Governance is expressed by
writing a filter, never by forgetting to.

**One header slot.** `route.headers` is the only place a header can be typed. It is
addressing — the upstream will not route without it — and it is merged under the caller's
own headers so a caller cannot forge it. **It may never carry a secret**: `Authorization`
is derived from the resolved secret and overwrites whatever it sets (§7.2). The caller's own
`Authorization` and `X-AG-Credentials` are stripped before any relay on both planes — they
authenticate the caller into the gateway and belong to no upstream (D31).

**One escape hatch, and it sits in `route`.** `route.extras` carries what a deployment needs
and no named field expresses: `vertex_project`, `aws_bedrock_runtime_endpoint`,
`aws_role_name`. It follows the header rule exactly — addressing, never secret material —
and that is what makes it safe to have. See "Why extras belongs to the route" below for why
there is no `settings.extras` and no top-level one.

**Listing and enforcement are not the same question.** The filter says what is *allowed*;
what can be *listed* is only ever the allowlist minus the denylist, because with no
allowlist the gateway does not know the upstream's catalogue. On the MCP plane the two
never diverge in practice — the upstream answers `tools/list` and the same filter trims the
response on the way back, which is the one place the gateway rewrites a body. On the LLM
plane a `standard` endpoint's allowlist *is* the SDK catalogue, so it lists in full; a
`custom` endpoint with no allowlist relays anything and lists nothing, which is honest
rather than convenient.

### What `llms_endpoints.data` actually holds

`route` mirrors the runner wire's `endpoint` object field for field, so one document means
the same thing on both sides of the gateway. Which of its fields matter is decided by
`deployment_kind`, not by the field being present — an `api_version` on a Bedrock endpoint
is ignored, not an error.

**A direct OpenAI-compatible reseller** — the common custom case. `base_url` is the whole
route; the adapter appends `/chat/completions`:

```json
{
  "route": { "base_url": "https://api.together.xyz/v1" },
  "models": { "allowlist": ["meta-llama/Llama-3-70b-chat-hf"] },
  "settings": { "timeout_seconds": 30.0 }
}
```

**Azure**, where the deployment lives at a per-resource host and the API is dated:

```json
{
  "route": {
    "base_url": "https://acme.openai.azure.com",
    "api_version": "2024-10-21"
  },
  "models": { "allowlist": ["gpt-4o", "gpt-4o-mini"] },
  "settings": { "max_output_tokens": 4096 }
}
```

**Bedrock**, where there is no URL to type — the region *is* the route, and the adapter
composes the host from it:

```json
{
  "route": { "region": "eu-central-1" },
  "models": { "allowlist": ["anthropic.claude-3-5-sonnet-20241022-v2:0"] }
}
```

**Vertex**, the case that earns `extras`. `vertex_location` comes from `region`, but
`vertex_project` is a GCP project id with no named field — routing, not secret material, so
it belongs here and not in the vault beside the service-account key:

```json
{
  "route": {
    "region": "europe-west4",
    "extras": { "vertex_project": "acme-prod" }
  },
  "models": { "allowlist": ["gemini-2.0-flash"] }
}
```

**A self-hosted gateway behind a routing header**, blocking one model without enumerating
the rest — the case the denylist exists for:

```json
{
  "route": {
    "base_url": "https://llm.internal.acme.io/v1",
    "headers": { "X-Acme-Tenant": "research" }
  },
  "models": { "denylist": ["gpt-4o"] }
}
```

**A generated `standard` endpoint has data too**, though nobody typed it — the catalogue
builds it (§8), and `base_url` is filled only for providers the passthrough adapter dials,
because it refuses without one. A translated provider keeps `route` empty and lets litellm
supply its own default:

```json
{
  "route": { "base_url": "https://api.openai.com/v1" },
  "models": { "allowlist": ["gpt-4o", "gpt-4o-mini", "o1", "..."] }
}
```

### What `mcps_endpoints.data` actually holds

The same document with one fewer route field and one more key. `route.base_url` is the
server's own endpoint — one URL per server (D16), and unlike the LLM plane nothing is
appended to it: the protocol is a POST to exactly that URL.

**A plain server needing no authentication** — `auth_mode` is `none` and `secret_id` is
null; the mocks are exactly this (D23):

```json
{ "route": { "base_url": "https://mcp.acme.io/" } }
```

**A server whose tools are restricted.** The allowlist does two jobs: it refuses a call to
an unlisted tool *before* the upstream is dialled, and it filters `tools/list` on the way
back:

```json
{
  "route": { "base_url": "https://mcp.acme.io/" },
  "tools": { "allowlist": ["search", "fetch"] },
  "settings": { "timeout_seconds": 15.0 }
}
```

**A server with one tool withdrawn**, which is the same trim expressed the other way —
everything the server offers except the destructive one, without pinning the list to what
it offers today:

```json
{
  "route": {
    "base_url": "https://mcp.internal.acme.io/",
    "headers": { "X-Acme-Tenant": "research" }
  },
  "tools": { "denylist": ["delete_page"] }
}
```

**An OAuth-protected server**, once the connect flow has run. `oauth` is discovery
metadata cached on the row, never secret material — the token itself is an `oauth_grant`
in the vault, pointed at by the `secret_id` column (D3):

```json
{
  "route": { "base_url": "https://mcp.notion.so/mcp" },
  "oauth": {
    "resource": "https://mcp.notion.so",
    "authorization_server": "https://auth.notion.so",
    "scopes_offered": ["read", "write"]
  }
}
```

**A generated endpoint's data is composed, not stored.** A `builtin/agenta` entry takes its
URL from configuration; a `builtin/composio` entry has no URL of its own at all — the
broker owns the route, and the endpoint carries a placeholder until `ComposioMCPAdapter`
lands (§8).

### Why `extras` belongs to the route, and only there

There are two `extras` in play and they are not the same field. The **secret's** extras
already exists (`CustomProviderSettingsDTO.extras`) and already flows: it is what carries
`aws_access_key_id`, `aws_secret_access_key`, `vertex_credentials`, `azure_ad_token` — the
material that authenticates us to a cloud. It lives in the vault, encrypted, and the adapter
merges it verbatim.

What has no home is the **non-secret** half of the same story. A Vertex call needs
`vertex_project`; a Bedrock call may need `aws_bedrock_runtime_endpoint` or `aws_role_name`.
None of those are secrets, none has a named route field, and today the only way to deliver
one is to smuggle it into the vault alongside real secret material. That is the conflation
this design refuses: `api_version` and `region` come from the route and never from the
secret, though the legacy SDK path packs both into the secret's extras.

So `extras` goes on `route`, for the same reason `headers` does:

- **`route.extras` is addressing.** It answers "where and how do we dial", which is what
  `route` means. It is never secret material, and the same sentence that governs
  `route.headers` governs it.
- **`settings` stays ours.** `timeout_seconds` and `max_output_tokens` are governance knobs
  *we* define and *we* enforce. A provider passthrough dict there would make settings half
  ours and half theirs, and the category stops meaning anything.
- **A top-level `data.extras` says nothing.** A reader could not tell whether a key addresses
  or configures, which is the whole reason `data` has named sub-objects at all. On a JSON
  column a forward-compat bag earns nothing either — adding a named field costs no migration.

**Precedence, which is the part that matters for safety.** The translated adapter merges in
this order: the caller's body, then `route.extras`, then the secret, then the explicit route
fields. So an endpoint can override what a caller asked for, and **the vault always outranks
the route** — a route field can never re-point authentication at a different secret.

**The passthrough adapter ignores `extras`.** It speaks raw HTTP: a URL, headers, and a
derived `Authorization`. Provider kwargs are a routing-library concept, so there is nothing
for it to do with them.

**Nothing equivalent on the MCP plane.** One protocol, one transport, one URL — there is no
per-provider dialect to accommodate, so `MCPEndpointRoute` stays at the shared pair. If that
ever changes it is a DTO change with no migration.

### 2.5 Flags and status: policy state versus secret state versus attempt outcome

Two different facts, two different homes, following the house pattern:

- **`flags.is_active`** — an operator's switch, on both endpoint tables. Server-set default
  `True`; a deactivated endpoint refuses calls with a reason that names the flag —
  `GatewayEndpointInactiveError`, one type for both planes, since the flag, the refusal and
  the reason are identical and only the endpoint named differs. The check sits immediately
  after resolution, before the allowlist: a deactivated endpoint should not report what it
  would have allowed.
- **`flags.is_valid`** — secret health, on the MCP endpoint only. Server-set, never
  client-writable (the connections service already enforces exactly this: "always
  server-set in flags"). A failed refresh flips it `False`; D18 then holds — the server's
  tools stay listed, the call fails, the existing escalation paths offer reconnection. The
  LLM endpoint carries no `is_valid`: a provider key is discovered by scanning for
  existence, not bound to one row (the asymmetry above), so there is nothing per-endpoint
  for a refresh to invalidate.
- **`status` (`StatusDBA`)** — the outcome of the last attempt, the shared
  `{timestamp, type, code, message, stacktrace}` shape, on both tables. On an MCP endpoint
  whose refresh failed: the failure that explains *why* `is_valid` is false. Otherwise: the
  last relay or probe failure, which is diagnosis, not policy input.

No lifecycle enum column exists on either table. Nothing here is a state machine: an
endpoint is configuration, and the ready / needs-auth / needs-input states are **derived**
per caller at read time — `ready` requires a valid secret for the endpoint, so it cannot be
a row fact (§4).

### 2.6 Why usage and audit write no rows here

D22 settles audit: one event per call into the existing events domain. Concretely, the
gateway emits through `publish_event`
(`api/oss/src/core/events/streaming.py`) with two new `EventType` members (§4), the
`EventsWorker` consumes the stream, and the existing `VIEW_EVENTS`-gated query surface
reads it back. The envelope discards a top-level user id ("events are system-generated"),
so the principal travels in `attributes` — the pattern every existing publish helper
already follows.

Usage rides the same event rather than a second write. The two facts that cannot be
reconstructed later — the secret **owner** and the **payer** (`secret_origin`) — are
attributes of the call, exactly like the decision and the outcome; splitting them across
an audit record and a usage record would mean two writes that can disagree about the one
call they describe. The EE meters become a consumer of this stream when metering lands
(`policy.md` owns that ordering); nothing in this design writes a meter row directly, and
the legacy credits counter is left alone (D24).

One honest caveat, inherited rather than hidden: the events stream drops writes when Redis
is unavailable and when the L1 quota check rejects, and `_safe_publish` swallows failures
by design. That is an availability posture chosen for read-analytics events;
`policy.md` flags that compliance-grade audit is not sampled and not lossy. Wave 0 keeps
D22 — one pipeline — and records the gap: if the gateways need stronger delivery than the
stream provides, the fix is in the events domain's durability, not a parallel gateway
audit table.

---

## 3. dbes

Concrete entities adding `__tablename__` and constraints. Composite primary key on
`(project_id, id)` and the project FK with `CASCADE`, as `gateway_connections` and the
triggers tables already do; the
`secret_id` constraints per §2.1.

```python
# dbs/postgres/gateways/llms/dbes.py

class LLMEndpointDBE(Base, LLMEndpointDBA):
    __tablename__ = "llms_endpoints"
    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["secret_id"], ["secrets.id"], ondelete="SET NULL"),
        UniqueConstraint("project_id", "slug",
                         name="uq_llms_endpoints_project_slug"),
        Index("ix_llms_endpoints_project_provider",
              "project_id", "provider_key"),
        Index("ix_llms_endpoints_flags", "flags", postgresql_using="gin"),
    )


# dbs/postgres/gateways/mcps/dbes.py

class MCPEndpointDBE(Base, MCPEndpointDBA):
    __tablename__ = "mcps_endpoints"
    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["secret_id"], ["secrets.id"], ondelete="SET NULL"),
        UniqueConstraint("project_id", "slug",
                         name="uq_mcps_endpoints_project_slug"),
        Index("ix_mcps_endpoints_flags", "flags", postgresql_using="gin"),
    )
```

**The slug uniqueness is per project, not per provider.** `gateway_connections` scopes its
slug under `(provider_key, integration_key)` because a connection names an install of an
integration. An endpoint slug is a **URL segment** (§2.3): two endpoints with one slug
would be one route, whatever their providers, so the constraint matches the route grammar
rather than the connection precedent.

**No unique constraint mentions `url` or `secret_id`.** Two endpoints may point at one
upstream with different tool policies, and one secret may back several endpoints (one
provider key, several custom deployments). Neither is an error, so neither is constrained.

Deduplication and races, in the constraint-not-logic style the triggers tables set:

| mechanism | absorbs | protects |
| --- | --- | --- |
| `(project_id, slug)` on both endpoint tables | a double-submitted create | the route grammar — one name, one endpoint |

---

## 4. dtos

Everything in this section is seed material: complete, importable Pydantic, lifted verbatim
into the seed commit (`plan.md`, wave 0).

### 4.1 Our shared vocabulary, and the triplicate enums left where they are

The `oauth | api_key` scheme enum and the ready / needs-auth / needs-input state machine
exist in three parallel copies today — `ConnectionAuthScheme`
(`core/gateway/connections/dtos.py`), `ToolConnectionState` plus `ConnectAffordance`
(`core/tools/dtos.py`), and `TriggerDiscoveryConnectionState` plus
`TriggerConnectAffordance` (`core/triggers/dtos.py`). The open review on this
(`open-reviews.md` OR4) gets its honest answer here: **the gateways are a separate domain
(§1), so they define their own vocabulary** — the copies below, in `core/gateways/dtos.py`,
shared by both planes. The three existing copies are **not ours to touch**: the current
scope is the gateways, agent v0, the runner and the harnesses (D15), and catalog, tools
and triggers sit outside it. Importing our vocabulary from the integrations domain would
re-couple the two through the back door for no gain; a fourth definition inside our own
boundary costs nothing and keeps the boundary real. If all four ever converge, the
neutral home is `core/shared/dtos.py` — which already holds `Identifier`, `Slug` and
`Header` — and that convergence is deliberately later work: `cleanups.md` item 9 carries
it, gated on the gateways existing at all.

One semantic addition the existing copies lack: `NONE`. The first checkpoint's reachable
targets are unauthenticated by design (D23 — our own servers and the mocks, no OAuth, no
static kind), so the scheme enum must be able to say so.

```python
# core/gateways/dtos.py

class GatewayAuthScheme(str, Enum):
    """How an upstream authenticates us. The gateways' own copy (OR4, §4.1)."""
    OAUTH = "oauth"
    API_KEY = "api_key"
    NONE = "none"


class GatewayConnectionState(str, Enum):
    """Derived per caller at read time — never stored (§2.5)."""
    READY = "ready"            # a usable secret exists for this endpoint
    NEEDS_AUTH = "needs_auth"  # OAuth target with no valid secret; connect
    NEEDS_INPUT = "needs_input"  # a secret must be supplied before use


class GatewayConnectAffordance(BaseModel):
    """The call to make when a secret is missing — an interaction, not a
    failure (D17). Same shape as the tools domain's ConnectAffordance."""
    endpoint: str
    body: Dict[str, Any] = Field(default_factory=dict)


class GatewayConnectionRequirement(BaseModel):
    """One target's secret state, returned from discovery and from a refused
    call. `connect` is present exactly when the state is not READY."""
    target: str                      # the route path under the plane, per §2.3 —
                                     # e.g. "builtin/composio/notion/my-notion"
    state: GatewayConnectionState
    connect: Optional[GatewayConnectAffordance] = None


class GatewayEndpointNamespace(str, Enum):
    """The first URL segment under either plane — the same three words on both
    (§2.3, D16, D30). The namespace selects the backend and says whose secret
    pays, which is what earns it a place in the path."""
    BUILTIN = "builtin"     # our account, so we bill: a provider segment follows
                            # (agenta, composio). Generated, never a row (D20, D21)
    STANDARD = "standard"   # a shape we know, the user's own key: the
                            # standard-provider set on the LLM plane, empty on MCP
    CUSTOM = "custom"       # a row; configurable, the user's key


class GatewayEndpointRoute(BaseModel):
    """Where and how to dial an upstream — the two fields both planes share (§2.4).
    `headers` is addressing, never a secret: Authorization is derived from the
    resolved secret and overwrites whatever is set here (§7.2)."""
    base_url: Optional[str] = None
    headers: Optional[Dict[str, str]] = None


class GatewayEndpointFilter(BaseModel):
    """One name filter, the same shape for LLM models and MCP tools (§2.4).
    Absent list = no constraint; allowlist: [] refuses everything; denylist
    always wins. Exact names only."""
    allowlist: Optional[List[str]] = None
    denylist: Optional[List[str]] = None

    def allows(self, name: str) -> bool: ...      # denylist first, then allowlist
    def enumerate(self) -> List[str]: ...         # allowlist minus denylist


class GatewayEndpointSettings(BaseModel):
    """Per-endpoint settings, one concern for both planes (D21). Custom
    endpoints only; generated endpoints take the code defaults."""
    timeout_seconds: Optional[float] = None
```

**One namespace enum, shared by both planes.** D30 keeps the value set identical on
purpose — the same three words, all three reserved even where one is empty — so a shared
type is the honest one, and it lives here at the domain root because the policy core's
`GatewayTarget` (§4.2) and both plane DTOs all carry it.

**The split that matters is billing, not backend.** `builtin` is the one namespace whose
upstream we pay for, so it is the only one metering will ever attach to; `standard` and
`custom` both spend the user's own key and need no charging path at all. The vocabulary
agrees end to end: the secrets domain says *standard*, and so does the URL.

### 4.2 The policy core's DTOs

```python
# core/gateways/policy/dtos.py

class GatewayPlane(str, Enum):
    LLM = "llm"
    MCP = "mcp"


class SecretMode(str, Enum):
    """Declared per resolution site, not per call (`secrets.md`)."""
    USER_OPTIONAL = "user_optional"   # the user's if present, else the project's
    USER_REQUIRED = "user_required"   # the user's, or fail — never fall back
    PROJECT_ONLY = "project_only"     # always the project's; ignore user secrets


class SecretOwnerKind(str, Enum):
    PROJECT = "project"
    USER = "user"


class SecretOwner(BaseModel):
    """Whose stored secret answered the lookup. Audit cannot reconstruct this
    later, which is why it travels with the secret (`secrets.md`)."""
    kind: SecretOwnerKind
    user_id: Optional[UUID] = None    # set exactly when kind is USER


class SecretOrigin(str, Enum):
    """Whose money the call spends — the payer. `vault` is the customer's own
    secret; `local` is platform-funded. Vocabulary fixed by `secrets.md`;
    coordinate values with the parallel bring-your-own-secrets work, which uses
    the same axis to zero-rate customer-funded usage."""
    VAULT = "vault"
    LOCAL = "local"


# --- what the resolver is asked for ---------------------------------------- #

class ProviderKeyRef(BaseModel):
    """A standard LLM endpoint — the standard-provider set (D30): find the
    provider_key secret for this provider."""
    provider_key: str

class BoundSecretRef(BaseModel):
    """A custom endpoint on either plane, or an OAuth-protected MCP endpoint:
    the row already names its secret directly (§2.1)."""
    secret_id: UUID

SecretRef = Union[ProviderKeyRef, BoundSecretRef]


class ResolvedSecret(BaseModel):
    """The (secret, owner, payer) triple (`secrets.md`). Never serialized
    outward: it exists between the resolver and an adapter, in process, and no
    wire model embeds it."""
    secret: SecretResponseDTO         # decrypted, from VaultService
    owner: SecretOwner
    origin: SecretOrigin


# --- what policy decides, and what audit records ---------------------------- #

class GatewayTarget(BaseModel):
    """The plane-neutral description of what a call is trying to reach."""
    plane: GatewayPlane
    namespace: GatewayEndpointNamespace
    name: str                           # the last path component: a slug, a provider
                                        # key (LLM builtin), or the connection slug
                                        # (MCP builtin) — §2.3
    #
    provider: Optional[str] = None      # builtin: which supplier — agenta, composio (D30)
    integration: Optional[str] = None   # builtin/composio: the integration segment
    endpoint_id: Optional[UUID] = None  # set when the target is a row
    model: Optional[str] = None         # LLM plane
    method: Optional[str] = None        # MCP plane: the protocol method
    tool: Optional[str] = None          # MCP plane: the target tool, when one is named


class PolicyDecision(BaseModel):
    allowed: bool
    permission: Permission             # the subject that was checked (§9)
    reason: Optional[str] = None       # denial cause, stable and terse; None when allowed


class GatewayUsage(BaseModel):
    """What the meter needs, plane-neutral. Tokens on the LLM plane, calls on
    both; recorded from day one even while nothing is charged (`policy.md`)."""
    calls: int = 1
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    cost: Optional[float] = None


class GatewayOutcome(BaseModel):
    """How the call ended, for the audit event (§2.6)."""
    status_code: Optional[int] = None
    duration_ms: Optional[int] = None
    #
    usage: Optional[GatewayUsage] = None
    owner: Optional[SecretOwner] = None   # None when no secret was resolved
    origin: Optional[SecretOrigin] = None
```

**Why `ResolvedSecret` carries the whole `SecretResponseDTO`** rather than a plucked
string: the payload shape differs per kind — a provider key is one string, a custom
provider is url + key + extras, an OAuth grant is a token pair — and the adapter, not the
resolver, knows which fields its upstream needs. Plucking in the resolver would grow a
per-kind switch in exactly the layer that must stay kind-agnostic. The containment rule is
behavioural, not structural: the DTO never crosses the north port, and `redaction` of it in
logs follows the runner's existing deny-set discipline.

**Why the ref is a union and not two resolver methods.** `secrets.md` specifies *one*
function called by both planes, and the mode logic — the part that must not fork — is
identical across both lookups. Two methods would duplicate it; one method with a typed ref
keeps the owner/mode semantics in one body and makes the lookup shape data.

### 4.3 The LLM plane

```python
# core/gateways/llms/dtos.py

class LLMDeploymentKind(str, Enum):
    """How a provider is reached — the wire's `deployment` axis, aligned with
    CustomProviderKind in core/secrets/enums.py (`models.md`: keep both axes)."""
    DIRECT = "direct"
    CUSTOM = "custom"          # OpenAI-compatible third party or self-hosted
    AZURE = "azure"
    BEDROCK = "bedrock"
    SAGEMAKER = "sagemaker"
    VERTEX = "vertex_ai"


class LLMEndpointRoute(BaseModel):
    """The route, mirroring the runner wire's `endpoint` object field for field
    (services/runner/src/protocol.ts): apiVersion for Azure, region for AWS and
    Vertex, on top of the shared base_url + headers."""
    api_version: Optional[str] = None
    region: Optional[str] = None
    extras: Optional[Dict[str, Any]] = None   # non-secret provider knobs with no named
                                              # field (vertex_project and friends). Same
                                              # rule as headers: addressing, never secret;
                                              # the secret's own extras outranks it.


LLMModelFilter = GatewayEndpointFilter   # the plane's own name for the shared shape


class LLMEndpointSettings(GatewayEndpointSettings):
    max_output_tokens: Optional[int] = None   # the ceiling (D21). A call above it
                                              # is REJECTED, never silently
                                              # clamped (D25) — CeilingExceededError, §5.
                                              # The CONFIG key. The request field it
                                              # binds to is Chat Completions' own:
                                              # max_tokens, or max_completion_tokens
                                              # on reasoning models. Reading the config
                                              # key off the body would never engage.


class LLMEndpointData(BaseModel):
    route: LLMEndpointRoute = Field(default_factory=LLMEndpointRoute)
    models: LLMModelFilter = Field(default_factory=LLMModelFilter)
    settings: LLMEndpointSettings = Field(default_factory=LLMEndpointSettings)


class LLMEndpointFlags(BaseModel):
    is_active: bool = True
    # no is_valid: a provider key is discovered by scanning for existence, not
    # bound to one row, so there is nothing per-endpoint for a refresh to
    # invalidate (§1, "Why a provider key is a scan, not a stored binding").
    # The MCP endpoint's secret_id IS bound to one row, which is why its flags
    # carry is_valid and this one does not (§2.5).


class LLMEndpoint(Identifier, Slug, Header, Lifecycle, Metadata):
    provider_key: str
    deployment_kind: LLMDeploymentKind
    namespace: GatewayEndpointNamespace = GatewayEndpointNamespace.CUSTOM
    secret_id: Optional[UUID] = None
    #
    data: LLMEndpointData = Field(default_factory=LLMEndpointData)
    flags: LLMEndpointFlags = Field(default_factory=LLMEndpointFlags)
    status: Optional[Status] = None


class LLMEndpointCreate(Slug, Header, Metadata):
    provider_key: str
    deployment_kind: LLMDeploymentKind
    secret_id: Optional[UUID] = None
    #
    data: LLMEndpointData = Field(default_factory=LLMEndpointData)
    flags: LLMEndpointFlags = Field(default_factory=LLMEndpointFlags)


class LLMEndpointEdit(Identifier, Header, Metadata):
    # no provider_key, no deployment_kind: repointing an endpoint at a different
    # provider family is a different endpoint, not an edit — absence makes it
    # unexpressible, the channels rule
    secret_id: Optional[UUID] = None
    #
    data: LLMEndpointData = Field(default_factory=LLMEndpointData)
    flags: LLMEndpointFlags = Field(default_factory=LLMEndpointFlags)


class LLMEndpointQuery(BaseModel):
    provider_key: Optional[str] = None
    deployment_kind: Optional[LLMDeploymentKind] = None
    slug: Optional[str] = None


class LLMCallContext(BaseModel):
    """What policy needs from the request body — parsed minimally, so the body
    itself can relay byte for byte (`scope-checklist.md`)."""
    model: str
    stream: bool = False


class LLMResolvedRoute(BaseModel):
    """What the south port receives: the route after selection, with the model
    id already in the routing library's form."""
    provider_key: str
    deployment_kind: LLMDeploymentKind
    model: str
    #
    base_url: Optional[str] = None
    api_version: Optional[str] = None
    region: Optional[str] = None
    headers: Optional[Dict[str, str]] = None
    #
    settings: LLMEndpointSettings = Field(default_factory=LLMEndpointSettings)
```

### 4.4 The MCP plane

```python
# core/gateways/mcps/dtos.py

class MCPEndpointRoute(GatewayEndpointRoute):
    """Nothing beyond the shared pair: an MCP server is one URL (D16) and the
    protocol POSTs to it directly — unlike the LLM plane's base_url, no path is
    appended."""


MCPToolFilter = GatewayEndpointFilter   # the plane's own name for the shared shape


class MCPEndpointSettings(GatewayEndpointSettings):
    """Nothing beyond the shared field yet; the subclass exists so a first
    MCP-only knob is a DTO change, symmetric with the LLM side."""


class MCPOAuthData(BaseModel):
    """Discovered authorization facts, cached on the row. Written by the OAuth
    checkpoint (WP17); absent until then. Not secret material — discovery
    metadata only (D3 holds: tokens live in the vault)."""
    resource: Optional[str] = None
    authorization_server: Optional[str] = None
    scopes_offered: List[str] = Field(default_factory=list)


class MCPEndpointData(BaseModel):
    route: MCPEndpointRoute = Field(default_factory=MCPEndpointRoute)
    tools: MCPToolFilter = Field(default_factory=MCPToolFilter)
    settings: MCPEndpointSettings = Field(default_factory=MCPEndpointSettings)
    oauth: Optional[MCPOAuthData] = None


class MCPEndpointFlags(BaseModel):
    is_active: bool = True
    is_valid: bool = True     # server-set; flipped False by a failed refresh (§2.5).
                              # No LLM counterpart: a provider key is discovered by
                              # existence, not bound to one row (§1).


class MCPEndpoint(Identifier, Slug, Header, Lifecycle, Metadata):
    auth_mode: GatewayAuthScheme
    namespace: GatewayEndpointNamespace = GatewayEndpointNamespace.CUSTOM
    secret_id: Optional[UUID] = None
    connection_id: Optional[UUID] = None
    # set by the service on BUILTIN entries only: the gateway_connections row
    # holding the brokered account this server fronts. Our registry referencing
    # theirs (§1), which is why it is not a column — builtin endpoints are
    # generated, never rows, so there is nothing to store it on. Absent from
    # Create and Edit: rows are custom, and custom is never broker-backed.
    provider_key: Optional[str] = None
    integration_key: Optional[str] = None
    # BUILTIN only, with `slug` carrying the connection's slug: the three URL
    # segments (§2.3) — the brokered connection's own unique key, so a listing
    # renders the route without a second lookup
    #
    data: MCPEndpointData
    flags: MCPEndpointFlags = Field(default_factory=MCPEndpointFlags)
    status: Optional[Status] = None


class MCPEndpointCreate(Slug, Header, Metadata):
    auth_mode: GatewayAuthScheme
    secret_id: Optional[UUID] = None
    #
    data: MCPEndpointData
    flags: MCPEndpointFlags = Field(default_factory=MCPEndpointFlags)


class MCPEndpointEdit(Identifier, Header, Metadata):
    auth_mode: GatewayAuthScheme       # editable: a server can move from none to
                                       # oauth; the service revalidates secret_id
    secret_id: Optional[UUID] = None
    #
    data: MCPEndpointData
    flags: MCPEndpointFlags = Field(default_factory=MCPEndpointFlags)


class MCPEndpointQuery(BaseModel):
    auth_mode: Optional[GatewayAuthScheme] = None
    slug: Optional[str] = None


class MCPCallContext(BaseModel):
    """What routing reads from the protocol's method and target headers — the
    body is never parsed for routing (`mcp.md`, header-based routing). The
    exact header names are pinned against the 2026-07-28 revision at
    implementation time, in apis/fastapi/gateways/mcps/utils.py."""
    method: str
    target: Optional[str] = None


class MCPResolvedRoute(BaseModel):
    url: str
    headers: Dict[str, str] = Field(default_factory=dict)
    settings: MCPEndpointSettings = Field(default_factory=MCPEndpointSettings)


# --- the two secret mechanisms, made legible (D27) ----------------------- #

class MCPDirectAuth(BaseModel):
    """builtin/agenta + custom: the secret is ours to present — an oauth_grant
    resolved from the vault (§7.2), or nothing for a NONE-scheme target."""
    secret: Optional[ResolvedSecret] = None


class MCPBrokeredAuth(BaseModel):
    """builtin: the integrations domain brokered the authorization and holds the
    secret upstream; what we carry is its connection row. `Connection` is
    that domain's own DTO (core/gateway/connections/dtos.py), imported by
    reference (§1) — no copy, no subclass."""
    connection: Connection


MCPRelayAuth = Union[MCPDirectAuth, MCPBrokeredAuth]
```

**`secret_id` is on the entity DTOs, and that is a recorded divergence from `secrets.md`.**
That document says domain responses exclude the secret *and its id*; the as-built
precedent it cites does not do this — `WebhookSubscription` carries `secret_id: Optional[UUID]`
(`core/webhooks/types.py`) and excludes only the material (`exclude={"secret"}` in
`core/webhooks/service.py`). The gateways follow the code, for a reason the stricter
sentence ignores: edits are full PUTs sourced from the freshly fetched entity, and a field
that is writable but never readable breaks that contract — every edit would silently
unbind the secret. The id is a pointer; reading the material it points at still takes
`VIEW_SECRET` through the vault. The material itself never appears on any DTO in this
document, in either direction.

**`builtin` and `custom` are two secret mechanisms, and the shapes make that legible
at the layer where it matters** (D27). At the *entity* layer the answer is a nullable
reference, not a discriminated endpoint type: `connection_id` and `integration_key` are
stamped by the service when it generates a `builtin` entry, and a split into
`MCPBuiltinEndpoint` / `MCPCustomEndpoint` was rejected because the endpoint's identity,
config and listing shape are one — only the secret path forks, and forking every DAO
and service signature for a difference that appears at secret time would spread the
fork everywhere it does not matter. At the *south port*, where the fork is real behaviour,
the shape **is** discriminated: `MCPRelayAuth` above, one arm per mechanism, so an adapter
cannot quietly treat a brokered connection as a vault secret or vice versa
(§7.1).

**The reference itself, designed** (D27 asks for exactly this): *which row* — the
`gateway_connections` row for the brokered account. *Keyed how* — by its own unique key,
which the URL spells outright (§2.3): the project from the token plus the
`(provider, integration, connection)` segments resolve one row through the existing
`ConnectionsService`, exactly, no chooser and no heuristics; the service stamps
`connection_id`, `provider_key` and `integration_key` onto the generated entry so nothing
downstream re-parses the path. *When the connection is revoked or invalid* — the endpoint
stays listed and derives `NEEDS_AUTH` (§8), and a relay attempt refuses with
`SecretInvalidError` before any upstream call, carrying the connect affordance for
the existing integrations flow: D18's posture, secret death never hides
configuration.

**An explicit empty allowlist refuses; an absent one does not.** `models: {"allowlist": []}`
means no model may be called — the list was written, and it is empty. `models: {}` is a
different statement: nothing was written, so nothing is constrained. The distinction is the
whole reason the filter uses `None` rather than a default-empty list, and it is what stops
"I forgot to fill this in" from reading as "refuse everything". Standard endpoints expose
their provider's whole catalogue (the static map is the allowlist, `scope-checklist.md`);
custom endpoints declare their own or declare nothing.

### 4.5 The two secret kinds (WP16 seed)

Adding a kind touches exactly four places and no schema (`secrets.md`): the enum member,
the settings DTO pair, the union arm, and a branch in the hand-written
`model_validator(mode="before")` — it is manual dispatch on the sibling `kind` field, not
a discriminated union, so a missing branch rejects the kind outright.

```python
# core/secrets/enums.py — two new members
class SecretKind(str, Enum):
    ...
    OAUTH_PROVIDER = "oauth_provider"
    OAUTH_GRANT = "oauth_grant"


# core/secrets/dtos.py — the settings pairs

class OAuthProviderSettingsDTO(BaseModel):
    """Our client registration with one authorization server. The SSO kind is
    the shape precedent (D14) — client id, client secret, issuer, scopes."""
    client_id: str
    client_secret: Optional[str] = None   # absent for public clients (PKCE-only,
                                          # Client ID Metadata Document flows)
    issuer_url: str                       # the authorization server
    scopes: List[str] = Field(default_factory=list)
    extra: Dict[str, Any] = Field(default_factory=dict)

class OAuthProviderDTO(BaseModel):
    provider: OAuthProviderSettingsDTO


class OAuthGrantSettingsDTO(BaseModel):
    """One server's tokens. Rewritten in place on every refresh (`secrets.md`);
    the endpoint's `secret_id` points here directly (§2.1)."""
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str = "Bearer"
    expires_at: Optional[datetime] = None
    scopes: List[str] = Field(default_factory=list)   # actually granted, not requested
    resource: str    # the upstream server the token was minted for — tokens are
                     # audience-bound (`mcp.md`), so the grant names the server

class OAuthGrantDTO(BaseModel):
    grant: OAuthGrantSettingsDTO


# core/secrets/dtos.py — the union gains two arms
class SecretDTO(BaseModel):
    kind: SecretKind
    data: Union[
        StandardProviderDTO,
        CustomProviderDTO,
        SSOProviderDTO,
        WebhookProviderDTO,
        CustomSecretDTO,
        OAuthProviderDTO,
        OAuthGrantDTO,
    ]
    # plus one `elif kind == SecretKind.OAUTH_PROVIDER.value:` and one
    # `elif kind == SecretKind.OAUTH_GRANT.value:` branch in
    # validate_secret_data_based_on_kind, each checking its settings shape —
    # the same structural checks the SSO branch performs.
```

**Two kinds, not one with sub-kinds** — D14's argument holds at the field level visible
above: the two share not a single field, and the sub-kind pattern in this enum
discriminates the same shape across vendors, which this is not. **The inner field is named
per kind** (`provider` for the registration, following the SSO precedent; `grant` for the
tokens, following the custom kind's freedom to pick its own noun), because calling a
token bundle a "provider" would be a lie the resolver pays for later.

**Coordination, restated as an instruction:** the parallel bring-your-own-secrets work is
adding kinds to this same enum for sandbox providers and the tool gateway key. The enum
member names above and `SecretOrigin`'s values (§4.2) are the two points of contact; agree
both in one pass before WP16 lands (D14, `secrets.md`).

### 4.6 The audit event types (WP4 seed)

Two members join the existing `EventType` (`core/events/types.py`), one per plane — the
noun differs, the record does not (`policy.md`):

```python
class EventType(str, Enum):
    ...
    # Gateways — one record per call, allowed or denied (D22)
    GATEWAY_LLM_CALLED = "gateway.llm.called"
    GATEWAY_MCP_CALLED = "gateway.mcp.called"
```

The attribute shape is owned by `core/gateways/policy/audit.py`, not by the enum, in the
build/publish pair every existing event family uses (`core/events/utils.py` is the
pattern: a pure attribute builder the tests hit, a publish wrapper that resolves scope,
runs the L1 soft check and never raises):

```python
# core/gateways/policy/audit.py

def build_gateway_call_attributes(
    *,
    user_id: UUID,
    #
    target: GatewayTarget,
    decision: PolicyDecision,
    outcome: GatewayOutcome,
) -> Dict[str, Any]:
    """Flatten the three documents into the event's attributes map. `user_id`
    goes in explicitly because the stream envelope discards top-level user ids
    (§2.6); `outcome.owner` and `outcome.origin` are the two fields audit
    cannot reconstruct later (`policy.md`)."""
    ...

async def publish_gateway_call(
    *,
    scope: AuthScope,
    #
    target: GatewayTarget,
    decision: PolicyDecision,
    outcome: GatewayOutcome,
) -> None:
    """One event per call, allowed or denied. EventType by target.plane;
    RequestType.ROUTER. Logs and swallows publish failures — the caller's
    response never depends on the stream (the _safe_publish discipline)."""
    ...
```

---

## 5. types

Domain exceptions, in `types.py` per domain — the newer house convention
(`api/AGENTS.md`) — with the `*Error` suffix most of the codebase uses rather than the
channels design's bare names, because these classes will sit in tracebacks next to
`ConnectionNotFoundError` and `AdapterError` and should read alike. One domain base so
the router decorator can catch broadly; no HTTP status on any exception — mapping happens
at the boundary, and the tools domain's status-carrying exceptions are a habit
deliberately not copied.

```python
# core/gateways/types.py

class GatewaysError(Exception):
    """Base exception for the gateways domain."""

    def __init__(self, message: str = "Gateways error"):
        self.message = message
        super().__init__(self.message)


# core/gateways/policy/types.py

class PolicyDeniedError(GatewaysError):
    """The permission check refused (WP3). Carries the subject and the target so
    the denial is explainable on a fixed-shape wire (§9)."""

    def __init__(self, *, permission: Permission, target: str):
        self.permission = permission
        self.target = target
        super().__init__(f"Denied {permission.value} on {target}")


class EntitlementDeniedError(GatewaysError):
    """The plan-level check refused. Distinct from PolicyDeniedError because
    permissions and entitlements answer different questions and conflating them
    is a known trap (`policy.md`)."""

    def __init__(self, *, key: str, target: str):
        self.key = key
        self.target = target
        super().__init__(f"Entitlement {key} exceeded for {target}")


class SecretNotFoundError(GatewaysError):
    """Resolution failed. Names WHICH owner is missing a secret, so the
    caller learns whether they must connect or an administrator must
    (`secrets.md`: failure is never silent and never a fallback to none)."""

    def __init__(self, *, mode: SecretMode, missing: SecretOwnerKind, target: str):
        self.mode = mode
        self.missing = missing
        self.target = target
        super().__init__(
            f"No {missing.value} secret for {target} under mode {mode.value}"
        )


class SecretInvalidError(GatewaysError):
    """A secret exists and cannot be used — revoked, or refresh failed.
    Surfaces as needs_auth with a connect affordance (D17, D18)."""

    def __init__(self, *, target: str, detail: Optional[str] = None):
        self.target = target
        self.detail = detail
        super().__init__(f"Secret for {target} is invalid")


class CeilingExceededError(GatewaysError):
    """A governance ceiling rejects; it never silently clamps (D25). Carries the
    three facts the denial must name so a caller retries correctly the first
    time: the ceiling, the value asked for, and the value allowed."""

    def __init__(self, *, ceiling: str, requested: Union[int, float],
                 allowed: Union[int, float], target: str):
        self.ceiling = ceiling        # the config key, e.g. "max_output_tokens"
        self.requested = requested
        self.allowed = allowed
        self.target = target
        super().__init__(
            f"{ceiling} on {target}: requested {requested}, allowed {allowed}"
        )


# core/gateways/llms/types.py

class LLMEndpointNotFoundError(GatewaysError):
    def __init__(self, *, namespace: GatewayEndpointNamespace, name: str):
        self.namespace = namespace
        self.name = name
        super().__init__(f"LLM endpoint not found: {namespace.value}/{name}")


class LLMModelNotAllowedError(GatewaysError):
    """The model is outside the endpoint's allowlist — a custom endpoint's
    declared model allowlist, or a builtin provider's catalogue (§4.3)."""

    def __init__(self, *, model: str, namespace: GatewayEndpointNamespace, name: str):
        self.model = model
        self.namespace = namespace
        self.name = name
        super().__init__(f"Model {model} not allowed on {namespace.value}/{name}")


class LLMUpstreamError(GatewaysError):
    """The upstream failed after policy allowed. Carries the upstream status so
    the proxy can relay a faithful OpenAI-shaped error (§9)."""

    def __init__(self, *, provider_key: str, status_code: Optional[int] = None,
                 detail: Optional[str] = None):
        self.provider_key = provider_key
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Upstream {provider_key} failed ({status_code})")


# core/gateways/mcps/types.py

class MCPEndpointNotFoundError(GatewaysError):
    def __init__(self, *, namespace: GatewayEndpointNamespace, name: str,
                 provider: Optional[str] = None, integration: Optional[str] = None):
        self.namespace = namespace
        self.provider = provider
        self.integration = integration
        self.name = name
        target = "/".join(s for s in (namespace.value, provider, integration, name) if s)
        super().__init__(f"MCP endpoint not found: {target}")


class MCPToolNotAllowedError(GatewaysError):
    """The named tool is outside the endpoint's tool policy (§2.4)."""

    def __init__(self, *, tool: str, namespace: GatewayEndpointNamespace, name: str,
                 provider: Optional[str] = None, integration: Optional[str] = None):
        self.tool = tool
        self.namespace = namespace
        self.provider = provider
        self.integration = integration
        self.name = name
        target = "/".join(s for s in (namespace.value, provider, integration, name) if s)
        super().__init__(f"Tool {tool} not allowed on {target}")


class MCPAuthRequiredError(GatewaysError):
    """No usable secret on an OAuth endpoint. Carries the requirement so the
    boundary can return the connect affordance instead of a bare failure (D17)."""

    def __init__(self, *, requirement: GatewayConnectionRequirement):
        self.requirement = requirement
        super().__init__(f"Authorization required for {requirement.target}")


class MCPScopeInsufficientError(GatewaysError):
    """A step-up scope challenge from the upstream (D17; `mcp.md`). Raised by
    the OAuth checkpoint's client; until then unreachable. Declared now so the
    interaction path can be typed against it."""

    def __init__(self, *, target: str, scopes: List[str]):
        self.target = target
        self.scopes = scopes
        super().__init__(f"Additional scopes required for {target}: {scopes}")


class MCPUpstreamError(GatewaysError):
    def __init__(self, *, target: str, status_code: Optional[int] = None,
                 detail: Optional[str] = None):
        self.target = target
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Upstream {target} failed ({status_code})")
```

**`PolicyDeniedError` and `SecretNotFoundError` are different failures on purpose.**
The first says *you may not*; the second says *you could, once someone connects*. The
second maps to the needs-auth / needs-input interaction path (D17) and carries enough to
build the affordance; the first never does — offering a connect affordance to a caller who
lacks the permission would be an escalation invitation.

**`CeilingExceededError` names all three numbers, and that is what makes rejection
tolerable** (D25): a denial carrying the ceiling, the asked-for value and the allowed
value lets a caller retry correctly on the first attempt, where a silent clamp would
produce output that differs from what was asked with nothing explaining why. The
distinction D25 draws is preserved in *where* this raises: it guards **our** ceilings —
the per-endpoint config (D21) — and never second-guesses a physical limit like a model's
context window, which is the upstream's to clamp or refuse in its own shape.

**`MCPScopeInsufficientError` is declared, not deferred.** Step-up is out of the first
increments (`scope-checklist.md` marks it detect-and-fail-visibly), but the *type* costs
nothing and lets WP8's proxy write its handler arm now, so wave 3 changes behaviour
without touching signatures.

---

## 6. models

FastAPI wire models in `apis/fastapi/gateways/{llms,mcps}/models.py`, for the **management
routers only**. The data-plane proxies have no wire models at all: their request and
response shapes belong to the OpenAI surface and the MCP transport respectively, are
relayed as bytes, and wrapping them would break every client (§1). That absence is the
router-layer split made visible in this section.

The house triple, exactly as triggers and channels ship it — create/edit requests wrap
the core DTO under a named field, queries add `Windowing`, responses carry `count` plus
the entity:

```python
# apis/fastapi/gateways/llms/models.py

class LLMEndpointCreateRequest(BaseModel):
    endpoint: LLMEndpointCreate

class LLMEndpointEditRequest(BaseModel):
    endpoint: LLMEndpointEdit

class LLMEndpointQueryRequest(BaseModel):
    endpoint: Optional[LLMEndpointQuery] = None
    windowing: Optional[Windowing] = None

class LLMEndpointResponse(BaseModel):
    count: int = 0
    endpoint: Optional[LLMEndpoint] = None

class LLMEndpointsResponse(BaseModel):
    count: int = 0
    endpoints: List[LLMEndpoint] = Field(default_factory=list)


# apis/fastapi/gateways/mcps/models.py

class MCPEndpointCreateRequest(BaseModel):
    endpoint: MCPEndpointCreate

class MCPEndpointEditRequest(BaseModel):
    endpoint: MCPEndpointEdit

class MCPEndpointQueryRequest(BaseModel):
    endpoint: Optional[MCPEndpointQuery] = None
    windowing: Optional[Windowing] = None

class MCPEndpointResponse(BaseModel):
    count: int = 0
    endpoint: Optional[MCPEndpoint] = None

class MCPEndpointsResponse(BaseModel):
    count: int = 0
    endpoints: List[MCPEndpoint] = Field(default_factory=list)


# --- connect: declared now, routed in wave 3 (WP18) -------------------------- #

class MCPConnectRequest(BaseModel):
    """Scopes the user ticked, chosen at connect time from the server's own
    published metadata rather than from a stored list (D17)."""
    scopes: List[str] = Field(default_factory=list)


class MCPConnectResponse(BaseModel):
    """The authorization URL to open. The callback completes the exchange."""
    authorization_url: str
```

**The connect pair is declared and unrouted**, which is the shape wave 3 lands into rather
than a placeholder. What it does when it arrives: the callback writes one `oauth_grant`
secret and PUTs its id onto the endpoint. There is no
grant row to create, because the endpoint names its secret directly — the same door
`edit_endpoint` uses for every other field.

**No create or edit request for a secret.** An OAuth endpoint's `secret_id` is written by
`edit_endpoint`, the same full PUT every other field on the row goes through — there is no
separate authorization document to forge, and the consent flow that eventually populates it
is WP17/WP18's to design against this same shape rather than a document of its own.

---

## 7. daos

Interfaces in `core/gateways/{llms,mcps}/interfaces.py`, implementations in
`dbs/postgres/gateways/{llms,mcps}/dao.py`. DAOs open their own sessions; services never
touch the engine.

Conventions, each load-bearing:

- **`@abstractmethod`, keyword-only after `self`**, bare `#` lines separating scope →
  entity → modifiers — how every DAO in the codebase reads.
- **`project_id: UUID` first on every method.** Tenant scope is structural.
- **`user_id` on writes only**, feeding `created_by_id` / `updated_by_id`; `Optional`
  where the writer is a flow rather than a person (an OAuth callback's `edit_endpoint`
  call, setting `secret_id` with nobody in the loop).
- **Verb naming is `create_/fetch_/edit_/delete_/query_`**, the newer house style
  (`core/workflows/`), not the connections DAO's `get_/update_`. That domain's older names
  stay where they are; a new domain follows the current convention, and the divergence is
  confined to one file that predates it.
- **Implementations wrap reads in `@suppress_exceptions(...)`** with
  `exclude=[EntityCreationConflict]` on creates, exactly as
  `dbs/postgres/gateway/connections/dao.py` does — a slug collision surfaces, everything
  else degrades to `None` / `[]` / `False`.

```python
# core/gateways/llms/interfaces.py

class LLMEndpointsDAOInterface(ABC):
    """Persistence contract for custom LLM endpoints. Standard endpoints are
    generated (D20) and never pass through this interface — the service merges
    them in from catalog.py, which is why nothing here has a namespace
    parameter: every row is custom by construction (§2.3)."""

    @abstractmethod
    async def create_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: LLMEndpointCreate,
    ) -> Optional[LLMEndpoint]:
        """Insert. Raises EntityCreationConflict on a slug collision — the one
        exception a create surfaces, per the connections DAO discipline."""
        ...

    @abstractmethod
    async def fetch_endpoint(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
    ) -> Optional[LLMEndpoint]: ...

    @abstractmethod
    async def fetch_endpoint_by_slug(
        self,
        *,
        project_id: UUID,
        #
        slug: str,
    ) -> Optional[LLMEndpoint]:
        """The data-plane route lookup (§2.3). Backed by
        uq_llms_endpoints_project_slug, so at most one row by
        construction. None means the custom namespace has no such name — the
        proxy 404s in the surface's own error shape (§9)."""
        ...

    @abstractmethod
    async def edit_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: LLMEndpointEdit,
    ) -> Optional[LLMEndpoint]:
        """Full PUT over the editable surface (§4.3): data, flags, header,
        secret_id. provider_key and deployment_kind are absent from the Edit DTO and
        therefore untouchable here."""
        ...

    @abstractmethod
    async def delete_endpoint(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
    ) -> bool: ...

    @abstractmethod
    async def query_endpoints(
        self,
        *,
        project_id: UUID,
        #
        endpoint: Optional[LLMEndpointQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[LLMEndpoint]: ...


# core/gateways/mcps/interfaces.py

class MCPEndpointsDAOInterface(ABC):
    """Same six verbs, same semantics, over mcps_endpoints."""

    @abstractmethod
    async def create_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: MCPEndpointCreate,
    ) -> Optional[MCPEndpoint]: ...

    @abstractmethod
    async def fetch_endpoint(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
    ) -> Optional[MCPEndpoint]: ...

    @abstractmethod
    async def fetch_endpoint_by_slug(
        self,
        *,
        project_id: UUID,
        #
        slug: str,
    ) -> Optional[MCPEndpoint]: ...

    @abstractmethod
    async def edit_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: MCPEndpointEdit,
    ) -> Optional[MCPEndpoint]: ...

    @abstractmethod
    async def delete_endpoint(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
    ) -> bool: ...

    @abstractmethod
    async def query_endpoints(
        self,
        *,
        project_id: UUID,
        #
        endpoint: Optional[MCPEndpointQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[MCPEndpoint]: ...
```

`None` is overloaded across these returns; the disambiguation, stated once:

| method | `None` means | caller does |
| --- | --- | --- |
| `fetch_endpoint_by_slug` | no such custom endpoint | the proxy answers not-found in the surface's own shape |
| `edit_endpoint` | the row does not exist | 404 at the boundary |

### 7.1 The south ports

One port per plane, in the same `interfaces.py` files. This answers `contract.md`'s open
question — **two interfaces sharing the secret types, not one interface with two
shapes** — because the method shapes share nothing: a streaming byte relay on one side, a
single JSON round trip on the other. A merged interface would be a union with no caller.
What they share is exactly what is shared in fact: `ResolvedSecret` in,
plane-specific route and result types out.

The result types are dataclasses, not Pydantic models, because a relay result carries an
`AsyncIterator` and lives for one call between the service and the surface — it is never
validated, stored or serialized.

```python
# core/gateways/llms/interfaces.py

@dataclass
class LLMRelayResult:
    """One upstream answer, streaming or not. `body` yields exactly one chunk
    for a non-streaming call. `usage` is populated by the adapter once `body`
    is exhausted, when the upstream exposed it (the OpenAI stream carries a
    trailing usage frame; the translated adapter reports the library's count);
    None means unknowable, and the audit event says so rather than guessing."""
    status_code: int
    headers: Dict[str, str]
    body: AsyncIterator[bytes]
    usage: Optional[GatewayUsage] = None


class LLMUpstreamInterface(ABC):
    """Turns a resolved route plus a resolved secret into an upstream call.
    The core never imports an implementation; wiring happens at the entrypoint."""

    @abstractmethod
    async def relay_chat_completion(
        self,
        *,
        route: LLMResolvedRoute,
        secret: Optional[ResolvedSecret],
        #
        context: LLMCallContext,
        body: bytes,
        headers: Dict[str, str],
    ) -> LLMRelayResult:
        """Relay one completion call. `body` is the caller's payload untouched;
        `headers` are the caller's headers already stripped of authorization.
        `secret` is None only for targets whose auth scheme is NONE (the
        mocks). Raises LLMUpstreamError on upstream failure."""
        ...

    # async def relay_embedding(...) -> LLMRelayResult
    # Deferred with the whole evaluator path (D15). Declared here as the seam it
    # will occupy so nothing in the surface design forecloses it.


# core/gateways/mcps/interfaces.py

@dataclass
class MCPRelayResult:
    """A single JSON answer. The gateway targets the stateless revision in JSON
    mode — one request, one `application/json` response, 202 for notifications
    (`mcp.md`; the in-tree precedent is the runner's internal tool server,
    services/runner/src/tools/tool-mcp-http.ts). No SSE leg to carry."""
    status_code: int
    headers: Dict[str, str]
    body: bytes


class MCPUpstreamInterface(ABC):
    @abstractmethod
    async def relay(
        self,
        *,
        route: MCPResolvedRoute,
        auth: MCPRelayAuth,
        #
        context: MCPCallContext,
        body: bytes,
        headers: Dict[str, str],
    ) -> MCPRelayResult:
        """Transparent per-server relay (D16): same method, same body, same
        response, with only the route and the authorization changed. `auth` is
        the discriminated union from §4.4 — MCPDirectAuth for builtin/agenta and
        custom, MCPBrokeredAuth for builtin/composio — so the two secret
        mechanisms cannot be conflated by an adapter (D30). Raises MCPUpstreamError on transport
        failure; protocol-level errors from the server are NOT exceptions — they
        are the response body, relayed, because the server's own failure reason
        is what lets the model correct itself (the pass-through rule in
        api/AGENTS.md's error-envelope scope).

        A `custom` route's URL was typed by a user and the adapter is what
        connects to it, so the outbound guard runs here before the POST: the
        resolving variant in core/webhooks/utils.py, connecting to the literal
        IP it returns rather than re-resolving the hostname (D28). A blocked
        target is MCPUpstreamError — a transport refusal, never relayed as an
        upstream body. Only `custom` strictly needs it — agenta targets are ours
        and composio's are the broker's — but the adapter is reached only by
        `custom`, so it runs unconditionally rather than branching on a namespace
        it is never given."""
        ...
```

**The byte-for-byte constraint and the routing library cannot both hold everywhere, and
the port is shaped so each holds where it can.** `scope-checklist.md` marks the body
byte-for-byte as a constraint (prompt caching then works for free); `plan.md` WP7 puts the
routing library in-process. These conflict: the library takes parsed parameters and
re-serializes, which is not byte-for-byte. The resolution is the two LLM adapters in the
file tree — **`passthrough`** for upstreams that speak the caller's protocol
(OpenAI-compatible: `deployment=custom`, and direct providers whose API is
OpenAI-shaped), which relays the body untouched with only authorization injected; and
**`translated`** for providers whose wire differs and for cloud resellers whose auth is
request signing, where the library earns its place (D9) and byte-for-byte is impossible by
the upstream's own definition. A pure function in `registry.py`,
`select_upstream(provider_key, deployment) -> str`, picks the adapter key; the mocks
register under a third key. The constraint is therefore honest: byte-for-byte wherever
the protocol matches, and only there.

**Registries copy an existing shape verbatim** — four structurally identical registry
classes already exist in catalog, connections, tools and triggers; these are the fifth
and sixth, the same shape borrowed rather than shared:

```python
class LLMUpstreamRegistry:
    def __init__(self, *, adapters: Dict[str, LLMUpstreamInterface]): ...
    def get(self, key: str) -> LLMUpstreamInterface: ...   # raises on a miss
    def keys(self) -> list[str]: ...

class MCPUpstreamRegistry:
    def __init__(self, *, adapters: Dict[str, MCPUpstreamInterface]): ...
    def get(self, key: str) -> MCPUpstreamInterface: ...
    def keys(self) -> list[str]: ...
```

### 7.2 The secret resolver port

The third port, in `core/gateways/policy/interfaces.py`, implemented by
`policy/resolution.py` over `VaultService` alone (WP2) — every `SecretRef` arm resolves
through the vault directly, because the caller already has the row that names its secret
before it ever reaches the resolver (§2.1). This is the signature the seed must get right
(D10, `plan.md`): the owner is in it from the first commit, while the only answer is the
project.

```python
# core/gateways/policy/interfaces.py

class SecretsResolverInterface(ABC):
    """One lookup, called by both planes (`secrets.md`). Mockable (D23): the
    mock resolver answers from a dict and never touches the vault."""

    @abstractmethod
    async def resolve(
        self,
        *,
        scope: AuthScope,
        #
        ref: SecretRef,
        mode: SecretMode,
    ) -> ResolvedSecret:
        """Resolve one secret for one call.

        The mode logic, in full (`secrets.md`):
          PROJECT_ONLY  -> the project secret; SecretNotFoundError(PROJECT) if absent.
          USER_REQUIRED -> the (project, user) secret; SecretNotFoundError(USER)
                           if absent — NEVER falls back.
          USER_OPTIONAL -> the (project, user) secret if present, else the
                           project's; SecretNotFoundError(USER) naming the
                           narrower owner if neither exists.

        Until user-owned secrets ship, the user arm of every mode finds nothing
        and the modes degrade to project lookup or failure — behaviourally
        today's world, with the signature already right.

        By ref arm:
          ProviderKeyRef -> scan the project's provider_key / custom_provider
                            secrets for the provider, as the SDK's settings
                            builder does today (`models.md`).
          BoundSecretRef -> VaultService.get_secret_by_id, scoped to the project.
                            On an OAuth MCP endpoint this is the row's own
                            secret_id; SecretInvalidError when the endpoint's
                            flags.is_valid is False (D18), before the vault is
                            even read.

        Raises, never returns None: no path silently yields "no secret"
        (`secrets.md`), and the exceptions carry which owner is missing so the
        boundary can build the connect affordance (§5)."""
        ...

    @abstractmethod
    async def available_provider_keys(self, *, scope: AuthScope) -> Set[str]:
        """Provider keys with a resolvable project-owned secret. Names only,
        never a value — an existence test that must not read a secret.

        Same scan as the ProviderKeyRef arm (provider_key + custom_provider),
        returning the provider names found. Unlike resolve() it does NOT raise
        when nothing matches: the empty set is the correct answer for a project
        with no keys, whereas a caller reaching resolve() has already committed
        to needing one."""
        ...
```

**Why the existence question is on this port** (R2). D20 makes a generated `builtin` endpoint
exist for a project exactly when a provider key exists for it, so `LLMGatewayService.list_endpoints`
(§8) has to ask — and its constructor has no vault dependency, deliberately. Handing it a
`VaultService` would give one service two secret seams and defeat the port; calling `resolve()`
once per provider to catch `SecretNotFoundError` is control flow by exception plus eleven vault
reads per list. Existence of a secret is a secret-layer question, so it lives with the
secret layer.

**`builtin` deliberately never passes through this port.** Its secret lives at the
broker and never enters our vault, so there is nothing here to resolve — the MCP service
takes the brokered path instead, carrying the connection row in `MCPBrokeredAuth` (§4.4).
Routing that path through the resolver anyway, with a fourth ref arm, was rejected: it
would force `ResolvedSecret` to sometimes hold no secret, which un-types every
consumer to accommodate the one caller that has a different mechanism, not a different
lookup (D27).

**Why the resolver is a port and not just a function.** The mode logic is pure and could
be a function; the lookups are not, and WP2's tests need the failure cases — which are the
interesting cases — without a vault. A port gives the mocks a seam (D23) and keeps
`VaultService`'s encryption-context requirement (`set_data_encryption_key`, without which
the DAO raises) inside one adapter instead of in every caller.

**Both planes resolve with `PROJECT_ONLY` today, applied in the services** (§8): every
gateway secret is project-owned, so there is no user arm to prefer (`out-of-scope.md`).
The mode is not hardcoded in the resolver — it is an argument at the call site — which is
what keeps this a data change rather than a signature change if user-level secrets ever
ship: a call site moves to `USER_REQUIRED` or `USER_OPTIONAL` on a signature that already
accepts them.

### 7.3 The TokenStorage adapter (WP17)

The OAuth client is not written here — the official MCP SDK's `OAuthClientProvider` is
adopted whole (`libraries.md`), persisting through a `TokenStorage` protocol we implement.
The adapter is `core/gateways/mcps/token_storage.py`, and it is deliberately thin: **it is
the resolve-and-store glue between the SDK's protocol and the shapes this document already
defined**, not a fourth place secrets live.

```python
# core/gateways/mcps/token_storage.py

class VaultTokenStorage:
    """Implements the pinned MCP SDK's TokenStorage protocol over the vault.

    One instance per (scope, endpoint): reads resolve through the endpoint's
    own secret_id and VaultService.get_secret_by_id; writes update the
    oauth_grant secret IN PLACE and, the first time, edit the endpoint row to
    point secret_id at it (§2.1) — there is no separate row to touch. The
    exact method set and value types come from the pinned SDK version and are
    verified at implementation time (OR1) — this class's constructor is the
    contract wave 0 owns."""

    def __init__(
        self,
        *,
        scope: AuthScope,
        endpoint_id: UUID,
        #
        vault_service: VaultService,
        mcp_endpoints_dao: MCPEndpointsDAOInterface,
        mode: SecretMode = SecretMode.PROJECT_ONLY,
    ) -> None: ...
```

Verification items the seed does not pretend to settle, all tracked in `open-reviews.md`
OR1 and OR12: the protocol's exact method set in the pinned version, that
`OAuthClientProvider` accepts this storage unchanged, that its redirect and callback
hooks wire to the dashboard connect flow rather than a local browser opener, and the
version pin itself — no MCP SDK is a dependency anywhere today, in either language.

---

## 8. services

Constructors take the DAO interfaces and the ports via keyword-only DI, never concrete
classes; cross-domain composition passes concrete service objects, which is the house rule
the composition root already enforces elsewhere (`api/entrypoints/routers.py` — every
leaf service receives the shared `connections_service` instance, and the interface rule is
enforced at the DAO and adapter seams, not between services).

```python
class GatewayPolicyService:
    def __init__(
        self,
        *,
        resolver: SecretsResolverInterface,
    ) -> None: ...

class LLMGatewayService:
    def __init__(
        self,
        *,
        llm_endpoints_dao: LLMEndpointsDAOInterface,
        policy: GatewayPolicyService,
        resolver: SecretsResolverInterface,
        upstream_registry: LLMUpstreamRegistry,
    ) -> None: ...

class MCPGatewayService:
    def __init__(
        self,
        *,
        mcp_endpoints_dao: MCPEndpointsDAOInterface,
        policy: GatewayPolicyService,
        resolver: SecretsResolverInterface,
        connections_service: ConnectionsService,
        upstream_registry: MCPUpstreamRegistry,
    ) -> None: ...
    # connections_service is required and was missing from this list until R12.
    # list_endpoints resolves a builtin entry's state "through the existing
    # connections service" and relay resolves a builtin target the same way, so
    # the behaviour this document mandates is unreachable without it. It is a
    # concrete service object by the paragraph above, not an interface — the
    # rule bites at the DAO and adapter seams, not between services.
```

Service method signatures drop the kwarg type hints — the DTOs carry the types — following
the template's compression. The surfaces, in full:

```python
class GatewayPolicyService:
    # --- authorization (WP3) ------------------------------------------------ #

    async def authorize(self, *, scope, permission, target) -> PolicyDecision: ...
    # scope: AuthScope; target: GatewayTarget. Permission via check_action_access
    # (core/access/permissions/service.py), fail-CLOSED. NO entitlement check:
    # every user has both gateways, and what entitlements will express here are
    # limits, which ship with metering (D29). EntitlementDeniedError stays
    # declared and mapped so that wave changes a body, not a signature. Raises
    # nothing — returns the decision; the caller raises PolicyDeniedError so the
    # audit event can record the denial before the exception leaves the service.

    # --- audit + usage (WP4, D22, §2.6) ------------------------------------- #

    async def record(self, *, scope, target, decision, outcome) -> None: ...
    # One event per call, allowed or denied, built by policy/audit.py and
    # published through publish_event. Never raises — the caller's response
    # must not depend on the stream (the _safe_publish discipline).


class LLMGatewayService:
    # --- management: thin over the DAO, plus the generated merge ------------ #

    async def create_endpoint(self, *, project_id, user_id, endpoint) -> Optional[LLMEndpoint]: ...
    async def fetch_endpoint(self, *, project_id, endpoint_id) -> Optional[LLMEndpoint]: ...
    async def edit_endpoint(self, *, project_id, user_id, endpoint) -> Optional[LLMEndpoint]: ...
    async def delete_endpoint(self, *, project_id, endpoint_id) -> bool: ...
    async def query_endpoints(self, *, project_id, endpoint=None, windowing=None) -> List[LLMEndpoint]: ...
    async def list_endpoints(self, *, project_id) -> List[LLMEndpoint]: ...
    # list_endpoints is the merge: generated standard endpoints (catalog.py,
    # existing iff a provider_key secret exists for the provider — D20) plus the
    # custom rows; builtin joins when it has members (D30). The only read that
    # spans namespaces. Existence comes from the resolver port's
    # available_provider_keys (§7.2, R2) — names only, no vault dependency on
    # this constructor.

    # catalog.py — the generation, two pure functions over the SDK's static map
    # (sdks/python/agenta/sdk/utils/assets.py::supported_llm_models), imported
    # the way core/workflows/static_catalog.py already imports the SDK:
    #
    #   def standard_llm_endpoint(*, provider_key: str) -> Optional[LLMEndpoint]:
    #       """The generated endpoint for one provider: namespace=BUILTIN,
    #       slug=provider_key, deployment_kind=DIRECT, models.allowlist from the map,
    #       config at code defaults, no id and no lifecycle — it is not a row.
    #       None for an unknown provider. base_url comes from the SDK's direct
    #       endpoint map for passthrough-routed providers, which the adapter
    #       refuses without; translated ones keep litellm's own default.
    #       Secrets domain and URL now say the same word (D30, §2.3)."""
    #
    #   def standard_llm_endpoints() -> List[LLMEndpoint]:
    #       """All eleven, existence-unfiltered. The service intersects with
    #       the vault's provider keys, because existence is a fact about the
    #       project (a key exists), not about the catalogue (D20)."""

    # --- the data plane (WP6, WP7) ------------------------------------------ #

    async def relay_chat_completion(
        self, *, scope, namespace, name, body, headers,
    ) -> LLMRelayResult: ...

    async def list_models(self, *, scope, namespace, name) -> List[str]: ...
    # What backs GET /v1/models (§9, R3). Per endpoint, not global: resolve the
    # target as the relay does, authorize with USE_LLM_ENDPOINTS — it is a
    # data-plane read that reveals configuration — and return the allowlist: the
    # static catalogue's slugs for builtin, the allowlist for custom. No secret
    # resolved, no upstream called, and no new DTO: the proxy shapes the OpenAI
    # list body inline, because the data plane has no wire models (§6).


class MCPGatewayService:
    # --- management --------------------------------------------------------- #

    async def create_endpoint(self, *, project_id, user_id, endpoint) -> Optional[MCPEndpoint]: ...
    async def fetch_endpoint(self, *, project_id, endpoint_id) -> Optional[MCPEndpoint]: ...
    async def edit_endpoint(self, *, project_id, user_id, endpoint) -> Optional[MCPEndpoint]: ...
    async def delete_endpoint(self, *, project_id, endpoint_id) -> bool: ...
    async def query_endpoints(self, *, project_id, endpoint=None, windowing=None) -> List[MCPEndpoint]: ...
    async def list_endpoints(self, *, project_id) -> List[MCPEndpoint]: ...
    # The three-namespace merge (D30): builtin/agenta entries from code,
    # builtin/composio entries generated from the Composio catalog with their
    # connection state resolved through the existing connections service, custom
    # rows from the DAO. A revoked composio connection stays listed, in
    # NEEDS_AUTH — the query passes is_active=None, per D18.

    # No connect/consent verbs here. CUSTOM OAuth endpoints only (D30):
    # composio servers connect through the existing integrations connect flow,
    # whose state machine and redirect Composio already drives. Whatever the
    # OAuth checkpoint (WP17, WP18) ends up wiring for a custom server writes
    # the vault secret, then calls edit_endpoint to point secret_id at it
    # (§2.1) — the same full PUT every other field on the row goes through,
    # not a document of its own.

    # --- the data plane (WP8) ----------------------------------------------- #

    async def relay(
        self, *, scope, namespace, name, provider=None, integration=None,
        context, body, headers,
    ) -> MCPRelayResult: ...
    # name is what follows the provider segment (§2.3): the agenta slug
    # (possibly nested), the custom slug, or composio's connection slug — in
    # which case provider and integration carry the other two segments
```

**The relay path, spelled once** — both planes walk the same six steps, which is D7 made
concrete; only the nouns differ. `target` here is a service-internal resolved-target
value (the generated endpoint or the row, plus which namespace answered); it never
crosses a layer, so it is not a DTO in §4:

```python
async def relay_chat_completion(self, *, scope, namespace, name, body, headers):
    target = await self._resolve_target(project_id=scope.project_id,
                                        namespace=namespace, name=name)
    # generated or row; LLMEndpointNotFoundError / MCPEndpointNotFoundError
    self._check_active(target)                    # GatewayEndpointInactiveError:
                                                  # the operator's switch, §2.5

    context = parse_call_context(body)            # model + stream; MCP reads headers
    self._check_allowlist(target, context)        # LLMModelNotAllowedError /
                                                  # MCPToolNotAllowedError — before
                                                  # any secret is touched
    self._check_ceilings(target, context)         # CeilingExceededError: reject,
                                                  # never clamp (D25)

    decision = await self.policy.authorize(
        scope=scope, permission=Permission.USE_LLM_ENDPOINTS,
        target=target.as_policy_target(context),
    )
    if not decision.allowed:
        await self.policy.record(scope=scope, target=..., decision=decision,
                                 outcome=GatewayOutcome(status_code=403))
        raise PolicyDeniedError(...)

    secret = await self.resolver.resolve(
        scope=scope, ref=target.secret_ref(), mode=SecretMode.PROJECT_ONLY,
    )   # both planes (§7.2); NONE-scheme targets skip this step;
        # builtin/composio takes the brokered path instead — the connection row
        # in MCPBrokeredAuth, never the resolver (§4.4, D30) — and refuses with
        # SecretInvalidError when that connection is revoked, before dispatch

    result = await asyncio.wait_for(
        self.upstream_registry.get(
            select_upstream(target.provider_key, target.deployment_kind)
        ).relay_chat_completion(route=target.route(context), secret=secret,
                                context=context, body=body, headers=headers),
        timeout=target.config.timeout_seconds,
    )   # LLMUpstreamError on expiry

    result.body = self._drain_and_record(body=result.body, scope=scope, ...)
    return result
```

Four things in that body are deliberate:

- **Allowlist before secret.** A refused model or tool must not cost a vault read, and
  the refusal reason must be the allowlist, not a coincidental secret gap.
- **The timeout is the service's, not an adapter's.** `timeout_seconds` is a property of
  the endpoint, so an adapter that forgets it must not leave the call with no ceiling at
  all — which is exactly what happened while the value lived in one of three adapters.
  For a stream this bounds time-to-first-byte: the proxy drains the body after this
  returns, and a long legitimate stream is not a timeout.
- **Usage is recorded after the drain, on both paths.** Every adapter fills
  `result.usage` while its body generator runs, and the proxy is what advances it —
  so reading usage at this point would record `None` on every non-streaming call.
- **The denial is recorded before the exception leaves.** An audit trail that only records
  successes answers "did every call get checked" with "every call that succeeded" — the
  exact failure D1 names.
- **Usage is recorded even when the stream broke.** The record call sits after the relay
  returns, but for a streamed body the outcome's usage is read off the
  `LLMRelayResult` after exhaustion — the surface drains, the service records in a
  `finally`. A crashed stream records what is known (`usage=None`, the status), never
  nothing.

**`list_tools`-shaped reads need no service verb.** Listing an MCP server's tools *is* a
relay (`context.method` is the list method), transparently passed through with one
asymmetry: a tool filter trims the list result — entries dropped whole, never renamed —
while secret death does not filter anything (D18). Policy hides what may
never be called; secret state never hides what policy allows. The per-caller list
question from `contract.md` (shared-intermediary caching vs per-caller allowlists) is
thereby scoped: list results are cacheable per (endpoint, policy-hash), and caching is out
of the first increment anyway (`scope-checklist.md`).

**Where the state machine is computed.** `GatewayConnectionState` (§4.1) is derived in
`MCPGatewayService` per namespace: `READY` iff the endpoint's scheme is NONE (every
`builtin/agenta` entry), or — `custom` — `secret_id` is set and `flags.is_valid` is true,
or — `builtin/composio` — the referenced connection row is active and valid, read through
the existing connections service; `NEEDS_AUTH` otherwise for an OAuth or brokered endpoint
— with the connect affordance naming the custom endpoint directly (WP17, WP18's to wire)
and the existing integrations connect flow for composio; `NEEDS_INPUT` reserved for the
api_key scheme (deferred with its kind, D14). The LLM side derives the same states from key
presence (`NEEDS_INPUT` when no provider secret exists). Nothing stores these (§2.5).

---

## 9. routers

Two router objects per plane (§1): `router.py` — the management CRUD, house rules — and
`proxy.py` — the protocol surface, whose shapes are not ours. Both live in
`apis/fastapi/gateways/{llms,mcps}/` and are mounted at the entrypoint:

```python
# api/entrypoints/routers.py — mounts
app.include_router(router=llm_gateway.router,  prefix="/gateways/llms", tags=["Gateway: LLM"])
app.include_router(router=llm_gateway.proxy,   prefix="/gateways/llms", include_in_schema=False)
app.include_router(router=mcp_gateway.router,  prefix="/gateways/mcps", tags=["Gateway: MCP"])
app.include_router(router=mcp_gateway.proxy,   prefix="/gateways/mcps", include_in_schema=False)
```

The proxies share the plane prefix with the CRUD without collision because their first
path segment is the shared namespace enum (`builtin | standard | custom`, typed as the
path parameter so a wrong segment 422s at the router before any handler runs), and none
of those values can spell `endpoints`.

### Permissions — the new subjects

Six members join `Permission` (`core/access/permissions/types.py`), a triple per plane,
with `USE` as the data-plane verb following `USE_MOUNTS` — "run" belongs to things that
execute on our infrastructure; a gateway endpoint is *used*, like a mount:

```python
    # Gateway: LLM endpoints
    VIEW_LLM_ENDPOINTS = "view_llm_endpoints"
    EDIT_LLM_ENDPOINTS = "edit_llm_endpoints"
    USE_LLM_ENDPOINTS = "use_llm_endpoints"

    # Gateway: MCP endpoints
    VIEW_MCP_ENDPOINTS = "view_mcp_endpoints"
    EDIT_MCP_ENDPOINTS = "edit_mcp_endpoints"
    USE_MCP_ENDPOINTS = "use_mcp_endpoints"
```

Role wiring follows the tools precedent exactly: Viewer gains the `VIEW` pair, Annotator
adds the `USE` pair (as it holds `RUN_TOOLS` today), Editor adds the `EDIT` pair. Two
triples rather than one shared set because the planes are separately governable — an
organization may let annotators call models and not reach tool servers — and per-plane
subjects are what `policy.md`'s authorization row ("may they use this server, this tool")
needs to be expressible at all. **Every member is checked by a named route below** — the
`RUN_TRIGGERS` lesson (defined, role-wired, checked by nothing) is not repeated.

### The management CRUD

Routes declared imperatively with `add_api_route`, every route with an `operation_id` and
`response_model_exclude_none=True`; collection routes keep their trailing slash. The LLM
block in full; the MCP block is the same shapes, one-for-one, and is elided to its table:

```python
class LLMGatewayRouter:
    def __init__(self, *, llm_gateway_service: LLMGatewayService):
        self.service = llm_gateway_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/endpoints/", self.create_endpoint, methods=["POST"],
            operation_id="create_llm_endpoint",
            response_model=LLMEndpointResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/", self.list_endpoints, methods=["GET"],
            operation_id="list_llm_endpoints",
            response_model=LLMEndpointsResponse,
            response_model_exclude_none=True,
        )
        # GET /endpoints/ is the merged listing — generated + custom (§8);
        # POST /endpoints/query filters rows only, because generated endpoints
        # have nothing to filter on but the provider, which GET already shows.
        self.router.add_api_route(
            "/endpoints/query", self.query_endpoints, methods=["POST"],
            operation_id="query_llm_endpoints",
            response_model=LLMEndpointsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}", self.fetch_endpoint, methods=["GET"],
            operation_id="fetch_llm_endpoint",
            response_model=LLMEndpointResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}", self.edit_endpoint, methods=["PUT"],
            operation_id="edit_llm_endpoint",
            response_model=LLMEndpointResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}", self.delete_endpoint, methods=["DELETE"],
            operation_id="delete_llm_endpoint",
        )

        # --- MCP management (MCPGatewayRouter) — same shapes, three paths total ---
        #   POST/GET   /endpoints/                 create_mcp_endpoint / list_mcp_endpoints
        #   POST       /endpoints/query            query_mcp_endpoints
        #   GET/PUT    /endpoints/{endpoint_id}    fetch_mcp_endpoint / edit_mcp_endpoint
        #   DELETE     /endpoints/{endpoint_id}    delete_mcp_endpoint
        #
        #   POST       /endpoints/{endpoint_id}/connect   (WP18, wave 3)
        #   GET        /connect/callback                  (WP18, wave 3)
        #
        # Both are declared in §6 and NOT wired here. The callback writes the
        # oauth_grant secret and PUTs secret_id through edit_endpoint above —
        # the same door every other field uses.
```

One handler in full, house body — decorators, scope, permission, service, envelope. The
scope comes from `get_auth_scope()`, **not** `request.state` (below):

```python
@intercept_exceptions()
@handle_gateway_exceptions()
async def create_endpoint(
    self,
    request: Request,
    *,
    body: LLMEndpointCreateRequest,
) -> LLMEndpointResponse:
    scope = get_auth_scope()
    await self._check(scope, Permission.EDIT_LLM_ENDPOINTS)

    endpoint = await self.service.create_endpoint(
        project_id=scope.project_id,
        user_id=scope.user_id,
        #
        endpoint=body.endpoint,
    )

    return LLMEndpointResponse(count=1 if endpoint else 0, endpoint=endpoint)
```

**`AuthScope` over `request.state`.** The
existing gateway, tools and triggers routers read `request.state.project_id` / `request.state.user_id` as raw
strings and re-wrap them in `UUID(...)` per call site; the design's principal claims (D2)
rest on `AuthScope` — frozen, four required UUIDs, assembled once by the auth middleware
and ContextVar-backed (`api/oss/src/utils/context.py`). The new code uses
`get_auth_scope()` exclusively: it is typed, it cannot be partially populated, it carries
`organization_id` (which `request.state` reads kept dropping and the audit event needs),
and the events domain already prefers it for exactly these reasons
(`core/events/utils.py::request_scope`). The old handlers are not rewritten here; they
converge when touched.

**`handle_gateway_exceptions()` is written once**, in a shared
`apis/fastapi/gateways/exceptions.py`, not duplicated per router — tools and
triggers currently duplicate `handle_adapter_exceptions()` verbatim, and those domains
are out of scope to fix (D15); ours is simply written once. Mapping: `*NotFoundError` → 404,
`GatewayEndpointInactiveError` → 403 naming the flag (§2.5),
`PolicyDeniedError` / `EntitlementDeniedError` → 403, `*NotAllowedError` → 403,
`CeilingExceededError` → 400, its body naming the ceiling, the requested and the allowed
values (D25), `MCPAuthRequiredError` → 409 carrying the `GatewayConnectionRequirement`
(an interaction, not a failure — D17), `SecretNotFoundError` / `SecretInvalidError` → 409
on the same reading — *you could, once someone connects* — `*UpstreamError` → 424, or 502
when the upstream answered ≥500 (the 424/502 split tools and triggers already use).

**The 409 for a missing secret holds on all three surfaces**, the two proxies included
(R11, settled). The proxies still translate into their own error *bodies* — that is the
real difference between the surfaces — but a caller branching on status gets one answer
per cause, not one per plane.

### The data planes

The proxies declare externally-fixed paths and **no wire models** (§6). Authentication is
the platform's own: the minted secret token travels as `Secret <token>`, one of the three
schemes the middleware already verifies by decode alone (D13) — so the proxy handlers see
a full `AuthScope` like any other route, and nothing here is public. It arrives in
`X-AG-Credentials` when the caller sends that header, and in `Authorization` otherwise; the
dedicated header wins because on a pass-through route `Authorization` is the caller's vendor
auth and not ours to read (D31). Both are stripped before any relay, on both planes.

**Both proxies strip the upstream's framing headers before answering** — `content-length`,
`content-encoding`, `transfer-encoding`, `connection`, `keep-alive` — through one shared
helper rather than a copy per plane. Two reasons, and the second is the one that bites:
ASGI computes those for our own response, and Starlette keeps a `content-length` it is
handed, so a relayed one outlives any body we rewrite. The MCP plane rewrites bodies
routinely — an INCLUDE tool policy filters `tools/list` — and `content-encoding: gzip`
would describe bytes httpx already decoded on our behalf.

```python
class LLMGatewayProxy:
    def __init__(self, *, llm_gateway_service: LLMGatewayService):
        self.service = llm_gateway_service
        self.router = APIRouter()

        # The OpenAI-compatible surface. base_url for a client is the route
        # minus the protocol suffix — e.g. {api_url}/gateways/llms/standard/openai/v1.
        # The trailing /v1 is the UPSTREAM protocol's own path, not our version
        # segment (§2.3): the client appends /v1/chat/completions to any base it
        # is handed, so the base we hand out ends /v1 and nothing else about
        # this surface is versioned here.
        self.router.add_api_route(
            "/builtin/{provider}/v1/chat/completions",
            self.chat_completions_builtin, methods=["POST"],
            operation_id="llm_gateway_chat_completions_builtin",
        )
        self.router.add_api_route(
            "/custom/{slug}/v1/chat/completions",
            self.chat_completions_custom, methods=["POST"],
            operation_id="llm_gateway_chat_completions_custom",
        )
        self.router.add_api_route(
            "/builtin/{provider}/v1/models",
            self.list_models_builtin, methods=["GET"],
            operation_id="llm_gateway_list_models_builtin",
        )
        self.router.add_api_route(
            "/custom/{slug}/v1/models",
            self.list_models_custom, methods=["GET"],
            operation_id="llm_gateway_list_models_custom",
        )
        # /v1/models answers from the allowlist — the static catalogue for
        # standard, the allowlist for custom — so a harness that lists before
        # calling sees exactly what policy will allow. Backed by
        # LLMGatewayService.list_models (§8, R3); the handler shapes the
        # OpenAI list body inline, since the data plane has no wire models.
        #
        # "/builtin/{provider}/{rest:path}/v1/chat/completions"
        # Reserved, empty today (D30) — declared when the LLM plane gains a
        # provider we hold the key for, which is also where metering attaches.
        #
        # "/{namespace}/.../v1/embeddings"
        # Deferred with the evaluator path (D15). The shape is reserved by this
        # comment so nothing else claims it.

class MCPGatewayProxy:
    def __init__(self, *, mcp_gateway_service: MCPGatewayService):
        self.service = mcp_gateway_service
        self.router = APIRouter()

        # One URL per server (D16). Streamable HTTP, stateless JSON mode:
        # POST carries JSON-RPC; GET/DELETE answer 405, as the runner's
        # internal tool server already does. No version segment: the MCP
        # protocol is a POST to the endpoint URL itself, revision negotiated
        # in a header (§2.3). One route per namespace — builtin takes a
        # catch-all after its provider segment, because each provider owns the
        # grammar under it: composio spells {integration}/{connection}, agenta a
        # slug that may itself be nested (D30). split_builtin_path does the
        # per-provider split at the boundary.
        self.router.add_api_route(
            "/builtin/{provider}/{rest:path}",
            self.relay_builtin, methods=["POST"],
            operation_id="mcp_gateway_relay_builtin",
        )
        self.router.add_api_route(
            "/custom/{slug}", self.relay_custom, methods=["POST"],
            operation_id="mcp_gateway_relay_custom",
        )
        # the same two paths answer GET/DELETE with 405 via
        # self.reject_stream_verbs, include_in_schema=False — elided
```

The two thin MCP handlers both delegate to `MCPGatewayService.relay` (§8), each passing
its namespace and segments; they exist because the routes carry different path
parameters, not because the behaviour differs.

Each proxy's `utils.py` holds the one pure function that reads the caller's request for
routing, and nothing else — both are fully unit-testable and both fail typed:

```python
# apis/fastapi/gateways/llms/utils.py
def parse_llm_call_context(*, body: bytes) -> LLMCallContext:
    """Extract model and stream from the JSON body without materializing a
    parsed copy for relay — the body itself stays byte-for-byte (§7.1).
    Raises ValueError when the body names no model; the proxy translates that
    into the surface's own invalid-request error shape."""

# apis/fastapi/gateways/mcps/utils.py
def parse_mcp_call_context(*, headers: Dict[str, str]) -> MCPCallContext:
    """Read the protocol's method and target headers (`mcp.md`, header-based
    routing) — the body is never parsed for routing. Header names are pinned
    against the 2026-07-28 revision at implementation time, in this one file."""
```

The proxy handlers check `USE_LLM_ENDPOINTS` / `USE_MCP_ENDPOINTS` through the same
`authorize` path (§8) — the permission lookup per call that D13 accepts as the cost of the
one-gateway-wide token, keeping a revoked permission effective immediately rather than at
the next mint.

**Denials wear the surface's own error shape.** The LLM proxy translates the mapped
HTTP status into the OpenAI error body — `{"error": {"message", "type", "code"}}` — with
`code` carrying the stable cause (`policy_denied`, `model_not_allowed`,
`ceiling_exceeded`, `secret_missing`); the MCP proxy answers protocol-shaped errors at the transport
status the relay produced, and gateway-authored refusals as the protocol's error result
with the same stable causes in the error data. What it must never do is leak the house
envelope onto either surface, or swallow the upstream's own error, which passes through
untouched (D16; the pass-through scope rule in `api/AGENTS.md`).

**Streaming rides `StreamingResponse` over `LLMRelayResult.body`**, with the audit record
written in the handler's `finally` after the iterator is exhausted (§8). A policy decision
is always made before the first upstream byte; what happens to a decision that expires
mid-stream is an open item in `architecture.md` §5 and is not silently decided here — the
stream, once begun, completes.

### Wiring

```python
# api/entrypoints/routers.py — construction, conditional on nothing:
# the gateways have no third-party dependency to gate on (D23)

llm_endpoints_dao = LLMEndpointsDAO(engine=_transactions_engine)
mcp_endpoints_dao = MCPEndpointsDAO(engine=_transactions_engine)

secret_resolver = SecretsResolver(vault_service=vault_service)
gateway_policy_service = GatewayPolicyService(resolver=secret_resolver)

llm_gateway_service = LLMGatewayService(
    llm_endpoints_dao=llm_endpoints_dao,
    policy=gateway_policy_service,
    resolver=secret_resolver,
    upstream_registry=LLMUpstreamRegistry(adapters={
        "passthrough": PassthroughLLMAdapter(),
        "translated": TranslatedLLMAdapter(),
        "mock": MockLLMAdapter(),          # registered always; reachable only
    }),                                    # via the mock endpoints the local
)                                          # stack defines (D23)

mcp_gateway_service = MCPGatewayService(
    mcp_endpoints_dao=mcp_endpoints_dao,
    policy=gateway_policy_service,
    resolver=secret_resolver,
    upstream_registry=MCPUpstreamRegistry(adapters={
        "http": HttpMCPAdapter(),          # custom: MCPDirectAuth
        "composio": ComposioMCPAdapter(),  # builtin/composio: MCPBrokeredAuth (D30)
        "mock": MockMCPAdapter(),          # serves the builtin/agenta mocks (D23)
    }),
)
```

---

## 10. Retention

The platform has no operational retention today; the channels design flagged it and
inherited it. The gateways must not inherit it **for secret material**, and mostly do
not need to, because the lifetimes fall out of the shapes above:

- **Tokens do not accumulate.** An `oauth_grant` secret is rewritten in place on every
  refresh (`secrets.md`) — there is no token history and no graveyard. Deletion is
  event-driven, not scheduled: revoking access deletes the vault secret, and the
  endpoint's `secret_id` follows it to NULL automatically (`ondelete="SET NULL"`, §2.1)
  rather than through a second write; a **deleted project** takes everything with it
  through the `CASCADE` chain — endpoint rows and the vault secrets themselves, whose
  table already cascades on project. The inbound credentials retain nothing by construction:
  minted, fifteen-minute expiry, never stored (D13).
- **Audit and usage records outlive what they describe, and die with the project.** They
  ride the events domain (D22) and inherit its retention posture wholesale — including
  the per-organization quota at ingest. Deleting an endpoint or clearing its secret does
  **not** delete the events that transited it; that is what makes them an audit trail
  rather than a cache, and it is why the event carries the owner and payer inline instead
  of referencing rows that may be gone (§2.6).
- **Configuration is cheap and keeps itself.** Endpoint rows are small, project-scoped,
  and hard-deleted by their DELETE routes; nothing here needs archival semantics, and
  none is designed.

What is deliberately not solved: a platform-wide retention policy for the events stream.
The gateways will raise its stakes — one event per model and tool call is a volume
profile the read-analytics events do not have — but the fix belongs to the events domain
(periodic, plan-configurable, as the channels design also concluded), not to a per-row
TTL invented here.

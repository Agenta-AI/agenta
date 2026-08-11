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
one API folder per plane; and the model plane's folder is named `llm/`, not `models/`.

```text
core/gateways/        <- NEW parent, sibling to the existing core/gateway/ (§1)
  dtos.py             our shared vocabulary — auth scheme, connection state,
                      connect affordance, endpoint config (§4)
  types.py            GatewaysError, the base exception
  policy/             the shared core both planes evaluate against (D7, D12)
    dtos.py           principal-adjacent DTOs: decision, target, outcome, credential triple
    types.py          policy + resolution exceptions
    interfaces.py     CredentialResolverInterface — the one lookup, owner-first (D10)
    resolution.py     the resolve() implementation over VaultService (WP2)
    service.py        GatewayPolicyService: authorize, audit, usage (WP3, WP4)
    audit.py          EventType members + attribute builders for the events stream (D22)
  llm/                the model plane (WP1, WP6, WP7)
    dtos.py           enums + core DTOs
    types.py          domain exceptions
    interfaces.py     LlmEndpointsDAOInterface + LlmUpstreamInterface (south port)
    registry.py       adapter key -> LlmUpstreamInterface
    catalog.py        standard endpoints generated from the SDK's static map (D20)
    service.py        LlmGatewayService: management + the data-plane relay
    providers/
      passthrough/adapter.py   OpenAI-compatible upstreams, byte-for-byte relay
      translated/adapter.py    the routing library in-process: shape + reseller signing
      fake/adapter.py          the fake LLM endpoint (D23, WP5)
  mcp/                the tool plane (WP1, WP8, WP9)
    dtos.py
    types.py
    interfaces.py     McpEndpointsDAOInterface + McpGrantsDAOInterface + McpUpstreamInterface
    registry.py       upstream kind -> McpUpstreamInterface
    token_storage.py  the MCP SDK's TokenStorage protocol over the vault (WP17, OR1)
    service.py        McpGatewayService: management + the transparent proxy
    providers/
      http/adapter.py          remote Streamable HTTP servers
      fake/adapter.py          the fake MCP server (D23, WP5)
dbs/postgres/gateways/
  llm/                dbas.py, dbes.py, dao.py, mappings.py
  mcp/                dbas.py, dbes.py, dao.py, mappings.py
apis/fastapi/gateways/
  exceptions.py       handle_gateway_exceptions(), written once (§9)
  llm/                models.py, router.py (management CRUD), proxy.py (OpenAI surface),
                      utils.py (call-context parsing off the body)
  mcp/                models.py, router.py (management CRUD), proxy.py (MCP surface),
                      utils.py (protocol header parsing)
```

The existing `core/gateway/`, `dbs/postgres/gateway/` and their tables are untouched in
this scope — including `gateway_connections`, whose ownership work is designed, not
scheduled (`secrets.md`).

Changed in place, in later work packages: `core/secrets/` gains the two OAuth kinds
(enum member, settings DTO pair, union arm, validator branch — WP16, §4);
`core/events/types.py` gains two `EventType` members (WP4, §4);
`core/access/permissions/types.py` gains six `Permission` members (§9).

Not shown: the deployable fakes. The adapter-level fakes above satisfy unit and contract
tests; Checkpoint A's acceptance tests additionally need the fakes running as compose
services in the local stack (`plan.md` WP5). Those are services, not entities, and are out
of this document's scope.

---

## 1. The tables

Three new, two reused, one deliberately left alone.

| table | what it is | what it is not |
| --- | --- | --- |
| `llm_gateway_endpoints` | one **custom** LLM endpoint: a reachable provider deployment, its route, its model allowlist, its configuration | not a model, and not the catalogue — standard endpoints are generated, never stored (D20) |
| `mcp_gateway_endpoints` | one **custom** MCP server: its URL, auth mode, tool policy, configuration | not a catalog of tools — the server owns its tool list (D19) |
| `mcp_gateway_grants` | one owner's authorization on one server, pointing at the vault row that holds the tokens | not a token store — the `oauth_grant` secret is (D3, D14) |
| `secrets` *(reused)* | gains two kinds, `oauth_provider` and `oauth_grant`; the payload is one encrypted blob, so **no schema change** | not gaining the owner column yet — ownership is designed, not scheduled (`secrets.md`) |
| events stream *(reused)* | one audit record per call, carrying decision, principal, owner, payer and usage | not a new table and not a second pipeline (D22) |
| `gateway_connections` *(existing)* | untouched; a Composio-brokered MCP endpoint will reference a row here | not the endpoint registry, and not our domain — see below |

Reading it as a sentence: *a project registers custom endpoints on either plane; a standard
endpoint exists the moment a key exists for it; an OAuth-protected server accumulates one
grant row per owner, each pointing at one vault secret; and every call, allowed or denied,
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
two protocol surfaces (`llm/`, `mcp/`), one shared core (`policy/`), inside one parent —
where three loose top-level siblings would leave the policy core homeless and make the
"one design" claim invisible in the tree.

**The one genuine connection between the two domains, stated so nobody re-litigates it:**
a Composio-brokered MCP server will point at a `gateway_connections` row — the Composio
account that fronts it lives there, and our `mcp_gateway_endpoints` registry references
it the way any domain references another's entities. A registry referencing a
neighbouring domain's rows is normal, and it is not a reason to live in that neighbour's
folder.

**Why `llm/`, not `models/`.** The skeleton proposed `models/` for the model plane.
Renamed: a folder called `models` whose API layer contains a `models.py` holding wire
models is self-parody, and the product noun throughout `v1/` is "the LLM gateway". `llm/`
and `mcp/` are also symmetric, which D19 says the two gateways are.

### Why the table names do not mirror the folder path

The tables are `llm_gateway_endpoints`, `mcp_gateway_endpoints` and `mcp_gateway_grants` —
**not** `gateways_*`, although `core/gateway/connections/` ↔ `gateway_connections` sets a
mirror-the-path precedent. On purpose: a `gateways_*` prefix would sort directly beside
`gateway_connections` in every schema listing and read as kin to a domain this design just
argued its way out of. Table names are read far more often in isolation — in `psql`, in
migrations, in an incident — than folder paths are, so the name leads with the plane,
which is the part someone scanning a schema actually needs, and carries `gateway` as the
qualifier.

### The API folder, and why the data plane and the CRUD do not share a router object

The domain has an API folder per plane, `apis/fastapi/gateways/{llm,mcp}/` — unremarkable
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
allowlist, a configuration — with a vault reference where a credential exists. Different
domain, different noun, different lifecycle; reuse would put our semantics on a table
tools and triggers read, and would leave `provider_key`/`integration_key` meaningless on
our rows. The connection an OAuth flow eventually produces on the MCP side is a
**grant**, and grants get their own table because their key is the owner, which
connections do not have. The reuse that *is* correct is the reference stated above: a
Composio-brokered MCP endpoint points at its connection row; it does not become one.

### Why grants are a row when the tokens are a secret

The vault holds the tokens (`oauth_grant`, D14); the gateway holds no secret material (D3).
But the vault payload is a `PGPString` blob — encrypted at rest, invisible to SQL — so
*"the grant for this owner on this server"* cannot be answered by querying inside secrets.
Something unencrypted must carry the lookup key `(project, endpoint, owner)` and point at
the vault row. That is precisely the webhook-subscription / SSO-provider shape: a domain
row carrying a `secret_id`. The row also gives the operational facts a home the payload
cannot serve — `is_valid` after a failed refresh (D18), the refresh attempt's outcome in
`status` — without decrypting anything.

### Why the LLM plane has no grants table

The asymmetry is deliberate and follows from what each credential *is*. An OAuth token is
**audience-bound**: minted for one server, by that server's authorization server, per
owner — so the binding `(owner, endpoint) → secret` is a fact that must be stored, and
`mcp_gateway_grants` stores it. A provider key is bound to nothing but its provider:
today it is a freestanding vault secret discovered by scanning the project's secrets for
the provider (the SDK's settings builder does exactly this, `models.md`), and when
user-owned secrets arrive the same scan runs over the vault's own owner columns
(`secrets.md`). There is no per-endpoint fact to record — a key backs every endpoint of
its provider at once — so a binding table would assert pairs nobody configures, the same
cross-product mistake the channels design refused for agents and spaces. The one place an
LLM endpoint does bind a specific secret, a custom endpoint, the binding is one column on
the endpoint row itself (§2.1).

### What is deliberately not a table

**Policy is derived, never stored.** The skeleton asked whether policy records exist. No:
every policy input already has a home — the permission catalog, the entitlement counters,
the per-endpoint configuration and tool allowlist on the endpoint rows, the static defaults
in code — and the decision is computed per call by `GatewayPolicyService` (§8). A stored
decision would need invalidation on every input; the existing two-layer entitlement pattern
(cached soft check, authoritative hard check) already answers the caching question and is
reused rather than reinvented (`policy.md`).

**Model routes are not rows.** A standard endpoint's route is derivable: a stable prefix,
the `standard` marker, and the provider's own name (D20). The provider-to-models catalogue
is already a static map in the SDK (`sdks/python/agenta/sdk/utils/assets.py`,
`supported_llm_models`, eleven providers), and the API already imports the SDK for exactly
this kind of static catalogue (`core/workflows/static_catalog.py`). `core/gateways/llm/catalog.py`
wraps that map; a standard endpoint *exists* when a `provider_key` secret exists for its
provider, and stores nothing.

**Audit and usage are events, not tables.** One event per call into the existing events
domain (D22): `publish_event` onto the Redis stream, the `EventsWorker` behind it, the
existing query surface in front. Usage measures ride the same event's `attributes` rather
than a second write — the gateway is the only point that sees all of both planes, and
recording real usage from day one is the requirement that cannot be backfilled
(`policy.md`); the meters are a later consumer of the stream, not a schema this design
owns. §2.7 works through the shape.

**`gateway_connections` gains nothing.** The skeleton reserved "whatever the owner
dimension implies for lookup". The owner dimension lands in the resolution *signature* now
and in storage later (`secrets.md`, D10); no column changes in this scope.

---

## 2. dbas

Abstract mixins declaring columns, composed from `dbs/postgres/shared/dbas.py`. The existing
gateway domain skips the `dbas.py` file entirely — `ConnectionDBE` composes the shared mixins
directly — but that works only while a domain has one table. These domains have two and
three, so each gets a `dbas.py`, per the house rule that the file exists "when needed"
(`api/AGENTS.md`).

`ProjectScopeDBA`, `LifecycleDBA`, `IdentifierDBA`, `FlagsDBA`, `TagsDBA` and `MetaDBA` go
on every table, matching `gateway_connections`. The rest are answers to questions:

| mixin | add it when | in these domains |
| --- | --- | --- |
| `SlugDBA` | the entity is addressed by a stable name someone types or routes on | both endpoint tables — the slug is the URL identifier (§2.3); not grants |
| `HeaderDBA` (`name`, `description`) | a human labels it in the UI | both endpoint tables; not grants — nobody names a grant, exactly as nobody names a delivery |
| `DataDBA` | there is a typed payload the columns should not fragment | both endpoint tables; not grants — the payload is in the vault, the row is a pointer |
| `StatusDBA` | an attempt against the outside world can fail | endpoints (last relay/probe failure) and grants (last refresh outcome) |

There is no `UserScopeDBA` on the endpoint tables: custom endpoints are project-owned
configuration, and user-owned *endpoints* are not designed anywhere in `v1/`. The user
dimension enters exactly once, on grants, where it is the owner key (§2.2).

```python
# dbs/postgres/gateways/llm/dbas.py

class LlmEndpointDBA(
    ProjectScopeDBA, IdentifierDBA, SlugDBA, LifecycleDBA,
    HeaderDBA, DataDBA, StatusDBA, FlagsDBA, TagsDBA, MetaDBA,
):
    """One custom LLM endpoint: a provider deployment we reach (D19, D20)."""
    __abstract__ = True

    provider_key = Column(String, nullable=False)
    # String, not Enum: the provider set grows with the routing library's, and
    # gateway_connections.provider_key is already a String for the same reason.
    deployment = Column(
        SQLEnum(LlmDeploymentKind, name="llmdeploymentkind_enum"), nullable=False
    )
    # Enum: the deployment set is ours and closed — direct, custom, azure,
    # bedrock, sagemaker, vertex_ai — aligned with CustomProviderKind and the
    # runner wire's `deployment` axis (services/runner/src/protocol.ts).
    secret_id = Column(UUID(as_uuid=True), nullable=True)
    # nullable: an endpoint with no credential is legitimate — the fake (D23),
    # an unauthenticated self-hosted server. FK with SET NULL, §2.1.
    # data: { route: {...}, model_slugs: [...], config: {...}, extras: {...} } — §2.4


# dbs/postgres/gateways/mcp/dbas.py

class McpEndpointDBA(
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
    # the `oauth_provider` client registration when auth_mode is oauth; NULL for
    # `none`. FK with SET NULL, §2.1.
    # data: { url, headers: {...}, tool_policy: {...}, config: {...}, oauth: {...} } — §2.4


class McpGrantDBA(
    ProjectScopeDBA, IdentifierDBA, LifecycleDBA,
    StatusDBA, FlagsDBA, TagsDBA, MetaDBA,
):
    """One owner's authorization on one server — a pointer at the vault, plus the
    operational facts the encrypted payload cannot serve (D18, §1)."""
    __abstract__ = True

    endpoint_id = Column(UUID(as_uuid=True), nullable=False)
    user_id = Column(UUID(as_uuid=True), nullable=True)
    # NULL means the grant is project-owned; a UUID means it belongs to that
    # member in this project. This is the (project, user) owner key from
    # `secrets.md`, present from the first migration because the grant is the
    # one entity whose owner already varies (§2.2).
    secret_id = Column(UUID(as_uuid=True), nullable=False)
    # NOT NULL: a grant row without its tokens is meaningless. FK CASCADE, §2.1.
    # expires_at = Column(TIMESTAMP(timezone=True), nullable=True)   # see below
    # No DataDBA and no expires_at: the scopes, tokens and expiry live in the
    #   `oauth_grant` payload. Refresh is lazy — the OAuth client refreshes at
    #   use time when the token is stale — so nothing queries "grants expiring
    #   soon" and expiry fails the column test (§2.4). A proactive refresh
    #   sweep, if one is ever built, promotes expires_at to a column then.
```

### 2.1 The secret reference and its constraint

The two existing precedents disagree. `webhook_subscriptions.secret_id` is a bare nullable
UUID with no constraint (`dbs/postgres/webhooks/dbas.py`); the SSO provider row carries
`nullable=False` plus `ForeignKeyConstraint(["secret_id"], ["secrets.id"],
ondelete="CASCADE")` (`api/ee/src/dbs/postgres/organizations/dbes.py`). The webhook shape
is the older and weaker one: a dangling `secret_id` there degrades to a `log.warning` at
dispatch time, which is tolerable for a signing key and not for a gateway credential.

All three new tables take the constraint, with the delete behaviour chosen per table:

- **Endpoints: `ondelete="SET NULL"`.** Deleting a vault secret must not silently delete an
  endpoint's configuration — the tool policy, the model allowlist, the timeouts survive,
  and calls fail visibly with the needs-auth / needs-input state until someone rebinds.
  This is D18's posture (a dead secret does not hide tools) applied to the row itself:
  credential death never erases configuration. `CASCADE` here would let a vault cleanup
  quietly unregister servers.
- **Grants: `ondelete="CASCADE"`.** The grant row is nothing but a pointer plus scope;
  when the `oauth_grant` secret is deleted — revocation, member removal — a surviving row
  would point at nothing and mean nothing. The service deletes vault-first exactly as the
  SSO delete path does (`api/ee/src/core/organizations/service.py`); the constraint covers
  the direction where the vault row dies first.

**Why the constraint at all, given the house rule that child-to-child references are
validated in the application layer.** That rule (followed by channels, stated in its entities document) is
about *domain* children — a grant's `endpoint_id` has no FK to `mcp_gateway_endpoints`,
because composite-scoped references across domain tables are validated in the service. The
secrets table is not a domain sibling; it is the platform vault, `secrets.id` is a plain
unique primary key, and the reference is load-bearing for a security claim. The database
keeping it honest costs one constraint.

### 2.2 The owner dimension: in every signature now, in one table now, in storage later

D10 is a signature rule: every credential lookup takes the owner from the outset, even
while the only answer is the project. What that means layer by layer, so nobody
over-applies it:

- **The resolver takes the owner always.** `CredentialResolverInterface.resolve()` takes
  the full `AuthScope` and a `CredentialMode`, and the mode logic consults
  `scope.user_id` (§7.2). This is the signature that is expensive to retrofit, and it is
  the one thing `plan.md` says the seed must get right.
- **The grants DAO takes the owner as a key.** `fetch_grant(project_id=..., endpoint_id=...,
  user_id=...)` with `user_id: Optional[UUID]` — `None` selects the project-owned grant.
  Grants are the one entity whose owner varies from the first migration, because an OAuth
  token belongs to whoever consented (`secrets.md`: one per owner per server).
- **The endpoint DAOs do not grow a user key.** Custom endpoints are project configuration;
  their verbs take `project_id` first and `user_id` only on writes, as authorship for
  `LifecycleDBA` — the house convention. Reading D10 as "every DAO verb keys on a user"
  would put a dead column on two tables.
- **The secrets table itself changes later.** `secrets.md` designs the `(project, user)`
  owner for vault rows and explicitly does not schedule it. When it lands it is a default
  column value, not a data migration, and no gateway signature moves — that is the point
  of taking the owner now.

### 2.3 The slug is the namespaced identifier

D16 requires the identifier in a gateway URL to carry a namespace — an id or a slug, never
a display name. The grammar, shared by both planes:

```text
/gateways/llm/{namespace}/{name}/...      namespace ∈ {standard, custom}
/gateways/mcp/{namespace}/{name}          namespace ∈ {standard, custom}
```

- **`standard`** — generated endpoints (D20). The name is the provider's own key on the LLM
  plane (`/gateways/llm/standard/openai/v1`) and the built-in server's key on the MCP plane.
  No row, no slug, no collision possible: the set is defined in code
  (`core/gateways/llm/catalog.py`, and the built-in MCP set which starts empty — its first
  members are the fakes).
- **`custom`** — stored endpoints. The name is the row's `slug`, unique per project
  (`uq_llm_gateway_endpoints_project_slug`, §3), validated by the shared `Slug` DTO's
  `URL_SAFE_SLUG` rule.

The namespace is a **path segment, not a column**: every row is `custom` by construction
(D20 stores nothing else), so a column would hold one value forever. The DTO carries a
`namespace` field stamped by the service — `CUSTOM` for rows, `STANDARD` for generated
endpoints — so one `LlmEndpoint` shape serves both and a listing can merge them (§4).

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

- **`provider_key`, `deployment`, `auth_mode` are columns.** The management UI filters on
  them (`query_endpoints`), and `auth_mode` decides which service paths are even legal.
- **`url` is `data`.** Nothing queries it: the route lookup is by slug (§2.3), and two
  endpoints pointing at one URL with different tool policies is legitimate, so there is no
  uniqueness to enforce. It is read back whole and handed to the adapter — the exact
  profile of `external_locator` in the channels design.
- **`tool_policy` is `data`.** Enforcement loads the endpoint row it already has; the
  policy is never a query predicate. Its shape mirrors the runner wire's `McpToolPolicy`
  (`services/runner/src/protocol.ts`) field for field, so the same document means the same
  thing on both sides of the gateway (§4).
- **`config` is `data`.** Timeouts, ceilings and extra headers (D21) are read at call time
  off the row in hand. Per-endpoint, only on custom endpoints — standard endpoints take
  the code defaults, which is what "ours to define" means concretely.
- **`model_slugs` is `data`.** The allowlist check happens in the service with the row
  loaded; `custom_provider` secrets already carry their model list inside the payload the
  same way.
- **`secret_id` is a column** — the FK acts on it (§2.1).
- **`expires_at` is not a column** until something queries it (§2, grants).

### 2.5 Grant uniqueness under a nullable owner

"One grant per owner per server" (`secrets.md`) with `user_id NULL` meaning the project
cannot be one unique constraint: Postgres treats NULLs as distinct, so
`UNIQUE (project_id, endpoint_id, user_id)` would admit unlimited project-owned duplicates.
Two partial unique indexes state it exactly, the idiom `trigger_subscriptions` already
uses (`dbs/postgres/triggers/dbes.py`):

```python
Index("uq_mcp_gateway_grants_user", "project_id", "endpoint_id", "user_id",
      unique=True, postgresql_where=text("user_id IS NOT NULL")),
Index("uq_mcp_gateway_grants_project", "project_id", "endpoint_id",
      unique=True, postgresql_where=text("user_id IS NULL")),
```

A second consent by the same owner is therefore an **update to the vault secret plus a
touch of the row**, never a second row — which is also what keeps refresh cheap: rewritten
on every refresh means the `oauth_grant` payload is updated in place (`secrets.md`), and
the row's identity never moves.

### 2.6 Flags and status: policy state versus credential state versus attempt outcome

Three different facts, three different homes, following the house pattern:

- **`flags.is_active`** — an operator's switch, on endpoints and grants. Server-set default
  `True`; a deactivated endpoint refuses calls at policy time with a reason that names the
  flag.
- **`flags.is_valid`** — credential health, on grants only. Server-set, never
  client-writable (the connections service already enforces exactly this: "always
  server-set in flags"). A failed refresh flips it `False`; D18 then holds — the server's
  tools stay listed, the call fails, the existing escalation paths offer reconnection.
  Endpoints have no `is_valid` because an endpoint does not authenticate; its credential's
  health lives with the credential.
- **`status` (`StatusDBA`)** — the outcome of the last attempt, the shared
  `{timestamp, type, code, message, stacktrace}` shape. On a grant: the refresh failure
  that explains *why* `is_valid` is false. On an endpoint: the last relay or probe failure,
  which is diagnosis, not policy input.

No lifecycle enum column exists on any of the three tables. Nothing here is a state
machine: an endpoint is configuration, a grant is a pointer, and the
ready / needs-auth / needs-input states are **derived** per caller at read time — `ready`
requires a valid grant *for that owner*, so it cannot be a row fact (§4).

### 2.7 Why usage and audit write no rows here

D22 settles audit: one event per call into the existing events domain. Concretely, the
gateway emits through `publish_event`
(`api/oss/src/core/events/streaming.py`) with two new `EventType` members (§4), the
`EventsWorker` consumes the stream, and the existing `VIEW_EVENTS`-gated query surface
reads it back. The envelope discards a top-level user id ("events are system-generated"),
so the principal travels in `attributes` — the pattern every existing publish helper
already follows.

Usage rides the same event rather than a second write. The two facts that cannot be
reconstructed later — the credential **owner** and the **payer** (`secret_origin`) — are
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
# dbs/postgres/gateways/llm/dbes.py

class LlmEndpointDBE(Base, LlmEndpointDBA):
    __tablename__ = "llm_gateway_endpoints"
    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["secret_id"], ["secrets.id"], ondelete="SET NULL"),
        UniqueConstraint("project_id", "slug",
                         name="uq_llm_gateway_endpoints_project_slug"),
        Index("ix_llm_gateway_endpoints_project_provider",
              "project_id", "provider_key"),
        Index("ix_llm_gateway_endpoints_flags", "flags", postgresql_using="gin"),
    )


# dbs/postgres/gateways/mcp/dbes.py

class McpEndpointDBE(Base, McpEndpointDBA):
    __tablename__ = "mcp_gateway_endpoints"
    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["secret_id"], ["secrets.id"], ondelete="SET NULL"),
        UniqueConstraint("project_id", "slug",
                         name="uq_mcp_gateway_endpoints_project_slug"),
        Index("ix_mcp_gateway_endpoints_flags", "flags", postgresql_using="gin"),
    )


class McpGrantDBE(Base, McpGrantDBA):
    __tablename__ = "mcp_gateway_grants"
    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["secret_id"], ["secrets.id"], ondelete="CASCADE"),
        # one grant per owner per server, under a nullable owner — §2.5
        Index("uq_mcp_gateway_grants_user", "project_id", "endpoint_id", "user_id",
              unique=True, postgresql_where=text("user_id IS NOT NULL")),
        Index("uq_mcp_gateway_grants_project", "project_id", "endpoint_id",
              unique=True, postgresql_where=text("user_id IS NULL")),
        # the resolution read: all grants for one endpoint, then filter by owner
        Index("ix_mcp_gateway_grants_endpoint", "project_id", "endpoint_id"),
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
| the two partial indexes on grants | two concurrent consent flows by one owner | the vault — one secret per grant, no orphaned twin |
| `ON CONFLICT` on grant create (§7) | a re-entered OAuth callback | the caller, who gets the surviving row |

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
`Header` — and that convergence is available later rather than done now.

One semantic addition the existing copies lack: `NONE`. The first checkpoint's reachable
targets are unauthenticated by design (D23 — our own servers and the fakes, no OAuth, no
static kind), so the scheme enum must be able to say so.

```python
# core/gateways/dtos.py

class GatewayAuthScheme(str, Enum):
    """How an upstream authenticates us. The gateways' own copy (OR4, §4.1)."""
    OAUTH = "oauth"
    API_KEY = "api_key"
    NONE = "none"


class GatewayConnectionState(str, Enum):
    """Derived per caller at read time — never stored (§2.6)."""
    READY = "ready"            # a usable credential exists for this owner
    NEEDS_AUTH = "needs_auth"  # OAuth target with no grant for this owner; connect
    NEEDS_INPUT = "needs_input"  # a secret must be supplied before use


class GatewayConnectAffordance(BaseModel):
    """The call to make when a credential is missing — an interaction, not a
    failure (D17). Same shape as the tools domain's ConnectAffordance."""
    endpoint: str
    body: Dict[str, Any] = Field(default_factory=dict)


class GatewayConnectionRequirement(BaseModel):
    """One target's credential state, returned from discovery and from a refused
    call. `connect` is present exactly when the state is not READY."""
    target: str                      # "{namespace}/{name}", per §2.3
    state: GatewayConnectionState
    connect: Optional[GatewayConnectAffordance] = None


class GatewayEndpointNamespace(str, Enum):
    """The first URL segment under each plane (§2.3, D16, D20)."""
    STANDARD = "standard"   # generated; ours to define; not editable (D21)
    CUSTOM = "custom"       # a row; configurable


class GatewayEndpointConfig(BaseModel):
    """Per-endpoint configuration, one concern for both planes (D21). Custom
    endpoints only; standard endpoints take the code defaults."""
    timeout_seconds: Optional[float] = None
    extra_headers: Optional[Dict[str, str]] = None
```

### 4.2 The policy core's DTOs

```python
# core/gateways/policy/dtos.py

class GatewayPlane(str, Enum):
    LLM = "llm"
    MCP = "mcp"


class CredentialMode(str, Enum):
    """Declared per resolution site, not per call (`secrets.md`)."""
    USER_OPTIONAL = "user_optional"   # the user's if present, else the project's
    USER_REQUIRED = "user_required"   # the user's, or fail — never fall back
    PROJECT_ONLY = "project_only"     # always the project's; ignore user secrets


class CredentialOwnerKind(str, Enum):
    PROJECT = "project"
    USER = "user"


class CredentialOwner(BaseModel):
    """Whose stored secret answered the lookup. Audit cannot reconstruct this
    later, which is why it travels with the credential (`secrets.md`)."""
    kind: CredentialOwnerKind
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
    """A standard LLM endpoint: find the provider_key secret for this provider."""
    provider_key: str

class BoundSecretRef(BaseModel):
    """A custom endpoint: the row already names its secret (§2.1)."""
    secret_id: UUID

class GrantRef(BaseModel):
    """An OAuth-protected MCP endpoint: find this owner's grant (§2.5)."""
    endpoint_id: UUID

CredentialRef = Union[ProviderKeyRef, BoundSecretRef, GrantRef]


class ResolvedCredential(BaseModel):
    """The (credential, owner, payer) triple (`secrets.md`). Never serialized
    outward: it exists between the resolver and an adapter, in process, and no
    wire model embeds it."""
    secret: SecretResponseDTO         # decrypted, from VaultService
    owner: CredentialOwner
    origin: SecretOrigin


# --- what policy decides, and what audit records ---------------------------- #

class GatewayTarget(BaseModel):
    """The plane-neutral description of what a call is trying to reach."""
    plane: GatewayPlane
    namespace: GatewayEndpointNamespace
    name: str                          # provider key / built-in key / slug (§2.3)
    #
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
    """How the call ended, for the audit event (§2.7)."""
    status_code: Optional[int] = None
    duration_ms: Optional[int] = None
    #
    usage: Optional[GatewayUsage] = None
    owner: Optional[CredentialOwner] = None   # None when no credential was resolved
    origin: Optional[SecretOrigin] = None
```

**Why `ResolvedCredential` carries the whole `SecretResponseDTO`** rather than a plucked
string: the payload shape differs per kind — a provider key is one string, a custom
provider is url + key + extras, an OAuth grant is a token pair — and the adapter, not the
resolver, knows which fields its upstream needs. Plucking in the resolver would grow a
per-kind switch in exactly the layer that must stay kind-agnostic. The containment rule is
behavioural, not structural: the DTO never crosses the north port, and `redaction` of it in
logs follows the runner's existing deny-set discipline.

**Why the ref is a union and not three resolver methods.** `secrets.md` specifies *one*
function called by both planes, and the mode logic — the part that must not fork — is
identical across all three lookups. Three methods would triplicate it; one method with a
typed ref keeps the owner/mode semantics in one body and makes the lookup shape data.

### 4.3 The LLM plane

```python
# core/gateways/llm/dtos.py

class LlmDeploymentKind(str, Enum):
    """How a provider is reached — the wire's `deployment` axis, aligned with
    CustomProviderKind in core/secrets/enums.py (`models.md`: keep both axes)."""
    DIRECT = "direct"
    CUSTOM = "custom"          # OpenAI-compatible third party or self-hosted
    AZURE = "azure"
    BEDROCK = "bedrock"
    SAGEMAKER = "sagemaker"
    VERTEX = "vertex_ai"


class LlmEndpointRoute(BaseModel):
    """The route, mirroring the runner wire's `endpoint` object field for field
    (services/runner/src/protocol.ts): baseUrl for OpenAI-compatible, apiVersion
    for Azure, region for AWS and Vertex, headers for non-secret routing."""
    base_url: Optional[str] = None
    api_version: Optional[str] = None
    region: Optional[str] = None
    headers: Optional[Dict[str, str]] = None


class LlmEndpointConfig(GatewayEndpointConfig):
    max_output_tokens: Optional[int] = None   # the ceiling (D21). A call above it
                                              # is REJECTED, never silently
                                              # clamped (D25) — CeilingExceededError, §5


class LlmEndpointData(BaseModel):
    route: LlmEndpointRoute = Field(default_factory=LlmEndpointRoute)
    model_slugs: List[str] = Field(default_factory=list)   # the allowlist; empty means
                                                           # refuse everything, not allow all
    config: LlmEndpointConfig = Field(default_factory=LlmEndpointConfig)
    extras: Optional[Dict[str, Any]] = None


class LlmEndpointFlags(BaseModel):
    is_active: bool = True
    # no is_valid: an endpoint does not authenticate; credential health lives
    # with the credential (§2.6)


class LlmEndpoint(Identifier, Slug, Header, Lifecycle, Metadata):
    provider_key: str
    deployment: LlmDeploymentKind
    namespace: GatewayEndpointNamespace = GatewayEndpointNamespace.CUSTOM
    secret_id: Optional[UUID] = None
    #
    data: LlmEndpointData = Field(default_factory=LlmEndpointData)
    flags: LlmEndpointFlags = Field(default_factory=LlmEndpointFlags)
    status: Optional[Status] = None


class LlmEndpointCreate(Slug, Header, Metadata):
    provider_key: str
    deployment: LlmDeploymentKind
    secret_id: Optional[UUID] = None
    #
    data: LlmEndpointData = Field(default_factory=LlmEndpointData)
    flags: LlmEndpointFlags = Field(default_factory=LlmEndpointFlags)


class LlmEndpointEdit(Identifier, Header, Metadata):
    # no provider_key, no deployment: repointing an endpoint at a different
    # provider family is a different endpoint, not an edit — absence makes it
    # unexpressible, the channels rule
    secret_id: Optional[UUID] = None
    #
    data: LlmEndpointData = Field(default_factory=LlmEndpointData)
    flags: LlmEndpointFlags = Field(default_factory=LlmEndpointFlags)


class LlmEndpointQuery(BaseModel):
    provider_key: Optional[str] = None
    deployment: Optional[LlmDeploymentKind] = None
    slug: Optional[str] = None


class LlmCallContext(BaseModel):
    """What policy needs from the request body — parsed minimally, so the body
    itself can relay byte for byte (`scope-checklist.md`)."""
    model: str
    stream: bool = False


class LlmResolvedRoute(BaseModel):
    """What the south port receives: the route after selection, with the model
    id already in the routing library's form."""
    provider_key: str
    deployment: LlmDeploymentKind
    model: str
    #
    base_url: Optional[str] = None
    api_version: Optional[str] = None
    region: Optional[str] = None
    headers: Optional[Dict[str, str]] = None
    #
    config: LlmEndpointConfig = Field(default_factory=LlmEndpointConfig)
```

### 4.4 The MCP plane

```python
# core/gateways/mcp/dtos.py

class McpToolPolicyMode(str, Enum):
    ALL = "all"
    INCLUDE = "include"


class McpToolPolicy(BaseModel):
    """Field-for-field mirror of the runner wire's McpToolPolicy
    (services/runner/src/protocol.ts), so the same document means the same
    thing on both sides of the gateway."""
    mode: McpToolPolicyMode = McpToolPolicyMode.ALL
    names: Optional[List[str]] = None   # required by the service when mode is INCLUDE


class McpEndpointConfig(GatewayEndpointConfig):
    """Nothing beyond the shared pair yet; the subclass exists so a first
    MCP-only knob is a DTO change, symmetric with the LLM side."""


class McpOAuthData(BaseModel):
    """Discovered authorization facts, cached on the row. Written by the OAuth
    checkpoint (WP17); absent until then. Not secret material — discovery
    metadata only (D3 holds: tokens live in the vault)."""
    resource: Optional[str] = None
    authorization_server: Optional[str] = None
    scopes_offered: List[str] = Field(default_factory=list)


class McpEndpointData(BaseModel):
    url: str
    headers: Optional[Dict[str, str]] = None     # non-secret routing headers only
    tool_policy: McpToolPolicy = Field(default_factory=McpToolPolicy)
    config: McpEndpointConfig = Field(default_factory=McpEndpointConfig)
    oauth: Optional[McpOAuthData] = None


class McpEndpointFlags(BaseModel):
    is_active: bool = True


class McpEndpoint(Identifier, Slug, Header, Lifecycle, Metadata):
    auth_mode: GatewayAuthScheme
    namespace: GatewayEndpointNamespace = GatewayEndpointNamespace.CUSTOM
    secret_id: Optional[UUID] = None
    #
    data: McpEndpointData
    flags: McpEndpointFlags = Field(default_factory=McpEndpointFlags)
    status: Optional[Status] = None


class McpEndpointCreate(Slug, Header, Metadata):
    auth_mode: GatewayAuthScheme
    secret_id: Optional[UUID] = None
    #
    data: McpEndpointData
    flags: McpEndpointFlags = Field(default_factory=McpEndpointFlags)


class McpEndpointEdit(Identifier, Header, Metadata):
    auth_mode: GatewayAuthScheme       # editable: a server can move from none to
                                       # oauth; the service revalidates secret_id
    secret_id: Optional[UUID] = None
    #
    data: McpEndpointData
    flags: McpEndpointFlags = Field(default_factory=McpEndpointFlags)


class McpEndpointQuery(BaseModel):
    auth_mode: Optional[GatewayAuthScheme] = None
    slug: Optional[str] = None


# --- grants ----------------------------------------------------------------- #

class McpGrantFlags(BaseModel):
    is_active: bool = True
    is_valid: bool = True     # server-set; flipped False by a failed refresh (§2.6)


class McpGrant(Identifier, Lifecycle):
    endpoint_id: UUID
    user_id: Optional[UUID] = None     # None: project-owned (§2.5)
    secret_id: UUID
    #
    flags: McpGrantFlags = Field(default_factory=McpGrantFlags)
    status: Optional[Status] = None


class McpGrantCreate(BaseModel):
    """Service-authored only: the OAuth flow writes the vault secret first, then
    this. No wire model wraps it (§6)."""
    endpoint_id: UUID
    user_id: Optional[UUID] = None
    secret_id: UUID
    #
    flags: McpGrantFlags = Field(default_factory=McpGrantFlags)


class McpGrantQuery(BaseModel):
    endpoint_id: Optional[UUID] = None
    user_id: Optional[UUID] = None


class McpCallContext(BaseModel):
    """What routing reads from the protocol's method and target headers — the
    body is never parsed for routing (`mcp.md`, header-based routing). The
    exact header names are pinned against the 2026-07-28 revision at
    implementation time, in apis/fastapi/gateways/mcp/utils.py."""
    method: str
    target: Optional[str] = None


class McpResolvedRoute(BaseModel):
    url: str
    headers: Dict[str, str] = Field(default_factory=dict)
    config: McpEndpointConfig = Field(default_factory=McpEndpointConfig)
```

**`secret_id` is on the entity DTOs, and that is a recorded divergence from `secrets.md`.**
That document says domain responses exclude the secret *and its id*; the as-built
precedent it cites does not do this — `WebhookSubscription` carries `secret_id: Optional[UUID]`
(`core/webhooks/types.py`) and excludes only the material (`exclude={"secret"}` in
`core/webhooks/service.py`). The gateways follow the code, for a reason the stricter
sentence ignores: edits are full PUTs sourced from the freshly fetched entity, and a field
that is writable but never readable breaks that contract — every edit would silently
unbind the credential. The id is a pointer; reading the material it points at still takes
`VIEW_SECRET` through the vault. The material itself never appears on any DTO in this
document, in either direction.

**The empty allowlist refuses.** `model_slugs: []` on a custom endpoint means no model may
be called, not "everything" — the permissive reading would make the dangerous state the
default state. Standard endpoints expose their provider's whole catalogue (the static map
is the allowlist, `scope-checklist.md`), which is the deliberate asymmetry: ours are known,
customs are declared.

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
    """One owner's tokens for one server. Rewritten in place on every refresh
    (`secrets.md`); the grant row points here (§2.5)."""
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
user's token bundle a "provider" would be a lie the resolver pays for later.

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
    (§2.7); `outcome.owner` and `outcome.origin` are the two fields audit
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


class CredentialNotFoundError(GatewaysError):
    """Resolution failed. Names WHICH owner is missing a credential, so the
    caller learns whether they must connect or an administrator must
    (`secrets.md`: failure is never silent and never a fallback to none)."""

    def __init__(self, *, mode: CredentialMode, missing: CredentialOwnerKind, target: str):
        self.mode = mode
        self.missing = missing
        self.target = target
        super().__init__(
            f"No {missing.value} credential for {target} under mode {mode.value}"
        )


class CredentialInvalidError(GatewaysError):
    """A credential exists and cannot be used — revoked, or refresh failed.
    Surfaces as needs_auth with a connect affordance (D17, D18)."""

    def __init__(self, *, target: str, detail: Optional[str] = None):
        self.target = target
        self.detail = detail
        super().__init__(f"Credential for {target} is invalid")


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


# core/gateways/llm/types.py

class LlmEndpointNotFoundError(GatewaysError):
    def __init__(self, *, namespace: str, name: str):
        self.namespace = namespace
        self.name = name
        super().__init__(f"LLM endpoint not found: {namespace}/{name}")


class LlmModelNotAllowedError(GatewaysError):
    """The model is outside the endpoint's allowlist — a custom endpoint's
    declared model_slugs, or a standard provider's catalogue (§4.3)."""

    def __init__(self, *, model: str, namespace: str, name: str):
        self.model = model
        self.namespace = namespace
        self.name = name
        super().__init__(f"Model {model} not allowed on {namespace}/{name}")


class LlmUpstreamError(GatewaysError):
    """The upstream failed after policy allowed. Carries the upstream status so
    the proxy can relay a faithful OpenAI-shaped error (§9)."""

    def __init__(self, *, provider_key: str, status_code: Optional[int] = None,
                 detail: Optional[str] = None):
        self.provider_key = provider_key
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Upstream {provider_key} failed ({status_code})")


# core/gateways/mcp/types.py

class McpEndpointNotFoundError(GatewaysError):
    def __init__(self, *, namespace: str, name: str):
        self.namespace = namespace
        self.name = name
        super().__init__(f"MCP endpoint not found: {namespace}/{name}")


class McpToolNotAllowedError(GatewaysError):
    """The named tool is outside the endpoint's tool policy (§2.4)."""

    def __init__(self, *, tool: str, namespace: str, name: str):
        self.tool = tool
        self.namespace = namespace
        self.name = name
        super().__init__(f"Tool {tool} not allowed on {namespace}/{name}")


class McpAuthRequiredError(GatewaysError):
    """No usable grant for this owner on an OAuth endpoint. Carries the
    requirement so the boundary can return the connect affordance instead of a
    bare failure (D17)."""

    def __init__(self, *, requirement: GatewayConnectionRequirement):
        self.requirement = requirement
        super().__init__(f"Authorization required for {requirement.target}")


class McpScopeInsufficientError(GatewaysError):
    """A step-up scope challenge from the upstream (D17; `mcp.md`). Raised by
    the OAuth checkpoint's client; until then unreachable. Declared now so the
    interaction path can be typed against it."""

    def __init__(self, *, target: str, scopes: List[str]):
        self.target = target
        self.scopes = scopes
        super().__init__(f"Additional scopes required for {target}: {scopes}")


class McpUpstreamError(GatewaysError):
    def __init__(self, *, target: str, status_code: Optional[int] = None,
                 detail: Optional[str] = None):
        self.target = target
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Upstream {target} failed ({status_code})")
```

**`PolicyDeniedError` and `CredentialNotFoundError` are different failures on purpose.**
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

**`McpScopeInsufficientError` is declared, not deferred.** Step-up is out of the first
increments (`scope-checklist.md` marks it detect-and-fail-visibly), but the *type* costs
nothing and lets WP8's proxy write its handler arm now, so wave 3 changes behaviour
without touching signatures.

---

## 6. models

FastAPI wire models in `apis/fastapi/gateways/{llm,mcp}/models.py`, for the **management
routers only**. The data-plane proxies have no wire models at all: their request and
response shapes belong to the OpenAI surface and the MCP transport respectively, are
relayed as bytes, and wrapping them would break every client (§1). That absence is the
router-layer split made visible in this section.

The house triple, exactly as triggers and channels ship it — create/edit requests wrap
the core DTO under a named field, queries add `Windowing`, responses carry `count` plus
the entity:

```python
# apis/fastapi/gateways/llm/models.py

class LlmEndpointCreateRequest(BaseModel):
    endpoint: LlmEndpointCreate

class LlmEndpointEditRequest(BaseModel):
    endpoint: LlmEndpointEdit

class LlmEndpointQueryRequest(BaseModel):
    endpoint: Optional[LlmEndpointQuery] = None
    windowing: Optional[Windowing] = None

class LlmEndpointResponse(BaseModel):
    count: int = 0
    endpoint: Optional[LlmEndpoint] = None

class LlmEndpointsResponse(BaseModel):
    count: int = 0
    endpoints: List[LlmEndpoint] = Field(default_factory=list)


# apis/fastapi/gateways/mcp/models.py

class McpEndpointCreateRequest(BaseModel):
    endpoint: McpEndpointCreate

class McpEndpointEditRequest(BaseModel):
    endpoint: McpEndpointEdit

class McpEndpointQueryRequest(BaseModel):
    endpoint: Optional[McpEndpointQuery] = None
    windowing: Optional[Windowing] = None

class McpEndpointResponse(BaseModel):
    count: int = 0
    endpoint: Optional[McpEndpoint] = None

class McpEndpointsResponse(BaseModel):
    count: int = 0
    endpoints: List[McpEndpoint] = Field(default_factory=list)

class McpGrantQueryRequest(BaseModel):
    grant: Optional[McpGrantQuery] = None
    windowing: Optional[Windowing] = None

class McpGrantResponse(BaseModel):
    count: int = 0
    grant: Optional[McpGrant] = None

class McpGrantsResponse(BaseModel):
    count: int = 0
    grants: List[McpGrant] = Field(default_factory=list)

class McpConnectRequest(BaseModel):
    """Begin the consent flow on one endpoint (WP18). Scopes are SELECTED, not
    inherited from everything the server advertises (D17)."""
    scopes: List[str] = Field(default_factory=list)

class McpConnectResponse(BaseModel):
    count: int = 0
    redirect_url: Optional[str] = None
```

**Grants get no create or edit request, and that is the interesting absence.** A grant
comes into being because a consent flow completed — the service writes the vault secret
and then the row — never because someone POSTed a grant document. A create model would
advertise forging an authorization; an edit model would advertise rewriting one. The wire
surface for grants is read (`query`), start (`connect`), and destroy (`revoke`, a DELETE —
§9). This is the same reasoning that denies channels' ledgers their create routes.

**`McpConnectResponse.redirect_url` mirrors `ConnectionStatus.redirect_url`** on the
existing connections flow — the dashboard already knows how to open a hosted redirect and
close the popup on callback; the OAuth checkpoint reuses that muscle rather than growing a
second consent UI shape.

---

## 7. daos

Interfaces in `core/gateways/{llm,mcp}/interfaces.py`, implementations in
`dbs/postgres/gateways/{llm,mcp}/dao.py`. DAOs open their own sessions; services never
touch the engine.

Conventions, each load-bearing:

- **`@abstractmethod`, keyword-only after `self`**, bare `#` lines separating scope →
  entity → modifiers — how every DAO in the codebase reads.
- **`project_id: UUID` first on every method.** Tenant scope is structural.
- **`user_id` on writes only**, feeding `created_by_id` / `updated_by_id`; `Optional`
  where the writer is a flow rather than a person (grant creation, whose author is the
  consent callback).
- **Verb naming is `create_/fetch_/edit_/delete_/query_`**, the newer house style
  (`core/workflows/`), not the connections DAO's `get_/update_`. That domain's older names
  stay where they are; a new domain follows the current convention, and the divergence is
  confined to one file that predates it.
- **Implementations wrap reads in `@suppress_exceptions(...)`** with
  `exclude=[EntityCreationConflict]` on creates, exactly as
  `dbs/postgres/gateway/connections/dao.py` does — a slug collision surfaces, everything
  else degrades to `None` / `[]` / `False`.

```python
# core/gateways/llm/interfaces.py

class LlmEndpointsDAOInterface(ABC):
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
        endpoint: LlmEndpointCreate,
    ) -> Optional[LlmEndpoint]:
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
    ) -> Optional[LlmEndpoint]: ...

    @abstractmethod
    async def fetch_endpoint_by_slug(
        self,
        *,
        project_id: UUID,
        #
        slug: str,
    ) -> Optional[LlmEndpoint]:
        """The data-plane route lookup (§2.3). Backed by
        uq_llm_gateway_endpoints_project_slug, so at most one row by
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
        endpoint: LlmEndpointEdit,
    ) -> Optional[LlmEndpoint]:
        """Full PUT over the editable surface (§4.3): data, flags, header,
        secret_id. provider_key and deployment are absent from the Edit DTO and
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
        endpoint: Optional[LlmEndpointQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[LlmEndpoint]: ...


# core/gateways/mcp/interfaces.py

class McpEndpointsDAOInterface(ABC):
    """Same six verbs, same semantics, over mcp_gateway_endpoints."""

    @abstractmethod
    async def create_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: McpEndpointCreate,
    ) -> Optional[McpEndpoint]: ...

    @abstractmethod
    async def fetch_endpoint(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
    ) -> Optional[McpEndpoint]: ...

    @abstractmethod
    async def fetch_endpoint_by_slug(
        self,
        *,
        project_id: UUID,
        #
        slug: str,
    ) -> Optional[McpEndpoint]: ...

    @abstractmethod
    async def edit_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: McpEndpointEdit,
    ) -> Optional[McpEndpoint]: ...

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
        endpoint: Optional[McpEndpointQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[McpEndpoint]: ...


class McpGrantsDAOInterface(ABC):
    """Persistence contract for grant rows. The owner is a key here, not
    authorship — this is where D10 is storage, not just signature (§2.2)."""

    @abstractmethod
    async def create_grant(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        grant: McpGrantCreate,
    ) -> Optional[McpGrant]:
        """Insert, idempotent on the owner: `ON CONFLICT DO NOTHING ...
        RETURNING`, falling back to a fetch — a re-entered OAuth callback
        returns the EXISTING row rather than None, because the caller still
        needs the row either way (the outbox rule from channels, same reason).
        The partial unique indexes in §2.5 carry the conflict.

        `user_id` here is the OWNER (grant.user_id mirrors it); authorship
        lands in created_by_id from the same value when present."""
        ...

    @abstractmethod
    async def fetch_grant(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
        user_id: Optional[UUID],
    ) -> Optional[McpGrant]:
        """The resolution read: THIS owner's grant on THIS endpoint.
        user_id=None selects the project-owned grant — it does not mean "any".
        The fallback walk (user's, else project's, per CredentialMode) belongs
        to the resolver, which calls this at most twice; putting the fallback
        in SQL would hide the mode logic where it cannot be unit-tested."""
        ...

    @abstractmethod
    async def fetch_grant_by_id(
        self,
        *,
        project_id: UUID,
        #
        grant_id: UUID,
    ) -> Optional[McpGrant]: ...

    @abstractmethod
    async def update_grant(
        self,
        *,
        project_id: UUID,
        #
        grant_id: UUID,
        is_valid: Optional[bool] = None,
        status: Optional[Status] = None,
    ) -> Optional[McpGrant]:
        """Server-set operational state only (§2.6): flip is_valid, record the
        refresh outcome. Deliberately NOT an edit_grant taking a document —
        there is no grant document to edit (§6), and this update must not be
        able to move endpoint_id, user_id or secret_id."""
        ...

    @abstractmethod
    async def delete_grant(
        self,
        *,
        project_id: UUID,
        #
        grant_id: UUID,
    ) -> bool:
        """Row only. The service deletes the vault secret FIRST, then this —
        the SSO delete order (§2.1); the CASCADE covers the reverse arrival."""
        ...

    @abstractmethod
    async def query_grants(
        self,
        *,
        project_id: UUID,
        #
        grant: Optional[McpGrantQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[McpGrant]: ...
```

`None` is overloaded across these returns; the disambiguation, stated once:

| method | `None` means | caller does |
| --- | --- | --- |
| `fetch_endpoint_by_slug` | no such custom endpoint | the proxy answers not-found in the surface's own shape |
| `fetch_grant` | this owner has not connected | the resolver applies the mode: fall back, or raise `CredentialNotFoundError` |
| `create_grant` | never — conflict returns the existing row | proceed with the row |
| `edit_endpoint` / `update_grant` | the row does not exist | 404 at the boundary |

### 7.1 The south ports

One port per plane, in the same `interfaces.py` files. This answers `contract.md`'s open
question — **two interfaces sharing the credential types, not one interface with two
shapes** — because the method shapes share nothing: a streaming byte relay on one side, a
single JSON round trip on the other. A merged interface would be a union with no caller.
What they share is exactly what is shared in fact: `ResolvedCredential` in,
plane-specific route and result types out.

The result types are dataclasses, not Pydantic models, because a relay result carries an
`AsyncIterator` and lives for one call between the service and the surface — it is never
validated, stored or serialized.

```python
# core/gateways/llm/interfaces.py

@dataclass
class LlmRelayResult:
    """One upstream answer, streaming or not. `body` yields exactly one chunk
    for a non-streaming call. `usage` is populated by the adapter once `body`
    is exhausted, when the upstream exposed it (the OpenAI stream carries a
    trailing usage frame; the translated adapter reports the library's count);
    None means unknowable, and the audit event says so rather than guessing."""
    status_code: int
    headers: Dict[str, str]
    body: AsyncIterator[bytes]
    usage: Optional[GatewayUsage] = None


class LlmUpstreamInterface(ABC):
    """Turns a resolved route plus a resolved credential into an upstream call.
    The core never imports an implementation; wiring happens at the entrypoint."""

    @abstractmethod
    async def relay_chat_completion(
        self,
        *,
        route: LlmResolvedRoute,
        credential: Optional[ResolvedCredential],
        #
        context: LlmCallContext,
        body: bytes,
        headers: Dict[str, str],
    ) -> LlmRelayResult:
        """Relay one completion call. `body` is the caller's payload untouched;
        `headers` are the caller's headers already stripped of authorization.
        `credential` is None only for targets whose auth scheme is NONE (the
        fakes). Raises LlmUpstreamError on upstream failure."""
        ...

    # async def relay_embedding(...) -> LlmRelayResult
    # Deferred with the whole evaluator path (D15). Declared here as the seam it
    # will occupy so nothing in the surface design forecloses it.


# core/gateways/mcp/interfaces.py

@dataclass
class McpRelayResult:
    """A single JSON answer. The gateway targets the stateless revision in JSON
    mode — one request, one `application/json` response, 202 for notifications
    (`mcp.md`; the in-tree precedent is the runner's internal tool server,
    services/runner/src/tools/tool-mcp-http.ts). No SSE leg to carry."""
    status_code: int
    headers: Dict[str, str]
    body: bytes


class McpUpstreamInterface(ABC):
    @abstractmethod
    async def relay(
        self,
        *,
        route: McpResolvedRoute,
        credential: Optional[ResolvedCredential],
        #
        context: McpCallContext,
        body: bytes,
        headers: Dict[str, str],
    ) -> McpRelayResult:
        """Transparent per-server relay (D16): same method, same body, same
        response, with only the route and the authorization changed. Raises
        McpUpstreamError on transport failure; protocol-level errors from the
        server are NOT exceptions — they are the response body, relayed, because
        the server's own failure reason is what lets the model correct itself
        (the pass-through rule in api/AGENTS.md's error-envelope scope)."""
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
`select_upstream(provider_key, deployment) -> str`, picks the adapter key; the fakes
register under a third key. The constraint is therefore honest: byte-for-byte wherever
the protocol matches, and only there.

**Registries copy an existing shape verbatim** — four structurally identical registry
classes already exist in catalog, connections, tools and triggers; these are the fifth
and sixth, the same shape borrowed rather than shared:

```python
class LlmUpstreamRegistry:
    def __init__(self, *, adapters: Dict[str, LlmUpstreamInterface]): ...
    def get(self, key: str) -> LlmUpstreamInterface: ...   # raises on a miss
    def keys(self) -> list[str]: ...

class McpUpstreamRegistry:
    def __init__(self, *, adapters: Dict[str, McpUpstreamInterface]): ...
    def get(self, key: str) -> McpUpstreamInterface: ...
    def keys(self) -> list[str]: ...
```

### 7.2 The credential resolver port

The third port, in `core/gateways/policy/interfaces.py`, implemented by
`policy/resolution.py` over `VaultService` and the grants DAO (WP2). This is the signature
the seed must get right (D10, `plan.md`): the owner is in it from the first commit, while
the only answer is the project.

```python
# core/gateways/policy/interfaces.py

class CredentialResolverInterface(ABC):
    """One lookup, called by both planes (`secrets.md`). Fakeable (D23): the
    fake resolver answers from a dict and never touches the vault."""

    @abstractmethod
    async def resolve(
        self,
        *,
        scope: AuthScope,
        #
        ref: CredentialRef,
        mode: CredentialMode,
    ) -> ResolvedCredential:
        """Resolve one credential for one call.

        The mode logic, in full (`secrets.md`):
          PROJECT_ONLY  -> the project secret; CredentialNotFoundError(PROJECT) if absent.
          USER_REQUIRED -> the (project, user) secret; CredentialNotFoundError(USER)
                           if absent — NEVER falls back.
          USER_OPTIONAL -> the (project, user) secret if present, else the
                           project's; CredentialNotFoundError(USER) naming the
                           narrower owner if neither exists.

        Until user-owned secrets ship, the user arm of every mode finds nothing
        and the modes degrade to project lookup or failure — behaviourally
        today's world, with the signature already right.

        By ref arm:
          ProviderKeyRef -> scan the project's provider_key / custom_provider
                            secrets for the provider, as the SDK's settings
                            builder does today (`models.md`).
          BoundSecretRef -> VaultService.get_secret_by_id, scoped to the project.
          GrantRef       -> the grants DAO's owner-keyed fetch (§7), then
                            get_secret_by_id; CredentialInvalidError when the
                            grant's is_valid is False (D18).

        Raises, never returns None: no path silently yields "no credential"
        (`secrets.md`), and the exceptions carry which owner is missing so the
        boundary can build the connect affordance (§5)."""
        ...
```

**Why the resolver is a port and not just a function.** The mode logic is pure and could
be a function; the lookups are not, and WP2's tests need the failure cases — which are the
interesting cases — without a vault. A port gives the fakes a seam (D23) and keeps
`VaultService`'s encryption-context requirement (`set_data_encryption_key`, without which
the DAO raises) inside one adapter instead of in every caller.

**Default modes are stated here and applied in the services** (§8): the LLM plane resolves
with `PROJECT_ONLY`, the MCP plane with `USER_OPTIONAL` — the deliberate asymmetry from
`secrets.md`: one billing identity for models, personal authority for tools. Neither is
hardcoded in the resolver; both are arguments at the call site, which is what makes the
open question (whether an administrator sets the mode per upstream) a data change later
rather than a signature change.

### 7.3 The TokenStorage adapter (WP17)

The OAuth client is not written here — the official MCP SDK's `OAuthClientProvider` is
adopted whole (`libraries.md`), persisting through a `TokenStorage` protocol we implement.
The adapter is `core/gateways/mcp/token_storage.py`, and it is deliberately thin: **it is
the resolve-and-store glue between the SDK's protocol and the shapes this document already
defined**, not a fourth place credentials live.

```python
# core/gateways/mcp/token_storage.py

class VaultTokenStorage:
    """Implements the pinned MCP SDK's TokenStorage protocol over the vault.

    One instance per (scope, endpoint): reads resolve through the grants DAO's
    owner-keyed fetch and VaultService.get_secret_by_id; writes update the
    oauth_grant secret IN PLACE and touch the grant row (§2.5). The exact method
    set and value types come from the pinned SDK version and are verified at
    implementation time (OR1) — this class's constructor is the contract wave 0
    owns."""

    def __init__(
        self,
        *,
        scope: AuthScope,
        endpoint_id: UUID,
        #
        vault_service: VaultService,
        mcp_grants_dao: McpGrantsDAOInterface,
        mode: CredentialMode = CredentialMode.USER_OPTIONAL,
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
        resolver: CredentialResolverInterface,
    ) -> None: ...

class LlmGatewayService:
    def __init__(
        self,
        *,
        llm_endpoints_dao: LlmEndpointsDAOInterface,
        policy: GatewayPolicyService,
        resolver: CredentialResolverInterface,
        upstream_registry: LlmUpstreamRegistry,
    ) -> None: ...

class McpGatewayService:
    def __init__(
        self,
        *,
        mcp_endpoints_dao: McpEndpointsDAOInterface,
        mcp_grants_dao: McpGrantsDAOInterface,
        policy: GatewayPolicyService,
        resolver: CredentialResolverInterface,
        upstream_registry: McpUpstreamRegistry,
    ) -> None: ...
```

Service method signatures drop the kwarg type hints — the DTOs carry the types — following
the template's compression. The surfaces, in full:

```python
class GatewayPolicyService:
    # --- authorization (WP3) ------------------------------------------------ #

    async def authorize(self, *, scope, permission, target) -> PolicyDecision: ...
    # scope: AuthScope; target: GatewayTarget. Permission via check_action_access
    # (core/access/permissions/service.py), then the entitlement soft check
    # (EE-guarded deferred import, the pattern core/events/utils.py already
    # uses). Permission is fail-CLOSED; the entitlement soft check follows the
    # existing two-layer pattern, with the authoritative check on the events
    # worker's side. Raises nothing — returns the decision; the caller raises
    # PolicyDeniedError / EntitlementDeniedError so the audit event can record
    # the denial before the exception leaves the service.

    # --- audit + usage (WP4, D22, §2.7) ------------------------------------- #

    async def record(self, *, scope, target, decision, outcome) -> None: ...
    # One event per call, allowed or denied, built by policy/audit.py and
    # published through publish_event. Never raises — the caller's response
    # must not depend on the stream (the _safe_publish discipline).


class LlmGatewayService:
    # --- management: thin over the DAO, plus the generated merge ------------ #

    async def create_endpoint(self, *, project_id, user_id, endpoint) -> Optional[LlmEndpoint]: ...
    async def fetch_endpoint(self, *, project_id, endpoint_id) -> Optional[LlmEndpoint]: ...
    async def edit_endpoint(self, *, project_id, user_id, endpoint) -> Optional[LlmEndpoint]: ...
    async def delete_endpoint(self, *, project_id, endpoint_id) -> bool: ...
    async def query_endpoints(self, *, project_id, endpoint=None, windowing=None) -> List[LlmEndpoint]: ...
    async def list_endpoints(self, *, project_id) -> List[LlmEndpoint]: ...
    # list_endpoints is the merge: generated standard endpoints (catalog.py,
    # existing iff a provider_key secret exists for the provider — D20) plus the
    # custom rows. The only read that spans both namespaces.

    # catalog.py — the generation, two pure functions over the SDK's static map
    # (sdks/python/agenta/sdk/utils/assets.py::supported_llm_models), imported
    # the way core/workflows/static_catalog.py already imports the SDK:
    #
    #   def standard_llm_endpoint(*, provider_key: str) -> Optional[LlmEndpoint]:
    #       """The generated endpoint for one provider: namespace=STANDARD,
    #       slug=provider_key, deployment=DIRECT, model_slugs from the map,
    #       config at code defaults, no id and no lifecycle — it is not a row.
    #       None for an unknown provider."""
    #
    #   def standard_llm_endpoints() -> List[LlmEndpoint]:
    #       """All eleven, existence-unfiltered. The service intersects with
    #       the vault's provider keys, because existence is a fact about the
    #       project (a key exists), not about the catalogue (D20)."""

    # --- the data plane (WP6, WP7) ------------------------------------------ #

    async def relay_chat_completion(
        self, *, scope, namespace, name, body, headers,
    ) -> LlmRelayResult: ...


class McpGatewayService:
    # --- management --------------------------------------------------------- #

    async def create_endpoint(self, *, project_id, user_id, endpoint) -> Optional[McpEndpoint]: ...
    async def fetch_endpoint(self, *, project_id, endpoint_id) -> Optional[McpEndpoint]: ...
    async def edit_endpoint(self, *, project_id, user_id, endpoint) -> Optional[McpEndpoint]: ...
    async def delete_endpoint(self, *, project_id, endpoint_id) -> bool: ...
    async def query_endpoints(self, *, project_id, endpoint=None, windowing=None) -> List[McpEndpoint]: ...
    async def list_endpoints(self, *, project_id) -> List[McpEndpoint]: ...

    # --- grants (WP17, WP18 wire these; declared now) ----------------------- #

    async def connect_endpoint(self, *, project_id, user_id, endpoint_id, scopes) -> str: ...
    # Begins consent: builds the authorization redirect via the OAuth client,
    # signed state via make_oauth_state (core/gateway/connections/utils.py —
    # already server-owned, HMAC, carries project and user). Returns the
    # redirect URL. Scope SELECTION is the caller's, not everything advertised
    # (D17).
    async def complete_connect(self, *, state, payload) -> McpGrant: ...
    # The callback half: decode_oauth_state recovers (project, user), the OAuth
    # client redeems the code, the vault secret is written FIRST, then the
    # grant row (§7). Idempotent via create_grant's conflict contract.
    async def revoke_grant(self, *, project_id, grant_id) -> bool: ...
    # Vault secret first, then the row (§2.1). Tools stay listed; subsequent
    # calls fail with the connect affordance (D18).
    async def query_grants(self, *, project_id, grant=None, windowing=None) -> List[McpGrant]: ...

    # --- the data plane (WP8) ----------------------------------------------- #

    async def relay(
        self, *, scope, namespace, name, context, body, headers,
    ) -> McpRelayResult: ...
```

**The relay path, spelled once** — both planes walk the same six steps, which is D7 made
concrete; only the nouns differ. `target` here is a service-internal resolved-target
value (the generated endpoint or the row, plus which namespace answered); it never
crosses a layer, so it is not a DTO in §4:

```python
async def relay_chat_completion(self, *, scope, namespace, name, body, headers):
    target = await self._resolve_target(project_id=scope.project_id,
                                        namespace=namespace, name=name)
    # generated or row; LlmEndpointNotFoundError / McpEndpointNotFoundError

    context = parse_call_context(body)            # model + stream; MCP reads headers
    self._check_allowlist(target, context)        # LlmModelNotAllowedError /
                                                  # McpToolNotAllowedError — before
                                                  # any credential is touched
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

    credential = await self.resolver.resolve(
        scope=scope, ref=target.credential_ref(), mode=CredentialMode.PROJECT_ONLY,
    )   # MCP: USER_OPTIONAL (§7.2); NONE-scheme targets skip this step

    result = await self.upstream_registry.get(
        select_upstream(target.provider_key, target.deployment)
    ).relay_chat_completion(route=target.route(context), credential=credential,
                            context=context, body=body, headers=headers)

    await self.policy.record(scope=scope, target=..., decision=decision,
                             outcome=outcome_from(result, credential))
    return result
```

Three orderings in that body are deliberate:

- **Allowlist before credential.** A refused model or tool must not cost a vault read, and
  the refusal reason must be the allowlist, not a coincidental credential gap.
- **The denial is recorded before the exception leaves.** An audit trail that only records
  successes answers "did every call get checked" with "every call that succeeded" — the
  exact failure D1 names.
- **Usage is recorded even when the stream broke.** The record call sits after the relay
  returns, but for a streamed body the outcome's usage is read off the
  `LlmRelayResult` after exhaustion — the surface drains, the service records in a
  `finally`. A crashed stream records what is known (`usage=None`, the status), never
  nothing.

**`list_tools`-shaped reads need no service verb.** Listing an MCP server's tools *is* a
relay (`context.method` is the list method), transparently passed through with one
asymmetry: an `INCLUDE` tool policy filters the list result — entries dropped whole, never
renamed — while credential death does not filter anything (D18). Policy hides what may
never be called; credential state never hides what policy allows. The per-caller list
question from `contract.md` (shared-intermediary caching vs per-caller allowlists) is
thereby scoped: list results are cacheable per (endpoint, policy-hash), and caching is out
of the first increment anyway (`scope-checklist.md`).

**Where the state machine is computed.** `GatewayConnectionState` (§4.1) is derived in
`McpGatewayService` per owner: `READY` iff the endpoint's scheme is NONE, or a valid grant
exists for this owner; `NEEDS_AUTH` for an OAuth endpoint without one — with the connect
affordance pointing at `connect_endpoint`'s route; `NEEDS_INPUT` reserved for the api_key
scheme (deferred with its kind, D14). The LLM side derives the same states from key
presence (`NEEDS_INPUT` when no provider secret exists). Nothing stores these (§2.6).

---

## 9. routers

Two router objects per plane (§1): `router.py` — the management CRUD, house rules — and
`proxy.py` — the protocol surface, whose shapes are not ours. Both live in
`apis/fastapi/gateways/{llm,mcp}/` and are mounted at the entrypoint:

```python
# api/entrypoints/routers.py — mounts
app.include_router(router=llm_gateway.router,  prefix="/gateways/llm", tags=["Gateway: LLM"])
app.include_router(router=llm_gateway.proxy,   prefix="/gateways/llm", include_in_schema=False)
app.include_router(router=mcp_gateway.router,  prefix="/gateways/mcp", tags=["Gateway: MCP"])
app.include_router(router=mcp_gateway.proxy,   prefix="/gateways/mcp", include_in_schema=False)
```

The proxies share the plane prefix with the CRUD without collision because their first
path segment is the namespace enum (`standard | custom`, typed as a path `Literal`), which
can never spell `endpoints` or `grants`.

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
block in full; the MCP block is the same seven shapes and is elided to its table:

```python
class LlmGatewayRouter:
    def __init__(self, *, llm_gateway_service: LlmGatewayService):
        self.service = llm_gateway_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/endpoints/", self.create_endpoint, methods=["POST"],
            operation_id="create_llm_endpoint",
            response_model=LlmEndpointResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/", self.list_endpoints, methods=["GET"],
            operation_id="list_llm_endpoints",
            response_model=LlmEndpointsResponse,
            response_model_exclude_none=True,
        )
        # GET /endpoints/ is the merged listing — standard + custom (§8);
        # POST /endpoints/query filters rows only, because generated endpoints
        # have nothing to filter on but the provider, which GET already shows.
        self.router.add_api_route(
            "/endpoints/query", self.query_endpoints, methods=["POST"],
            operation_id="query_llm_endpoints",
            response_model=LlmEndpointsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}", self.fetch_endpoint, methods=["GET"],
            operation_id="fetch_llm_endpoint",
            response_model=LlmEndpointResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}", self.edit_endpoint, methods=["PUT"],
            operation_id="edit_llm_endpoint",
            response_model=LlmEndpointResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}", self.delete_endpoint, methods=["DELETE"],
            operation_id="delete_llm_endpoint",
        )

        # --- MCP management (McpGatewayRouter) — same shapes ---
        #   POST/GET   /endpoints/                 create_mcp_endpoint / list_mcp_endpoints
        #   POST       /endpoints/query            query_mcp_endpoints
        #   GET/PUT    /endpoints/{endpoint_id}    fetch_mcp_endpoint / edit_mcp_endpoint
        #   DELETE     /endpoints/{endpoint_id}    delete_mcp_endpoint
        #   POST       /endpoints/{endpoint_id}/connect   connect_mcp_endpoint  (WP18)
        #   GET        /connect/callback                  mcp_connect_callback  (WP18)
        #   POST       /grants/query                query_mcp_grants
        #   DELETE     /grants/{grant_id}           revoke_mcp_grant
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
    body: LlmEndpointCreateRequest,
) -> LlmEndpointResponse:
    scope = get_auth_scope()
    await self._check(scope, Permission.EDIT_LLM_ENDPOINTS)

    endpoint = await self.service.create_endpoint(
        project_id=scope.project_id,
        user_id=scope.user_id,
        #
        endpoint=body.endpoint,
    )

    return LlmEndpointResponse(count=1 if endpoint else 0, endpoint=endpoint)
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
`PolicyDeniedError` / `EntitlementDeniedError` → 403, `*NotAllowedError` → 403,
`CeilingExceededError` → 400, its body naming the ceiling, the requested and the allowed
values (D25), `McpAuthRequiredError` → 409 carrying the `GatewayConnectionRequirement`
(an interaction, not a failure — D17), `*UpstreamError` → 424, or 502 when the upstream
answered ≥500 (the 424/502 split tools and triggers already use).

**The connect callback is the one route with no permission check**, authenticated by the
signed state token instead — precisely the `GET /tools/connections/callback` shape,
reusing `make_oauth_state` / `decode_oauth_state`, and it needs its own
`_PUBLIC_ENDPOINTS` entry with a literal path. It returns the same popup-closing
`HTMLResponse` card. (The hardcoded `_CALLBACK_PATH` in
`core/gateway/connections/service.py` is the flaw not to repeat: the MCP callback path is
a constant in the MCP domain, not borrowed from tools.)

### The data planes

The proxies declare externally-fixed paths and **no wire models** (§6). Authentication is
the platform's own: the minted secret token travels as `Secret <token>`, one of the three
schemes the middleware already verifies by decode alone (D13) — so the proxy handlers see
a full `AuthScope` like any other route, and nothing here is public.

```python
class LlmGatewayProxy:
    def __init__(self, *, llm_gateway_service: LlmGatewayService):
        self.service = llm_gateway_service
        self.router = APIRouter()

        # The OpenAI-compatible surface. base_url for a client is
        #   {api_url}/gateways/llm/{namespace}/{name}/v1
        self.router.add_api_route(
            "/{namespace}/{name}/v1/chat/completions",
            self.chat_completions, methods=["POST"],
            operation_id="llm_gateway_chat_completions",
        )
        self.router.add_api_route(
            "/{namespace}/{name}/v1/models",
            self.list_models, methods=["GET"],
            operation_id="llm_gateway_list_models",
        )
        # /v1/models answers from the allowlist — the static catalogue for
        # standard, model_slugs for custom — so a harness that lists before
        # calling sees exactly what policy will allow.
        #
        # "/{namespace}/{name}/v1/embeddings"
        # Deferred with the evaluator path (D15). The path is reserved by this
        # comment so nothing else claims the shape.

class McpGatewayProxy:
    def __init__(self, *, mcp_gateway_service: McpGatewayService):
        self.service = mcp_gateway_service
        self.router = APIRouter()

        # One URL per server (D16). Streamable HTTP, stateless JSON mode:
        # POST carries JSON-RPC; GET/DELETE answer 405, as the runner's
        # internal tool server already does.
        self.router.add_api_route(
            "/{namespace}/{name}", self.relay, methods=["POST"],
            operation_id="mcp_gateway_relay",
        )
        self.router.add_api_route(
            "/{namespace}/{name}", self.reject_stream_verbs,
            methods=["GET", "DELETE"], include_in_schema=False,
        )
```

Each proxy's `utils.py` holds the one pure function that reads the caller's request for
routing, and nothing else — both are fully unit-testable and both fail typed:

```python
# apis/fastapi/gateways/llm/utils.py
def parse_llm_call_context(*, body: bytes) -> LlmCallContext:
    """Extract model and stream from the JSON body without materializing a
    parsed copy for relay — the body itself stays byte-for-byte (§7.1).
    Raises ValueError when the body names no model; the proxy translates that
    into the surface's own invalid-request error shape."""

# apis/fastapi/gateways/mcp/utils.py
def parse_mcp_call_context(*, headers: Dict[str, str]) -> McpCallContext:
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
`ceiling_exceeded`, `credential_missing`); the MCP proxy answers protocol-shaped errors at the transport
status the relay produced, and gateway-authored refusals as the protocol's error result
with the same stable causes in the error data. What it must never do is leak the house
envelope onto either surface, or swallow the upstream's own error, which passes through
untouched (D16; the pass-through scope rule in `api/AGENTS.md`).

**Streaming rides `StreamingResponse` over `LlmRelayResult.body`**, with the audit record
written in the handler's `finally` after the iterator is exhausted (§8). A policy decision
is always made before the first upstream byte; what happens to a decision that expires
mid-stream is an open item in `architecture.md` §5 and is not silently decided here — the
stream, once begun, completes.

### Wiring

```python
# api/entrypoints/routers.py — construction, conditional on nothing:
# the gateways have no third-party dependency to gate on (D23)

llm_endpoints_dao = LlmEndpointsDAO(engine=_transactions_engine)
mcp_endpoints_dao = McpEndpointsDAO(engine=_transactions_engine)
mcp_grants_dao = McpGrantsDAO(engine=_transactions_engine)

credential_resolver = CredentialResolver(vault_service=vault_service,
                                         mcp_grants_dao=mcp_grants_dao)
gateway_policy_service = GatewayPolicyService(resolver=credential_resolver)

llm_gateway_service = LlmGatewayService(
    llm_endpoints_dao=llm_endpoints_dao,
    policy=gateway_policy_service,
    resolver=credential_resolver,
    upstream_registry=LlmUpstreamRegistry(adapters={
        "passthrough": PassthroughLlmAdapter(),
        "translated": TranslatedLlmAdapter(),
        "fake": FakeLlmAdapter(),          # registered always; reachable only
    }),                                    # via the fake endpoints the local
)                                          # stack defines (D23)

mcp_gateway_service = McpGatewayService(
    mcp_endpoints_dao=mcp_endpoints_dao,
    mcp_grants_dao=mcp_grants_dao,
    policy=gateway_policy_service,
    resolver=credential_resolver,
    upstream_registry=McpUpstreamRegistry(adapters={
        "http": HttpMcpAdapter(),
        "fake": FakeMcpAdapter(),
    }),
)
```

---

## 10. Retention

The platform has no operational retention today; the channels design flagged it and
inherited it. The gateways must not inherit it **for credential material**, and mostly do
not need to, because the lifetimes fall out of the shapes above:

- **Tokens do not accumulate.** An `oauth_grant` secret is rewritten in place on every
  refresh (`secrets.md`), and a second consent updates rather than inserts (§2.5) — there
  is no token history and no graveyard. Deletion is event-driven, not scheduled: a
  **revoked grant** deletes the vault secret then the row (§7); a **removed member's**
  user-owned grants are deleted when the membership is — the `(project, user)` owner key
  exists so this sweep has a predicate, and wiring it into the member-removal path is part
  of the ownership work `secrets.md` schedules; a **deleted project** takes everything
  with it through the `CASCADE` chain — grant rows, endpoint rows, and the vault secrets
  themselves, whose table already cascades on project. The inbound credential retains
  nothing by construction: minted, fifteen-minute expiry, never stored (D13).
- **Audit and usage records outlive what they describe, and die with the project.** They
  ride the events domain (D22) and inherit its retention posture wholesale — including
  the per-organization quota at ingest. Deleting an endpoint or revoking a grant does
  **not** delete the events that transited it; that is what makes them an audit trail
  rather than a cache, and it is why the event carries the owner and payer inline instead
  of referencing rows that may be gone (§2.7).
- **Configuration is cheap and keeps itself.** Endpoint rows are small, project-scoped,
  and hard-deleted by their DELETE routes; nothing here needs archival semantics, and
  none is designed.

What is deliberately not solved: a platform-wide retention policy for the events stream.
The gateways will raise its stakes — one event per model and tool call is a volume
profile the read-analytics events do not have — but the fix belongs to the events domain
(periodic, plan-configurable, as the channels design also concluded), not to a per-row
TTL invented here.

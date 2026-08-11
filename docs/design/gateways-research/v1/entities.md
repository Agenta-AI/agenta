# Gateways: entities

**Status: skeleton — this document is wave 0.** The layout and the table inventory are
proposals; the column lists, method signatures and layer contents are the work.

Nothing forks until this is filled in, because the seed commit is taken verbatim from it. See
`plan.md`.

The data model and its full stack, following the codebase's existing layering. Column lists
will be the proposal, not migrations.

## Structural precedent

Channels chose `triggers` as its sibling because it was the other multi-provider integration
domain. **The gateways have no sibling to copy — they extend the family that would have been
it.** Catalog, connections, tools and triggers already implement ports, registries, services
and per-provider adapters; the gateways add members to that family rather than mirroring it
from outside.

The consequence is that most structural questions are already answered by what is there, and
the design work is additive: which tables are new, which existing ones gain a column, and
what the model plane looks like given it currently has no domain at all.

## Proposed layout

```text
core/gateway/
  catalog/            (exists)
  connections/        (exists — gains the owner dimension)
  mcp/                NEW: server registry, tool policy, the MCP client
    dtos.py           enums + core DTOs
    types.py          domain exceptions
    interfaces.py     DAO + upstream-server port
    registry.py       server key -> adapter
    service.py
    providers/
  models/             NEW: the model plane the codebase does not have
    dtos.py
    types.py
    interfaces.py
    registry.py       provider/deployment -> adapter
    service.py
    providers/
  policy/             NEW: the shared core both planes evaluate against
dbs/postgres/gateway/
  <per-domain>/       dbas.py, dbes.py, dao.py, mappings.py
apis/fastapi/gateway/
  <per-domain>/       models.py, router.py
```

*To establish:* whether `policy` is a core module or a service, and whether the model plane
belongs under `gateway/` at all given it is not an integration in the catalog sense.

## The tables

*To establish.* Current inventory, with what each is and is not:

| table | what it is | what it is not |
|---|---|---|
| `gateway_connections` | exists; one authorization of one integration | not a credential store — it references one |
| MCP server registry | NEW: a registered upstream, its route, auth mode, tool policy | not a catalog of tools — the server owns its tool list |
| *(policy records?)* | *to establish* — whether policy is stored or derived | |
| *(model routes?)* | *to establish* — whether a model route is a row or config | |

Existing tables expected to change: `secrets` gains the owner dimension (`secrets.md`);
`gateway_connections` gains whatever the owner dimension implies for lookup.

## What each layer must carry

Following the repo's standard domain structure:

### dbas

*To establish.* Shared mixins. Likely candidates: the owner dimension, if it is uniform
across tables that gain it.

### dbes

*To establish.* Concrete entities and their columns.

### dtos

*To establish.* Domain contracts. Must include the new secret kinds' settings DTOs and their
union arms — see `secrets.md`, which owns their shape.

### types

*To establish.* Domain exceptions. The consent states already exist as enums in the tools and
triggers domains; whether they are reused or unified is an open review item.

### models

*To establish.* Request and response schemas for the routers.

### daos

*To establish.* Every verb must take the credential owner as a parameter from the outset,
even while the only answer is the project. This is the one signature decision that is
expensive to retrofit.

### services

*To establish.* Orchestration. Services depend on interfaces, never concrete DAOs or
adapters; concrete wiring happens only at the entrypoint.

### routers

*To establish.* Route declarations. Note that the north ports are not ordinary CRUD routers —
an OpenAI-compatible surface and an MCP surface have externally-fixed shapes. Whether they
live here or beside the data plane depends on `architecture.md` §2.

## Retention

*To establish.* Tokens, audit records, and usage records have different lifetimes and
different deletion triggers — a revoked grant, a removed member, a deleted project. The
platform has no operational retention today, which channels also flagged; this design should
not silently inherit that gap for credential material.

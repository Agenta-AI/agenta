# WP8 — Configuration API

Delivers the non-public router surface for channels: connections, agents, spaces,
grants, threads, inbox/outbox observability, capabilities and the policy explain
endpoint — every route in `entities.md` §9, wired with `check_action_access`
inline and permissions mirroring the workflow roles (`VIEW_CHANNELS`,
`EDIT_CHANNELS`, `RUN_CHANNELS`). This is the API the web app (WP13) is built
against; it does not touch ingress (WP3), routing (WP4) or delivery (WP5).

## Files

New:
- `api/oss/src/apis/fastapi/channels/router.py` — `ChannelsRouter`, all routes below
- `api/oss/src/apis/fastapi/channels/models.py` — request/response wire models (`entities.md` §6)
- `api/oss/src/apis/fastapi/channels/__init__.py`

Edited, diff prepared but not applied mid-stream:
- `api/entrypoints/routers.py` — SHARED. WP8 prepares its router-registration diff
  and its `check_action_access` wiring as a patch. It is applied at **C3**, merged
  alongside WP6, never committed to this file directly between checkpoints
  (`workstreams/README.md`).

Read, not edited (WP1's surface, consumed here):
- `api/oss/src/core/channels/service.py` (`ChannelsService`)
- `api/oss/src/core/channels/dtos.py`, `types.py`

## Interfaces

Every route below is taken verbatim from `entities.md` §9. Collection routes keep
their trailing slash; item routes do not. Every route carries
`response_model_exclude_none=True` except the two with no response body.

| operation_id | method | path | response model |
| --- | --- | --- | --- |
| `list_channels` | GET | `/catalog/channels/` | `ChannelsCatalogResponse` |
| `fetch_channel_capabilities` | GET | `/catalog/channels/{channel}/capabilities/` | `ChannelCapabilitiesResponse` |
| `query_channel_connections` | POST | `/connections/query` | `ChannelConnectionsResponse` |
| `create_channel_agent` | POST | `/agents/` | `ChannelAgentResponse` |
| `list_channel_agents` | GET | `/agents/` | `ChannelAgentsResponse` |
| `query_channel_agents` | POST | `/agents/query` | `ChannelAgentsResponse` |
| `fetch_channel_agent` | GET | `/agents/{agent_id}` | `ChannelAgentResponse` |
| `edit_channel_agent` | PUT | `/agents/{agent_id}` | `ChannelAgentResponse` |
| `delete_channel_agent` | DELETE | `/agents/{agent_id}` | none (204) |
| `set_channel_agent_default` | POST | `/agents/{agent_id}/default` | `ChannelAgentResponse` |
| `create_channel_space` | POST | `/spaces/` | `ChannelSpaceResponse` |
| `list_channel_spaces` | GET | `/spaces/` | `ChannelSpacesResponse` |
| `query_channel_spaces` | POST | `/spaces/query` | `ChannelSpacesResponse` |
| `fetch_channel_space` | GET | `/spaces/{space_id}` | `ChannelSpaceResponse` |
| `edit_channel_space` | PUT | `/spaces/{space_id}` | `ChannelSpaceResponse` |
| `delete_channel_space` | DELETE | `/spaces/{space_id}` | none (204) |
| `discover_channel_spaces` | POST | `/spaces/discover` | `ChannelSpaceCandidatesResponse` |
| `create_channel_grant` | POST | `/grants/` | `ChannelGrantResponse` |
| `list_channel_grants` | GET | `/grants/` | `ChannelGrantsResponse` |
| `query_channel_grants` | POST | `/grants/query` | `ChannelGrantsResponse` |
| `edit_channel_grant` | PUT | `/grants/{grant_id}` | `ChannelGrantResponse` |
| `delete_channel_grant` | DELETE | `/grants/{grant_id}` | none (204) |
| `set_channel_grant_default` | POST | `/grants/{grant_id}/default` | `ChannelGrantResponse` |
| `resolve_channel_policy` | POST | `/policy/resolve` | `ChannelPolicyResponse` |
| `query_channel_threads` | POST | `/threads/query` | `ChannelThreadsResponse` |
| `close_channel_thread` | POST | `/threads/{thread_id}/close` | `ChannelThreadResponse` |
| `query_channel_inbox_events` | POST | `/inbox/events/query` | `ChannelInboxEventsResponse` |
| `query_channel_outbox_events` | POST | `/outbox/events/query` | `ChannelOutboxEventsResponse` |

Not this package's route: `ingest_slack_event` / `ingest_bridge_event` (POST `/channels/slack/events/`, `/channels/bridge/events/`) is
WP3's public ingress route — not registered here, not permission-checked here.

Handler body follows the house shape exactly (`entities.md` §9): decorators
(`@intercept_exceptions()`, `@handle_adapter_exceptions()` where the service can
raise an adapter error), a `self._check(request, Permission.X)` call, the service
call, the response envelope. `fetch_channel_agent`/`fetch_channel_space` etc.
translate a `None` result to 404; `edit_*` and `delete_*` do the same.

## Contracts this package must honour

- **`check_action_access` inline on every route**, called through a shared
  `self._check(request, permission)` helper as `TriggersRouter` does — no route
  skips the check, including item-lookup routes.
- **Permissions mirror the workflow roles**: `VIEW_CHANNELS` on every read route
  (`list_*`, `query_*`, `fetch_*`), `EDIT_CHANNELS` on every configuration write
  (`create_*`, `edit_*`, `delete_*`, `set_*_default`, `close_channel_thread`),
  `RUN_CHANNELS` reserved for paths that cause an agent to act — none exist in
  this package's surface, since routing lives in WP4; it is defined here for
  forward compatibility with WP9 (commands) and any future route that triggers a
  turn synchronously.
- **No cross-table write validation.** `create_grant`/`edit_grant` do not check
  that a second default would violate uniqueness — that is unexpressible by
  construction. `flags.is_default = true` on a `ChannelGrantCreate` or
  `ChannelGrantEdit` that collides with an existing default fails at the
  database with the partial unique index `uq_channel_grants_default`
  (`entities.md` §3), and the router surfaces that as a 409/422, never as a
  pre-check query. Same for `uq_channel_agents_default`. `set_channel_agent_default`
  and `set_channel_grant_default` are separate verbs precisely because the
  service, not this router, clears the previous default before setting the new
  one in one call (`entities.md` §8) — the router does not orchestrate that
  two-step itself.
- **"The default must be granted here" needs no check.** D29: the grant's
  existence is the permission, so there is no agent-is-default-but-not-granted
  state this package must guard against.
- **The ingress route is not here.** `POST /channels/slack/events/` (and `/channels/bridge/events/`) is WP3's, public,
  HMAC-verified, no session and no `check_action_access` call — this package
  never registers it and never imports WP3's handler.
- **Threads, inbox and outbox have no create routes.** `ChannelThread`,
  `ChannelInboxEvent` and `ChannelOutboxEvent` are written by routing and by
  workers only (D31, `entities.md` §6). This package exposes `query_*` (and
  `close_channel_thread`, which appends per D12 rather than editing) and nothing
  that lets an API caller forge a conversation.
- **`api/entrypoints/routers.py` is prepared as a diff, not committed here.**
  WP8's registration block and its permission wiring land at C3 alongside WP6's,
  applied together as one edit per `workstreams/README.md`'s collision table.

## Tests

- Every route in the Interfaces table returns 403 without the matching permission
  and the expected 2xx/204 with it, exercised as a matrix over `VIEW_CHANNELS` /
  `EDIT_CHANNELS`.
- `set_channel_agent_default` on a connection that already has a default agent
  succeeds and the previous default's `flags.is_default` reads `false` after —
  proving the service clears-then-sets rather than the router validating.
- Creating a second `ChannelGrant` with `flags.is_default=true` for the same
  space raises a database-level conflict, not a 422 from a router-side check —
  assert the failure surfaces from the DAO/index, not from a pre-query.
- `list_channel_agents` / `query_channel_agents` (and the space/grant
  equivalents) both work against the same underlying data — the GET and the
  POST-query are not divergent code paths.
- `query_channel_threads`, `query_channel_inbox_events`,
  `query_channel_outbox_events` have no corresponding create route reachable
  from any client (assert 405/404 on `POST /threads/`, `POST /inbox/events/`,
  `POST /outbox/events/`).
- `resolve_channel_policy` returns a `ChannelEffectivePolicy` with `decided_by`
  populated for every field, for a fixture where each of the five levels
  (`capability`, `channel`, `agent`, `space`, `grant`) decides at least one
  field.
- `GET /agents/`, `GET /spaces/`, `GET /grants/` 307 is never observed — trailing
  slash present on every collection route registration.
- The public ingress path (`/channels/slack/events/`, `/channels/bridge/events/`) is absent from this router's
  route table entirely (assert by inspecting `self.router.routes`).

## Out of scope

- WP1 — the DAO, service methods and `resolve_policy` this router calls.
- WP3 — the ingress route and its `_PUBLIC_ENDPOINTS` registration.
- WP4 — routing, resolution and invoke; this package never causes a turn to run.
- WP9 — command parsing; `RUN_CHANNELS` is defined here but unused until WP9 or
  a later package needs it.
- WP13 — the web app consuming this API.

## Checkpoint

WP8 feeds **C3 — Slack works**. Merges WP6, WP8; needs C2.

> **Serialised here:** WP8's router registration and its `check_action_access`
> wiring.

> **Exit condition:** a mention in a real Slack workspace produces an answer in
> the same thread; an approval resolves from a button click without opening a
> browser; an operator can configure a connection end to end over the API.

WP8's share of that exit condition is the last clause: the operator's
end-to-end configuration path (connection → agent → space → grant → default)
must be reachable purely through this router's routes.

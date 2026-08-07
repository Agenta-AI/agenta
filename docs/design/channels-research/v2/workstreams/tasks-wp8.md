# WP8 — Tasks

## Setup

- [ ] Create `api/oss/src/apis/fastapi/channels/` package (`__init__.py`, `router.py`, `models.py`).
- [ ] Add `Permission.VIEW_CHANNELS`, `Permission.EDIT_CHANNELS`, `Permission.RUN_CHANNELS`
      to the permission enum and to the default-role permission lists, mirroring
      `VIEW_WORKFLOWS` / `EDIT_WORKFLOWS` / `RUN_WORKFLOWS` exactly (viewer gets
      VIEW, editor+ gets EDIT and RUN).

## Wire models (`models.py`)

- [ ] `ChannelAgentCreateRequest` / `EditRequest` / `QueryRequest` / `Response` / `sResponse`,
      wrapping the core DTOs per `entities.md` §6.
- [ ] `ChannelSpaceCreateRequest` / `EditRequest` / `QueryRequest` / `Response` / `sResponse`,
      plus `ChannelSpaceCandidatesResponse` for discovery.
- [ ] `ChannelGrantCreateRequest` / `EditRequest` / `QueryRequest` / `Response` / `sResponse`.
- [ ] `ChannelThreadQueryRequest` / `Response` / `sResponse` (no create/edit models).
- [ ] `ChannelInboxEventQueryRequest` / `sResponse`, `ChannelOutboxEventQueryRequest` / `sResponse`
      (no create/edit models).
- [ ] `ChannelCapabilitiesResponse`, `ChannelsCatalogResponse`.
- [ ] `ChannelPolicyResolveRequest`, `ChannelPolicyResponse`.
- [ ] `ChannelConnectionsResponse` (read-only view over shared `gateway_connections`).

## Router: catalog and capabilities

- [ ] `list_channels` — GET `/catalog/channels/`, `VIEW_CHANNELS`.
- [ ] `fetch_channel_capabilities` — GET `/catalog/channels/{channel}/capabilities/`, `VIEW_CHANNELS`.

## Router: connections (read-only view)

- [ ] `query_channel_connections` — POST `/connections/query`, `VIEW_CHANNELS`.

## Router: agents

- [ ] `create_channel_agent` — POST `/agents/`, `EDIT_CHANNELS`.
- [ ] `list_channel_agents` — GET `/agents/`, `VIEW_CHANNELS`.
- [ ] `query_channel_agents` — POST `/agents/query`, `VIEW_CHANNELS`.
- [ ] `fetch_channel_agent` — GET `/agents/{agent_id}`, `VIEW_CHANNELS`, 404 on `None`.
- [ ] `edit_channel_agent` — PUT `/agents/{agent_id}`, `EDIT_CHANNELS`, path/body id match check, 404 on `None`.
- [ ] `delete_channel_agent` — DELETE `/agents/{agent_id}`, `EDIT_CHANNELS`, 404 if not deleted.
- [ ] `set_channel_agent_default` — POST `/agents/{agent_id}/default`, `EDIT_CHANNELS`,
      calls `ChannelsService.set_agent_default` (clears prior default, sets new one in one call).

## Router: spaces

- [ ] `create_channel_space` — POST `/spaces/`, `EDIT_CHANNELS`.
- [ ] `list_channel_spaces` — GET `/spaces/`, `VIEW_CHANNELS`.
- [ ] `query_channel_spaces` — POST `/spaces/query`, `VIEW_CHANNELS`.
- [ ] `fetch_channel_space` — GET `/spaces/{space_id}`, `VIEW_CHANNELS`, 404 on `None`.
- [ ] `edit_channel_space` — PUT `/spaces/{space_id}`, `EDIT_CHANNELS`, path/body id match check, 404 on `None`.
- [ ] `delete_channel_space` — DELETE `/spaces/{space_id}`, `EDIT_CHANNELS`, 404 if not deleted.
- [ ] `discover_channel_spaces` — POST `/spaces/discover`, `VIEW_CHANNELS`, calls
      `ChannelsService.discover_spaces`, returns `ChannelSpaceCandidate` list (nothing persisted).

## Router: grants

- [ ] `create_channel_grant` — POST `/grants/`, `EDIT_CHANNELS`.
- [ ] `list_channel_grants` — GET `/grants/`, `VIEW_CHANNELS`.
- [ ] `query_channel_grants` — POST `/grants/query`, `VIEW_CHANNELS`.
- [ ] `edit_channel_grant` — PUT `/grants/{grant_id}`, `EDIT_CHANNELS`, path/body id match check, 404 on `None`.
- [ ] `delete_channel_grant` — DELETE `/grants/{grant_id}`, `EDIT_CHANNELS`, 404 if not deleted.
- [ ] `set_channel_grant_default` — POST `/grants/{grant_id}/default`, `EDIT_CHANNELS`,
      calls `ChannelsService.set_grant_default` (clear-then-set, one call).

## Router: policy

- [ ] `resolve_channel_policy` — POST `/policy/resolve`, `VIEW_CHANNELS`, calls
      `ChannelsService.resolve_effective_policy`, returns `ChannelEffectivePolicy`
      with `decided_by` populated.

## Router: threads, inbox, outbox (read-only + close)

- [ ] `query_channel_threads` — POST `/threads/query`, `VIEW_CHANNELS`.
- [ ] `close_channel_thread` — POST `/threads/{thread_id}/close`, `EDIT_CHANNELS`,
      calls `ChannelsService.close_thread` (appends, per D12 — never edits).
- [ ] `query_channel_inbox_events` — POST `/inbox/events/query`, `VIEW_CHANNELS`.
- [ ] `query_channel_outbox_events` — POST `/outbox/events/query`, `VIEW_CHANNELS`.
- [ ] Confirm no create/edit route exists for threads, inbox events or outbox
      events anywhere in the router — this is a negative assertion worth its own
      test, not just an omission.

## Verification

- [ ] Permission matrix test: every route 403s without its permission, succeeds with it.
- [ ] Default-swap test: `set_channel_agent_default` / `set_channel_grant_default`
      clear the prior default; a second default created directly (bypassing the
      swap verb) is rejected by the partial unique index, not by router code.
- [ ] Trailing-slash audit: every collection route ends in `/`, every item route
      does not — grep the router's `add_api_route` calls against the Interfaces
      table in `specs-wp8.md`.
- [ ] Confirm the ingress route (`/channels/slack/events/`, `/channels/bridge/events/`) is absent from this
      router's route table.

## Checkpoint prep

- [ ] Prepare the `api/entrypoints/routers.py` registration diff (import +
      `include_router` + any `check_action_access` bootstrap this file needs) as
      a reviewable patch, held until C3, per `workstreams/README.md`'s
      serialisation rule. Do not commit it to that file directly.

## Definition of done

An operator can configure a connection end to end over the API, and exactly one
agent can be default in a space — a second is rejected by the partial unique
index, not by application code.

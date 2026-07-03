---
id: telegram
title: 'Telegram in Composio: real integration, no real trigger'
date: 2026-07-01
---

# Telegram in Composio: real integration (tool), no real incoming-message trigger

## TL;DR

- **Telegram IS a real Composio integration.** The `telegram.SEND_MESSAGE`
  (`TELEGRAM_SEND_MESSAGE`) tool the live deployment returned is a genuine
  Composio catalog slug, not a phantom. Agenta emitted it because Composio's own
  semantic search (`COMPOSIO_SEARCH_TOOLS`) returned it.
- **`needs_auth` was meaningful, not a false positive.** It means "real
  integration, no active connection in this project, connect it via OAuth." It is
  exactly the state you'd expect for an unconnected but real toolkit.
- **The Slack mis-match on trigger discovery is the real signal that Telegram has
  no incoming-message trigger in Composio.** `find_triggers` (`POST
  /triggers/discover`) is keyword scoring over Composio's live catalog, not an
  allowlist and not a semantic trigger search. When no Telegram trigger event
  exists, the generic term "message" leaks to Slack's real
  `SLACK_CHANNEL_MESSAGE_RECEIVED` event.
- **Net for the builder kit:** Telegram can *send* (action tool) but cannot
  *listen* (no trigger). The honest agent behavior for "a bot that listens on
  Telegram" is: discover, detect `needs_auth` on the send tool, report there is no
  incoming-message trigger, and stop. This matches the build-notes decision for
  case 8.

## 1. How Agenta resolves Composio integrations and triggers

There is **no supported-integration allowlist anywhere** in `api/` or `sdks/`.
Everything is a live passthrough to Composio's V3 API. Availability is whatever
Composio's live catalog returns for this API key.

Tools (actions):

- `POST /api/tools/discover` → `ToolsService.discover_capabilities`
  (`api/oss/src/core/tools/service.py:474`) → adapter
  `search_capabilities` which calls Composio's meta-tool
  `POST /tools/execute/COMPOSIO_SEARCH_TOOLS`
  (`api/oss/src/core/tools/providers/composio/adapter.py:211-284`).
- The returned tool slugs come **straight from Composio** —
  `ComposioSearchQueryResult.primary_tool_slugs` / `related_tool_slugs` are plain
  passthrough fields (`api/oss/src/core/tools/providers/composio/dtos.py:22-30`),
  no aliasing, no rewriting. So `TELEGRAM_SEND_MESSAGE` in the result means
  Composio's catalog genuinely has a `telegram` toolkit with a `SEND_MESSAGE`
  action.
- Slug → integration split is purely mechanical
  (`split_composio_slug`, `api/oss/src/core/tools/discovery.py:147-173`):
  `TELEGRAM_SEND_MESSAGE` → `("telegram", "SEND_MESSAGE")`. No lookup table.
- The integration browse catalog (`GET /toolkits`, `GET /toolkits/{slug}`) is also
  a live passthrough (`api/oss/src/core/tools/providers/composio/catalog.py:57,88,116`).

Triggers (events):

- `POST /api/triggers/discover` → `TriggersService.discover_triggers`
  (`api/oss/src/core/triggers/service.py:330`).
- Trigger events come from the live catalog
  `GET /triggers_types?toolkit_slugs={integration}`
  (`api/oss/src/core/triggers/providers/composio/catalog.py:45-112`,
  path documented in `.../triggers/providers/composio/adapter.py:34-40`).

Conclusion for (1): **pass-through, no allowlist.** The repo does not pin the list
of supported apps or triggers. `needs_auth` on a real slug = real integration, just
not connected.

## 2. Is "telegram" a real Composio app with SEND_MESSAGE?

Yes — and the `needs_auth` state is meaningful, computed as follows in
`ToolsService._discovery_connection_state` / `_connection_auth_state`
(`api/oss/src/core/tools/service.py:551-636`):

1. Query the project's `gateway_connections` for `(composio, telegram)`.
2. If an active + valid connection exists → `READY`.
3. Otherwise read the integration's auth scheme via `get_integration("telegram")`
   (live `GET /toolkits/telegram`). OAuth-only (or unknown) → `NEEDS_AUTH`;
   API-key-only → `NEEDS_INPUT`.

So `connection: null, state: needs_auth` for `telegram.SEND_MESSAGE` decodes as:
Composio returned a real `TELEGRAM_SEND_MESSAGE` action, the project has no active
Telegram connection, and Telegram authenticates via OAuth. That is the normal
"real but unconnected" state — **not a phantom.**

Caveat worth noting: line 634-636 defaults any unknown/uncatalogued integration to
`NEEDS_AUTH`. So `needs_auth` on its own is not proof the integration is real. The
proof is that the **slug itself came from `COMPOSIO_SEARCH_TOOLS`**, which only
emits real Composio catalog slugs. Both together = real integration.

The repo does not vendor or pin a catalog; the only place app slugs are hardcoded
is test fixtures/mocks (`api/oss/tests/pytest/unit/tools/test_discovery.py`,
`.../unit/triggers/test_triggers_discovery.py`) — those mock the adapter and prove
nothing about the live catalog. Availability = whatever Composio returns live.

## 3. Does Composio expose Telegram *triggers* (incoming messages)?

Everything in the repo points to **no** real Telegram incoming-message trigger:

- The trigger mis-match to Slack is diagnostic. `find_triggers` does **keyword
  scoring**, not semantic search:
  - `_discover_events_for_use_case` (`.../triggers/service.py:463-502`) pulls
    candidate integrations by searching the catalog for the use_case and its terms
    (`_candidate_integrations`, line 504), then scores each integration's trigger
    events against the use_case terms (`_score_trigger_match`, line 170;
    `_match_signal`, line 124).
  - For "new telegram message" the scored terms are `telegram`, `message` ("new" is
    a stopword, line 86). If Composio has **no** Telegram trigger event, the term
    `message` still hits Slack's real `SLACK_CHANNEL_MESSAGE_RECEIVED` event, so
    Slack surfaces. The candidate loaders even fall back to broad, unfiltered
    catalog pages (`add_page(None)`, lines 530/562), which is exactly how an
    unrelated integration leaks in.
  - A `_has_primary_evidence` guard (line 183, needs 2 distinct matched terms or an
    exact-phrase hit, `_DISCOVERY_MIN_PRIMARY_TERMS = 2`, line 75) is meant to drop
    weak single-term matches to a no-match note. That the live deployment still
    surfaced Slack suggests either the deployment predates this guard or the tested
    phrasing shared a second term with the Slack page. Regardless, the mis-match
    tells us there was **no Telegram trigger event to match against** — if there
    were, `list_events(integration="telegram")` would have returned it and it would
    have out-scored Slack.

- Corroborating evidence in the repo:
  - The manual Composio trigger smoke test
    (`api/oss/tests/manual/triggers/try_composio_triggers.py`) only ever exercises
    **Slack** trigger types and explicitly notes: *"message_sent intentionally has
    no Slack equivalent — Slack/Composio only expose messages received."* Composio's
    trigger coverage is thin and app-specific.
  - The builder-agent build-notes already reached the same conclusion for case 8
    (`docs/design/agent-workflows/projects/builder-agent-reliability/build-notes.md:26-32`):
    *"Telegram is a known integration but not connected, and `find_triggers` has no
    real 'new telegram message' event (it mis-matches to a Slack event)."*

- Mechanism note: Telegram bots receive updates via getUpdates long-polling or a
  setWebhook webhook. Composio *could* model that as a trigger type, but this
  deployment's `GET /triggers_types?toolkit_slugs=telegram` evidently returns no
  matching incoming-message event (else discovery wouldn't fall through to Slack).
  The Telegram toolkit here is action-only (SEND_MESSAGE and friends), with no
  incoming-message trigger. (This reflects what Composio's live catalog returned
  for this key; it is not pinned in the repo, so it can change if Composio adds
  Telegram triggers.)

## What the Slack mis-match tells us about `find_triggers`

It is a **keyword-and-catalog-fallback matcher over Composio's live trigger
catalog**, not a curated map and not a semantic matcher. Its failure mode is:
when the requested integration has no matching trigger event, a generic noun in
the use_case ("message", "email", "issue") pulls in an unrelated integration that
*does* have such an event. That is a discovery-quality gap
(`_has_primary_evidence` is the mitigation), not evidence about Telegram — but the
fall-through itself confirms Telegram had no competing trigger event to return.

## Bottom line

- Tool: **real.** `telegram.SEND_MESSAGE` exists in Composio; `needs_auth` = real,
  unconnected, OAuth.
- Trigger: **not available** on this deployment. No Telegram incoming-message
  trigger; discovery mis-routes to Slack.
- User's belief "there is NO Telegram in Composio at all" is **half right**: no
  Telegram *trigger*, but there IS a Telegram *send-message* integration.

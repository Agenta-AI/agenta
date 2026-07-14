# Plan: score trigger discovery against a cached catalog dump

## Design in one paragraph

Fetch the complete Composio trigger-types catalog (351 items, 8 pages, ~4.3 s) through
the existing adapter, cache it in Redis with a 24-hour TTL, and rewrite
`_discover_events_for_use_case` to score all items in memory. The scoring functions
(`_score_trigger_match`, `_has_primary_evidence`, `_discovery_terms`) carry over, with
one addition found during live verification: an adjacency bonus that replaces the
provider's relevance ordering on score ties (decision D7 in
[`status.md`](status.md)). The per-use-case keyword paging
(`_candidate_integrations`, `_candidate_events`) and the follow-up `get_event` detail
call all disappear. The wire contract of `discover_triggers` does not change: same
request, same `TriggerCapabilitiesResult`.

## How the pieces map to the current code

All paths relative to `api/oss/src/core/triggers/`.

### 1. Adapter: fetch the full catalog

Add `list_all_events()` to `ComposioTriggersCatalogClient`
(`providers/composio/catalog.py`). It loops the existing `list_events(...)` page by page,
following `next_cursor` until exhausted, and returns `List[TriggerCatalogEventDetails]`.
Sequential on purpose (decision D2): the cursor format is undocumented, and the fetch is
rare enough that 4.3 seconds is fine.

The list response already includes `config` and `payload` per item (research §2), so the
existing `_parse_event` gets a sibling that parses list items into
`TriggerCatalogEventDetails` instead of the slimmer `TriggerCatalogEvent`.

### 2. Service: cache the dump

Add `_cached_event_catalog(provider_key)` to `TriggersService` (`service.py`), mirroring
`ToolsService._cached_search` (`core/tools/service.py`): try `get_cache`, on miss call
the adapter's `list_all_events()` and `set_cache` the result. Cache properties:

- **Key**: provider only. The catalog is the same for every project, so the cache is
  project-agnostic, exactly like the tools-discovery cache (its D6 split).
- **TTL**: 24 hours. The catalog moves slowly (351 mature items). A stale window of at
  most a day is acceptable because the subscription-create path validates against the
  live provider anyway; a removed trigger fails loudly at mint time, not silently.
- **Serialization**: a small wrapper DTO holding `List[TriggerCatalogEventDetails]`, so
  `get_cache(model=...)` can validate it. No new agent-facing fields; this type never
  crosses the API boundary (interface review: it is pure catalog data plus nothing, no
  config/policy/credential fields to misplace).

### 3. Service: score in memory

Rewrite `_discover_events_for_use_case`:

- Load the catalog once per `discover_triggers` call (one awaited cache read).
- Build a `TriggerCatalogIntegration` per distinct toolkit from the items' embedded
  `toolkit` (slug + name; no description, see D5).
- Score every item with the existing `_score_trigger_match`, keep score > 0, sort
  descending. Same dedup, same `_has_primary_evidence` gate for the primary match.
- The primary match's `trigger_config` and `payload` come straight from the dump item.
  Delete the `get_event` call inside `discover_triggers`.

Delete `_candidate_integrations` and `_candidate_events`. Nothing else uses them.

`_trigger_discovery_connection_state` and `_trigger_connection_auth_state` stay
unchanged. They are per-project (DB) plus at most one `get_integration` call per
surfaced integration, at most four per use case, and they must stay fresh (a user who
just finished connecting must see READY immediately). Not the bottleneck.

### 4. What stays on the live adapter

The public browse routes (`list_events`, `get_event` in
`apis/fastapi/triggers/router.py`) keep calling the adapter directly. Their pagination
semantics (Composio's native cursor) would change if we served them from the dump, and
they are not slow today. Possible follow-up, out of scope (decision D4).

## Phases

**Phase 1 — catalog fetch and cache.** `list_all_events()` on the adapter, the wrapper
DTO, `_cached_event_catalog()` on the service. Unit tests with a fake adapter: pages are
followed to exhaustion, cache hit skips the adapter, cache miss populates it.

**Phase 2 — in-memory discovery.** Rewrite `_discover_events_for_use_case`, delete the
candidate loaders, drop the `get_event` call. Update
`oss/tests/pytest/unit/triggers/test_triggers_discovery.py`: the scoring and
primary-evidence tests keep their assertions but feed a fake catalog dump instead of
paged fakes. Add one test that a use case matching nothing still returns the no-match
note (existing `_TRIGGER_DISCOVERY_NO_MATCH_NOTE` path).

**Phase 3 — verify against the live stack.** `cd api && py-run-tests` for the unit
suite. Then on the dev stack: call `discover_triggers` twice with 2 to 3 realistic use
cases ("when a new GitHub issue is created", "new Slack message in a channel"). Confirm
cold call completes in single-digit seconds, warm call in under a second, and the
surfaced events match a before/after capture from the current implementation.

**Phase 4 — docs sync.** No wire change, so the interface inventory is untouched. Update
any agent-workflows documentation that mentions trigger-discovery latency or the paged
lookup, per the keep-docs-in-sync skill.

## Risks and mitigations

- **Cold-cache stampede**: several concurrent discoveries on an empty cache each trigger
  the 4-second fetch. Harmless (last write wins, results identical) but wasteful. If it
  shows up in practice, add a Redis `SET NX` single-flight lock. Not in v1.
- **Composio outage with a cold cache**: the fetch raises `AdapterError`, which surfaces
  exactly as today's per-page failures do. A stale-while-revalidate cache would mask
  this; noted as optional hardening, not in v1.
- **Scoring drift**: the integration description leaves the haystack (D5). The term
  weights already favor event fields (5) and event key (3) over integration key (2), and
  toolkit slug + name remain. Phase 3's live capture was the check, and it caught a real
  case: score ties that the provider's relevance ordering used to break now broke by
  catalog order, surfacing the GitHub issue-comment event over the issue-created event.
  Resolved with the adjacency bonus (D7 in [`status.md`](status.md)) plus a unit test
  that pins the case.

## Verification summary

1. Unit: `cd api && py-run-tests` green, including the rewritten discovery tests.
2. Live: two consecutive `discover_triggers` calls on the dev stack; assert timings
   (cold < 10 s, warm < 1 s) and stable results against a pre-change capture.
3. Regression: the existing subscription-create flow against a discovered event still
   works end to end (discover, connect, create_subscription).

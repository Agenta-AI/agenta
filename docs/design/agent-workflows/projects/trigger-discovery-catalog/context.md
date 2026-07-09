# Context: why `discover_triggers` is slow

## The symptom

An agent that calls `discover_tools` gets an answer in under a second (warm). The same
agent calling `discover_triggers` waits 30 to 60 seconds. Both operations answer the same
kind of question: "given this use case, which integration and which capability should I
wire up?" The gap makes trigger setup feel broken next to tool setup.

## Why the two operations differ

`discover_tools` rides on Composio's semantic search. One HTTP call
(`COMPOSIO_SEARCH_TOOLS`) takes all the use cases at once and returns tools, schemas, and
guidance together. The service caches that result in Redis, keyed project-agnostically,
so repeat discoveries skip Composio entirely
(`api/oss/src/core/tools/service.py`, `discover_capabilities` and `_cached_search`).

`discover_triggers` has no semantic search to ride on. Composio does not offer one for
triggers. So the v1 implementation emulates search by paging the catalog with keywords
(`api/oss/src/core/triggers/service.py`, `discover_triggers`):

1. For each use case, `_candidate_integrations` runs up to five `GET /toolkits` searches
   (the full phrase, then the first three keywords, then an unfiltered fallback).
2. For each of up to ten candidate integrations, `_candidate_events` runs up to five
   `GET /triggers_types` searches the same way.
3. The primary match then costs one more `GET /triggers_types/{slug}` for its config
   schema, and each surfaced integration costs a `GET /toolkits/{slug}` for its auth
   schemes.

Every one of those calls is a live HTTP round trip. None are cached. None run
concurrently: each `await` sits inside a plain `for` loop, so latencies add up instead of
overlapping. The worst case is roughly 50 sequential round trips per use case. At 0.5
seconds per round trip, three use cases cost over a minute.

So the problem is not algorithmic complexity in CPU terms. It is a sequential HTTP
fan-out against a remote catalog, done fresh on every call.

## The insight that unlocks the fix

The trigger catalog is tiny and self-contained. Measured live (see
[`research.md`](research.md)):

- 351 trigger types total, across only 41 toolkits. Compare 23,790 action tools, which
  is why the tools side genuinely needs Composio's search.
- The full dump is 8 pages and 2.2 MB, and each item already includes everything
  discovery needs: slug, name, description, toolkit, the `config` schema, and a sample
  `payload`.
- Fetching all 8 pages takes about 4.3 seconds.

A catalog this small does not need remote search. We can hold the whole thing in memory
and score it directly, with the same scoring functions the service already uses.

## Why we download instead of shipping a JSON file

Shipping the dump as a file in the repo was the first idea, and the repo has precedent
for vendored catalogs (the LLM model list in `assets.py`). But Composio's terms of
service rule it out. Section 3 of [composio.dev/terms](https://composio.dev/terms)
excludes "any resale or commercial use of the platform or its contents, any derivative
use of the platform or its contents, or any use of data mining, robots, or similar data
gathering and extraction tools." Committing their catalog content (descriptions, schemas,
sample payloads) into a public repo that ships in a commercial product reads as exactly
that. Downloading the catalog at runtime with our own API key and caching it server-side
is ordinary API usage, and it costs us almost nothing: one 4-second fetch per deployment
per cache window instead of zero. Full analysis in [`research.md`](research.md), decision
D1 in [`status.md`](status.md).

## Goals

- Warm `discover_triggers` returns in under a second.
- Cold calls pay one catalog fetch (about 4 seconds), once per deployment per cache
  window, not per request.
- Discovery results stay at least as good as today: same scoring logic, same DTOs, no
  wire change.
- The agent-facing contract of the operation does not change at all.

## Non-goals

- No change to `discover_tools`. It is already fast.
- No change to the public catalog browse endpoints (`list_events`, `get_event` routes) in
  v1. They stay on the live adapter. Serving them from the cached dump is a possible
  follow-up, noted in [`plan.md`](plan.md).
- No vendored catalog file in the repo (ToS, see above).
- No new agent-facing fields or behavior.

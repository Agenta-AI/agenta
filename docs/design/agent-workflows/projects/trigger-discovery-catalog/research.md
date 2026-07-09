# Research: verified facts

Everything below was measured live against `https://backend.composio.dev/api/v3` with the
dev-stack API key, on 2026-07-09 and 2026-07-10. Nothing here is estimated.

## 1. Catalog sizes

| Catalog | Endpoint | Count |
| --- | --- | --- |
| Toolkits (integrations) | `GET /toolkits` | 1,047 |
| Trigger types (events) | `GET /triggers_types` | 351 |
| Tools (actions) | `GET /tools` | 23,790 |

Only **41 of the 1,047 toolkits have any trigger at all**. The distribution is heavily
skewed toward a few large integrations:

googlesuper 48, github 46, confluence 23, clickup 21, box 20, googlesheets 16,
workday 13, linear 12, zoom 11, googledocs 10, one_drive 9, slackbot 9, slack 9,
notion 8, googlecalendar 7, and a long tail of smaller ones.

The takeaway: the trigger catalog is two orders of magnitude smaller than the tools
catalog. Holding it whole is cheap. That option does not exist for tools, which is why
the tools side uses Composio's semantic search instead.

## 2. What a trigger-type item contains

Each item in the `GET /triggers_types` list response carries:

`slug`, `name`, `description`, `toolkit` (object with `slug` and `name`), `config`
(the JSON Schema for the trigger's configuration), `payload` (a sample event payload),
`instructions`, `requires_webhook_endpoint_setup`, `type`, `version`.

This matters because the current `discover_triggers` makes a **separate**
`GET /triggers_types/{slug}` call to fetch `config` and `payload` for the primary match.
With the full dump in hand, that call disappears: the list items already contain both
fields.

One gap: the `toolkit` object inside an item has `slug` and `name` but no description.
The current scorer includes the integration description in its haystack. Scoring from
the dump loses that one signal. See decision D5 in [`status.md`](status.md).

## 3. Dump size and fetch timings

- Page size is capped at 50. A `limit=1000` request is silently clamped to 50, so the
  full dump is 8 pages.
- Full dump: **2.2 MB** of JSON. Stripped to only the fields the keyword scorer reads
  (slug, name, description, toolkit, type): **139 KB**.
- Sequential fetch, following `next_cursor` page by page: **4.26 seconds** (8 pages at a
  steady ~0.55 s each).
- Parallel fetch: the cursor is just base64 of `page-offset` (`"Mi01MA=="` decodes to
  `2-50`), so all 8 cursors can be constructed upfront and fetched concurrently:
  **0.86 seconds**, all 351 slugs identical to the sequential result.

We decided against the parallel trick (decision D2). The cursor format is undocumented,
so constructing cursors by hand leans on an implementation detail Composio can change
without notice. The fetch runs once per cache window per deployment; 4.3 seconds there
is not worth a fragile dependency.

## 4. Why the current implementation is slow (call-count math)

Per use case, worst case, all sequential:

| Step | Calls |
| --- | --- |
| `_candidate_integrations`: phrase + 3 terms + fallback | up to 5 |
| `_candidate_events` for each of up to 10 integrations | up to 10 × 5 |
| `get_event` detail for the primary match | 1 |
| `get_integration` auth-scheme check per surfaced integration | up to 4 |

That is up to ~50 round trips per use case, each a live HTTP call with a 30-second
timeout budget and no caching. Three use cases means ~150 sequential calls. At the
measured ~0.55 s per Composio round trip, that is 30 to 80 seconds of pure network wait.

`discover_tools`, for comparison, makes **one** Composio call for all use cases combined,
and caches it (`_cached_search`, `api/oss/src/core/tools/service.py`).

## 5. Composio SDK and static availability

- Neither the API service nor the SDK depends on a Composio SDK package. Our adapters
  call the REST API directly with httpx
  (`api/oss/src/core/triggers/providers/composio/catalog.py`).
- Composio's own SDKs (Python `composio`, TypeScript `@composio/core`) are thin API
  clients. They bundle no catalog files.
- Composio publishes no downloadable catalog dump. The paginated API is the only source.

## 6. Terms-of-service check (can we vendor the dump?)

Question: may we commit the downloaded catalog (descriptions, config schemas, sample
payloads) as a JSON file in the Agenta repo?

Section 3 (License Grant) of [composio.dev/terms](https://composio.dev/terms):

> "This license does not include any resale or commercial use of the platform or its
> contents, any derivative use of the platform or its contents, or any use of data
> mining, robots, or similar data gathering and extraction tools."

A vendored dump in a public repo that ships in a commercial product (Agenta EE) plausibly
hits both the "derivative/commercial use of its contents" clause and the "data gathering
and extraction" clause. No clause grants redistribution or offline storage of API
responses. Conclusion: do not vendor. Fetch at runtime with our API key and cache
server-side, which is ordinary API usage. This became decision D1.

The practical loss is small. A vendored file would only have bought us discovery with
zero Composio calls ever, and discovery is useless without a Composio key anyway (the
connection-state half of the response needs one).

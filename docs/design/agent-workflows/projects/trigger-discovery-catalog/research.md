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

That sums to up to 60 round trips per use case, each a live HTTP call with a 30-second
timeout budget and no caching. Three use cases means up to 180 sequential calls. At the
measured ~0.55 s per Composio round trip, that is 30 to 90+ seconds of pure network wait.

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

## 7. Discovery quality experiment (891 queries, 2026-07-10)

After the catalog cache shipped, a live check showed "slack triggers" returning nothing
at all. Rather than patch that one case, we measured what agents actually get. The
harness (`scripts/discovery_eval.py`) extracts the real scoring functions from
`service.py` via AST, so there is no copy drift, and replays them over the real
351-event catalog with four query families:

- **usecase / fragment** (343 each): natural phrasings templated from every live
  event's own name ("when a message is posted in slack", "slack channel message
  received"). Ground truth is known by construction.
- **browse** (164): menu-shaped asks agents genuinely type, with spaced names the way
  people write them ("google calendar triggers", "what triggers does slack support").
- **hand** (41): realistic asks written independently of the catalog, including
  platforms the catalog does not have (telegram, dropbox) and vocabulary mismatches
  ("when a pull request is merged" — Composio only has state-changed).

What the baseline got wrong, with numbers:

| Failure | Baseline | Cause |
| --- | --- | --- |
| Browse queries fully empty | 25% | "triggers"/"events" match nothing; 2-term gate fails; no-match path returns zero alternatives |
| Browse queries wrong toolkit | 14% | "what" is a substring of WHATSAPP, "can" of CANVAS |
| Wrong platform as primary | "discord message received" → Slack | event-key word hits outweigh platform identity |
| Deprecated events surfaced | 6 corpus hits | nothing demotes "DEPRECATED: use X instead" items |
| Hand asks with right answer nowhere in top 4 | 4.9% | combination of the above |

Nine scorer variants were A/B tested on the same corpus. The winner (shipped) combines
four changes: meta and question words become stopwords; a use case that names a
platform is restricted to it; deprecated events lose 25 score points; and the no-match
path returns the closest-scoring events as alternatives instead of nothing. Results:

| Metric | Baseline | Shipped |
| --- | --- | --- |
| usecase/fragment top-1 | 98.0% | 98.0% (top-4 stays 100%) |
| browse right toolkit | 61% | 100% |
| browse empty | 25% | 0% |
| hand: right answer missing from top 4 | 4.9% | 0% |
| deprecated events surfaced | 6 | 0 |

Variants that measured worse and were rejected, so nobody re-tries them blind:

- **Singular/plural fallback matching**: hand top-1 dropped 46% → 41% (extra noise
  outweighs the few plural saves).
- **Treating "new" as a content word**: templated top-1 hit 100%, but it regressed the
  pinned live case — "new slack message in a channel" flipped to the direct-message
  event because its verbose description mentions "new" and "channels".
- **Down-weighting description-only hits**: fixed the case above but dropped "when
  someone stars my github repo" out of the top 4 entirely (the description is the only
  place "stars" appears; the event is named STARGAZER). A right answer nowhere in the
  surfaced set is the worst failure class, so this lost to keeping description weight.
- **A large question-word stopword list** (list, show, get, support, have...): those
  words appear inside real event names, and templated top-1 fell 2.7 points. Only the
  minimal hazard set shipped.

Residual, accepted: when the named platform has no triggers in the catalog at all
("new telegram message received"), generic words can still pass the 2-term gate and
surface a wrong-platform primary. The tool description and the build-agent skill both
instruct the agent to confirm the integration and the event description before wiring
anything, and the no-match note says explicitly that an absent integration means the
provider has no triggers for it.

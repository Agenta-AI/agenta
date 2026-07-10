# Status

**State: implemented and verified live. On PR #5189 for review.**

Last updated: 2026-07-10.

## Where things stand

- Design reviewed and approved (PR #5189, lgtm on 2026-07-10). CodeRabbit's five review
  comments are folded in (see the decision list and the arithmetic fix in
  [`research.md`](research.md)).
- Implementation landed per [`plan.md`](plan.md), phases 1 to 3. The catalog fetch, the
  Redis cache, the in-memory scorer, and the whole-fetch deadline are in
  `api/oss/src/core/triggers/`; the env knobs are `COMPOSIO_CATALOG_CACHE_TTL_SECONDS`
  (default 86400) and `COMPOSIO_CATALOG_FETCH_DEADLINE_SECONDS` (default 30).
- Measured on the live EE dev stack (2026-07-10): **cold call 5.06 s, warm calls 0.71 s
  and 0.73 s** for two use cases, against 30 to 60 seconds before. One
  `list_all_events` fetch on the cold call (351 items, 41 toolkits), zero Composio
  catalog calls on warm ones. Cache key confirmed project-agnostic with a ~24 h TTL.
- Unit suite: 193 triggers+tools tests green, full unit lane green except 6
  pre-existing, unrelated failures in `secrets/test_dtos.py` (SSRF URL rejection;
  present before this change).

## Settled decisions

- **D1 — Download at runtime, never vendor the dump.** Composio ToS §3 excludes
  commercial/derivative use of platform contents and data extraction; a committed JSON
  file in a commercial OSS repo is not defensible. A runtime fetch with our API key,
  cached server-side, is ordinary API usage. Cost of compliance: one ~4 s fetch per
  deployment per cache window.
- **D2 — Sequential page fetch, no constructed cursors.** The pagination cursor decodes
  to a predictable `page-offset` string, and constructing all 8 cursors upfront cuts the
  fetch from 4.3 s to 0.9 s. Rejected: the format is undocumented and the fetch is rare.
  Boring wins.
- **D3 — Redis cache, project-agnostic key, 24 h TTL.** Namespace `triggers:catalog`,
  same pattern and rationale as tools discovery (`_cached_search`, D6 in the
  tool-discovery workspace): the catalog half is global, the connection-state half is
  computed fresh per project on every call. The shared cache helper's built-in lock also
  single-flights concurrent cold callers, which retired the stampede risk from the plan.
- **D4 — Only discovery reads the dump; browse routes stay live.** `list_events` /
  `get_event` HTTP routes keep their adapter-backed cursor pagination. Verified
  unaffected on the live stack. Serving them from the dump is a follow-up, not v1.
- **D5 — Toolkit display names ride along in the snapshot; only the integration
  description leaves the scoring haystack.** The snapshot carries an
  `integration_names` map (slug to display name) parsed from the dump, so name-based
  matching survived. The lost description signal is guarded by the live capture and the
  pinned ranking test (see D7).
- **D6 — Whole-fetch deadline (from review).** The full catalog crawl is wrapped in one
  `asyncio.wait_for` deadline (`catalog_fetch_deadline_seconds`, default 30 s) converted
  to the domain `AdapterError`, so one stalled page cannot hold a cold call for the sum
  of per-page timeouts. The page loop is also capped at 50 pages with a warning log when
  the cap truncates the snapshot.
- **D7 — Content-term adjacency bonus in the scorer (from live verification).** With
  provider relevance ordering gone, equal-score ties broke by catalog order, and "when a
  new GitHub issue is created" surfaced `GITHUB_ISSUE_COMMENT_CREATED_TRIGGER` over
  `GITHUB_ISSUE_CREATED_TRIGGER` (both scored 26). `_match_signal` now adds +4 per
  consecutive pair of use-case terms found adjacent in the normalized event key or name
  ("issue created" hits `ISSUE_CREATED`, not `ISSUE_COMMENT_CREATED`). Terms matching
  the integration's own key or name are excluded from pair formation: a first version
  that included them made "slack message" reward `SLACK_MESSAGE_REACTION_ADDED` over
  the real channel-message events, because the integration name prefixes every event
  key of that integration. `matched_terms` and the primary-evidence gate are untouched.
  Two unit tests pin the GitHub and Slack cases with the wrong event listed first.
- **D8 — Discovery quality pass, validated by an 891-query experiment.** A live check
  after the cache shipped showed browse-shaped asks ("slack triggers") returning
  nothing. We measured instead of patching: `scripts/discovery_eval.py` replays the
  real scoring functions (AST-extracted, no copy drift) over the real catalog with
  templated, browse, and hand-written query families (research §7). Four changes won
  the A/B and shipped together: (1) meta and question words became stopwords —
  "triggers" is noise, and "what"/"can" substring-match WHATSAPP/CANVAS; (2) a use case
  that names a platform is restricted to that platform's events, because a
  perfectly-worded event on the wrong platform is unusable ("discord message received"
  must never return Slack); (3) events whose description starts with DEPRECATED lose 25
  points, so live replacements always outrank them; (4) the no-match path returns the
  closest-scoring events as alternatives with an honest note, instead of an empty list.
  Browse queries went from 25% empty / 14% wrong toolkit to 100% right toolkit; the
  templated ground-truth sets held at 98% top-1 / 100% top-4. Rejected with data (so
  they are not re-tried blind): plural fallback, "new" as a content word, description
  down-weighting, and a large question-word list — each regressed a measured case
  (research §7). The tool description in the SDK op catalog and the build-agent skill
  were updated in the same pass: matching is keyword search, confirm integration +
  description before wiring, bare integration name browses its events.

## Notes for future sessions

- The EE dev stack's uvicorn watchfiles does not pick up host-side writes under
  `api/oss/src/core/triggers/` (it does for `oss/src/utils/env.py`). A byte-identical
  rewrite of `env.py` forces a full reload when triggers changes must go live. Cause not
  investigated; worth a look if it bites again.

## Open questions

- None blocking. Optional hardening (stale-while-revalidate on Composio outage with a
  cold cache) remains listed in [`plan.md`](plan.md) and deliberately out of v1.

## Next steps

1. Merge review of the implementation diff on PR #5189.

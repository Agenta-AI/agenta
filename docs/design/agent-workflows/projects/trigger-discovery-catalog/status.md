# Status

**State: design ready for review. No implementation started.**

Last updated: 2026-07-10.

## Where things stand

- Problem diagnosed and measured live (see [`research.md`](research.md)): the latency is
  a sequential HTTP fan-out of up to ~50 uncached Composio calls per use case.
- Full catalog dump measured: 351 trigger types, 8 pages, 2.2 MB, 4.3 s sequential fetch.
- Composio ToS checked: vendoring the dump in-repo is not clearly permitted, so the
  design fetches at runtime and caches in Redis.
- Design and phased plan written ([`plan.md`](plan.md)). Awaiting review before
  implementation.

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
- **D3 — Redis cache, project-agnostic key, 24 h TTL.** Same pattern and rationale as
  tools discovery (`_cached_search`, D6 in the tool-discovery workspace): the catalog
  half is global, the connection-state half is computed fresh per project on every call.
- **D4 — Only discovery reads the dump; browse routes stay live.** `list_events` /
  `get_event` HTTP routes keep their adapter-backed cursor pagination. Serving them from
  the dump is a follow-up, not v1.
- **D5 — Accept losing the integration description from the scoring haystack.** The
  dump's embedded toolkit object has slug and name only. Event-level fields dominate the
  score weights, and the phase-3 before/after capture guards against ranking regressions.

## Open questions

- None blocking. Optional hardening (single-flight lock, stale-while-revalidate) is
  listed in [`plan.md`](plan.md) under risks and deliberately out of v1.

## Next steps

1. Review of this workspace (draft PR).
2. Implement phases 1 to 4 from [`plan.md`](plan.md) on a GitButler lane over
   `big-agents`.

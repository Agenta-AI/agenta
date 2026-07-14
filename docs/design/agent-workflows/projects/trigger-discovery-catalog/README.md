# Trigger discovery: cached catalog dump

Planning workspace for making `discover_triggers` fast. Today the operation takes 30 to 60
seconds because it pages through the Composio catalog with up to 60 sequential HTTP calls
per use case. The fix: fetch the full trigger catalog once (351 items, about 4 seconds),
cache it in Redis for a day, and score every use case in memory. Warm calls drop to under
a second.

This is the triggers-side sibling of the `tool-discovery` workspace
([`../tool-discovery/`](../tool-discovery/README.md)). Tools got fast through Composio's
semantic search. Triggers have no such search, but their catalog is small enough to hold
whole.

## Files

- [`context.md`](context.md) — why `discover_triggers` is slow, why `discover_tools`
  isn't, and what outcome we want.
- [`research.md`](research.md) — verified facts: catalog sizes, dump timings, what each
  catalog item contains, and the Composio terms-of-service check. All run live on
  2026-07-09 and 2026-07-10.
- [`plan.md`](plan.md) — the design and the phased implementation plan.
- [`status.md`](status.md) — current state and settled decisions (D1 to D5). Source of
  truth.

## One-line summary

The whole Composio trigger catalog is 351 items across 41 toolkits, and each item already
carries its config schema and a sample payload. Fetch it once, cache it for a day, score
in memory: cold discovery costs one 4-second fetch per deployment per day, and every other
call returns in under a second.

Implemented and verified live on 2026-07-10: cold 5.06 s, warm 0.71 s, against 30 to 60
seconds before. See [`status.md`](status.md).

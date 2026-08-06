# WP2 — Status

**Lane** WL2 · **Stream** WS2 · **Branch** `wp2-resolver-promote` (not yet created)

| Field | Value |
|-------|-------|
| State | IMPLEMENTED (awaiting commit by orchestrator) |
| Contract frozen (WS-PRE) | ☑ `resolve_target_fields(template, context)` signature |
| Branch created | ☐ (anchor `wp1-events-catalog`) |
| Subagent | WP2 build agent |
| PR | — |

## Checklist

- [x] Move `resolve_payload_fields` → `agenta.sdk.utils.resolvers.resolve_target_fields`
- [x] Update webhooks call site
- [x] AC: webhooks delivery suite green, unchanged
- [ ] PR opened `--base wp1-events-catalog`

## Decisions

- [x] SDK module path confirmed — `sdks/python/agenta/sdk/utils/resolvers.py`
      already exists and exports `resolve_json_selector`; `resolve_target_fields`
      added next to it. No conflict.

## Notes / blockers

- Pure move + rename, no behavior change. `MAX_RESOLVE_DEPTH` (=10) moved with the
  function into the SDK resolvers module (it only governed this recursion).
- Webhooks `delivery.py` now imports `resolve_target_fields` from the SDK and dropped
  its local `resolve_payload_fields` + `MAX_RESOLVE_DEPTH`.
- Test file `test_webhooks_tasks.py`: imports + the `resolve_json_selector` patch target
  repointed to `agenta.sdk.utils.resolvers`; assertions unchanged. All 19 tests pass.
- No triggers code touched; no triggers→webhooks import path introduced.
- Env note: the locally installed editable `agenta` resolves to the sibling `vibes`
  worktree, so tests were run with `PYTHONPATH=.../application/sdks/python` to exercise
  the edited SDK in this tree.

## Files changed (for the orchestrator)

- `sdks/python/agenta/sdk/utils/resolvers.py` (add `resolve_target_fields` + `MAX_RESOLVE_DEPTH`)
- `api/oss/src/core/webhooks/delivery.py` (import + call site; drop local fn/const)
- `api/oss/tests/pytest/unit/webhooks/test_webhooks_tasks.py` (import + patch target rename)

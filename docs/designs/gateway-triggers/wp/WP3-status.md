# WP3 — Status

**Lane** WL3 · **Stream** WS3 · **Branch** `wp3-subscriptions` (not yet created)

| Field | Value |
|-------|-------|
| State | NOT STARTED |
| Contract frozen (WS-PRE) | ☐ Subscription/Delivery DTOs + routes + DAO surface |
| Consumes frozen | ☐ ConnectionsGW (WP0) ☐ TriggersGW (WP1) |
| Branch created | ☐ (anchor `wp2-resolver-promote`) |
| Subagent | — |
| PR | — |

## Checklist

- [ ] `subscriptions` table (FlagsDBA, DataDBA, FK → gateway_connections)
- [ ] `deliveries` table (+ metadata.id dedup column)
- [ ] DBA mixins (mirror webhooks/dbas.py)
- [ ] Migration in `core_oss` (both editions)
- [ ] Subscription CRUD routes + adapter calls (ti_* lifecycle)
- [ ] Delivery read routes
- [ ] Stub ConnectionsGW (WP0) + TriggersGW (WP1) until merged
- [ ] AC: create/list/disable/delete; delete leaves connection intact
- [ ] PR opened `--base wp2-resolver-promote`

## Decisions

- [ ] I4 idempotency store (dedup column)
- [ ] M8 default mapping + validation posture

## Notes / blockers

_(none yet)_

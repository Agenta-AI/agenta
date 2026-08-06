# WP4 — Status

**Lane** WL4 · **Stream** WS4 · **Branch** `wp4-ingress-dispatch` (not yet created)

| Field | Value |
|-------|-------|
| State | NOT STARTED |
| Consumes frozen | ☐ Subscription DTO/DAO (WP3) ☐ `resolve_target_fields` (WP2) |
| Branch created | ☐ (anchor `wp3-subscriptions`) |
| Subagent | — |
| PR | — |

## Checklist

- [ ] `POST /triggers/composio/events/` raw-body + HMAC verify + `COMPOSIO_WEBHOOK_SECRET`
- [ ] project/trigger scoping + 200-skip + target guard (I5)
- [ ] webhook-URL registration (I6)
- [ ] resolve `inputs_fields` → `data.inputs` (M2, M3)
- [ ] build request refs/selector (M4) + `invoke_workflow` (M5)
- [ ] system `user_id` (M6)
- [ ] async dispatch (M7)
- [ ] metadata.id dedup (I4) + delivery rows + retry (M9)
- [ ] Stub WP3 DAO + WP2 resolver until merged
- [ ] AC: 401 / no-op / invoke / dedup / error-row
- [ ] PR opened `--base wp3-subscriptions`

## Decisions

- [ ] I6 webhook-URL registration
- [ ] M7 sync vs async
- [ ] M6 system identity
- [ ] M9 retry policy

## Notes / blockers

_(none yet)_

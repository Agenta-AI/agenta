# WP6 — Web: subscriptions + deliveries UI

**Lane** WL6 (anchor WL3) · **Stream** WS6 (web) · **Area** web

Parent docs: [`../plan.md`](../plan.md) §4, [`../gap.md`](../gap.md) §2.6 (F1 subscribe, F3).

## Goal

The management half of the FE: create / manage subscriptions and view deliveries.

## Closes (gap items)

F1 (subscribe part), F3.

## Scope

- Create a subscription — pick event + bind workflow + author the mapping (`inputs_fields`) —
  via the WP3 subscription API.
- List / disable / delete subscriptions.
- Deliveries audit view (`/triggers/deliveries`, F3 — deferrable past v1).

## Functional deps

- **WP3** only — the `/triggers/subscriptions` + `/triggers/deliveries` API. Independent of
  WP4 (the management UI doesn't need dispatch to exist).

## Stubs needed (until deps merge)

- Mock the WP3 HTTP surface against its frozen shape.

## Decisions to lock first

None hard (consumes the frozen WP3 API).

## Acceptance criteria

- Create a workflow-bound subscription; list / disable / delete it.
- Deliveries view renders (empty until WP4 dispatch lands).

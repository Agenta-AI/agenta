# WP4 — Ingress + dispatch

**Lane** WL4 (anchor WL3) · **Stream** WS4 (api) · **Area** api

Parent docs: [`../plan.md`](../plan.md) §4, [`../gap.md`](../gap.md) §2.4 + §2.5, [`../mimics.md`](../mimics.md) (Triggers vs Billing;
Triggers vs Everything), [`../mapping.md`](../mapping.md) §3–§4.

## Goal

Close the loop in **one** functional unit: an inbound event is received, verified, scoped,
resolved, and acted on. Ingress lives here (not its own lane) because a verify-and-park
endpoint isn't functional — the receive path only becomes real once it dispatches.

## Closes (gap items)

I1, I2, I3, I4, I5, I6, M2, M3, M4, M5, M6, M7, M9 — and consumes **M1** (the resolver).

## Scope — ingress half (mimic billing `/stripe/events/`)

- `POST /triggers/composio/events/` — read raw body **before** parsing.
- HMAC-SHA256 verify over `{id}.{ts}.{body}` with `COMPOSIO_WEBHOOK_SECRET`; 401 bad sig;
  200 no-op when secret unset; add `COMPOSIO_WEBHOOK_SECRET` to `env`.
- Recover `project_id` from `metadata.user_id`; route `metadata.trigger_id` → local
  subscription; 200-skip unknown/disabled; optional `target`-style env fan-out guard (I5).
- One-time project webhook-URL registration with Composio (I6).

## Scope — dispatch half

- Resolve `inputs_fields` via `resolve_target_fields` against `{event, subscription, scope}`
  with `TRIGGER_EVENT_FIELDS` (M2, M3) into `data.inputs` **only**.
- Build the `WorkflowServiceRequest`: destination from the stored workflow `references`/
  `selector` (M4); call `WorkflowsService.invoke_workflow(project_id, user_id, request)` (M5).
- **System-initiated identity** (M6) — run as a resolved project-system `user_id`.
- **Async dispatch** (M7) — ack-fast + enqueue; ingress returns 2xx promptly.
- Real `metadata.id` dedup against `deliveries` (I4); write a delivery row per event with
  outcome; dispatch retry policy (M9).

## Functional deps (fan-in)

- **WP3** — reads the subscription, writes a `deliveries` row (DTO + DAO surface).
- **WP2** — imports `resolve_target_fields`.

## Stubs needed (until deps merge)

- Subscription DTO/DAO (WP3) — stub `get_subscription_by_trigger_id` + `write_delivery`.
- `resolve_target_fields` (WP2) — import against the frozen signature.

## Decisions to lock first

Webhook-URL registration (I6), sync-vs-async (M7), system `user_id` (M6), retry policy (M9).

## Acceptance criteria (both editions)

- Forged signature → 401; unset secret → 200 no-op.
- Signed event for a known subscription → bound workflow invoked with the mapped inputs.
- Duplicate `metadata.id` → **single** invocation.
- Bad mapping / missing workflow → a `deliveries` **error row** (no workflow trace), still
  2xx to the provider.

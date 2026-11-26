# WP5 — Web (schedule UI + play/pause across 3 domains)

Read `contracts.md` first. Depends on WP3 (schedule CRUD API) + WP6 (start/stop routes) — code
against the documented API shapes. Independent tree (web/), fully parallel.

Apply the `agenta-package-practices` skill (package vs app placement, molecules, EntityPicker,
loadable/runnable bridges, package unit tests).

## Location
`web/packages/agenta-entity-ui/src/gatewayTrigger/` (alongside the existing
`drawers/TriggerSubscriptionDrawer.tsx`). Data atoms likely under `web/packages/agenta-entities/`.

## Three surfaces

### 1. Schedule drawer (create/edit)
Mirror `drawers/TriggerSubscriptionDrawer.tsx`. Differences:
- Replace the Composio event picker with a **cron-expression field**. Validate client-side and show a
  human-readable "next runs" hint (consider `cronstrue` or a tiny local parser; confirm dep policy).
- Reuse the reference-family build exactly as the subscription drawer / `runnable/deploy.ts`
  (`web/packages/agenta-entities/src/runnable/deploy.ts`): send `application{,_variant,_revision}` or
  evaluator/environment-by-slug families. The drawer sends `data.references` already normalized by FE
  prefix; BE completes the family.
- Send `data: { event_key, schedule, inputs_fields, references, selector }` per `TriggerScheduleData`.

### 2. Schedules list / table
Mirror the subscriptions list. Columns: name, cron (rendered human-readable), bound workflow,
`is_active` state, last delivery. Row actions: edit, delete, **play/pause**.

### 3. Play/pause control (all three entity types)
A toggle on row + drawer for trigger subscriptions, trigger schedules, AND webhook subscriptions,
calling the WP6 routes `POST /{id}/start` and `POST /{id}/stop`. Optimistic update of
`flags.is_active`. Subscription + webhook drawers: prefill reads `flags.is_active` (subscription
rename from old top-level `enabled`).

## Data layer
Schedule query/mutation atoms mirroring the subscription atoms: list, get, create, edit, delete,
start, stop. The deliveries view is reused — delivery rows now carry `schedule_id` as well as
`subscription_id` (filter/group accordingly).

## AC
- Create/edit a schedule from the UI; references sent as the full prefixed family; edit prefills correctly.
- Play/pause toggles `is_active` on all three entity types and reflects state after refetch.
- Schedules list renders cron + active state.
- `pnpm lint-fix` clean in `web/`; package unit tests for new atoms/components.

## Notes
- The Fern/generated API client may need regen once WP3/WP6 routes land — coordinate at stitch time.
- Don't invent reference-building; reuse `runnable/deploy.ts` (hard rule from prior work).

# Trigger "Latest" binding

Give triggers (schedules + subscriptions) a first-class **Latest** binding: run the
newest revision of a variant, resolved fresh at each fire. The backend already does this
for variant-only references; the frontend can neither express nor render it, and a
backend workaround (create-time pinning, commit `fe4a01f`) was added that this project
reverts.

## Read in this order

1. **[context.md](context.md)** — why, goals, non-goals, the design decisions (rail
   choice, reference shape, the marker question). Start here.
2. **[research.md](research.md)** — verified findings with `file:line` citations. Every
   claim in the plan traces back here. Re-verified 2026-07-07.
3. **[plan.md](plan.md)** — phases A–F with concrete per-file edits, sized for narrow
   subagents.
4. **[status.md](status.md)** — source of truth for state. **DESIGN DRAFT, awaiting
   Mahmoud's review on the draft PR.**

## One-paragraph summary

Three binding modes, one per policy: **Latest** (variant-only ref, follow head at fire),
**Pinned** (revision ref, frozen), **Deployed** (environment ref, follow deployment).
The wire already encodes the policy in the reference *shape* — the absence of a revision
ref **is** the follow-latest signal, and the dispatcher re-resolves from raw references on
every fire. So the backend work is a **revert** (undo the create-time pin) plus keeping
one good fix from the same lane (422 handlers on the subscription endpoints). The real
work is frontend: a third rail item, and **one shared prefix-symmetric classifier** for
every reference read — the drawers and settings list currently never read the
`workflow_*` family that agent-created triggers store, which is the gap the pin papered
over. Prefill recognizes the variant-only shape (any prefix) as Latest instead of
stuffing a variant id into a revision field, the picker shows its current value, and the
settings list labels Latest triggers by name + tag. Then fix the op-catalog descriptions
that post-revert would tell the model the opposite of what its own triggers do.

## Key touch points (all paths absolute from repo root)

- Backend un-pin: `api/oss/src/core/triggers/service.py` `_validate_references`
- Backend test reshape: `api/oss/tests/pytest/unit/triggers/test_triggers_reference_defaulting.py`
- FE control: `web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/shared/RunVersionField.tsx`
- FE drawers: `web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/TriggerScheduleDrawer.tsx`,
  `.../TriggerSubscriptionDrawer.tsx`
- FE settings list: `web/oss/src/components/pages/settings/Triggers/components/GatewaySchedulesSection.tsx`,
  `.../GatewaySubscriptionsSection.tsx`
- Wording: `sdks/python/agenta/sdk/agents/platform/op_catalog.py`,
  `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`

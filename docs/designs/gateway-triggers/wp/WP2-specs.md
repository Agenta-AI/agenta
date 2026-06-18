# WP2 — Resolver promotion (SDK + webhooks)

**Lane** WL2 (anchor WL1) · **Stream** WS2 (sdk+webhooks) · **Area** sdk + webhooks

Parent docs: [`../plan.md`](../plan.md) §4, [`../gap.md`](../gap.md) §2.5 (M1), [`../mapping.md`](../mapping.md) §5/§6.

## Goal

Promote the mapping resolver to the SDK under a neutral name so triggers and webhooks both
consume it without a cross-domain import. A complete, testable change on its own — its **live
consumer today is webhooks**, independent of triggers entirely.

## Closes (gap items)

M1.

## Scope

- Move `resolve_payload_fields` (`core/webhooks/delivery.py:95`) to
  `agenta.sdk.utils.resolvers`, renamed **`resolve_target_fields`** (next to the existing
  `resolve_json_selector` at `:114`).
- Update the webhooks call site to the new name/location.
- Pure move + rename — **no behavior change**. (It resolves a template into *a* target —
  whole body for webhooks, `data.inputs` for triggers — hence the neutral name.)

## Contracts this WP freezes (consumed by WS4 — freeze in WS-PRE)

```text
agenta.sdk.utils.resolvers.resolve_target_fields(template, context) -> dict
  # template: arbitrary JSON; leaves with $/ selectors resolved against context, else literal
  # context: { event, subscription, scope } (allowlisted slots)
  # null-on-miss, depth-capped (MAX_RESOLVE_DEPTH); default template "$" = whole context
```

## Functional deps

None in-feature. Root in the §1 DAG.

## Stubs needed

None.

## Decision to lock first

None hard. (Confirm the SDK module path `agenta.sdk.utils.resolvers` is where it lands.)

## Acceptance criteria

- Existing **webhook delivery tests pass unchanged** against the renamed/relocated resolver.
- `resolve_target_fields` importable from `agenta.sdk.utils.resolvers`; no triggers→webhooks
  import path introduced.

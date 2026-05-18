# Findings: Dynamic Access and Billing

Origin scan of branch `feat/add-access-controls-in-env-vars` (commits `c33134f45..da0548d5e`) against the `proposal.md` and `gap.md` in this folder. Code was read independently before reconciling against `tasks.md`. Findings from PR #4330 external review (Copilot) appended as FIND-014..019 — all closed. FIND-020 added from a local migration-tree audit and resolved on user direction by rebasing this branch's migration after the meters reshape. A second sync pass against PR #4330 added FIND-021 (Stripe meter mapping), FIND-022 (stale `Counter.EVENTS` / `Counter.TRACES` references in adjacent design folders), and FIND-023 (stale enum references in `test_access_controls.py`) — all closed in this same pass. A third sync pass picked up FIND-024 from a follow-up Copilot review comment (stale `scripts/` path in a validator error message); already resolved as a side-effect of the FIND-021 pricing rewrite. See [Closed Findings](#closed-findings) for current state.

## Sources

- `docs/designs/dynamic-access-and-billing/{research,gap,proposal,tasks}.md`
- `api/oss/src/utils/env.py`
- `api/ee/src/core/entitlements/{controls.py,types.py,service.py}`
- `api/ee/src/core/subscriptions/{settings.py,service.py,types.py}`
- `api/ee/src/apis/fastapi/billing/router.py`
- `api/ee/src/utils/{entitlements.py,permissions.py}`
- `api/ee/src/services/{converters.py,db_manager_ee.py,workspace_manager.py,throttling_service.py,admin_manager.py,db_manager_ee.py}`
- `api/ee/src/routers/workspace_router.py`
- `api/ee/src/models/{shared_models.py,db_models.py,api/workspace_models.py,api/api_models.py}`
- `api/ee/src/core/tracing/service.py`
- `api/ee/src/core/meters/service.py`
- `api/oss/src/core/{accounts,auth}/service.py`
- `api/oss/src/routers/workspace_router.py`
- `api/ee/databases/postgres/migrations/core/versions/{a9f3e8b7c5d1_clean_up_organizations.py,a1b2c3d4e5f7_unify_org_member_role_to_viewer.py,7990f1e12f47_create_free_plans.py}`
- `api/ee/tests/pytest/unit/{test_access_controls.py,test_controls_env_override.py,test_billing_settings.py,test_billing_router.py}`
- `web/oss/src/lib/{Types.ts,helpers/useEntitlements.ts}`, `web/ee/src/services/billing/types.d.ts`, `web/ee/src/components/SidebarBanners/state/atoms.ts`
- `docs/docs/self-host/{02-configuration.mdx,04-dynamic-access-controls.mdx,05-dynamic-billing-settings.mdx}`

## Summary

Initial scan surfaced 13 findings: one P0 (project-scope RBAC regression), four P1 (closed-enum holdouts and validation gaps), and the rest P2/P3 hygiene — all resolved on this branch. PR #4330 external review (Copilot) added six more (FIND-014..019), then a migration audit added FIND-020, then a second sync pass added FIND-021..023:

- **Closed (PR #4330 + migration audit):** FIND-014 (P2, design-doc retention defaults updated to match shipped code), FIND-015 (P3, override-vs-overlay terminology tightened in MDX), FIND-016 (P1, acceptance tests fixed by renaming `member`→`viewer`), FIND-017 (P2, `assert` replaced with explicit `if/raise EventException` in trial-checkout), FIND-018 (P3, `_normalize_pricing_entry` now rejects empty `{}` with a slug-pointing error; covered by new unit test), FIND-019 (P3, `existing_type=sa.String()` threaded through both `alter_column` calls in the member→viewer migration), FIND-020 (P0, EE `core` migration tree fork resolved by chaining `a1b2c3d4e5f7` after `9d3e8f0a1b2c`).
- **Closed (latest sync):** FIND-021 (P1, `STRIPE_METER_NAMES` mapping added in `entitlements/types.py`; `meters/service.py` looks up event name + price via the mapping with a skip-path log; `subscriptions/settings.py` switched to flat pricing shape with operator-owned `traces` / `users` slot names plus reserved `free` / `trial` markers; `migrate_stripe_pricing.py` rewritten as an annotation helper for `free` / `trial`), FIND-022 (P3, mechanical `Counter.EVENTS` → `Counter.EVENTS_INGESTED` and `Counter.TRACES` → `Counter.TRACES_INGESTED` rename across `data-retention/README.md`, `data-retention/data-retention-periods.initial.specs.md`, and `ee-self-hosting/research.md`), FIND-023 (P2, `test_access_controls.py` fixture and tests migrated to `Counter.TRACES_INGESTED` / `Period.MONTHLY` / `Retention.MONTHLY` / `Flag.ACCESS`; 61/61 pass), FIND-024 (P3, Copilot-flagged stale `scripts/migrate_stripe_pricing.py` path in a validator error message — already resolved as a side-effect of the FIND-021 pricing rewrite; verified `grep` returns no matches).

EE unit suite green after the changes: `test_access_controls.py` 61/61, `test_billing_settings.py` + `test_controls_env_override.py` 83/83.

## Rules

- Severity uses `P0`/`P1`/`P2`/`P3` (proposal-blockers, gap-from-proposal, real-but-bounded, hygiene).
- Confidence is `high` when code lines directly confirm the behavior, `medium` when a regression is implied by code paths I traced but did not run.
- Findings tagged `Category: Correctness` are functional regressions; `Consistency` are spec-vs-implementation drift; `Migration` are operational risks at upgrade time.

## Notes

- `controls.py` and `settings.py` parse env at import time. Changing `env.access_controls.*` / `env.billing.*` after import does not re-trigger validation. Tests work around this via subprocess.
- `WorkspaceRole(str, Enum)` enables `role == "owner"`-style comparisons everywhere; that is why `_project_is_owner` still works after the refactor.
- Per `CLAUDE.md`, all new env access must funnel through `oss.src.utils.env.env`; the implementation respects that.

## Open Findings

_None._

## Closed Findings

### FIND-021 — [CLOSED] No mapping between internal Counter/Gauge slugs and Stripe-side meter event names; `traces_ingested` won't route to a Stripe meter configured as `"traces"`

- ID: FIND-021
- Origin: sync
- Lens: validation
- Severity: P1
- Confidence: high
- Status: fixed
- Category: Migration
- Summary: The runtime sends `event_name = meter.key.value` to [`stripe.billing.MeterEvent.create`](../../../api/ee/src/core/meters/service.py) (line 250) — i.e. `"traces_ingested"`, the value of `Counter.TRACES_INGESTED`. But the Stripe meter on the dashboard was configured against the pre-rename slug `"traces"`, and the per-meter price IDs live on Stripe subscription items keyed by that same `"traces"` name. With the meters reshape that renamed the Counter from `TRACES` to `TRACES_INGESTED`, the runtime now emits a Stripe event with a name no Stripe-side meter recognizes — Stripe silently drops the event (or rejects with an "unknown meter" error in strict mode). Same class of bug for the corresponding price-id lookup in `stripe.meters`. The internal slug rename was a one-sided change that broke the external Stripe wiring.
- Evidence:
  - Runtime at [meters/service.py:250](../../../api/ee/src/core/meters/service.py#L250) — `event_name = meter.key.value` is the only source of the Stripe-side event name; no remap.
  - [meters/service.py:180-183](../../../api/ee/src/core/meters/service.py#L180-L183) — `get_stripe_meter_price(plan, meter.key.value)` uses the same `meter.key.value` to look up the price ID under `stripe.meters` in the env config; the env config was written by the operator against the Stripe-side meter names.
  - [subscriptions/settings.py:161-167](../../../api/ee/src/core/subscriptions/settings.py#L161-L167) — `_VALID_METER_KEYS` rejects any `stripe.meters` key that isn't in `{c.value for c in Counter} | {g.value for g in Gauge}`, so the operator can't simply use the Stripe-side `"traces"` name in `AGENTA_BILLING_PRICING` — the validator forces them to use `"traces_ingested"`. Both sides of the Stripe wiring are pinned to the internal slug.
  - Converter at [migrate_stripe_pricing.py:97-98](migrate_stripe_pricing.py#L97-L98) — emits `meters[meter_key]` using the *input slot-name* (`"traces"`), which fails the validator above for the same reason. (This is the surface Copilot's review comment landed on; the root cause is the missing mapping, not the converter alone.)
- Files:
  - [api/ee/src/core/meters/service.py](../../../api/ee/src/core/meters/service.py) (runtime — `event_name` source, `get_stripe_meter_price` call)
  - [api/ee/src/core/subscriptions/settings.py](../../../api/ee/src/core/subscriptions/settings.py) (validator + `get_stripe_meter_price` impl)
  - [api/ee/src/core/entitlements/types.py](../../../api/ee/src/core/entitlements/types.py) (Counter / Gauge enums)
  - [docs/designs/dynamic-access-and-billing/migrate_stripe_pricing.py](migrate_stripe_pricing.py) (converter)
- Cause: The meters reshape renamed internal Counter values (e.g. `traces` → `traces_ingested`), but the Stripe-side meter event names and operator-facing pricing-config keys remained at the original names. The two surfaces are not the same — the internal slug is a code identifier, the Stripe meter name is an external configuration the operator owns — but the current code treats them as identical by passing `meter.key.value` to Stripe and as the lookup key into `stripe.meters`.
- Explanation: Without a mapping, the meters reshape can never land without an externally-coordinated Stripe-dashboard rename for every deployment that previously had a `"traces"` meter configured. With a mapping, the internal slug stays canonical and the Stripe-side name stays stable; operators do not need to touch their Stripe configuration when Agenta renames internal Counter values, and existing pricing JSON continues to validate.
- Suggested Fix (user-suggested approach: add a mapping as a global var):
  - Define a single source of truth at module scope in [`entitlements/types.py`](../../../api/ee/src/core/entitlements/types.py) (alongside the Counter / Gauge enums) mapping each internal `Counter` / `Gauge` member to its Stripe-side meter event name:

    ```python
    # Internal Counter/Gauge slug → external Stripe meter event name.
    # The runtime uses this when emitting `stripe.billing.MeterEvent.create(event_name=...)`
    # and when looking up the price ID under `AGENTA_BILLING_PRICING.stripe.meters`.
    # The Stripe-side names are operator-owned (configured once on the Stripe
    # dashboard); changing an internal Counter value here does not require any
    # Stripe-dashboard change.
    STRIPE_METER_NAMES: dict[str, str] = {
        Counter.TRACES_INGESTED.value:  "traces",
        Gauge.USERS.value:              "users",
        # Add a row here when a new counter/gauge becomes Stripe-reportable
        # (i.e. when it enters `REPORTS`). Counter values not in REPORTS do
        # not appear here.
    }
    ```

  - Use the mapping in two places:
    1. [meters/service.py:250](../../../api/ee/src/core/meters/service.py#L250) — `event_name = STRIPE_METER_NAMES[meter.key.value]` (with a clear `KeyError` → `[report] Skipping ... no Stripe meter mapping` log line that falls through the existing skipped-meter path).
    2. [subscriptions/settings.py](../../../api/ee/src/core/subscriptions/settings.py) — change `_VALID_METER_KEYS` to use `set(STRIPE_METER_NAMES.values())` (the **Stripe-side** names) instead of `{c.value for c in Counter} | {g.value for g in Gauge}`. The operator's `AGENTA_BILLING_PRICING.stripe.meters.<slot>.price` is then keyed on Stripe-side names (matching what they configured on Stripe), and `get_stripe_meter_price(plan, meter.key.value)` does the lookup via `STRIPE_METER_NAMES[meter.key.value]`.
  - Update the converter at [migrate_stripe_pricing.py](migrate_stripe_pricing.py) to be a no-op transform on the meter slot-names — it reads `"traces"` and writes `"traces"`, no remap needed because the schema now agrees with the Stripe-side names. Tighten the script's docstring to reflect this.
  - Update the operator docs at [04-dynamic-access-controls.mdx](../../docs/self-host/04-dynamic-access-controls.mdx) and [05-dynamic-billing-settings.mdx](../../docs/self-host/05-dynamic-billing-settings.mdx) to document that the `stripe.meters` keys are the **Stripe-side meter event names**, not the internal Counter slugs, and that the set of valid keys is determined by the `STRIPE_METER_NAMES` table.
- Alternatives:
  - Rename the Stripe-side meters on every operator's Stripe dashboard to match the new internal slug (`"traces"` → `"traces_ingested"`). Rejected: operationally invasive, requires coordinated downtime per deployment, and any future internal rename would require the same dance again.
  - Make the mapping operator-configurable per plan via an extra `stripe.meters.<slot>.event_name` field. Could be added later as a layer on top of the global default if any deployment needs to override the canonical map; not required for the initial fix.
- Resolution: Applied the user-suggested mapping plus the broader pricing reshape that fell out of the conversation. `STRIPE_METER_NAMES: dict[str, str]` added at module scope in [`entitlements/types.py`](../../../api/ee/src/core/entitlements/types.py) keying internal Counter/Gauge values to Stripe-side meter event names (`Counter.TRACES_INGESTED.value` → `"traces"`, `Gauge.USERS.value` → `"users"`). Runtime in [`meters/service.py`](../../../api/ee/src/core/meters/service.py) uses `STRIPE_METER_NAMES.get(meter.key.value)` for both `event_name` and the price-id lookup, with a clear skip-path log if a meter is not Stripe-reportable. [`subscriptions/settings.py`](../../../api/ee/src/core/subscriptions/settings.py) was rewritten to a flat pricing shape mirroring the original `STRIPE_PRICING` (`{slug: {free?, trial?, <stripe_slot>: {price, quantity?}}}`); slot names are operator-owned and no longer validated against an internal enum, so `"traces"` and `"users"` flow end-to-end. The `AGENTA_BILLING_TRIAL_PLAN` / `AGENTA_BILLING_TRIAL_DAYS` env vars were collapsed into a per-entry `{trial: N}` marker in the pricing dict, and the corresponding fields were dropped from `BillingSettings` in [`api/oss/src/utils/env.py`](../../../api/oss/src/utils/env.py). [`migrate_stripe_pricing.py`](migrate_stripe_pricing.py) was rewritten as a small annotation helper (`annotate(pricing, free_slug, trial)`) that adds the `free` / `trial` markers without touching slot names. Operator-facing billing docs (`05-dynamic-billing-settings.mdx`) were deleted per user direction; access-control docs (`04-dynamic-access-controls.mdx`, `02-configuration.mdx`, both `env.ee.*.example` files) were stripped of all billing / Stripe references.
- Sources: User-direction ("the Stripe meters and prices are associated to 'traces' not 'traces_ingested'", "maybe add a mapping as a global var", "drop the docs about billing", "drop mentions to BILLING or STRIPE ENV VARS in mdx docs", "drop from .env.example files too"); PR #4330 Copilot review (comment id 3260473541, thread `PRRT_kwDOJbjazM6C5oCs`) flagged the converter-surface symptom of the same root cause.

### FIND-022 — [CLOSED] Stale `Counter.EVENTS.retention` / `Counter.TRACES.retention` references in data-retention design docs

- ID: FIND-022
- Origin: sync
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Consistency
- Summary: Three documents in `docs/designs/data-retention/` and `docs/design/ee-self-hosting/` still reference the pre-reshape enum members `Counter.EVENTS.retention` and `Counter.TRACES.retention`. The shipped enum uses the `_INGESTED` suffix (`Counter.EVENTS_INGESTED`, `Counter.TRACES_INGESTED`). Operators grepping for these symbols when reading retention design notes won't find them in the code.
- Evidence:
  - [docs/designs/data-retention/README.md:34, :36](../data-retention/README.md) — references `Counter.EVENTS.retention` and `Counter.TRACES.retention`.
  - [docs/designs/data-retention/data-retention-periods.initial.specs.md](../data-retention/data-retention-periods.initial.specs.md) — same legacy names per Copilot's note.
  - [docs/design/ee-self-hosting/research.md:531](../../design/ee-self-hosting/research.md#L531) — `Counter.TRACES.retention` and `Counter.EVENTS.retention` in the new "Span and event retention" section.
- Files:
  - [docs/designs/data-retention/README.md](../data-retention/README.md)
  - [docs/designs/data-retention/data-retention-periods.initial.specs.md](../data-retention/data-retention-periods.initial.specs.md)
  - [docs/design/ee-self-hosting/research.md](../../design/ee-self-hosting/research.md)
- Cause: Doc-vs-code drift after the meters reshape renamed `Counter.TRACES` → `Counter.TRACES_INGESTED` and added `Counter.EVENTS_INGESTED`. The retention design docs were written against the pre-reshape names and not updated.
- Explanation: Same class as FIND-014 — the dynamic-access-and-billing design folder was already brought in sync; this finding extends the cleanup to the adjacent `data-retention` and `ee-self-hosting` design folders. Each file gets a mechanical `Counter.EVENTS` → `Counter.EVENTS_INGESTED` and `Counter.TRACES` → `Counter.TRACES_INGESTED` rename, plus a sanity check that no other stale enum references remain.
- Suggested Fix:
  - Sed-style rename across the three files: `Counter.EVENTS` → `Counter.EVENTS_INGESTED`, `Counter.TRACES` → `Counter.TRACES_INGESTED` (carefully — only when the context is enum member access, not when the string slug `events` / `traces` is being discussed as a config value).
  - Grep `docs/` for any remaining `Counter\.\(EVENTS\|TRACES\|EVALUATIONS\|CREDITS\)\b` references that aren't `_INGESTED` / `_RUN` / `_CONSUMED` / `_RETRIEVED` and address them too.
- Resolution: Applied the mechanical rename across the three files: `docs/designs/data-retention/README.md` lines 27 and 34 (`Counter.TRACES.retention` → `Counter.TRACES_INGESTED.retention`, `Counter.EVENTS.retention` → `Counter.EVENTS_INGESTED.retention`); `docs/designs/data-retention/data-retention-periods.initial.specs.md` line 72 (`Counter.TRACES` → `Counter.TRACES_INGESTED`); `docs/design/ee-self-hosting/research.md` lines 528, 531, and the entitlement-endpoint table at lines 604–611 (trace + event retention enum names updated). Grep for `Counter\.(EVENTS|TRACES|EVALUATIONS|CREDITS)\b` outside of `_INGESTED` / `_RUN` / `_CONSUMED` / `_RETRIEVED` forms returns clean.
- Sources: PR #4330 Copilot review (comment ids 3260473592 + 3260473627, threads `PRRT_kwDOJbjazM6C5oDW` + `PRRT_kwDOJbjazM6C5oDv`).

### FIND-023 — [CLOSED] `test_access_controls.py` uses pre-reshape `Counter.TRACES` / `monthly=True` / `Flag.HOOKS`

- ID: FIND-023
- Origin: sync (incidental — surfaced while running broader test suite to validate FIND-021 fix)
- Lens: validation
- Severity: P2
- Confidence: high
- Status: fixed
- Category: Testing
- Summary: [api/ee/tests/pytest/unit/test_access_controls.py](../../../api/ee/tests/pytest/unit/test_access_controls.py) still constructs `Counter.TRACES`, `Quota(monthly=True, ...)`, and `Flag.HOOKS` at lines 124, 319, 321, 347, 396, 401. None of these enum members / fields exist on the post-reshape branch — `Counter` has `TRACES_INGESTED` (no `TRACES`), `Quota` has `period: Optional[Period]` (no `monthly` field; rejected by `extra="forbid"`), and `Flag` has only `RBAC`/`ACCESS`/`DOMAINS`/`SSO` (no `HOOKS`). 8 tests fail to load. These were missed during FIND-014 (design-doc rename), FIND-015 (MDX rename), and the `Quota.extra="forbid"` hardening — the tests are independent of those fix sites but consume the same renamed surfaces.
- Evidence:
  - `python -m pytest ee/tests/pytest/unit/test_access_controls.py` produces 8 failures, all `extra_forbidden` or `AttributeError`-style errors against the stale references.
  - Specific lines: 124 (`"counters": {"traces": {... "monthly": True}}`), 319 (`Flag.HOOKS`), 321 (`Counter.TRACES: Quota(... monthly=True ...)`), 347 (`plans[...][Counter.TRACES]`), 396 + 401 (`Flag.HOOKS`).
- Files:
  - [api/ee/tests/pytest/unit/test_access_controls.py](../../../api/ee/tests/pytest/unit/test_access_controls.py)
- Cause: When `Counter.TRACES` was renamed to `Counter.TRACES_INGESTED` and `Quota.monthly` replaced with `Quota.period`, the production code + design docs + MDX docs were updated, but this test file (which exercises `_PlanOverride` parsing + the overlay merge against env-payload JSON) was not. The `Flag.HOOKS` removal was missed in the same pass.
- Explanation: The failures are tightly scoped to one test file; nothing in production references these stale members. Same class of doc-vs-code drift as FIND-022 but on the test side. Mechanical fix: rename `Counter.TRACES` → `Counter.TRACES_INGESTED`, replace `monthly=True` with `period=Period.MONTHLY` (and import `Period`), replace `Flag.HOOKS` with a still-existing flag (`Flag.RBAC` or remove the test case if its semantic was specifically the dropped flag).
- Suggested Fix:
  - Rename the four stale enum references and migrate the `Quota` constructor calls / JSON payloads:

    ```python
    # Before
    "counters": {"traces": {"limit": 100, "monthly": True}}
    Counter.TRACES: Quota(free=5000, monthly=True, retention=44640)
    Tracker.FLAGS: {Flag.HOOKS: False}

    # After
    "counters": {"traces_ingested": {"limit": 100, "period": "monthly"}}
    Counter.TRACES_INGESTED: Quota(free=5000, period=Period.MONTHLY, retention=Retention.MONTHLY)
    Tracker.FLAGS: {Flag.RBAC: False}  # or drop the test if HOOKS-specific
    ```

  - Import `Period` and `Retention` from `ee.src.core.entitlements.types` if not already.
  - Re-run `python -m pytest ee/tests/pytest/unit/test_access_controls.py` to confirm 64/64 pass.
- Resolution: Added `Period` and `Retention` to the `# noqa: E402` import block at line 277. Reworked the `_base_plan()` fixture at lines 318–337 to use `Flag.ACCESS` (not `Flag.HOOKS`), `Counter.TRACES_INGESTED` (not `Counter.TRACES`), and `Quota(free=5000, period=Period.MONTHLY, retention=Retention.MONTHLY)` (not `monthly=True, retention=44640`). Updated `test_quota_field_merge_preserves_other_fields` at lines 339–352 (overlay payload key `"traces"` → `"traces_ingested"`, lookup `Counter.TRACES` → `Counter.TRACES_INGESTED`, assertion `traces.monthly is True` → `traces.period == Period.MONTHLY`, `traces.retention == 525600` → `traces.retention == Retention.YEARLY`). Updated `test_overlay_targeting_unknown_plan_fails` and `test_flag_patch_only_overwrites_named_keys` to use `Flag.ACCESS` (the only non-RBAC flag still in the enum). Two upstream cleanups in this same file at lines 105–117 (`test_description_propagated`) and 120–130 (`test_counters_and_gauges_validated`) had already been applied in the prior pass. `python -m pytest ee/tests/pytest/unit/test_access_controls.py` → 61/61 pass (test count dropped from 64 to 61 after the parser API tightening; broader suite `test_billing_settings.py` + `test_controls_env_override.py` → 83/83). `ruff check` clean.
- Sources: Local test-suite run during FIND-021 verification.

### FIND-024 — [CLOSED] `_normalize_pricing_entry` error message pointed at non-existent `scripts/migrate_stripe_pricing.py`

- ID: FIND-024
- Origin: sync
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Consistency
- Summary: Copilot review (PR #4330, comment id `3260614199`, review id `4312094586`, targeting [`api/ee/src/core/subscriptions/settings.py:130`](../../../api/ee/src/core/subscriptions/settings.py#L130) at the time of the review) flagged that an error message in `_normalize_pricing_entry` directed operators to `scripts/migrate_stripe_pricing.py` for legacy-to-new pricing conversion, while the converter actually ships at `docs/designs/dynamic-access-and-billing/migrate_stripe_pricing.py`. Operators hitting the validation error on the legacy shape would look in a `scripts/` directory that doesn't exist.
- Evidence:
  - Copilot comment body (`gh api repos/Agenta-AI/agenta/pulls/comments/3260614199`): "Operators hitting this validation error during the legacy-to-new-pricing migration will look in a `scripts/` directory that doesn't exist. Update the path in the error message to match the script's actual location."
  - Post-FIND-021 rewrite of [`subscriptions/settings.py`](../../../api/ee/src/core/subscriptions/settings.py) no longer contains any reference to `scripts/migrate_stripe_pricing.py` — `grep -rn "scripts/migrate_stripe_pricing" .` returns no matches.
- Files:
  - [api/ee/src/core/subscriptions/settings.py](../../../api/ee/src/core/subscriptions/settings.py)
- Cause: Pre-FIND-021 versions of `_normalize_pricing_entry` carried a legacy-shape detection branch with an error message that referenced the wrong path. The branch was rewritten end-to-end as part of the FIND-021 pricing reshape (flat shape with operator-owned slot names, reserved `free` / `trial` markers, no internal-enum validation of slot names), so the legacy-detection branch and its stale error message no longer exist.
- Explanation: The defect was real at review time; it is no longer present because the FIND-021 rewrite removed the surrounding code. Resolving as a side-effect of FIND-021 (not a no-op — the same operator-facing failure mode is just unreachable now). No follow-up needed in code.
- Suggested Fix: None — already resolved by the FIND-021 rewrite. If a future change re-introduces a legacy-detection branch, the error message must point at `docs/designs/dynamic-access-and-billing/migrate_stripe_pricing.py` (or wherever the converter then lives).
- Resolution: Verified via `grep -rn "scripts/migrate_stripe_pricing" .` returning no matches across the repo. The pricing validator now operates on the flat shape and never emits a legacy-conversion hint; the helper at `docs/designs/dynamic-access-and-billing/migrate_stripe_pricing.py` is documented in `summary.md` and `findings.md` as the annotation tool for `free` / `trial` markers.
- Sources: PR #4330 Copilot review (comment id `3260614199`, review id `4312094586`).

### FIND-001 — [CLOSED] WorkspaceMember response model still uses closed `WorkspaceRole` enum

- ID: FIND-001
- Origin: scan
- Lens: verification
- Severity: P1
- Confidence: high
- Status: fixed
- Category: Consistency
- Summary: `WorkspacePermission.role_name: WorkspaceRole` and `InviteRequest.roles: List[WorkspaceRole]` (renamed from `OrganizationMembersResponse.roles` — the actual field) blocked serialization of env-defined role slugs.
- Resolution: Switched `WorkspacePermission.role_name` to `str` in both [api/ee/src/models/api/workspace_models.py](api/ee/src/models/api/workspace_models.py) and [api/ee/src/core/workspaces/types.py](api/ee/src/core/workspaces/types.py); switched `InviteRequest.roles` to `List[str]` in [api/ee/src/models/api/api_models.py](api/ee/src/models/api/api_models.py). Validation against the effective scope catalog now happens at the API boundary (see FIND-003 for the assignment validation).
- Sources: proposal.md "Refactor Imports".

### FIND-002 — [CLOSED] Project-scope defaults drop workspace-role permissions (RBAC regression)

- ID: FIND-002
- Origin: scan
- Lens: verification
- Severity: P0
- Confidence: high
- Status: fixed
- Category: Correctness
- Summary: `_default_roles()["project"]` returned minima-only (`owner`/`viewer`), but `project_members.role` is populated with workspace-role slugs (`admin`/`developer`/`editor`/`annotator`) by every project-membership writer. `_project_has_permission` resolved `get_role_permissions("project", "admin")` → `[]`, stripping non-owner project members of every permission.
- Resolution: Extended the project-scope code defaults to mirror the workspace-scope default extras ([api/ee/src/core/entitlements/controls.py:215-243](api/ee/src/core/entitlements/controls.py#L215-L243)). Tests updated: [test_access_controls.py:53-66](api/ee/tests/pytest/unit/test_access_controls.py#L53-L66) now asserts project-scope mirrors the full `WorkspaceRole` set; the env-override path replaces the default extras when the project scope is explicitly overridden.
- Sources: gap.md "Workspace roles are also too static"; proposal.md "Refactor Imports".

### FIND-003 — [CLOSED] `workspace_router.update_user_roles` still validated against `WorkspaceRole.is_valid_role`

- ID: FIND-003
- Origin: scan
- Lens: verification
- Severity: P1
- Confidence: high
- Status: fixed
- Category: Consistency
- Summary: Even after env-defined roles were returned by `GET /workspace/roles/`, the assignment path rejected anything not in the closed `WorkspaceRole` enum.
- Resolution: Replaced the enum check with `get_role("workspace", payload.role)` in [api/ee/src/routers/workspace_router.py:91-96](api/ee/src/routers/workspace_router.py#L91-L96). Removed the unused `WorkspaceRole` import from that module and from [api/ee/src/models/api/workspace_models.py](api/ee/src/models/api/workspace_models.py).
- Sources: tasks.md "Update `WorkspaceRole` runtime usage".

### FIND-004 — [CLOSED] `db_manager_ee.get_all_workspace_roles()` still returned `list(WorkspaceRole)`

- ID: FIND-004
- Origin: scan
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed
- Category: Consistency
- Summary: The DB-manager and workspace-manager wrappers were unchanged after the refactor; any direct caller (admin tooling, integration tests) still saw the closed enum.
- Resolution: Both [db_manager_ee.get_all_workspace_roles](api/ee/src/services/db_manager_ee.py) and [workspace_manager.get_all_workspace_roles](api/ee/src/services/workspace_manager.py) now return `get_roles("workspace")` directly. The local import of `controls.get_roles` inside `db_manager_ee` avoids any potential import cycle.
- Sources: tasks.md "Update role discovery APIs to return `get_roles()`".

### FIND-005 — [CLOSED] `get_free_plan()` fallback ignored effective plan set

- ID: FIND-005
- Origin: scan
- Lens: verification
- Severity: P1
- Confidence: high
- Status: fixed
- Category: Soundness
- Summary: When operators set a custom `AGENTA_ACCESS_PLANS` without `cloud_v0_hobby`, the unguarded literal fallback in `get_free_plan()` would write a non-existent plan during cancel/downgrade.
- Resolution: `_build_settings()` now raises at startup when (a) no pricing entry is marked `"free": true` AND (b) `cloud_v0_hobby` is not in the effective plan set ([api/ee/src/core/subscriptions/settings.py](api/ee/src/core/subscriptions/settings.py)). Loud failure beats silent corruption.
- Sources: proposal.md "Acceptable fallback behavior".

### FIND-006 — [CLOSED] `get_default_plan()` did not validate against the effective plan set

- ID: FIND-006
- Origin: scan
- Lens: verification
- Severity: P1
- Confidence: high
- Status: fixed
- Category: Soundness
- Summary: `subscriptions.types.get_default_plan()` returned `env.agenta.default_plan` raw if set, skipping the proposal-mandated membership check.
- Resolution: Validation is performed once at startup inside `_build_settings()` ([api/ee/src/core/subscriptions/settings.py](api/ee/src/core/subscriptions/settings.py)) — a non-matching `AGENTA_DEFAULT_PLAN` now fails the API boot with a clear error. Keeps `get_default_plan()` itself dependency-free.
- Sources: proposal.md "Organization Onboarding".

### FIND-007 — [CLOSED] Admin `start_plan` accepted arbitrary plan strings

- ID: FIND-007
- Origin: scan
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed
- Category: Soundness
- Summary: The admin account-create flow no longer cast the plan through the `Plan` enum, so unknown slugs reached `start_plan` unchecked.
- Resolution: Added a `plan not in _ee_get_plans()` guard in [api/oss/src/core/accounts/service.py](api/oss/src/core/accounts/service.py) that raises `AdminValidationError` before `start_plan`. Validation lives at the admin boundary; `start_plan` still trusts validated input from internal callers.
- Sources: proposal.md "Subscription plan values read from DB or Stripe metadata must exist in the effective plan set".

### FIND-008 — [CLOSED] `AGENTA_BILLING_PRICING.stripe.meters` keys were not validated against `Counter`/`Gauge`

- ID: FIND-008
- Origin: scan
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed
- Category: Validation
- Summary: Typos in meter keys silently disabled Stripe reporting via `get_stripe_meter_price()`.
- Resolution: Added `_VALID_METER_KEYS` (`Counter` ∪ `Gauge`) and reject unknown keys with the allowed list in the error message ([api/ee/src/core/subscriptions/settings.py](api/ee/src/core/subscriptions/settings.py)).
- Sources: research.md "Validation Needs".

### FIND-009 — [CLOSED] `AGENTA_BILLING_CATALOG` entries passed through with no schema validation

- ID: FIND-009
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Consistency
- Summary: The parser only checked `isinstance(entry, dict)`; docs advertised required fields (`title`, `description`, `type`, `features`) that weren't enforced.
- Resolution: Added a Pydantic `_CatalogEntry` model with `extra="allow"` so operators can still extend the payload, but `title`/`description`/`type`/`features` are now required and `type` must be `"standard"` or `"custom"`. Tests in [test_billing_settings.py](api/ee/tests/pytest/unit/test_billing_settings.py) and [test_controls_env_override.py](api/ee/tests/pytest/unit/test_controls_env_override.py) updated to use the full schema.
- Sources: docs/docs/self-host/05-dynamic-billing-settings.mdx.

### FIND-010 — [CLOSED] Default plan literal `cloud_v0_hobby` referenced in multiple migrations

- ID: FIND-010
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Migration
- Summary: Migrations seed `subscriptions.plan = 'cloud_v0_hobby'`; on an upgrade with a custom plan map that omits it, runtime would fail every entitlement check for those orgs.
- Resolution: Comments in both migrations ([a9f3e8b7c5d1_clean_up_organizations.py](api/ee/databases/postgres/migrations/core/versions/a9f3e8b7c5d1_clean_up_organizations.py), [7990f1e12f47_create_free_plans.py](api/ee/databases/postgres/migrations/core/versions/7990f1e12f47_create_free_plans.py)) call out the operator constraint, and the FIND-005 guard in `_build_settings()` now refuses to start the API if the constraint is violated — so the failure surface moves from "silently broken org subscriptions" to "loud startup error".
- Sources: gap.md "Multi-process consistency".

### FIND-011 — [CLOSED] `_PlanOverride` rejected plans with only a `description`

- ID: FIND-011
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Consistency
- Summary: research.md described description-only plans as valid; the parser rejected them.
- Resolution: Dropped the `"must define at least one of..."` guard from `_parse_plans_override` ([api/ee/src/core/entitlements/controls.py](api/ee/src/core/entitlements/controls.py)) — display-only plans now resolve with an empty entitlement map. `fetch_usage` distinguishes "unknown plan" (None → 404) from "plan exists but enforces nothing" (`{}` → empty usage) ([api/ee/src/apis/fastapi/billing/router.py](api/ee/src/apis/fastapi/billing/router.py)). Tests in [test_access_controls.py](api/ee/tests/pytest/unit/test_access_controls.py) and [test_controls_env_override.py](api/ee/tests/pytest/unit/test_controls_env_override.py) updated.
- Sources: research.md "Recommended Override Shape".

### FIND-012 — [CLOSED] Workspace-scope `viewer` minima silently overrides any env override

- ID: FIND-012
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: wontfix
- Category: Consistency
- Summary: The minima `viewer` permission set is fixed at code-default and cannot be redefined from env.
- Resolution: Behavior is intentional and matches the documented contract ([docs/docs/self-host/04-dynamic-access-controls.mdx:168-180](docs/docs/self-host/04-dynamic-access-controls.mdx#L168-L180)). Tests assert this lock-in. Closing as wontfix — no operator demand for viewer-permission overrides yet; reopen if that changes.
- Sources: docs/docs/self-host/04-dynamic-access-controls.mdx "Platform minima".

### FIND-013 — [CLOSED] Throttling middleware no-opped on unknown plan

- ID: FIND-013
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Soundness
- Summary: Misconfigured / orphaned subscriptions used to bypass throttling entirely with only a warning log.
- Resolution: `throttling_middleware` now falls back to the free-plan throttle bucket when the org's plan is unknown or carries no throttles ([api/ee/src/services/throttling_service.py](api/ee/src/services/throttling_service.py)). If the free plan also has no throttles defined (e.g. unusual self-host config), the request still goes through — but at least the safe-default path is exercised first, and the log entry now identifies the fallback explicitly.
- Sources: research.md "Failure Behavior".

### FIND-016 — [CLOSED] `OrganizationRole` `"member"` → `"viewer"` rename breaks acceptance tests

- ID: FIND-016
- Origin: PR #4330 review (Copilot, comment id 3242587323)
- Lens: external review
- Severity: P1
- Confidence: high
- Status: fixed
- Category: Correctness
- Summary: [api/ee/src/services/admin_manager.py:92](../../../api/ee/src/services/admin_manager.py#L92) renames the `OrganizationRole` literal from `"member"` to `"viewer"`. This is a breaking API change for `POST /admin/simple/accounts/organizations/memberships/`. Three acceptance tests still posted `"role": "member"` and would fail Pydantic validation: [test_memberships.py:52](../../../api/ee/tests/pytest/acceptance/accounts/test_memberships.py#L52), [test_transfer_ownership.py:65](../../../api/ee/tests/pytest/acceptance/accounts/test_transfer_ownership.py#L65), [test_transfer_ownership.py:118](../../../api/ee/tests/pytest/acceptance/accounts/test_transfer_ownership.py#L118).
- Resolution: All three call sites updated to use `"viewer"` — matching the new canonical slug. The API is internal-only (no external consumers post `"member"`) and the admin endpoint is the single boundary, so a deprecation alias was not necessary. Wider grep confirmed no other `role: "member"` references in source (the remaining occurrences in [a1b2c3d4e5f7_unify_org_member_role_to_viewer.py](../../../api/ee/databases/postgres/migrations/core/versions/a1b2c3d4e5f7_unify_org_member_role_to_viewer.py) and [a9f3e8b7c5d1_clean_up_organizations.py](../../../api/ee/databases/postgres/migrations/core/versions/a9f3e8b7c5d1_clean_up_organizations.py) are the historical migration that performed the unification and must stay).
- Sources: PR #4330 Copilot review, [admin_manager.py:92](../../../api/ee/src/services/admin_manager.py#L92).

### FIND-014 — [CLOSED] `Counter.EVENTS_INGESTED` retention default mismatch between design docs and code

- ID: FIND-014
- Origin: PR #4330 review (Copilot, comment id 3242370086)
- Lens: external review
- Severity: P2
- Confidence: high
- Status: fixed (docs)
- Category: Consistency
- Summary: Three design docs ([research.md:290-292](research.md#L290), [gap.md:72-73](gap.md#L72), [proposal.md:323-326](proposal.md#L323)) and the [tasks.md:135](tasks.md#L135) checklist stated the default for `Counter.EVENTS_INGESTED.retention` was `null` / "no retention" / "events kept forever unless operators opt in". The as-shipped [DEFAULT_ENTITLEMENTS](../../../api/ee/src/core/entitlements/types.py) declares `Counter.EVENTS_INGESTED: Quota(period=Period.MONTHLY, retention=Retention.MONTHLY|QUARTERLY|YEARLY)` on Hobby/Pro/Business and `retention=None` only on Agenta/Self-hosted. Operator copy-pasting from the design docs would have configured the wrong behavior.
- Resolution: **Code is canonical** — the retention values (MONTHLY/QUARTERLY/YEARLY on the three cloud plans, None on Agenta and Self-hosted) are correct per `events_ingested` aligning with `traces_ingested` retention on each plan; only the design folder was stale. [research.md](research.md), [gap.md](gap.md), [proposal.md](proposal.md), and [tasks.md](tasks.md) updated to match the shipped enum (`Counter.EVENTS_INGESTED`), the new `Quota` shape (`period: Period.MONTHLY` replaces `monthly: True`), and the per-plan retention values. The MDX docs at [docs/docs/self-host/04-dynamic-access-controls.mdx](../../docs/self-host/04-dynamic-access-controls.mdx) already reflect the shipped code, so no MDX change was needed for this finding.
- Sources: PR #4330 Copilot review, [api/ee/src/core/entitlements/types.py](../../../api/ee/src/core/entitlements/types.py).

### FIND-015 — [CLOSED] Docs must make the override-vs-overlay semantic split explicit

- ID: FIND-015
- Origin: PR #4330 review (Copilot, comment id 3242370144)
- Lens: external review
- Severity: P3
- Confidence: high
- Status: fixed (docs)
- Category: Consistency
- Summary: Copilot framed this as a behavior bug, but the behavior is by design: `AGENTA_ACCESS_ROLES` and `AGENTA_ACCESS_PLANS` are **overrides** — replacing the role catalog / plan map for the named scope or plan — and `AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY` / `AGENTA_ACCESS_ROLES_OVERLAY` are the **overlays** that field-merge into a base. Verified by [test_override_only_specified_scope_keeps_other_defaults](../../../api/ee/tests/pytest/unit/test_access_controls.py). The MDX docs leaked some ambiguity: the `AGENTA_ACCESS_ROLES` description said env "may add" roles, which can read as merge semantics, but the override actually replaces. An operator who reached for `AGENTA_ACCESS_ROLES` to add a single role would replace the project-scope default extras (admin/developer/editor/annotator) and strip every existing project member of their permissions.
- Resolution: [04-dynamic-access-controls.mdx](../../docs/self-host/04-dynamic-access-controls.mdx) was rewritten to call out the split explicitly: (a) a `:::warning Override semantics: replace, not merge` callout at the top of the `AGENTA_ACCESS_ROLES` examples spelling out the FIND-002-redux footgun and redirecting "add one role" cases to the overlay; (b) two side-by-side H4 examples under that warning — "Override the full project-scope catalog (destructive — restate everything)" vs "Add a single role on top of the defaults (use the overlay)" — so operators see both paths concretely; (c) `:::note Scope of effect` callouts on both `_ROLES_OVERLAY` (plan-independent) and `_DEFAULT_PLAN_OVERLAY` (plan-targeted) sections, contrasting their scope. The override-vs-overlay terminology is now consistent throughout the page.
- Sources: PR #4330 Copilot review, [test_access_controls.py](../../../api/ee/tests/pytest/unit/test_access_controls.py), [controls.py](../../../api/ee/src/core/entitlements/controls.py).

### FIND-020 — [CLOSED] EE `core` migration tree forks at `e6f7a8b9c0d1`: two heads block `alembic upgrade head`

- ID: FIND-020
- Origin: sync
- Lens: verification
- Severity: P0
- Confidence: high
- Status: fixed
- Category: Migration
- Summary: After merging `feat/clean-up-meters` into this branch, the EE `core` Alembic tree had two heads — `9d3e8f0a1b2c_reshape_meters_table.py` (meters reshape) and `a1b2c3d4e5f7_unify_org_member_role_to_viewer.py` (this PR's org-role unification) — both declaring `down_revision = "e6f7a8b9c0d1"`. `alembic upgrade head` would fail with `Multiple head revisions are present`.
- Evidence (pre-fix): `find_head.py core` output `Heads: ['9d3e8f0a1b2c', 'a1b2c3d4e5f7']` with a forking branch at the `e6f7a8b9c0d1` node. EE `tracing`, OSS `core`, and OSS `tracing` were single-head and unaffected.
- Files:
  - [api/ee/databases/postgres/migrations/core/versions/a1b2c3d4e5f7_unify_org_member_role_to_viewer.py](../../../api/ee/databases/postgres/migrations/core/versions/a1b2c3d4e5f7_unify_org_member_role_to_viewer.py)
  - [api/ee/databases/postgres/migrations/core/versions/9d3e8f0a1b2c_reshape_meters_table.py](../../../api/ee/databases/postgres/migrations/core/versions/9d3e8f0a1b2c_reshape_meters_table.py)
- Cause: Two feature branches (`feat/clean-up-meters` and `feat/add-access-controls-in-env-vars`) each added a revision parented at the same release tip; the merge brought both files in without linearizing.
- Resolution: Per user direction ("this branch's migration(s) go after the extend-meter's migration(s)"), edited `a1b2c3d4e5f7.down_revision` from `"e6f7a8b9c0d1"` to `"9d3e8f0a1b2c"` so the org-role unification chains after the meters reshape. The org-role migration body operates on `organization_members.role` and is independent of the meters schema, so the rebase is safe. Verified by re-running `python find_head.py core` from `api/ee/databases/postgres/migrations/` — output is now `Heads: ['a1b2c3d4e5f7']` with a single linear chain.
- Sources: `find_head.py core` before/after output, [a1b2c3d4e5f7_unify_org_member_role_to_viewer.py:25-29](../../../api/ee/databases/postgres/migrations/core/versions/a1b2c3d4e5f7_unify_org_member_role_to_viewer.py#L25-L29).

### FIND-017 — [CLOSED] `assert` guard in trial-checkout path stripped under `-O` / `PYTHONOPTIMIZE`

- ID: FIND-017
- Origin: sync
- Lens: validation
- Severity: P2
- Confidence: high
- Status: fixed
- Category: Soundness
- Summary: A runtime correctness guard inside the trial-checkout path used `assert`. Python's `-O` / `PYTHONOPTIMIZE` strips asserts, so in an optimized deployment a mis-configured trial state could silently flow through with `None` values into `trial_period_days=None` and the Stripe metadata, instead of failing loudly.
- Evidence (pre-fix): [api/ee/src/core/subscriptions/service.py:95-98](../../../api/ee/src/core/subscriptions/service.py#L95-L98) used `assert trial_days is not None and trial_plan is not None` for type narrowing.
- Files:
  - [api/ee/src/core/subscriptions/service.py](../../../api/ee/src/core/subscriptions/service.py)
- Cause: Type-narrowing convenience: `get_trial_days()` and `get_trial_plan()` return `Optional[int]` / `Optional[str]`; the `assert` let the rest of the body treat them as non-None without explicit handling.
- Resolution: Replaced the `assert` with an explicit guard that raises `EventException` — the same domain exception already used at lines 87 and 90 of the same function. The guard now survives `python -O` / `PYTHONOPTIMIZE` and surfaces a clear domain-level error at the boundary instead of an opaque downstream Stripe failure. Comment annotated to document the rationale.

  ```python
  trial_days = get_trial_days()
  trial_plan = get_trial_plan()
  if trial_days is None or trial_plan is None:
      raise EventException(
          "Reverse trial invoked without configured trial state "
          "(trial_days and trial_plan must both be set)."
      )
  ```

- Sources: PR #4330 Copilot review (comment id 3260011657, thread `PRRT_kwDOJbjazM6C4VLH`); [subscriptions/service.py:95-105](../../../api/ee/src/core/subscriptions/service.py#L95-L105).

### FIND-018 — [CLOSED] `_normalize_pricing_entry` accepted empty `{}` per plan slug, silently 400s at checkout

- ID: FIND-018
- Origin: sync
- Lens: validation
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Validation
- Summary: An empty `{}` pricing entry for any plan slug passed startup validation, occupied a slot in `_PRICING`, contributed nothing to free-plan derivation, and silently made `get_stripe_line_items(slug)` return `[]`. The failure surface was a late-stage `400 "not available for purchase"` at checkout instead of a clear startup error.
- Evidence (pre-fix): [api/ee/src/core/subscriptions/settings.py:122-179](../../../api/ee/src/core/subscriptions/settings.py#L122-L179) only restricted top-level keys to `{"free", "stripe"}` via the unknown-keys check; neither key was required.
- Files:
  - [api/ee/src/core/subscriptions/settings.py](../../../api/ee/src/core/subscriptions/settings.py)
  - [api/ee/tests/pytest/unit/test_billing_settings.py](../../../api/ee/tests/pytest/unit/test_billing_settings.py)
- Cause: The two top-level keys were treated as individually optional; there was no joint constraint requiring at least one.
- Resolution: Added a guard at the end of `_normalize_pricing_entry` that raises a slug-pointing `ValueError` if `normalized` ends up empty. Operator typos and partial copy-pastes now fail fast at startup with the offending slug named in the message.

  ```python
  if not normalized:
      raise ValueError(
          f"AGENTA_BILLING_PRICING['{slug}'] must declare at least one of "
          "'free' or 'stripe'."
      )
  ```

  Added [test_billing_settings.py::TestNormalizePricingEntry::test_empty_pricing_entry_rejected](../../../api/ee/tests/pytest/unit/test_billing_settings.py) to lock in the behavior. Full `test_billing_settings.py` suite green (33/33).
- Sources: PR #4330 Copilot review (comment id 3260011743, thread `PRRT_kwDOJbjazM6C4VMT`); [subscriptions/settings.py:174-190](../../../api/ee/src/core/subscriptions/settings.py#L174-L190).

### FIND-019 — [CLOSED] Alembic `alter_column(..., existing_type=None)` in member→viewer migration

- ID: FIND-019
- Origin: sync
- Lens: verification
- Severity: P3
- Confidence: medium
- Status: fixed
- Category: Migration
- Summary: `op.alter_column(..., existing_type=None)` was passed in both `upgrade()` and `downgrade()` of the member→viewer migration. For a server-default-only change on PostgreSQL this rendered as `ALTER COLUMN ... SET DEFAULT ...` and worked today, but relied on dialect-specific leniency and would have misrepresented the column to alembic's renderer if the underlying type were ever altered upstream.
- Files:
  - [api/ee/databases/postgres/migrations/core/versions/a1b2c3d4e5f7_unify_org_member_role_to_viewer.py](../../../api/ee/databases/postgres/migrations/core/versions/a1b2c3d4e5f7_unify_org_member_role_to_viewer.py)
- Cause: Server-default-only change; the author didn't thread the column type through to `alter_column`.
- Resolution: Imported `sqlalchemy as sa` and changed `existing_type=None` to `existing_type=sa.String()` on both `alter_column` calls. No behavior change on PostgreSQL today; survives a future dialect addition or column-type change upstream without misrepresenting the column. Ruff clean after the change.
- Sources: PR #4330 Copilot review (comment id 3260011798, thread `PRRT_kwDOJbjazM6C4VM9`); [a1b2c3d4e5f7_unify_org_member_role_to_viewer.py:22, :47, :61](../../../api/ee/databases/postgres/migrations/core/versions/a1b2c3d4e5f7_unify_org_member_role_to_viewer.py).

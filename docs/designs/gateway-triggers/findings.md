# Gateway Triggers — Findings

| Field | Value |
|-------|-------|
| Path | `docs/designs/gateway-triggers/` (whole PR — subscriptions, ingress, gateway, UI, schedules) |
| Branch | `gateway-triggers-all` (base `main`) |
| PR | [#4749](https://github.com/Agenta-AI/agenta/pull/4749) |
| Depth | deep |
| Synced | 2026-06-22 (scan-codebase + sync-findings against PR #4749) |
| Severity scheme | P0 / P1 / P2 / P3 |

## Sources

- **scan**: fresh-context review of the branch diff vs `origin/main` (3 parallel passes: triggers core+API, gateway+DAO+migrations, web+cron+docker).
- **sync**: CodeRabbit review on PR #4749 (27 inline comments; 5 already marked "Addressed in commit"; 2 CodeQL alerts).

## Summary

| ID | Sev | Status | Area | Summary |
|----|-----|--------|------|---------|
| F1 | P0→ | fixed (diag) | Security | Composio signature compared as **hex**, but provider may send **base64**. **Fixed locally**: now computes both, accepts either, logs which matched + raw inputs (diagnostic-first per decision). |
| F2 | P1 | needs-verify | Security/Multitenancy | `verify_signature` fails **open** on empty secret? — actually returns False (OK); but `_verify_composio_signature` in router returned True on missing secret (CodeRabbit says addressed in ce43b26 — verify + close thread). |
| F3 | P1 | fixed | Multitenancy | DAO `ti_id` subscription lookups. **Fixed locally**: removed dead unscoped `get_subscription_by_trigger_id`; documented the surviving inbound-resolve method as the one sanctioned cross-project read. |
| F4 | P1 | fixed | Multitenancy | `gateway/connections/dao.py` provider-id lookup/activation. **Fixed locally**: `project_id` now mandatory through DAO→service→tools-service; OAuth callback fails if project_id unresolved. |
| F5 | P1 | confirmed | Correctness | `TriggersService.__init__` accepts `Optional` deps then calls them unconditionally → `AttributeError` if constructed with defaults. (Not in user's directive list — left open.) |
| F6 | P1 | fixed | API contract | `gateway/connections/interfaces.py` `Dict[str,Any]` returns. **Fixed locally**: `ConnectionStatusResponse` / `ConnectionRefreshResponse` DTOs. |
| F7 | P1 | fixed (auto) | Correctness | web `projectScopedParams()` lets `extra.project_id` override scoped value. **Unambiguous — fixed locally.** |
| F8 | P2 | fixed (auto) | Reliability | web catalog hooks auto-prefetch with no `isError` guard → tight failing-fetch loop. **Unambiguous — fixed locally.** |
| F9 | P1 | fixed | Correctness | `verify_signature` lossy `decode('utf-8', errors='replace')`. **Fixed locally**: signs over byte-exact `{id}.{ts}.` + body bytes. |
| F10 | P2 | fixed (auto) | Robustness | adapter `ensure_webhook` 409 retry path `again["items"][0]["secret"]` unguarded → `IndexError`/`KeyError` bypasses the `httpx.HTTPError` wrapper. **Fixed locally.** |
| F11 | P2 | fixed | Correctness | core `delete_subscription` bare `Exception`. **Fixed locally**: narrowed to typed `AdapterError` (best-effort provider cleanup); unexpected errors surface to the route's `@intercept_exceptions`. |
| F12 | P2 | fixed | Reliability | Enqueue with no timeout. **Fixed locally**: `asyncio.wait_for(..., 5s)` on all 3 PR `.kiq()` sites (ingress→503, schedule dispatch, webhook deliver). Eval-runner `.kiq()` left untouched (pre-existing, not in PR). |
| F13 | P2 | needs-user-decision | Supply chain | `docker-compose.gh.yml` (oss+ee) composio service runs unpinned runtime `pip install composio httpx`. (Not in directive list — pin targets TBD.) |
| F14 | P2 | fixed | API contract | catalog pagination **tuples**. **Fixed locally**: page DTOs across gateway + tools + triggers (integrations, actions, events) per decision "all catalog pagination". |
| F15 | P2 | fixed (auto) | Robustness | `catalog/registry.py` lookup uses truthiness instead of explicit missing-key detection. **Fixed locally.** |
| F16 | P2 | confirmed | Testing | No web unit tests for `TriggerScheduleDrawer` / `TriggerSubscriptionDrawer` / `ActiveToggle`. |
| F17 | P2 | confirmed | Testing | No api unit tests for `verify_signature` (secret rotation), cron fire-gate, dedup, full-PUT edit preservation. |
| F18 | P2 | confirmed | Testing | Acceptance lifecycle tests (triggers/tools connections, ee+oss) leak provider state on assertion failure — need `try/finally` cleanup. |
| F19 | P3 | fixed (partial) | Security | Manual operator script. **Fixed locally**: removed the hardcoded public `webhook.site` default URL (`cmd_converge` now requires `AGENTA_WEBHOOK_URL`). Secret prints KEPT — they are the intended output of a manual dev tool (`cmd_register`), confirmed by user. |
| F20 | P3 | confirmed | Migration | `oss000000004` downgrade JSONB `flags - 'is_active'` is silent if key/row absent (cosmetic; backfill is unreleased). |
| F21 | — | wontfix | Migration | In-place edit of `oss000000003` flagged by scan as Alembic-immutability violation — **this is the documented, decided strategy** (unreleased migration, fresh-DB-only, `--nuke` required). Not a bug. See Notes. |
| F22 | P3 | fixed | API contract | `connections/service.py` `type: ignore` dict assignment. **Fixed locally**: widened `ConnectionCreate.data` to `Union[ConnectionCreateData, Json]`; dropped the `type: ignore`. |
| F23 | P0 | wontfix (false-positive) | Correctness | "Schedule dispatch task never wired" — **verified false**: `routers.py:713` assigns `triggers_service.schedule_dispatch_task = _triggers_worker.dispatch_schedule` after worker construction. CodeRabbit saw only the `:684` ctor call, not the deferred assignment. |
| F24 | — | wontfix | Security | `/admin/triggers/schedules/refresh` no-auth posture **matches the platform convention** (evaluations `refresh_runs` — our reuse anchor — has the identical `# NO CHECK` comment; `/admin/*` is network-isolated, cron POSTs to `http://api:8000`). Not a new bug. |
| F25 | P1 | fixed | Correctness | Dispatcher had no `is_valid` gate. **Fixed**: invalid subscription → 409 failed delivery, no invoke; unit test strengthened (`invoke_workflow.assert_not_awaited`). |
| F26 | P1 | fixed | Correctness | `refresh_schedules()` now tracks `failures` and returns `failures == 0` so the caller sees non-200 on dropped runs. |
| F27 | P1 | fixed | Migration | `oss000000004` backfill now `jsonb_set(...) WHERE flags->>'is_active' IS NULL` — never overwrites an existing value. |
| F28 | P1 | fixed | Correctness | `WebhookSubscriptionEdit.flags` now `Optional[...] = None`; edit service merges existing DB flags when omitted (full-PUT-from-current). |
| F29 | P1 | fixed | Correctness | `MINUTE="${MINUTE:-0}"` guard added to **both** `triggers.sh` and `queries.sh`. |
| F30 | P2 | fixed | Reliability | Both OSS crons brought up to the EE cron pattern (bounded `--connect-timeout`/`--max-time`, curl-exit decode, HTTP-status check). |
| F31 | P2 | fixed | Correctness | New `_sync_provider_enabled` helper computes provider `enabled = is_active and is_valid`, used by edit/start-stop/refresh/revoke. |
| F32 | P2 | fixed | API contract | `TriggerScheduleInvalid` gains `schedule`/`reason` structured context; raise sites populate them. |
| F33 | P2 | fixed | Migration/Perf | Added `ix_trigger_deliveries_schedule_id_created_at` (+ downgrade) in `oss000000003`. |
| F34 | P3 | fixed | Testing | `test_triggers_schedules.py` list flows assert status before `.json()`. |
| F35 | P3 | fixed | Docs | `AGENTS.md` test-run example rewritten as `cd <area>` with an explicit area list. |

## Notes

- **F21 is not a defect.** `status.md` records the decision: the trigger tables are unreleased, no production DB has run `oss000000003`, so editing it in place (rather than stacking ALTERs) is intentional and requires `--nuke` on already-migrated dev DBs. Recorded only so the scan observation isn't re-raised every pass.
- **"Addressed in commit" CodeRabbit comments** (already fixed upstream, verify in working tree, then resolve threads): router `_verify_composio_signature` fail-closed (ce43b26), service edit provider-binding desync, `mappings.py` client-controlled `ti_id` overwrite, dispatcher persist-before-reraise short-circuit. These map to F2-adjacent items; not re-opened unless the working tree contradicts.
- Many findings (F4, F6, F11, F12, F14, F15, F19, F22) live in the **subscriptions/ingress/gateway** code shipped earlier in this same PR, not the schedules work — but they're in PR #4749's diff so they belong here.
- **`trigger_id` vs `event_id` naming verified (not a defect):** `trigger_id` = provider trigger-instance `ti_*` (`metadata.trigger_id`/`nano_id`), used only to resolve the subscription; `event_id` = per-delivery unique id (`metadata.id`), used only for dedup + the delivery key. Consistent end-to-end (ingress → worker → dispatcher). Schedules synthesize `event_id = "{schedule.id}:{timestamp}"` and carry no `trigger_id`.

## Naming consistency pass (F36, user, 2026-06-22)

Canonical glossary — six distinct things, each with one name:
gateway **connection ID** (`connection_id`, the `ca_*`), trigger **subscription ID**
(subscription `id`), **trigger ID** (the provider `ti_*`), trigger **delivery ID**
(delivery `id`), **event ID** (`metadata.id`, per-delivery), **event type**
(`metadata.trigger_slug`, the event kind).

- **F36 — fixed.** Renamed our internal `ti_id` → `trigger_id` everywhere it's *our* field: DTO `TriggerSubscription.trigger_id`, DB column + index (`oss000000003`, in-place; nuke required), DBE/dbas/DAO/mappings/interface/service, web zod schema + tests. **Provider wire contract untouched** — the composio adapter and the ingress envelope still read Composio's own `metadata.trigger_id`/`nano_id`/`id` verbatim (Composio itself calls it `trigger_id`, so this aligns rather than conflicts).
- Event-resolution context (`$.event.*`) no longer exposes the trigger instance: dropped `trigger_id`, renamed `trigger_type` → **`event_type`**, added **`event_id`** (`metadata.id`). `TRIGGER_CONTEXT_FIELDS`, `_build_context`, the drawer preview, and the schedule-acceptance template (`$.event.timestamp`) updated to match. Requires a nuke/redeploy (DB column rename).

## Decisions (user, 2026-06-22)

- **F1/F9:** Don't blind-switch the encoding. Add code + debug logs that capture the raw event and try BOTH the current (hex) and suggested (base64) decode so a real event reveals which path errors. Diagnostic-first.
- **F3/F4:** Make `project_id` **mandatory** in all routes and services. The only allowed cross-project lookups are **explicit** exceptions (inbound Composio events resolving an unknown `ti_id`; admin routes). Document those explicitly.
- **F6/F14/F22:** No gateway code in this PR is released yet → avoid `Dict[str,Any]`/tuple/`type: ignore`; introduce proper DTOs now.
- **F11:** Use domain exceptions; fall back to the standard `suppress_exceptions`/`intercept_exceptions` decorators rather than a bare `except`.
- **F12:** Add the enqueue timeout, **5 seconds**, and apply it to **all** `.kiq()` enqueue sites, not just the ingress one.
- **F19:** Remove the secret-printing / public-URL bits **if the test does not need them**.
- Resolve/close clearly-stale or already-fixed PR threads **without** leaving comments.

## Open Findings

### [OPEN] F23 — Schedule dispatch task never wired into `TriggersService`
- **Origin** sync (CodeRabbit, critical) · **Severity** P0 · **Confidence** high · **Status** confirmed
- **Files** `api/entrypoints/routers.py:684`; `api/oss/src/core/triggers/service.py:73` (ctor), `:777-782` (`refresh_schedules`)
- **Evidence** Verified: the entrypoint `TriggersService(...)` passes `adapter_registry/catalog_service/triggers_dao/connections_service/workflows_service` but **omits** `schedule_dispatch_task` (defaults to `None`). `refresh_schedules()` therefore always takes the "Taskiq client not configured" branch — scheduled triggers never enqueue.
- **Suggested Fix** Pass a schedule dispatch task into `TriggersService` at construction (a `triggers.dispatch_schedule` producer task, mirroring how the ingress dispatch task is wired), or fail fast when schedules are enabled but the task is missing.

### [OPEN] F24 — Schedule refresh admin endpoint skips auth/entitlement
- **Origin** sync (CodeRabbit) · **Severity** P1 · **Confidence** medium · **Status** confirmed
- **Files** `api/oss/src/apis/fastapi/triggers/router.py:1426`
- **Evidence** The `/admin/triggers/schedules/refresh` route explicitly skips auth/entitlement; it scans schedules and enqueues dispatches. If `/admin/triggers` is reachable off a trusted network it is an unauthenticated trigger/DoS surface.
- **Suggested Fix** Confirm it carries the same internal-auth posture as the other `/admin/*` cron endpoints (e.g. `AGENTA_AUTH_KEY` access header) and is never mounted on public surfaces. If already gated like the sibling crons, this is informational.

### [OPEN] F25 — Dispatcher has no `is_valid` gate before invoking workflows
- **Origin** sync (CodeRabbit) · **Severity** P1 · **Confidence** high · **Status** confirmed
- **Files** `api/oss/src/tasks/asyncio/triggers/dispatcher.py:95-168`
- **Evidence** Verified: the comment at :95 says invalid subscriptions fall through to the failed-delivery path, but no `entity.flags.is_valid` check exists before `invoke_workflow` (:168). Invalid/revoked subscriptions still execute. The existing unit test `test_invalid_subscription_is_not_silently_skipped` only asserts `write_delivery` was awaited (true on success too), so it does not catch this.
- **Suggested Fix** Add an `is_valid` gate (subscriptions only) that writes a failed delivery (e.g. `409`) and returns before invoke; strengthen the unit test to assert `invoke_workflow` was NOT awaited and the delivery status is the failure code.

### [OPEN] F26 — `refresh_schedules` reports success after dispatch failures
- **Origin** sync (CodeRabbit) · **Severity** P1 · **Confidence** high · **Status** confirmed
- **Files** `api/oss/src/core/triggers/service.py:~829` (per-schedule `except Exception` loop), returns `True`
- **Evidence** Enqueue/broker failures inside the per-schedule loop are logged and swallowed; the method still returns `True`, so the cron/admin caller sees success while runs were dropped.
- **Suggested Fix** Track failures across the batch; return/raise a failure signal (or report count) so the caller can surface non-200.

### [OPEN] F27 — `oss000000004` backfill overwrites existing `is_active`
- **Origin** sync (CodeRabbit) · **Severity** P1 · **Confidence** high · **Status** confirmed · **Category** Migration
- **Files** `api/oss/databases/postgres/migrations/core_oss/versions/oss000000004_add_webhook_subscription_flags.py:~27`
- **Evidence** `UPDATE ... SET flags = COALESCE(flags,'{}') || '{"is_active": true}'` sets `is_active=true` for **every** row, overwriting already-disabled subs. (Supersedes the cosmetic F20 downgrade note.)
- **Suggested Fix** `jsonb_set(..., true) WHERE flags IS NULL OR flags ->> 'is_active' IS NULL` — only backfill where the key is absent. Webhook flags are unreleased, so a `--nuke` dev DB is unaffected, but the migration should still be correct.

### [OPEN] F28 — Webhook edit resurrects paused subscriptions
- **Origin** sync (CodeRabbit) · **Severity** P1 · **Confidence** high · **Status** confirmed
- **Files** `api/oss/src/core/webhooks/types.py:149` (`WebhookSubscriptionEdit`), edit mapping
- **Evidence** Edit materializes missing `flags` as `is_active=True` and the mapping persists `subscription.flags`; a normal PUT omitting flags (older client) silently resumes a paused subscription. **Note:** this is the webhook-domain analogue of the full-PUT rule — edit must merge with the current DB value, not default.
- **Suggested Fix** Make edit `flags` optional and merge with the existing DB value before writing (full-PUT-from-current), or require clients to round-trip flags.

### [OPEN] F29 — `triggers.sh` aborts at the top of every hour (`00` minute)
- **Origin** sync (CodeRabbit) · **Severity** P1 · **Confidence** high · **Status** confirmed
- **Files** `api/oss/src/crons/triggers.sh:7-8`
- **Evidence** `MINUTE=$(date -u +%M | sed 's/^0*//')` turns `"00"` into `""`; the next `$(( ... ))` arithmetic fails and the job aborts every hour at :00.
- **Suggested Fix** `MINUTE="${MINUTE:-0}"` after the strip. (CodeRabbit committable suggestion.)

### [OPEN] F30 — `triggers.sh` masks curl failures, no timeouts
- **Origin** sync (CodeRabbit) · **Severity** P2 · **Confidence** high · **Status** confirmed
- **Files** `api/oss/src/crons/triggers.sh:22`
- **Evidence** `curl -s ... || echo "❌ CURL failed"` swallows the failure; no `--fail`/`--connect-timeout`/`--max-time` → hidden failures and possible hangs.
- **Suggested Fix** `-sS --fail --connect-timeout 5 --max-time 30`, drop the `|| echo`. (CodeRabbit committable suggestion.)

### [OPEN] F31 — Provider enablement computed inconsistently
- **Origin** sync (CodeRabbit) · **Severity** P2 · **Confidence** medium · **Status** confirmed
- **Files** `api/oss/src/core/triggers/service.py:~454` (edit), `:530-604` (`_set_valid`/`set_subscription_active`)
- **Evidence** `edit_subscription` syncs provider with `is_active` only, `_set_valid` with `is_valid` only, `set_subscription_active` not at all → paths disagree and can re-enable a revoked/paused provider trigger.
- **Suggested Fix** One helper computing provider `enabled = is_active and is_valid`, used by edit/start/stop/refresh/revoke.

### [OPEN] F32 — `TriggerScheduleInvalid` lacks structured context
- **Origin** sync (CodeRabbit) · **Severity** P2 · **Confidence** high · **Status** confirmed · **Category** API contract
- **Files** `api/oss/src/core/triggers/exceptions.py:53`
- **Evidence** Carries only a message, unlike the not-found errors that expose IDs. Guideline: domain exceptions should include structured context.
- **Suggested Fix** Add `schedule` / `reason` fields so the router builds richer 422s without parsing text.

### [OPEN] F33 — Missing schedule-delivery ordering index
- **Origin** sync (CodeRabbit) · **Severity** P2 · **Confidence** medium · **Status** confirmed · **Category** Migration/Perf
- **Files** `api/oss/databases/postgres/migrations/core_oss/versions/oss000000003_...py:238`
- **Evidence** The subscription-delivery ordering index exists but the schedule-delivery equivalent was not added. (In-place edit OK — migration unreleased.)
- **Suggested Fix** Add the parallel `(schedule_id, created_at)`-style ordering index in `oss000000003`.

### [OPEN] F34 — schedules acceptance test consumes body before status assert
- **Origin** sync (CodeRabbit) · **Severity** P3 · **Confidence** high · **Status** confirmed · **Category** Testing
- **Files** `api/oss/tests/pytest/acceptance/triggers/test_triggers_schedules.py:83`
- **Evidence** List-flow tests call `.json()` before asserting `status_code == 200`, masking the real failure on a non-200.
- **Suggested Fix** Assert status first, then read body.

### [OPEN] F35 — AGENTS.md test-run command example syntax error
- **Origin** sync (CodeRabbit) · **Severity** P3 · **Confidence** high · **Status** confirmed · **Category** Docs
- **Files** `AGENTS.md:195`
- **Suggested Fix** Fix the quoted `cd "sdks/python"|"api"|"services"` example syntax.

### [OPEN] F2 — Router signature fail-open on missing secret (verify upstream fix)
- **Origin** sync (CodeRabbit) · **Severity** P1 · **Confidence** medium · **Status** needs-verify
- **Files** `api/oss/src/apis/fastapi/triggers/router.py:~94`
- **Evidence** CodeRabbit: `if not secret: return True` is an auth bypass on misconfig; marked "✅ Addressed in commit ce43b26". Core `verify_signature` already returns `False` on empty secret.
- **Suggested Fix** Confirm the router path now returns `False`/rejects on the pushed HEAD; if so, resolve the thread. Re-open only if the working tree still returns True.

### [OPEN] F5 — `TriggersService` constructor accepts None deps then dereferences them
- **Origin** sync (CodeRabbit) + scan · **Severity** P1 · **Confidence** high · **Status** confirmed
- **Files** `api/oss/src/core/triggers/service.py` (init), call sites throughout
- **Evidence** `triggers_dao: Optional[...] = None`, `connections_service: Optional[...] = None`; methods call `self.dao.*` / `self.connections_service.*` unconditionally.
- **Suggested Fix** Drop the `Optional`/defaults (make required) per CodeRabbit, OR validate non-None in `__init__`. Not in the user's directive list this pass — left open.

### [OPEN] F13 — unpinned runtime `pip install` in composio compose service
- **Origin** sync (CodeRabbit) + scan · **Severity** P2 · **Confidence** high · **Status** needs-user-decision
- **Files** `hosting/docker-compose/oss/docker-compose.gh.yml:~554`; `hosting/docker-compose/ee/docker-compose.gh.yml` (same)
- **Evidence** `pip install --quiet --root-user-action=ignore composio httpx` — no version pins; latest-at-runtime breaks reproducibility.
- **Suggested Fix** Pin versions, or move composio/httpx into the image's deps. Pin targets TBD.

### [OPEN] F16 — no web unit tests for schedule/subscription drawers + ActiveToggle
- **Origin** scan · **Severity** P2 · **Confidence** high · **Status** confirmed · **Category** Testing
- **Files** `web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/*`, `components/ActiveToggle.tsx`
- **Suggested Fix** Add unit tests (cron input, prefill, play/pause transitions, error display).

### [OPEN] F17 — missing api unit tests (signature rotation, cron gate, dedup, full-PUT)
- **Origin** scan · **Severity** P2 · **Confidence** high · **Status** confirmed · **Category** Testing
- **Files** `api/oss/src/core/triggers/service.py`, dispatcher
- **Suggested Fix** Unit-test `verify_signature` (now exercises hex + base64 paths), `croniter.match` gate, dedup keys, edit field preservation.

### [OPEN] F18 — acceptance lifecycle tests leak provider state on failure
- **Origin** sync (CodeRabbit) · **Severity** P2 · **Confidence** high · **Status** confirmed · **Category** Testing
- **Files** `api/ee/tests/pytest/acceptance/triggers/test_triggers_subscriptions.py:182-227`, `.../test_triggers_connections.py:160`, `api/oss/.../test_triggers_connections.py:71`
- **Suggested Fix** `try/finally` cleanup + assert delete response.

### [OPEN] F20 — `oss000000004` downgrade JSONB subtraction silent on absent key
- **Origin** scan · **Severity** P3 · **Confidence** medium · **Status** confirmed · **Category** Migration
- **Files** `api/oss/databases/postgres/migrations/core_oss/versions/oss000000004_add_webhook_subscription_flags.py:~47`
- **Suggested Fix** Cosmetic; backfill is unreleased. Optional `CASE WHEN flags IS NULL` guard.

## Closed Findings

### [CLOSED] F1 — Composio signature hex vs base64 (diagnostic-first)
- **Origin** sync (CodeRabbit, critical) + scan · **Severity** P0 · **Status** fixed (diagnostic)
- **Files** `api/oss/src/core/triggers/service.py` `verify_signature`
- **Fix applied** Per decision: do NOT blind-switch. Now computes both hex and base64 HMAC digests, accepts whichever matches, and logs the raw inputs + which encoding matched (`matched via HEX` / `matched via BASE64`) at debug/info. A real event will reveal the true encoding; collapse to one afterward.

### [CLOSED] F3 — `ti_id` subscription lookups lack tenant scope
- **Origin** sync + scan · **Severity** P1 · **Status** fixed
- **Files** `api/oss/src/dbs/postgres/triggers/dao.py`, `core/triggers/interfaces.py`
- **Fix applied** Removed the dead, unscoped `get_subscription_by_trigger_id` (no callers). The surviving `get_project_and_subscription_by_trigger_id` is documented as the **one sanctioned cross-project read** — the inbound-event exception per the F3/F4 decision (the event carries only `ti_*`, no tenant scope).

### [CLOSED] F4 — Connection provider-id lookup/activation make `project_id` optional
- **Origin** sync (CodeRabbit) · **Severity** P1 · **Status** fixed
- **Files** `dbs/postgres/gateway/connections/dao.py`, `core/gateway/connections/{interfaces,service}.py`, `core/tools/service.py`, `apis/fastapi/tools/router.py`
- **Fix applied** `project_id` now mandatory through DAO → connections service → tools service. The OAuth callback fails with the error card if it can't resolve `project_id` from the signed state (never activates cross-project).

### [CLOSED] F6 — `Dict[str, Any]` returns in gateway connections interface
- **Origin** sync (CodeRabbit) + scan · **Severity** P1 · **Status** fixed
- **Files** `core/gateway/connections/{dtos,interfaces}.py`, `.../providers/composio/adapter.py`, `core/gateway/connections/service.py`
- **Fix applied** Added `ConnectionStatusResponse` / `ConnectionRefreshResponse` DTOs; interface + adapter return them; service reads attributes instead of `.get(...)`.

### [CLOSED] F7 — web `projectScopedParams()` lets `extra` override `project_id`
- **Origin** sync (CodeRabbit) + scan · **Severity** P1 · **Status** fixed
- **Files** `web/packages/agenta-entities/src/gatewayTrigger/api/client.ts`
- **Fix applied** Reordered spreads so scoped `project_id` always wins (`extra` first, scoped value last). Matches CodeRabbit's committable suggestion.

### [CLOSED] F8 — web catalog hooks auto-prefetch with no `isError` guard
- **Origin** scan + sync (CodeRabbit) · **Severity** P2 · **Status** fixed
- **Files** `web/.../gatewayTrigger/hooks/useTriggerCatalogIntegrations.ts`, `useTriggerCatalogEvents.ts`
- **Fix applied** Added `&& !query.isError` to the prefetch effect guard (and dep array) in both hooks.

### [CLOSED] F9 — `errors='replace'` corrupts signed payload
- **Origin** sync (CodeRabbit) · **Severity** P1 · **Status** fixed
- **Files** `api/oss/src/core/triggers/service.py`
- **Fix applied** Signs over byte-exact `f"{id}.{ts}.".encode() + body` (no lossy utf-8 decode). Folded into the F1 diagnostic rewrite.

### [CLOSED] F10 — adapter 409 webhook-secret retry path unguarded
- **Origin** sync (CodeRabbit) · **Severity** P2 · **Status** fixed
- **Files** `api/oss/src/core/triggers/providers/composio/adapter.py`
- **Fix applied** Added `_first_webhook_secret` guard helper; the 409 retry raises `AdapterError` instead of `IndexError`/`KeyError` when no readable secret is returned.

### [CLOSED] F11 — bare `Exception` swallow in `delete_subscription`
- **Origin** sync (CodeRabbit) + scan · **Severity** P2 · **Status** fixed
- **Files** `api/oss/src/core/triggers/service.py`
- **Fix applied** Narrowed to typed `AdapterError` (best-effort provider cleanup); unexpected exceptions now surface to the route's `@intercept_exceptions` — per the F11 decision.

### [CLOSED] F12 — enqueue has no timeout/error shaping
- **Origin** sync (CodeRabbit) · **Severity** P2 · **Status** fixed
- **Files** `apis/fastapi/triggers/router.py`, `core/triggers/service.py`, `tasks/asyncio/webhooks/dispatcher.py`
- **Fix applied** `asyncio.wait_for(..., timeout=5s)` on all three PR `.kiq()` sites (ingress → 503; schedule dispatch + webhook deliver already catch+continue). Eval-runner `.kiq()` left untouched (pre-existing, not in this PR).

### [CLOSED] F14 — tuple pagination returns instead of DTO (catalog)
- **Origin** sync (CodeRabbit) · **Severity** P2 · **Status** fixed
- **Files** `core/gateway/catalog/{dtos,interfaces,service}.py` + composio adapter; `core/tools/{dtos,interfaces,service}.py` + catalog adapter; `core/triggers/{dtos,interfaces,service}.py` + catalog adapter; both routers
- **Fix applied** Per "all catalog pagination" decision: `CatalogIntegrationsPage`, `ToolCatalogIntegrationsPage`, `ToolCatalogActionsPage`, `TriggerCatalogIntegrationsPage`, `TriggerCatalogEventsPage` DTOs replace every `Tuple[List[...], Optional[str], int]`. The two genuinely-internal DAO tuples (`get_project_and_subscription_by_trigger_id`, `fetch_active_schedules_with_project`) are intentionally kept.

### [CLOSED] F15 — registry lookup uses truthiness, not explicit missing-key
- **Origin** sync (CodeRabbit) · **Severity** P2 · **Status** fixed
- **Files** `api/oss/src/core/gateway/catalog/registry.py`
- **Fix applied** `if provider_key not in self._adapters: raise` then index.

### [CLOSED] F19 — public default URL in manual test
- **Origin** sync (CodeQL + CodeRabbit) · **Severity** P3 · **Status** fixed (partial)
- **Files** `api/oss/tests/manual/triggers/try_composio_triggers.py`
- **Fix applied** Removed the hardcoded public `webhook.site` default URL; `cmd_converge` now requires `AGENTA_WEBHOOK_URL` (matching `cmd_register`). Secret prints KEPT — they are the intended output of a manual operator script, confirmed by the user.

### [CLOSED] F21 — in-place edit of `oss000000003` (scan flagged as Alembic violation)
- **Origin** scan · **Status** wontfix (documented decision)
- See Notes. The migration is unreleased; in-place edit is the chosen strategy.

### [CLOSED] F22 — `type: ignore` dict assignment to DTO field
- **Origin** scan · **Severity** P3 · **Status** fixed
- **Files** `api/oss/src/core/gateway/connections/{dtos,service}.py`
- **Fix applied** Widened `ConnectionCreate.data` to `Optional[Union[ConnectionCreateData, Json]]` (the service builds a provider-shaped persistence dict); dropped the `# type: ignore`.

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
| F1 | P0 | fixed | Security | Composio signature compared as **hex**, but provider may send **base64**. **Resolved**: live events confirmed lowercase **hex** (5/5 `matched via HEX`, byte-exact `signed_bytes`, body_len=1068). Collapsed to hex-only; dropped the diagnostic dual-accept + base64 branch. |
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
| F37 | P3 | confirmed | Testing | `test_triggers_ingress.py:113` dedup test gates only on `COMPOSIO_TEST_CONNECTED_ACCOUNT` and can resolve an empty secret → 401 flakiness unrelated to dedup. Add `@_requires_composio` + guard the secret. |
| F38 | P0 | fixed | Wiring/Reliability | Triggers worker entrypoint crash-loops: the dispatcher refactor added a required `triggers_dao` kwarg to `TriggersWorker`, wired in `routers.py` but **missed in `worker_triggers.py`**. Ingress verified+enqueued every event (202) but nothing consumed the queue. **Found via live run** (worker container restarting every ~7s); **fixed locally** by passing `triggers_dao` (already constructed). Confirmed: worker boots, 2 deliveries written. |

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

### [OPEN] F24 — Schedule refresh admin endpoint skips auth/entitlement
- **Origin** sync (CodeRabbit) · **Severity** — · **Confidence** high · **Status** wontfix (convention)
- **Files** `api/oss/src/apis/fastapi/triggers/router.py:1426`
- **Evidence** Verified: matches the platform convention — the evaluations `refresh_runs` admin cron (our reuse anchor) has the identical `# NO CHECK FOR PERMISSIONS / ENTITLEMENTS`; `/admin/*` is network-isolated and the cron POSTs to `http://api:8000`. Not a new bug. Kept open as a tracked decision rather than silently resolved.
- **Suggested Fix** None unless we decide to add internal-auth to ALL `/admin/*` crons as a platform-wide change.

### [OPEN] F37 — ingress dedup test precondition can 401-flake
- **Origin** sync (CodeRabbit, minor) · **Severity** P3 · **Confidence** medium · **Status** confirmed · **Category** Testing
- **Files** `api/oss/tests/pytest/acceptance/triggers/test_triggers_ingress.py:113`
- **Evidence** The dedup test gates only on `COMPOSIO_TEST_CONNECTED_ACCOUNT` and can resolve an empty webhook secret → 401 failures unrelated to dedup → flaky.
- **Suggested Fix** Add `@_requires_composio` and guard the resolved secret before signing.

## Closed Findings

### [CLOSED] F1 — Composio signature hex vs base64 (resolved against live events)
- **Origin** sync (CodeRabbit, critical) + scan · **Severity** P0 · **Status** fixed
- **Files** `api/oss/src/core/triggers/service.py` `verify_signature`
- **Fix applied** Diagnostic-first per decision: temporarily computed both hex and base64 digests, accepted either, logged which matched + raw inputs. Live Composio events then resolved it — **5/5 matched via HEX**, `force_refresh=False`, byte-exact `signed_bytes` (body_len=1068), never base64. Collapsed to hex-only: dropped the base64 branch, the dual-accept, the debug dump, and the now-unused `base64` import. Negative-path test (forged `deadbeef`) still rejects; signature unit suite unaffected (it signs with hex).

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

### [CLOSED] F23 — Schedule dispatch task wiring (false positive)
- **Origin** sync (CodeRabbit, critical) · **Severity** P0 · **Status** wontfix (false-positive)
- **Files** `api/entrypoints/routers.py:713`
- **Verdict** CodeRabbit saw only the `TriggersService(...)` ctor at :684 and missed the deferred assignment at `:713` (`triggers_service.schedule_dispatch_task = _triggers_worker.dispatch_schedule`). The task IS wired; `refresh_schedules` does not hit the unconfigured branch. Validated green on nuke+redeploy.

### [CLOSED] F25 — Dispatcher `is_valid` gate
- **Origin** sync (CodeRabbit) · **Severity** P1 · **Status** fixed (committed `af24dad`)
- **Files** `api/oss/src/tasks/asyncio/triggers/dispatcher.py`
- **Fix applied** `dispatch_subscription` writes a 409 failed delivery and returns before invoke when `is_valid` is false; unit test asserts `invoke_workflow` not awaited + status 409.

### [CLOSED] F26 — `refresh_schedules` success after dispatch failures
- **Origin** sync (CodeRabbit) · **Severity** P1 · **Status** fixed (committed `af24dad`)
- **Files** `api/oss/src/core/triggers/service.py`
- **Fix applied** Counts `failures`; returns `failures == 0`.

### [CLOSED] F27 — `oss000000004` backfill overwrites existing `is_active`
- **Origin** sync (CodeRabbit) · **Severity** P1 · **Status** fixed (committed `af24dad`)
- **Files** `.../oss000000004_add_webhook_subscription_flags.py`
- **Fix applied** `jsonb_set(...) WHERE flags IS NULL OR flags ->> 'is_active' IS NULL`. (Subsumes F20's upgrade concern.)

### [CLOSED] F28 — Webhook edit resurrects paused subscriptions
- **Origin** sync (CodeRabbit) · **Severity** P1 · **Status** fixed (committed `af24dad`)
- **Files** `api/oss/src/apis/fastapi/webhooks/router.py`
- **Fix applied** Kept `flags` required (full-PUT, per the edits-are-full-PUT rule — reverted the optional/merge misstep); the `test_subscription` server-side builder now carries `flags=existing.flags`. The main edit route already passes the client's full body.

### [CLOSED] F29 — `triggers.sh` aborts at `:00` minute
- **Origin** sync (CodeRabbit) · **Severity** P1 · **Status** fixed (committed `af24dad`)
- **Files** `api/oss/src/crons/triggers.sh`, `queries.sh`
- **Fix applied** `MINUTE="${MINUTE:-0}"` in both crons.

### [CLOSED] F30 — cron curl masks failures / no timeouts
- **Origin** sync (CodeRabbit) · **Severity** P2 · **Status** fixed (committed `af24dad`)
- **Files** `api/oss/src/crons/triggers.sh`, `queries.sh`
- **Fix applied** Both OSS crons brought to the EE pattern (`--connect-timeout`/`--max-time`, curl-exit decode, HTTP-status check) rather than inventing a new `--fail` style.

### [CLOSED] F31 — Provider enablement computed inconsistently
- **Origin** sync (CodeRabbit) · **Severity** P2 · **Status** fixed (committed `af24dad`)
- **Files** `api/oss/src/core/triggers/service.py`
- **Fix applied** `_sync_provider_enabled` helper computes `enabled = is_active and is_valid`, used by edit/start/stop/refresh/revoke.

### [CLOSED] F32 — `TriggerScheduleInvalid` structured context
- **Origin** sync (CodeRabbit) · **Severity** P2 · **Status** fixed (committed `af24dad`)
- **Files** `api/oss/src/core/triggers/exceptions.py`, `service.py`
- **Fix applied** Added `schedule`/`reason`; raise sites populate them.

### [CLOSED] F33 — Missing schedule-delivery ordering index
- **Origin** sync (CodeRabbit) · **Severity** P2 · **Status** fixed (committed `af24dad`)
- **Files** `.../oss000000003_...py`
- **Fix applied** Added `ix_trigger_deliveries_schedule_id_created_at` (+ downgrade).

### [CLOSED] F34 — schedules test consumes body before status assert
- **Origin** sync (CodeRabbit) · **Severity** P3 · **Status** fixed (committed `af24dad`)
- **Files** `api/oss/tests/pytest/acceptance/triggers/test_triggers_schedules.py`
- **Fix applied** Assert status before `.json()` in both list flows.

### [CLOSED] F35 — AGENTS.md test-run example syntax
- **Origin** sync (CodeRabbit) · **Severity** P3 · **Status** fixed (committed `af24dad`)
- **Files** `AGENTS.md`
- **Fix applied** Rewritten as `cd <area>` with an explicit area list.

### [CLOSED] F36 — `ti_id` → `trigger_id` naming consistency
- **Origin** user · **Status** fixed (committed `af24dad`)
- **Fix applied** See the "Naming consistency pass" note above. Validated green on nuke+redeploy (1007 sdk / 1862 api / 158 services).

### [CLOSED] F38 — Triggers worker entrypoint crash-loop (missing `triggers_dao`)
- **Origin** live run (manual E2E) · **Severity** P0 · **Status** fixed
- **Files** `api/entrypoints/worker_triggers.py`
- **Fix applied** The dispatcher refactor (dedup + `is_valid` 409 gate) added a required `triggers_dao` kwarg to `TriggersWorker.__init__`. `routers.py` was updated; `worker_triggers.py:94` was not, so the worker container raised `TypeError: ... missing 'triggers_dao'` and restarted every ~7s. Ingress kept returning 202 (verify + enqueue succeed) but nothing drained `queues:triggers` → no deliveries. Passed `triggers_dao=triggers_dao` (already constructed at line 58). Worker now boots (`Listening started`); confirmed against live DB — 2 deliveries written, one per path (subscription event + cron schedule). Tests didn't catch it: unit tests construct the worker with the dao directly; nothing exercises entrypoint wiring.

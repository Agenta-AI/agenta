# Tasks: Sandbox Metering & Entitlements

Status: draft. Phase 1 is the build target; Phase 2 tasks are listed at design
depth and will be refined (and pricing numbers filled in) before implementation.

Conventions: new domain code follows `api/AGENTS.md` (Router → Service → DAO,
DTOs not dicts, domain exceptions, env via `api/oss/src/utils/env.py`, no
`os.getenv` in feature code). Every ingestion entry point is double-gated on the
provider `.enabled` flag **and** `is_ee()`.

---

## Phase 0 — Stop billing users (applied)

All in `api/ee/src/core/access/entitlements/types.py`.

- [x] Remove `Gauge.USERS.value: "users"` from `REPORTS` (stop Stripe billing;
  `report()` skips-and-flushes non-`REPORTS` keys, no error).
- [x] Pro plan `Gauge.USERS`: `free=3, limit=10, strict=True` → `Quota(strict=True)`
  (uncapped). Hobby (free) unchanged (`free=2, limit=2, strict=True`); Business /
  Agenta-AI / Self-Hosted already uncapped.
- [ ] Verify: adding users past 10 on Pro succeeds; the free plan still blocks
  past 2; no `users` line in the next Stripe report run.
- [ ] Note for ops: stale `users` price item on existing Pro/Business
  subscriptions can be left or cleaned up separately (not load-bearing — it just
  stops receiving usage).

---

## Phase 1 — Metering

### Meter & entitlement keys (additive, no row migration)

- [ ] Add sandbox counters to `Counter` in
  `api/ee/src/core/access/entitlements/types.py`:
  `SANDBOX_VCPU_SECONDS`, `SANDBOX_RAM_GIB_SECONDS`, `SANDBOX_DISK_GIB_SECONDS`
  (+ optional `SANDBOX_GPU_SECONDS`).
- [ ] Mirror the same members into `Meters` in `api/ee/src/core/meters/types.py`.
- [ ] Add a Phase-1 **non-blocking** `Quota(period=Period.MONTHLY)` (no
  `free`/`limit`/`strict`) for each new counter, in every plan of
  `DEFAULT_ENTITLEMENTS`, so metering records without gating yet.
- [ ] Confirm `compute_meter_id` (UUIDv5 over scope+period+key) and the
  `(organization_id, key, year, month)` PK handle the new keys with no schema
  change (they should — keys are generic).

### Env config & provider toggles (`api/oss/src/utils/env.py`)

- [ ] Add `E2BConfig` (`api_key`, optional `webhook_url` override) with an
  `enabled` property true only when required vars are present (mirror
  `AIServicesConfig`). Env: `AGENTA_E2B_API_KEY`, `AGENTA_E2B_WEBHOOK_URL`.
- [ ] Add `DaytonaConfig` (`api_key`, `api_url`, org mapping) with `enabled`.
  Env: `AGENTA_DAYTONA_API_KEY`, `AGENTA_DAYTONA_API_URL`,
  `AGENTA_DAYTONA_ORGANIZATION_ID`.
- [ ] Expose both on the shared `env` object.

### New domain skeleton

- [ ] Create the domain folders (`apis/fastapi/<sandboxes>/`, `core/<sandboxes>/`,
  `dbs/postgres/<sandboxes>/`) per the standard shape. Decide name:
  `sandbox_metering`.
- [ ] Define typed DTOs in `core/<sandboxes>/dtos.py`:
  `SandboxUsageDTO` (provider, sandbox_id, org/project scope, vcpu_seconds,
  ram_gib_seconds, disk_gib_seconds, window start/end, source event id).
- [ ] Define domain exceptions in `core/<sandboxes>/types.py` (e.g.
  `SandboxWebhookSignatureInvalid`, `SandboxProviderDisabled`); catch at the
  router boundary.
- [ ] `core/<sandboxes>/service.py`: a `record_usage()` that converts a
  `SandboxUsageDTO` into `check_entitlements(cache=False)` (or
  `MetersService.adjust`) calls — **one per base meter** — at org scope. This is
  the single sink both providers feed.

### E2B — webhook receiver + secret + registration

- [ ] **Secret (leader-generate, store like Composio's fetched secret):** at
  startup, generate a 32-byte secret under a Redis `SET NX` guard so only one
  container creates it; store `encrypt(secret)` in a Redis namespace mirroring
  the Composio resolver (`api/oss/src/core/triggers/utils.py`
  `WebhookSecretResolver`). Other containers read+decrypt the same value.
- [ ] **Registration:** `ensure_e2b_webhook_registered()` — `GET
  /events/webhooks` to reconcile, `POST /events/webhooks` with
  `{name, url, enabled, events:[created,paused,resumed,killed], signature_secret}`
  only if our callback URL isn't already registered. Mirror
  `ComposioTriggersAdapter.ensure_webhook_subscription()`'s idempotent
  check-then-create.
- [ ] **Startup hook:** call it from `lifespan()` in
  `api/entrypoints/routers.py`, guarded `if env.e2b.enabled:`, best-effort
  (log on failure, don't block startup) — same shape as the Composio block.
- [ ] **Receiver route** `POST /webhooks/e2b/events/` (public, unauthenticated;
  mirror the Composio receiver in
  `api/oss/src/apis/fastapi/triggers/router.py`). Verify
  `sha256(secret + raw_body)` base64 vs `e2b-signature`; **read raw body**.
- [ ] **Dedupe** on `e2b-delivery-id`. Ack 202 fast; enqueue to the async broker
  (Redis stream like `streams:sandbox` / TaskIQ), do meter work off-request.
- [ ] **Verifier diagnostics:** log first real deliveries (headers + computed vs
  received signature); pin to observed behavior (E2B docs/header mismatch,
  e2b-dev/e2b #1103).
- [ ] **Window math in the worker:** on `killed`/`paused` compute
  `vcpu_seconds = vCPU × duration_ms/1000`,
  `ram_gib_seconds = (memory_mb/1024) × duration_ms/1000`; `resumed` opens a new
  window. Accumulate via the `record_usage()` sink (incremental + delivery-id
  dedupe).

### Daytona — poll job

- [ ] Poll job (reuse the singleton Redis-lock + TTL pattern that guards
  `MetersService.report()`), gated `if env.daytona.enabled and is_ee():`.
- [ ] HTTP client (typed DTO return, per `api/AGENTS.md`): `Authorization:
  Bearer <key>` + `X-Daytona-Organization-ID` header. Call
  `GET /organization/{org}/usage/aggregated` with `from=period_start,to=now`;
  optionally `GET /organization/{org}/usage/sandbox` for attribution.
- [ ] **Cumulative → delta write:** compute
  `delta = authoritative_total_for_period − current_meter_value` per base meter
  and feed `adjust()` (reuses `adjust()` unchanged; idempotent and
  self-healing). Clamp the window to the billing period using the org anchor
  (same anchor logic `check_entitlements`/`dao` already use).
- [ ] Resolve Agenta-org → Daytona-org mapping (see open question 1).

### Local dev bridge (E2B only)

- [ ] Add an `e2b-bridge` docker-compose service under the `with-tunnel` profile
  in the `ee` + `oss` **dev** compose files (after the `triggers-bridge`
  service). Unlike the Composio WS dispatcher, this runs **ngrok** to expose the
  local API's `/webhooks/e2b/events/`.
- [ ] Feed the minted public URL into startup registration as
  `env.e2b.webhook_url`.
- [ ] Add a `run.sh` flag to toggle it independently (`--e2b-tunnel`, off by
  default), so it only starts when E2B is exercised locally.

### Verification (Phase 1)

- [ ] Acceptance: an E2B `killed` webhook (signed) increments the three sandbox
  counters for the org by the expected resource-seconds; replayed delivery
  (same `e2b-delivery-id`) does not double-count.
- [ ] Acceptance: a Daytona poll cycle writes the period totals; a second poll
  with unchanged upstream totals is a no-op (delta 0).
- [ ] With both providers disabled, neither the receiver registration, the poll
  job, nor the bridge runs.
- [ ] EE/OSS test accounts per `feedback_oss_ee_test_accounts` for any ungated
  endpoint.

---

## Phase 2 — Entitlements & gating (design depth)

### Per-plan tiers & Stripe wiring

- [ ] Replace Phase-1 non-blocking quotas with real per-plan `Quota`s in
  `DEFAULT_ENTITLEMENTS` (Hobby hard at free tier; Pro/Business free tier + soft
  overage). Numbers owned by pricing.
- [ ] Add each billed meter to `REPORTS` (`{counter.value: "<stripe slug>"}`)
  so `MetersService.report()` syncs it (counters → `billing.MeterEvent.create`,
  delta = value − synced).
- [ ] Add per-plan Stripe price ids under the new slot names to
  `AGENTA_BILLING_PRICING` (resolved by `get_stripe_meter_price(plan, name)` in
  `api/ee/src/core/subscriptions/settings.py`). No `report()` code change.

### Gating

- [ ] **Create-time soft pre-check (Layer 1):** before launching a sandbox,
  `check_entitlements(key=..., cache=True, scope=org)`; refuse launch if over.
  Estimate in-flight accrual (`allocated_vcpu × elapsed + …`) and add to the
  cached value for the decision.
- [ ] **Post-hoc true-up (Layer 2):** the webhook/poll `record_usage()` already
  does `adjust(cache=False)` — confirm it reconciles the Layer-1 cache
  (the entitlements service already invalidates on reject).
- [ ] Keep RBAC (`RUN_SESSIONS`) separate from the entitlement check
  (`feedback_permissions_vs_entitlements`): permission = may-run, entitlement =
  has-quota.

### Mid-session enforcement (2b, dependent)

- [ ] Wire an over-quota breach to the sandbox **kill** path. Depends on the
  missing user-kill endpoint (`DELETE /sessions/streams/{id}` + runner `/kill`)
  landing. Recommend shipping 2a (create-time gating) first.

### Open questions to resolve before Phase 2 build

- [ ] Daytona org mapping model (platform-wide vs per-tenant).
- [ ] Bill E2B paused-storage in v1, or compute-only first?
- [ ] Include GPU seconds now or defer?
- [ ] Final Stripe meter slugs + per-plan price ids.

---

## Phase 3 — Records metering & billing

The spans pattern with a new key: max-size cap + meter per-record count + price
for typical size. No provider integration, no new mechanism. Unit = **count**
(decided — mirrors `delta = count root spans`), not bytes.

> **Dependency (not a Phase 3 task):** the transcripts→records **rename** lands
> separately — another branch merged/rebased into this one before Phase 3
> starts. Phase 3 assumes the domain is already `records` and does **no**
> renaming; it only adds the meter key + billing.

- [ ] Max record size: confirm/define a per-record size cap (analogue of
  `MAX_OTLP_BATCH_SIZE` / per-span byte limit). Reuse an existing size guard on
  the records path if present; else add an `env`-configured cap that rejects
  oversize at the edge (like the OTLP `413`). This bound is what makes
  per-count billing fair.
- [ ] Add `Counter.RECORDS_INGESTED = "records_ingested"` to
  `entitlements/types.py` and mirror into `Meters` (`core/meters/types.py`).
- [ ] Add a per-plan `Quota(free=..., period=MONTHLY, retention=Retention.*)` to
  every plan in `DEFAULT_ENTITLEMENTS` (retention matches the plan tier, as
  traces do). Confirm this is the same field already driving record retention so
  the window and the metered allowance share one source.
- [ ] Wire the two-layer check at the records persist path:
  `check_entitlements(key=Counter.RECORDS_INGESTED, delta=<n_records>,
  cache=True)` at the request edge, `cache=False` in the worker (mirror the
  OTLP-router + tracing-worker pair). Delta = one per record.
- [ ] Billing: add `Counter.RECORDS_INGESTED.value: "records"` to `REPORTS`; add
  a `"records"` price slot per plan to `AGENTA_BILLING_PRICING` (price-per-record
  set for typical record size). No `report()` change.
- [ ] Acceptance: persisting N records increments the counter by N; an oversize
  record is rejected at the cap; retention sweep unchanged; meter appears in the
  Stripe report once in `REPORTS`.

---

## Phase 4 — S3 / SeaweedFS storage gauge + caps

Structurally different: a **gauge** (level), not a counter. `Gauge.USERS` is the
template. Caps now; billing/retention later.

- [ ] Add `Gauge.BYTES = "bytes"` to `entitlements/types.py`,
  mirror into `Meters`. Decide org-scope only vs also project-scope gauge.
- [ ] Mount-layout prerequisite: ensure the S3/SeaweedFS path convention encodes
  `org/project` prefix so stored size is attributable to a `MeterScope` without
  per-file bookkeeping.
- [ ] Incremental deltas: on mount write `check_entitlements(key=Gauge.BYTES,
  delta=+bytes, scope=org[/project])`; on delete `delta=-bytes`. Gauge `value` =
  live total.
- [ ] Periodic reconcile job (mirror the Daytona poll/lock pattern): read
  authoritative size and set the gauge via `delta = authoritative − current`.
  - [ ] S3 source: CloudWatch `BucketSizeBytes` / Storage Lens / prefix-scoped
    `ListObjectsV2` size sum.
  - [ ] SeaweedFS source: filer/volume size API over the org/project prefix.
- [ ] Caps: add `Quota(free=<GiB>, limit=<GiB>, strict=True)` per plan. Enforce
  with a **synchronous create-time check** on the write path (genuine gate here,
  unlike post-hoc sandbox compute).
- [ ] Provider/scope toggle + `is_ee()` gating on the reconcile job, mirroring
  Phase 1.
- [ ] Billing (defer until volume justifies): add
  `Gauge.BYTES.value: "storage"` to `REPORTS` + per-plan `"storage"`
  price. `report()` syncs gauges as absolute quantity (`Subscription.modify`) —
  no change.
- [ ] Retention (later): a sweep deleting old mount data emits negative deltas;
  the reconcile corrects drift.
- [ ] Acceptance: write then delete the same bytes returns the gauge to its prior
  level; reconcile corrects an injected drift; a write past the cap is rejected.

### Open questions to resolve before Phase 3/4 build

- [x] Record unit: **count + max-size cap** (decided — spans model). Not bytes.
- [ ] Exact per-record size cap value, and whether an existing records-path size
  guard already provides it (Phase 3).
- [ ] Storage gauge scope: org-only vs org+project (Phase 4).
- [ ] Authoritative S3 size source (CloudWatch vs Storage Lens vs list-sum) and
  its latency/cost vs reconcile frequency.
- [ ] Per-GiB price + free-tier GiB per plan (defer-billing decision).

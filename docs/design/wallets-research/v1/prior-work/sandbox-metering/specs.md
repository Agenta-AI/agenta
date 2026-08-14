# Sandbox Metering & Entitlements — Design Spec

Status: draft. Phase 0 (stop billing users) is a tiny standalone change, already
applied. Phase 1 (metering) specified for build; Phase 2 (entitlements & gating)
specified at design depth; Phases 3–4 (transcript-records metering, S3/SeaweedFS
storage gauge) sketched at concept depth, to be refined before implementation.

Branch: `feat/add-sandbox-metering`. Base: `big-agents` (same base as the
`chore/add-sandbox-*` and `chore/add-harness-*` worktrees).

This spec covers sandbox compute (Phases 1–2). It then extends the *same*
metering machinery to two adjacent session-storage dimensions:

- **Phase 3 — records.** Per-session **records** (the lines of a session
  transcript). Today they have a retention policy but are **not metered or
  billed**. Phase 3 adds a counter + billing, mirroring spans exactly: a **max
  record size** cap, then **meter per-record count**, price set for typical size.
  (The transcripts→records rename is separate work that lands before Phase 3 —
  see §6.)
- **Phase 4 — S3 / SeaweedFS storage.** Session mounts (S3 in prod, SeaweedFS
  local) accrue durable bytes per org/project. Phase 4 meters stored size as a
  **gauge** (a level, not a counter) and adds caps + later retention.

> [!NOTE]
> Naming: what the code calls *transcripts* is really the per-session container;
> its lines are **transcript records** (events). Phase 3 names the meter for the
> records, not the container.

---

## 1. Overview

We run user **sessions** inside ephemeral cloud sandboxes (E2B, Daytona; also
local/Modal). Each live sandbox consumes billable resources. This feature
ingests per-sandbox resource consumption into the EE meter store and (Phase 2)
gates sandbox usage through the existing entitlements machinery — so sandbox
usage behaves like traces: a free tier per plan, soft overage billing on paid
plans, hard blocks where configured.

Two providers, **two ingestion mechanisms, one sink**:

| Provider | Mechanism | Direction | Trigger |
|---|---|---|---|
| **E2B** | Lifecycle **webhook** | push (E2B → us) | `created` / `paused` / `resumed` / `killed` |
| **Daytona** | Analytics **usage API** | pull (us → Daytona) | periodic poll job |

Both normalize to the same base meters and write through the **same**
`MetersService.adjust()` / `check_entitlements()` path that traces use. Each
path is gated on a provider toggle **and** `is_ee()`; neither runs when its
provider is off.

> [!IMPORTANT]
> Billing is on **allocation × wall-clock-alive-time**, not on actual CPU
> utilization. An idle-but-alive sandbox still bills. Do **not** meter from
> E2B's `getMetrics()` (5s utilization samples) — that is observability only.

---

## 2. Dimensions & degrees of freedom

Sandbox usage is **not one variable**. There are **three independent base
meters** (four with GPU), each a `rate × duration` integral over the sandbox's
billable window:

| Base meter (new `Counter`) | Unit | E2B rate | Daytona rate |
|---|---|---|---|
| `sandbox_vcpu_seconds` | vCPU·s | $0.000014/s | $0.000014/s |
| `sandbox_ram_gib_seconds` | GiB·s | $0.0000045/s | $0.0000045/s |
| `sandbox_disk_gib_seconds` | GiB·s | (paused-only storage) | $0.00000003/s (5 GiB free) |
| `sandbox_gpu_seconds` *(optional, Daytona)* | GPU·s | n/a | per-GPU rate |

Dollar price is a **derived** linear combination of these with per-region rate
constants — we store the **physical resource-seconds** (rate-stable,
re-priceable), not the vendor's dollar figure. Both vendors return raw
resource-seconds, so this is always available.

**Billable-window semantics differ per provider** and must be encoded per
provider, not assumed:

- **Daytona** bills the full *alive* window (running **and** stopped — disk
  persists while stopped). The poll returns cumulative resource-seconds for the
  window; we don't reconstruct the window ourselves.
- **E2B** stops **compute** billing the instant a sandbox is `paused` / `killed`
  / times out; only **storage** accrues while paused. We therefore **must**
  process `paused`/`resumed` to close and reopen compute windows, or a
  paused-mid-life session over-bills. A `created`→`killed` pair alone is wrong
  for any paused session.

---

## 3. How this mirrors the existing meter/entitlements machinery

The EE billing stack already implements exactly the shape we need. We are
**adding new keys**, not new mechanism.

### 3.1 The taxonomy (`api/ee/src/core/access/entitlements/types.py`)

- `Counter` — monotonic metered usage (`traces_ingested`, `evaluations_run`,
  `credits_consumed`, `events_ingested`). **Sandbox resource-seconds are
  counters.**
- `Quota(free, limit, strict, retention, scope, period)`:
  - `free` — free-tier allowance for the period.
  - `limit` — the cap value the predicate compares against.
  - `strict=True` → **HARD** limit (block at the cap). `strict` falsey →
    **SOFT** limit (allow overshoot, bill the overage). `limit=None` →
    unlimited.
  - `period` — `MONTHLY` for our counters (billing-period accumulation).
- `REPORTS: dict[str, str]` — the "reportable to Stripe" set. A meter is synced
  to Stripe **iff** its key is in `REPORTS`; the value is the Stripe-side meter
  name. Today only `traces` and `users`. **Each sandbox meter we want billed
  must be added here** with its Stripe meter slug.
- `DEFAULT_ENTITLEMENTS[plan][Tracker.COUNTERS][counter] = Quota(...)` — this is
  the **per-plan tiering table**. Tracing's real example, which sandbox meters
  copy:
  - Hobby: `Quota(free=5_000, limit=5_000, ...)` — capped at free tier (no
    overage path; effectively blocked past free).
  - Pro: `Quota(free=10_000, ...)` — free tier then **soft** (no `limit`/`strict`
    → unlimited overage, billed).
  - Business: `Quota(free=1_000_000, ...)` — bigger free tier, soft overage.

This is precisely the "free tier + blocked-in-free, free tier + priced-overage
in Pro, bigger tier + different price in Business" model requested.

### 3.2 The meter store (`api/ee/src/core/meters/`, `api/ee/src/dbs/postgres/meters/`)

- `Meters` enum (`core/meters/types.py`) mirrors the `Counter`/`Gauge` slugs —
  **add the four sandbox counters here too.**
- `MeterScope` = `(organization_id [→ workspace → project → user])`; hierarchy
  enforced. We meter at **org** scope (with project for attribution).
- `MetersDAO.adjust(meter, quota, anchor)` — atomic upsert that increments
  `value += delta`, applies the quota predicate, returns `(allowed, meter,
  commit_callable)`. Primary key `(organization_id, key, year, month)`;
  `value` = accumulated, `synced` = last reported to Stripe.
- `MetersService.report()` — the Stripe sync job. Counters report
  `delta = value − synced` via `stripe.billing.MeterEvent.create(...)`
  (deduplicated by a deterministic `identifier`); gauges set absolute quantity
  via `Subscription.modify`. Sandbox counters ride the **counter** path
  unchanged.

### 3.3 The entitlement entry point (`api/ee/src/core/access/entitlements/service.py`)

`check_entitlements(*, key, delta, cache, scope, period)` is the single call:

- `cache=True` → **Layer 1** soft-check: Redis-cached read, **never writes DB**,
  mirrors `adjust()`'s strict/non-strict predicate so it's never stricter than
  Layer 2.
- `cache=False` → **Layer 2**: atomic `adjust()` in DB, writes the meter,
  refreshes/invalidates the Layer-1 cache.
- `delta` is the increment. **Sandbox ingestion is just
  `check_entitlements(key=Counter.SANDBOX_*_SECONDS, delta=<resource_seconds>,
  cache=False, scope=<org scope>)`** — same call traces use, different key and a
  larger delta.
- Fails **open** on any non-config error (a meter glitch never blocks a
  request).

So **Phase 1 ingestion = compute resource-seconds, then call `adjust()` (or
`check_entitlements(cache=False)`) per provider event/poll-row.** No new billing
mechanism is introduced.

---

## 3b. Phase 0 — Stop billing users (standalone, applied)

A tiny, self-contained change that ships independently of the sandbox work. We
**keep metering users** (the `Gauge.USERS` meter and its `delta=±1` adjusts on
org add/remove stay), but we **stop billing** them and **remove the cap except on
free**. Three edits, all in `api/ee/src/core/access/entitlements/types.py`:

1. **Stop billing:** drop `Gauge.USERS.value: "users"` from `REPORTS`. Because
   `REPORTS` membership is the "reportable to Stripe" set, removing it means
   `report()` skips users (it already skips-and-flushes any key not in `REPORTS`
   — no error, existing user meters just stop syncing). The gauge keeps
   incrementing in the DB; it's tracked, not invoiced.
2. **Remove the cap except on free:** only **Pro** still had a paid cap
   (`free=3, limit=10, strict=True`) → reduced to `Quota(strict=True)`
   (`limit=None` ⇒ unlimited, per the `check_entitlements` predicate). Business /
   Agenta-AI / Self-Hosted-Enterprise were already `Quota(strict=True)` with no
   limit (uncapped). **Hobby (free) is unchanged** — it keeps `free=2, limit=2,
   strict=True`.
3. No change to call sites, `Meters`, or `CONSTRAINTS` — the gauge is still
   adjusted exactly as before.

Net effect: user count is still observable per org (and still capped on the free
plan), but no longer a Stripe line item and no longer a hard ceiling on paid
plans.

---

## 4. Phase 1 — Metering (build target)

Goal: sandbox resource-seconds land in the meter store accurately for both
providers, gated per provider, with **no gating behavior yet** (record only).

### 4.1 New domain

Follow the standard domain shape (`api/AGENTS.md`): a `sandboxes` (or
`sandbox_metering`) domain under `apis/fastapi/`, `core/`, `dbs/postgres/`.
EE-only billing logic stays in `api/ee/src/...`; the webhook receiver route may
live in OSS (like the Composio receiver) with an `is_ee()`-guarded import for
the meter write.

New enum members (additive — no migration of existing rows):
- `Counter.SANDBOX_VCPU_SECONDS = "sandbox_vcpu_seconds"`
- `Counter.SANDBOX_RAM_GIB_SECONDS = "sandbox_ram_gib_seconds"`
- `Counter.SANDBOX_DISK_GIB_SECONDS = "sandbox_disk_gib_seconds"`
- (`Counter.SANDBOX_GPU_SECONDS` optional)
- Same four mirrored into `Meters`.
- `DEFAULT_ENTITLEMENTS`: add a `Quota(...)` for each, **per plan** (Phase 1 may
  set them all unlimited/soft — `Quota(period=Period.MONTHLY)` — so nothing
  blocks; Phase 2 sets the real free tiers).

### 4.2 E2B ingestion — webhook (push)

E2B's model is the **inverse of Composio's**. With Composio, *Composio*
generates one signing secret per project and we **fetch** it (idempotent
`GET/POST /webhook_subscriptions`), cache it encrypted in Redis (TTL 1h,
auto-refresh), and all containers share it via Redis — no leader. With E2B, **we
provide the secret** at registration (`POST https://api.e2b.app/events/webhooks`
with `{name, url, enabled, events[], signature_secret}`).

Decision (mirrors the user's instinct and the Composio storage pattern):

- **Leader-generate once, store like a fetched secret.** At startup, if E2B is
  enabled, one container generates a 32-byte secret **iff** not already present,
  using a Redis `SET NX` guard so concurrent containers don't race; the winner
  registers the webhook with E2B and writes the encrypted secret to the same
  Redis namespace pattern the Composio resolver uses
  (`encrypt(secret)`, decrypt on read). Losers read the winner's secret from
  Redis. Net effect: identical to "store it as if it were the response from
  Composio," so every API container verifies with the same secret.
- **Idempotent registration:** `GET /events/webhooks` first; create only if our
  callback URL isn't already registered (reconcile, don't duplicate). Mirror
  `ComposioTriggersAdapter.ensure_webhook_subscription()`'s
  check-then-create-with-conflict-arbitration.
- **Startup hook:** register in the FastAPI `lifespan()` in
  `api/entrypoints/routers.py`, guarded `if env.e2b.enabled:` and best-effort
  (log on failure, don't block startup) — same shape as the Composio block.

Receiver:
- Route `POST /webhooks/e2b/events/` (public, unauthenticated, mirrors the
  Composio/Stripe receiver). Verify `sha256(secret + raw_body)` base64 against
  the `e2b-signature` header (use the **raw** body). Dedupe on
  `e2b-delivery-id`. Ack fast (202), enqueue to the async broker, do meter work
  off the request path.
  > [!WARNING]
  > E2B has a documented docs-vs-actual mismatch on header names / signature
  > formatting (github e2b-dev/e2b #1103). Per the "diagnostics over
  > introspection" rule: log the first real deliveries (headers + computed vs
  > received signature) and pin the verifier to observed behavior, not the docs.

Meter math (per event):
- On `killed`/`paused`, payload carries `start_timestamp`, `vCPU`, `memory_mb`,
  `duration_ms`. Compute `vcpu_seconds = vCPU × duration_ms/1000`,
  `ram_gib_seconds = (memory_mb/1024) × duration_ms/1000`. Accumulate via
  `adjust(delta=...)`.
- On `paused` close the compute window; on `resumed` open a new one. Storage
  during pause (if billed) accrues to `sandbox_disk_gib_seconds`.
- **Idempotency:** events are incremental → accumulate, dedupe on
  `e2b-delivery-id` to survive E2B retries.

### 4.3 Daytona ingestion — poll (pull)

- Auth: org-scoped API key as `Authorization: Bearer` **plus** the mandatory
  `X-Daytona-Organization-ID` header.
- Scheduled job (gated `if env.daytona.enabled and is_ee():`) calls, per
  Agenta org that maps to a Daytona org, with `from = period_start, to = now`:
  - `GET /organization/{org}/usage/aggregated` → period rollup
    (`totalCPUSeconds`, `totalRAMGBSeconds`, `totalDiskGBSeconds`,
    `totalGPUSeconds`, `totalPrice`, `sandboxCount`).
  - `GET /organization/{org}/usage/sandbox` → per-sandbox breakdown for
    project/session attribution (optional in Phase 1).
- **Idempotency:** the poll returns **cumulative** totals for the window → write
  with **set semantics** (overwrite the period's value to the authoritative
  total), which is naturally idempotent and self-healing across missed/duplicate
  runs. (Contrast: E2B accumulates.) This needs either a small extension to the
  meter write to support "set to absolute" vs "increment by delta", or we
  compute `delta = authoritative_total − current_value` and feed that to
  `adjust()`. Prefer the delta approach to reuse `adjust()` unchanged.
- **Job scheduling / lock:** reuse the existing singleton-job lock pattern
  (Redis lock + TTL, self-healing on crash) used by `report()` so only one
  worker polls per interval.

### 4.4 Provider toggles & local dev

- Env config in `api/oss/src/utils/env.py` (per `api/CLAUDE.md` — never
  `os.getenv` in feature code). Two new config blocks with an `enabled`
  property that is true only when required vars are present (mirror
  `AIServicesConfig.enabled`):
  - `E2BConfig`: `api_key`, optional `webhook_url` override, `enabled`.
  - `DaytonaConfig`: `api_key`, `organization_id`/mapping, `api_url`, `enabled`.
- Every ingestion entry point is double-gated: provider `.enabled` **and**
  `is_ee()`.

**Local-dev bridge — E2B genuinely needs a public URL; Composio does not.** The
Composio "tunnel" is **not ngrok** — it's a WebSocket bridge
(`api/entrypoints/dispatcher_composio.py`) that subscribes to Composio's
WebSocket and forwards events to the in-network API. E2B has **no** WebSocket
subscribe API; it only HTTP-pushes to a public URL. So for E2B local dev we need
the **inverse**: an **ngrok-style public tunnel** that exposes the local API's
`/webhooks/e2b/events/` and a registration that points E2B at that public URL.

- Add an `e2b-bridge` (or `e2b-tunnel`) docker-compose service under the
  `with-tunnel` profile in the `ee` + `oss` dev compose files, placed after the
  `triggers-bridge`/`composio` service. For E2B this service runs **ngrok**
  (not a WS dispatcher), and the public URL it mints is fed to startup
  registration as the E2B `webhook_url` override (`env.e2b.webhook_url`). Add a
  `run.sh` flag to toggle it independently (`--e2b-tunnel` / off by default), so
  it only starts when E2B is being exercised locally.

---

## 5. Phase 2 — Entitlements & gating (design depth)

Once meters are populated, gate sandbox usage like traces. No new mechanism —
set the per-plan `Quota` table and wire the checks.

### 5.1 Per-plan tiers (`DEFAULT_ENTITLEMENTS`)

Replace the Phase-1 unlimited quotas with real tiers per base meter, e.g.
(numbers TBD by pricing):
- **Hobby**: small free allowance, **hard** (`strict=True`, `limit=free`) — no
  paid sandbox usage on free.
- **Pro**: larger free allowance, then **soft** overage (no `limit`/`strict`),
  billed via Stripe.
- **Business**: bigger free allowance, soft overage, possibly different Stripe
  price.
- Self-hosted / enterprise: unlimited.

Add each billed meter to `REPORTS` with its Stripe meter slug, and register the
corresponding Stripe prices per plan (the `get_stripe_meter_price(plan, name)`
path `report()` already uses).

### 5.2 Two-layer gating, adapted to post-hoc usage

Tracing checks at ingestion. Sandbox usage is **post-hoc** — the authoritative
resource-seconds only arrive on E2B `kill`/`pause` or the next Daytona poll. So
the two layers map to **lifecycle moments**, not a single request:

- **Layer 1 — create-time soft pre-check** (the real gatekeeping lever): before
  launching a sandbox, `check_entitlements(key=..., cache=True)` against the
  current meter; refuse to spin one up if the org is already over quota. To
  account for in-flight cost, estimate live accrual
  (`allocated_vcpu × elapsed + …`) and add it to the cached value for the
  decision.
- **Layer 2 — post-hoc true-up**: the webhook/poll `adjust(cache=False)` writes
  the authoritative value and reconciles the cache.

> [!IMPORTANT]
> Keep **permissions** separate from **entitlements**. RBAC (`RUN_SESSIONS`)
> answers "may this user run a sandbox"; entitlements answer "does this org have
> sandbox quota left." Do not gate one through the other.

### 5.3 Mid-session enforcement (hardest part, scope-flag it)

Create-time gating is cheap and is the recommended default. Killing an
**in-flight** over-quota session requires the sandbox **kill** API wired to the
entitlement breach — which ties into the missing-user-kill gap already noted for
sessions (`DELETE /sessions/streams/{id}` + runner `/kill`). Recommend Phase 2a
= create-time gating only; Phase 2b = mid-session kill, dependent on the kill
endpoint landing.

---

## 5b. Where each existing metered-ish thing stands (the map this builds on)

Before Phases 3–4, the lay of the land in the meter taxonomy today:

| Thing | Tracked? | Metered? | Billed (`REPORTS`)? | Retention? | Family |
| --- | --- | --- | --- | --- | --- |
| **Spans / traces** | yes | yes (`traces_ingested`) | **yes** (`"traces"`) | per-plan `Retention` | Counter |
| **Events** (internal) | yes | yes (`events_ingested`) | **no** (not in `REPORTS`) | per-plan `Retention` | Counter |
| **Records** (transcript lines) | yes (records persisted) | **no** | no | retention only (today) | — (Phase 3 adds Counter, count + max-size cap) |
| **Users** | yes | yes (`users`) | **no** (Phase 0 dropped from `REPORTS`; capped on free only) | n/a | Gauge |
| **Sandbox compute** | — | Phase 1 | Phase 2 | n/a | Counter ×3 |
| **S3 / SeaweedFS storage** | — | Phase 4 | Phase 4 | later | **Gauge** (Phase 4) |

The pattern to copy is explicit: **events** show a counter that is metered for
*retention sizing* but deliberately **absent from `REPORTS`** (tracked, not
billed). **traces** show the full metered+billed counter. **users** show the
only existing **gauge** (a level, Stripe-synced as absolute quantity). Phase 3 =
"make transcript records like traces." Phase 4 = "make storage like users
(a gauge), but org/project-scoped and capped."

---

## 6 (Phase 3). Records metering & billing

Goal: per-session **records** become a first-class metered, billable counter,
**exactly like spans** — free tier per plan, soft overage on paid plans,
retention per plan.

> [!IMPORTANT]
> **The transcripts→records rename is NOT part of Phase 3.** It lands separately
> (another branch merged/rebased into this one before Phase 3 starts). Phase 3
> assumes the domain is already named `records` and only adds the **metering +
> billing** on top. Do not do any renaming here.

**Unit decision — count, with a max-size cap (the spans model, decided).**
Meter **per record (count)**, not bytes — this is precisely what spans do, and
it's the right call:

- Spans already meter by **count of root spans**:
  `delta = sum(1 for span in spans if span.parent_id is None)`
  (`api/oss/src/apis/fastapi/otlp/router.py`), not by byte size.
- That works because each unit is **size-bounded**: the OTLP ingest enforces a
  max payload (`MAX_OTLP_BATCH_SIZE = env.agenta.otlp.max_batch_bytes`, `413`
  past the cap) plus per-worker byte limits. A bounded unit makes per-count
  billing fair; the **per-record price is set to reflect the typical record
  size** rather than billing raw bytes.
- So records do the same: **enforce a max record size** (cap, reject/refuse
  oversize like the OTLP `413`), then **meter `delta = count of records`**, and
  modulate the per-record price for typical size. Byte-level metering is
  reserved for genuine *storage* (Phase 4 gauge), not records.

This is the most mechanical phase: the spans pattern with a new key. No new
ingestion mechanism, no provider integration.

- **Max record size:** confirm/define the per-record size cap (analogue of the
  OTLP batch/span byte limit). If the records ingest path already has a size
  guard, reuse it; otherwise add one (`env`-configured, reject oversize at the
  edge). This bound is what makes per-count billing fair.
- **New counter:** `Counter.RECORDS_INGESTED = "records_ingested"`. Mirror into
  `Meters`. (Assumes the records domain already exists post-rename — Phase 3 only
  adds the meter key, not the domain.)
- **Per-plan `Quota`:** add to every plan in `DEFAULT_ENTITLEMENTS` with a
  `free` tier + `period=MONTHLY` + a `retention=Retention.*` matching the plan
  (Hobby `MONTHLY`, Pro `QUARTERLY`, Business `YEARLY`) — same shape traces use.
  The `retention` field is what already drives record retention; it becomes the
  *single* source for both the retention window and the metered allowance.
- **Ingestion call site:** wherever records are persisted (the sessions/records
  worker), add the same two-layer pair traces use:
  `check_entitlements(key=Counter.RECORDS_INGESTED, delta=<n_records>,
  cache=True)` at the request edge and `cache=False` in the persisting worker.
  Delta = number of records in the batch (one per record, mirroring the
  count-root-spans delta).
- **Billing:** add `Counter.RECORDS_INGESTED.value: "records"` to `REPORTS`, and
  the per-plan Stripe price under a `"records"` slot in `AGENTA_BILLING_PRICING`.
  `report()` syncs it as a counter MeterEvent unchanged. Price-per-record chosen
  to absorb the typical record size.
- **Retention** continues to be driven by the `Quota.retention` field as today;
  Phase 3 does not change the retention sweep, it just also bills.

---

## 7 (Phase 4). S3 / SeaweedFS mount storage — a gauge, not a counter

Goal: meter durable bytes stored under session mounts (S3 in prod, SeaweedFS
local), per org and per project, and add caps. Billing later; retention later.

**This one is structurally different from every phase above: it is a GAUGE.**
Counters accumulate monotonically over a billing period and reset; a gauge is a
**level** — the current total size of stored data, which goes up on write and
**down on delete**. The only existing gauge is `Gauge.USERS`, and it is the
template:

- **New gauge:** `Gauge.BYTES = "bytes"` (mirror into `Meters`).
  Consider a second gauge keyed at project scope if per-project caps are needed
  (`MeterScope` already supports `project_id` under `organization_id`).
- **Delta semantics:** adjust the gauge by **signed delta** the same way USERS
  does (`check_entitlements(key=Gauge.BYTES, delta=+bytes)` on write,
  `delta=-bytes` on delete). The meter `value` is the live total. Stripe sync
  (`report()`) already treats gauges as **absolute quantity** via
  `Subscription.modify` — correct for "current GB stored."
- **Source of truth for size:** do **not** trust per-operation deltas alone to
  stay consistent forever (drift on crashes/aborted multipart). Pair the
  incremental deltas with a **periodic reconcile** that reads authoritative
  usage from the backend and *sets* the gauge:
  - **S3:** CloudWatch `BucketSizeBytes` per bucket, or S3 Storage Lens, or a
    prefix-scoped `ListObjectsV2` size sum per `org/project` prefix.
  - **SeaweedFS (local):** filer/volume size APIs or a `du`-equivalent over the
    org/project prefix.
  This mirrors the sandbox **poll** idea (Daytona): authoritative absolute value
  on a schedule, reconciled into the gauge as `delta = authoritative − current`.
- **Scoping:** key bytes by `org/project` prefix in the mount layout so the
  reconcile and the meter scope line up (`MeterScope(organization_id,
  workspace_id, project_id)`). The mount path convention must encode org+project
  so size is attributable without per-file bookkeeping.
- **Caps (the point of Phase 4):** a storage gauge with `Quota(free=<GiB>,
  limit=<GiB>, strict=True)` per plan blocks new writes past the cap. Because the
  write path is synchronous, the **create-time soft pre-check** is a genuine
  gate here (unlike sandbox compute's post-hoc cost): check the gauge before
  accepting an upload.
- **Billing:** negligible per-GiB early; defer `REPORTS`/Stripe until volume
  justifies it. Add `Gauge.BYTES.value: "storage"` to `REPORTS` + a
  per-plan `"storage"` price when ready — no mechanism change.
- **Retention:** later. A retention sweep that deletes old mount data simply
  emits negative deltas (and the periodic reconcile corrects any drift).

> [!IMPORTANT]
> Gauge vs counter is the load-bearing distinction. Storage is the *amount held
> right now*; sandbox-seconds and transcript-records are *amounts consumed this
> period*. Modeling storage as a counter would never decrement on delete and
> would bill cumulative writes instead of held size — wrong. Use the gauge path.

---

## 8. Open questions

1. **Daytona org mapping:** how does an Agenta org resolve to a Daytona
   organization id for the poll? One shared Daytona org for the platform, or one
   per tenant? Determines whether `/usage/sandbox` attribution is required in
   Phase 1.
2. **Absolute-set vs delta for the poll:** confirm the `delta = total − current`
   approach reuses `adjust()` cleanly across month boundaries (the cumulative
   window must be clamped to the billing period, using the same anchor logic).
3. **Disk while paused (E2B):** confirm whether we bill E2B paused-storage at
   all in v1, or defer it (compute-only first).
4. **GPU:** include `sandbox_gpu_seconds` now or defer until a GPU sandbox SKU
   exists?
5. **Stripe meter slugs & prices:** exact `REPORTS` names and per-plan price ids
   (Phase 2, pricing-owned).

---

## 7. References (code, this worktree)

- Entitlement types / plan tiers / `REPORTS`:
  `api/ee/src/core/access/entitlements/types.py`
- Entitlement entry point (two-layer):
  `api/ee/src/core/access/entitlements/service.py` (`check_entitlements`)
- Meter store: `api/ee/src/core/meters/{service,types}.py`,
  `api/ee/src/dbs/postgres/meters/dao.py`
- Stripe sync job: `MetersService.report()` in
  `api/ee/src/core/meters/service.py`
- Composio receiver / secret resolver (the pattern E2B inverts):
  `api/oss/src/apis/fastapi/triggers/router.py`,
  `api/oss/src/core/triggers/{service,utils}.py`,
  `api/oss/src/core/triggers/providers/composio/adapter.py`
- Composio startup registration: `lifespan()` in `api/entrypoints/routers.py`
- Local-dev bridge (WebSocket, not ngrok):
  `api/entrypoints/dispatcher_composio.py`; compose `with-tunnel` profile
- Env/provider-toggle pattern: `api/oss/src/utils/env.py` (`*.enabled`)

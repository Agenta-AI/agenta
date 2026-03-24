# Research: EE Architecture for Self-Hosting

This document captures a detailed analysis of how the current EE codebase handles plans, entitlements, billing, org lifecycle, RBAC, and metering. It is intended as a reference for designing the self-hosted EE experience.

---

## Table of Contents

1. [Data Model Overview](#1-data-model-overview)
2. [EE Extension Mechanism](#2-ee-extension-mechanism)
3. [Plans](#3-plans)
4. [Entitlements](#4-entitlements)
5. [Entitlement Resolution Flow](#5-entitlement-resolution-flow)
6. [Subscriptions](#6-subscriptions)
7. [Reverse Trial](#7-reverse-trial)
8. [Meters & Usage](#8-meters--usage)
9. [Throttling](#9-throttling)
10. [Billing API Surface](#10-billing-api-surface)
11. [Frontend Billing & Feature Gating](#11-frontend-billing--feature-gating)
12. [Organization Lifecycle](#12-organization-lifecycle)
13. [Organization Flags vs Plan Entitlements](#13-organization-flags-vs-plan-entitlements)
14. [RBAC & Permissions](#14-rbac--permissions)
15. [Env Vars & Config](#15-env-vars--config)
16. [Gaps for Self-Hosted EE](#16-gaps-for-self-hosted-ee)

---

## 1. Data Model Overview

Before diving into individual subsystems, it helps to understand how the key concepts relate to each other. These are frequently confused because they have overlapping names.

### The core chain

```
Organization ──FK──→ Subscription (DB row) ──has──→ Plan (string field)
                                                        ↓ (runtime lookup)
                                                  ENTITLEMENTS[plan] → capabilities
```

An **Organization** has exactly one **Subscription** (DB row keyed by `organization_id`). The subscription stores a **Plan** (a string like `cloud_v0_pro`). At runtime, the plan string is used to look up **Entitlements** from an in-memory Python dict.

### Four things that look similar but are different

| Concept | What it is | Where it lives | What uses it |
|---------|-----------|----------------|-------------|
| **Plan** | A string name (e.g., `cloud_v0_pro`) | `Plan` enum in `subscriptions/types.py` | Key that connects subscription → entitlements |
| **ENTITLEMENTS** | Dict mapping Plan → capabilities (flags, quotas, throttles) | `entitlements/types.py` | Runtime enforcement engine (`check_entitlements()`) |
| **CATALOG** | List of display objects (title, price, feature bullets) | `entitlements/types.py` | `GET /billing/plans` → frontend pricing page. Purely presentation, no enforcement role. |
| **STRIPE_PRICING** | JSON mapping Plan → Stripe price IDs | `STRIPE_PRICING` env var | Stripe API calls only (checkout, subscription creation). Tells Stripe what to charge. |

The flow between them:

```
CATALOG          → Frontend shows plan options to user (display only)
STRIPE_PRICING   → Stripe knows what to charge (billing only)
Plan (string)    → Stored on subscription row in DB (the bridge)
ENTITLEMENTS     → Runtime looks up capabilities by plan (enforcement)
```

### What is tied to the org — plan or entitlement?

The **plan** is tied to the organization via the subscription row. Entitlements are derived from the plan at runtime. There is no per-org entitlement override — every org on the same plan gets the same capabilities.

### Subscription table: two masters, no dependency between them

The subscription table serves both the entitlement engine and Stripe, but they don't depend on each other:

```
subscription row:
  organization_id  ← links to org (FK)
  plan             ← LOCAL: used by entitlement engine
  active           ← LOCAL: subscription active flag
  anchor           ← LOCAL: billing cycle day (for metering periods)
  customer_id      ← STRIPE: nullable, only set if Stripe is enabled
  subscription_id  ← STRIPE: nullable, only set if Stripe is enabled
```

The entitlement engine only reads `plan` and `anchor`. It never reads `customer_id` or `subscription_id`. Stripe only uses `customer_id` and `subscription_id` for its own operations. Removing Stripe does not break entitlements — as long as a subscription row exists with a valid plan.

### Can you have entitlements and meters without Stripe?

**Yes.** The entitlement engine resolves from: subscription row (local DB) → ENTITLEMENTS dict (in-memory) → meters table (local DB). Stripe is only used for two things: charging money and syncing usage for billing reports. The enforcement pipeline is fully local.

### Can you have entitlements without a subscription row?

**No.** `check_entitlements()` raises `EntitlementsException("No subscription found")` if there is no subscription row for the org. Every org must have a subscription record or all entitlement-gated operations fail (trace ingestion, app creation, user invitations, RBAC checks, etc.).

### What does "define entitlements in env vars" mean?

There are two levels:
- **Level 1 (simpler)**: Define which plan new orgs get via env var (e.g., `AGENTA_DEFAULT_PLAN=cloud_v0_business`). The ENTITLEMENTS dict already has capabilities for that plan — no new definitions needed.
- **Level 2 (more flexible)**: Define custom capability sets via env/config, decoupled from the existing cloud plan names. This requires extending the ENTITLEMENTS dict or introducing an override mechanism.

---

## 2. EE Extension Mechanism

### How EE hooks into OSS

The composition happens in `api/entrypoints/routers.py`. There is a single binary toggle:

```python
# api/oss/src/utils/env.py, line 10
_LICENSE = "ee" if os.getenv("AGENTA_LICENSE") == "ee" else "oss"
```

This drives `is_ee()` / `is_oss()` which are used throughout the codebase. **There is no `is_cloud()` function** — the system only distinguishes OSS vs EE, not cloud vs self-hosted.

EE extends OSS in four ways:

1. **Throttling middleware** — added before auth middleware, rate-limits all requests per org/plan
2. **`extend_main(app)`** — mounts billing, org, workspace, and auth routes
3. **`extend_app_schema(app)`** — modifies OpenAPI metadata (hardcodes `servers` to `cloud.agenta.ai`)
4. **~447 inline `is_ee()` guards** scattered across OSS code for RBAC checks and entitlement enforcement

### EE folder structure

```
api/ee/src/
├── main.py                          # extend_main(), extend_app_schema()
├── apis/fastapi/
│   ├── billing/router.py            # Stripe checkout, portal, plans, subscriptions, usage
│   └── organizations/router.py      # Domains, SSO providers
├── core/
│   ├── entitlements/
│   │   ├── service.py               # enforce/check quota violations
│   │   └── types.py                 # ENTITLEMENTS dict, CATALOG, plans, flags, counters, gauges, throttles
│   ├── meters/
│   │   ├── service.py               # adjust, check, fetch, report meters
│   │   └── types.py                 # MeterDTO
│   ├── organizations/
│   │   └── exceptions.py            # OrganizationError hierarchy
│   ├── subscriptions/
│   │   ├── service.py               # create, read, update, reverse trial, free plan, Stripe events
│   │   └── types.py                 # Plan enum, Event enum, SubscriptionDTO
│   └── tracing/
│       └── service.py               # flush_spans (retention enforcement)
├── crons/
│   ├── meters.sh / meters.txt       # Cron: POST /admin/billing/usage/report
│   └── spans.sh / spans.txt         # Cron: POST /admin/billing/usage/flush
├── dbs/postgres/
│   ├── meters/                      # Meter DB entities + DAO
│   ├── organizations/               # SSO providers DAO
│   ├── subscriptions/               # Subscription DB entities + DAO
│   └── tracing/                     # Retention DAO
├── models/
│   ├── db_models.py                 # OrganizationMemberDB, WorkspaceMemberDB, ProjectMemberDB
│   └── shared_models.py             # WorkspaceRole enum, Permission enum
├── routers/                         # Legacy org/workspace routers
├── services/
│   ├── commoners.py                 # create_accounts, create_organization_with_subscription
│   ├── db_manager_ee.py             # create_organization, add_user_to_*
│   ├── throttling_service.py        # HTTP middleware for per-org rate limiting
│   └── workspace_manager.py         # Invitation flow
└── utils/
    ├── entitlements.py              # check_entitlements() — central entitlement checker
    ├── billing.py                   # compute_billing_period
    └── permissions.py               # RBAC: check_action_access, check_rbac_permission
```

### Key files

| Concern | File |
|---------|------|
| EE toggle | `api/oss/src/utils/env.py` (line 10) |
| EE extension entry | `api/ee/src/main.py` |
| App composition | `api/entrypoints/routers.py` |
| `is_ee()` / `is_oss()` | `api/oss/src/utils/common.py` (via `env`) |

---

## 3. Plans

A plan is just a **string name** — the key that connects a subscription to its entitlements. Plans are a **hardcoded Python `str` enum** in `api/ee/src/core/subscriptions/types.py`:

```python
class Plan(str, Enum):
    CLOUD_V0_HOBBY = "cloud_v0_hobby"
    CLOUD_V0_PRO = "cloud_v0_pro"
    CLOUD_V0_BUSINESS = "cloud_v0_business"
    CLOUD_V0_HUMANITY_LABS = "cloud_v0_humanity_labs"
    CLOUD_V0_X_LABS = "cloud_v0_x_labs"
    CLOUD_V0_AGENTA_AI = "cloud_v0_agenta_ai"

FREE_PLAN = Plan.CLOUD_V0_HOBBY       # comment says "Move to ENV FILE"
REVERSE_TRIAL_PLAN = Plan.CLOUD_V0_PRO # comment says "move to ENV FILE"
REVERSE_TRIAL_DAYS = 14                # comment says "move to ENV FILE"
```

There are 6 plans:
- 3 standard commercial tiers: **Hobby** (free), **Pro** ($49/mo), **Business** ($399/mo)
- 3 custom/internal plans: **Humanity Labs**, **X Labs**, **Agenta AI**

Plans are **not stored in a DB table** — they are entirely in code.

A `CATALOG` list in `api/ee/src/core/entitlements/types.py` (lines 136–295) defines the display data served to the frontend: title, description, pricing info, feature lists, retention periods. Custom plans are only shown if the org is currently on that plan.

Stripe product/pricing mappings are loaded from the `STRIPE_PRICING` env var (JSON) — this maps `Plan` values to Stripe price IDs. STRIPE_PRICING is only used for Stripe API calls (checkout, subscription creation). It plays no role in entitlement enforcement.

### How CATALOG, STRIPE_PRICING, ENTITLEMENTS, and Plan relate

```
Plan enum (string name)
   │
   ├──→ ENTITLEMENTS[plan]   → what the org CAN DO (enforcement)
   ├──→ CATALOG[plan]        → what the FRONTEND SHOWS (display)
   └──→ STRIPE_PRICING[plan] → what STRIPE CHARGES (billing)
```

These three mappings are independent. CATALOG and STRIPE_PRICING can be absent for a plan and entitlements still work. The custom plans (Humanity Labs, X Labs, Agenta AI) demonstrate this: they have ENTITLEMENTS entries but no STRIPE_PRICING entries and their CATALOG entries are minimal.

### Observations for self-hosting

- Plan names are all prefixed with `cloud_v0_` — cloud-specific branding
- Plans are hardcoded — no way to define custom plans without code changes
- The `FREE_PLAN` and `REVERSE_TRIAL_PLAN` constants have comments suggesting they should be in env vars but aren't
- There is no "enterprise self-hosted" plan — a self-hosted customer would need to either use one of the existing plans (awkward naming) or add a new one
- For self-hosted, CATALOG and STRIPE_PRICING are irrelevant. Only the Plan → ENTITLEMENTS mapping matters.

---

## 4. Entitlements

Entitlements are a **hardcoded dict** mapping `Plan` → capabilities, in `api/ee/src/core/entitlements/types.py` (the `ENTITLEMENTS` dict, lines 297–628).

Each plan's entitlements contain 4 tracker categories:

### Flags (boolean feature gates)

```python
class Flag(str, Enum):
    HOOKS = "hooks"       # Webhooks
    RBAC = "rbac"         # Role-based access control
    ACCESS = "access"     # Org flags/settings access
    DOMAINS = "domains"   # Domain verification
    SSO = "sso"           # Enterprise SSO
```

| Flag | Hobby | Pro | Business | Custom (e.g. Humanity Labs) |
|------|-------|-----|----------|----------------------------|
| HOOKS | False | True | True | True |
| RBAC | False | False | True | True |
| ACCESS | False | False | True | True |
| DOMAINS | False | False | True | True |
| SSO | False | False | True | True |

**Critical observation**: RBAC is only enabled on Business+ plans. On Hobby/Pro, when `Flag.RBAC` is `False`, the system **grants full access to all users** regardless of their role. This means role assignments are stored but not enforced. This is a cloud pricing lever, not an enterprise behavior — a self-hosted EE customer expects RBAC to always work.

### Counters (periodic usage limits, reset monthly)

```python
class Counter(str, Enum):
    TRACES = "traces"
    EVALUATIONS = "evaluations"
    EVALUATORS = "evaluators"
    ANNOTATIONS = "annotations"
    CREDITS = "credits"
```

Each counter has a `Quota` with: `limit` (hard cap, None = unlimited), `free` (included amount), `monthly` (resets each billing period), `strict` (block at limit vs allow current op), `retention` (data retention in minutes).

| Counter | Hobby | Pro | Business |
|---------|-------|-----|----------|
| Traces | 5,000/mo | unlimited (10k free) | unlimited (1M free) |
| Evaluations | 20/mo (strict) | unlimited (strict) | unlimited (strict) |
| Credits | 100/mo (strict) | 100/mo (strict) | 100/mo (strict) |

### Gauges (absolute resource limits)

```python
class Gauge(str, Enum):
    USERS = "users"
    APPLICATIONS = "applications"
```

| Gauge | Hobby | Pro | Business |
|-------|-------|-----|----------|
| Users | 2 (strict) | 10 (strict, 3 free) | unlimited |
| Applications | unlimited | unlimited | unlimited |

### Throttles (rate limiting)

Each plan defines `Throttle` objects with token-bucket parameters (`capacity`, `rate` in req/min). Categories: STANDARD, CORE_FAST, TRACING_FAST, AI_SERVICES, etc.

| Category | Hobby | Pro | Business |
|----------|-------|-----|----------|
| STANDARD | 480/min | 1,440/min | 3,600/min |
| CORE_FAST + TRACING_FAST | 1,200/min | 3,600/min | 36,000/min |
| CORE_SLOW + TRACING_SLOW | 120 cap, 1/min refill | 180 cap, 1/min | 1,800 cap, 1/min |
| AI_SERVICES | 10 cap, 30/min | 30 cap, 90/min | 300 cap, 900/min |

### Constraints

The `CONSTRAINTS` dict (lines 637–654) defines what is enforced when quota is exceeded:
- **BLOCKED**: flags HOOKS/RBAC, gauges USERS/APPLICATIONS
- **READ_ONLY**: counters TRACES/EVALUATIONS

### Observations for self-hosting

- The entitlement model is well-structured and could work for self-hosted if the plan assignment mechanism changes
- The custom plans (Humanity Labs, X Labs, Agenta AI) already demonstrate entitlements can exist without Stripe — they have full entitlements defined but no pricing/checkout
- A self-hosted EE customer would want something like the Business or custom plan entitlements: all flags true, generous or unlimited quotas
- Entitlements are per-plan, not per-org — there is no org-level override mechanism

---

## 5. Entitlement Resolution Flow

The central function is `check_entitlements()` in `api/ee/src/utils/entitlements.py`:

```python
async def check_entitlements(
    organization_id: UUID,
    key: Union[Flag, Counter, Gauge],
    delta: Optional[int] = None,
    use_cache: Optional[bool] = False,
) -> tuple[bool, Optional[MeterDTO], Optional[Callable]]:
```

### Resolution steps

1. **Parse key type** — determine if it's a Flag, Counter, or Gauge
2. **Load subscription** (cached in Redis under `entitlements:subscription` namespace, 24h TTL) — query `subscriptions` table on cache miss. This gives the org's `Plan` and billing `anchor` day.
3. **For Flags** — pure boolean lookup: `ENTITLEMENTS[plan][Tracker.FLAGS][flag]`. No DB write.
4. **For Counters/Gauges** — look up the `Quota`, compute current billing period.
5. **Soft check (Layer 1, `use_cache=True`)** — read from Redis cache, fall back to DB read. Compare `value + delta <= limit`. Never writes to DB.
6. **Hard check (Layer 2, `use_cache=False`)** — call `MetersService.adjust()` which does an **atomic PostgreSQL upsert** (`INSERT ... ON CONFLICT DO UPDATE ... WHERE value <= limit ... RETURNING value`). If the WHERE clause fails, the operation is rejected.

### Call sites

`check_entitlements` is called from:
- Route handlers: app creation/deletion, user invitation, OTLP trace ingestion, permissions verification
- Background workers: tracing worker (batch processing), events worker
- Evaluation tasks: counter adjustment on failure (delta=-1)
- RBAC checks: `Flag.RBAC` checked on every permission verification

### Dependency chain

The entitlement system requires a `subscription` row in the `subscriptions` table. Without it, `check_entitlements` raises `EntitlementsException("No subscription found")`. This means **every org must have a subscription record** or all entitlement-gated operations fail.

### Observations for self-hosting

- The resolution logic itself is clean and does not depend on Stripe
- The hard dependency on a `subscription` row is the real coupling point — not Stripe, but the subscription table
- For self-hosted, the subscription could be created with a fixed plan at org creation time
- The two-layer caching (Redis + Postgres) is solid and would work for self-hosted

---

## 6. Subscriptions

### Data model

The `subscriptions` table (PK = `organization_id`):

| Column | Type | Description |
|--------|------|-------------|
| `organization_id` | UUID | FK to organization |
| `customer_id` | String, nullable | Stripe customer ID |
| `subscription_id` | String, nullable | Stripe subscription ID |
| `plan` | String | Current plan enum value |
| `active` | Boolean | Whether subscription is active |
| `anchor` | SmallInteger, nullable | Billing cycle anchor day (1-31) |

Defined in `api/ee/src/dbs/postgres/subscriptions/dbes.py`.

### Lifecycle events

```python
class Event(str, Enum):
    SUBSCRIPTION_CREATED = "subscription_created"
    SUBSCRIPTION_PAUSED = "subscription_paused"
    SUBSCRIPTION_RESUMED = "subscription_resumed"
    SUBSCRIPTION_SWITCHED = "subscription_switched"
    SUBSCRIPTION_CANCELLED = "subscription_cancelled"
```

`process_event()` in `SubscriptionsService` handles all transitions. Key behaviors:
- **CREATED**: sets `active=True`, stores plan, subscription_id, anchor
- **PAUSED** (non-free): sets `active=False`
- **RESUMED** (non-free): sets `active=True`
- **SWITCHED** (non-free): **requires Stripe** — retrieves/modifies Stripe subscription, updates DB
- **CANCELLED** (non-free): reverts to `FREE_PLAN`, clears `subscription_id`, resets org flags

After every event, the `entitlements:subscription` Redis cache is invalidated.

### How is Stripe disabled?

Via env var. If `STRIPE_API_KEY` is not set, `env.stripe.enabled` returns `False`:

```python
# api/oss/src/utils/env.py, line 368-371
class StripeConfig(BaseModel):
    api_key: str | None = os.getenv("STRIPE_API_KEY")

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)
```

Throughout the code, Stripe-dependent operations check `if not env.stripe.enabled: return` early. This is a soft disable — the Stripe SDK is still imported and billing routes are still mounted (see section 10).

### Stripe dependency per operation

- `start_reverse_trial()`: creates local DB subscription first, then creates Stripe customer/subscription only if `env.stripe.enabled`. When Stripe is off, the org gets `FREE_PLAN` permanently.
- `start_free_plan()`: no Stripe dependency at all — just creates a DB row with `plan=FREE_PLAN`
- `process_event()` for SWITCHED: **requires Stripe** — retrieves/modifies Stripe subscription, will fail without it
- `cancel_subscription()`: **requires Stripe** — calls `stripe.Subscription.cancel()`

### The `create_organization_with_subscription` problem

This function (in `commoners.py`) is the only path for creating an org with entitlements, and it is cloud-specific:

```python
async def create_organization_with_subscription(..., use_reverse_trial=False):
    organization = await create_organization(payload, user)

    if use_reverse_trial:
        await subscription_service.start_reverse_trial(...)  # Cloud: Stripe trial
    else:
        await subscription_service.start_free_plan(...)       # Just a DB row with FREE_PLAN

    await check_entitlements(org_id, Gauge.USERS, delta=1)
```

The problem: both `start_reverse_trial` and `start_free_plan` hardcode `FREE_PLAN = Plan.CLOUD_V0_HOBBY`. There is no parameter for "which plan should this org get." For self-hosted, this function needs to be generalized to accept a configurable default plan:

```python
# What it should look like for self-hosted:
await subscription_service.start_plan(org_id, plan=configured_default_plan)
```

No trial concept, no Stripe — just: create a subscription row with the right plan.

### Observations for self-hosting

- The subscription table is a clean abstraction — it stores the plan locally
- `customer_id` and `subscription_id` are nullable, so the schema already supports non-Stripe subscriptions
- Plan switching via `process_event(SWITCHED)` is tightly coupled to Stripe
- Need a non-Stripe mechanism to assign/change plans (admin API or env-driven default)
- The org creation flow needs a generalized "start with plan X" path that doesn't assume cloud trial logic

---

## 7. Reverse Trial

The reverse trial is a SaaS acquisition flow: new users get Pro-level access for 14 days without a credit card. If they don't upgrade, they fall back to Hobby.

### Flow

1. User signs up → `create_accounts()` calls `create_organization_with_subscription(use_reverse_trial=True)`
2. `start_reverse_trial()`:
   - Creates DB subscription with `plan=FREE_PLAN`, `active=True`
   - If Stripe disabled, **stops here** (org stays on free plan permanently)
   - If Stripe enabled: creates Stripe customer, creates Stripe subscription with `trial_period_days=14` and `end_behavior: cancel`
   - Updates DB subscription to `plan=REVERSE_TRIAL_PLAN` (Pro)

### What happens when trial ends

- If user adds payment: Stripe transitions to paid, `customer.subscription.created` webhook fires → SUBSCRIPTION_CREATED event
- If user doesn't add payment: Stripe auto-cancels → `customer.subscription.deleted` webhook fires → SUBSCRIPTION_CANCELLED event → reverts to FREE_PLAN

### Observations for self-hosting

- Reverse trial is purely a SaaS concept — irrelevant for self-hosted
- When Stripe is disabled, `start_reverse_trial()` effectively becomes `start_free_plan()` — the org gets Hobby forever
- This is the main reason self-hosted EE orgs are stuck on Hobby

---

## 8. Meters & Usage

### What is metered

| Meter | Type | What it tracks |
|-------|------|---------------|
| `TRACES` | Counter | Root spans ingested per billing period |
| `EVALUATIONS` | Counter | Evaluation runs per billing period |
| `CREDITS` | Counter | AI service credits consumed |
| `USERS` | Gauge | Current seat count |
| `APPLICATIONS` | Gauge | Current number of applications |

### Storage

The `meters` table (composite PK = `organization_id, key, year, month`):

| Column | Type | Description |
|--------|------|-------------|
| `organization_id` | UUID | FK to subscriptions |
| `key` | String | Meter name (traces, users, etc.) |
| `year` | SmallInteger | Billing year (0 for gauges) |
| `month` | SmallInteger | Billing month (0 for gauges) |
| `value` | BigInteger | Current value |
| `synced` | BigInteger | Last value reported to Stripe |

### Metering pipeline

```
Action (trace ingest, app create, etc.)
    ↓
check_entitlements()
    ↓ (for counters/gauges)
MetersService.adjust()
    ↓
MetersDAO.adjust() — atomic Postgres upsert
    ↓
Redis cache updated/invalidated
```

### Stripe sync (decoupled)

A cron job every 30 minutes calls `POST /admin/billing/usage/report`. This:
1. Dumps meters where `synced != value`
2. For each: reports to Stripe (gauge → `stripe.Subscription.modify`, counter → `stripe.billing.MeterEvent.create`)
3. Updates `synced = value`

Only `TRACES` and `USERS` are reported to Stripe (defined in `REPORTS` list).

If Stripe is disabled, `MetersService.report()` returns early — no Stripe calls.

### Span retention

A cron job calls `POST /admin/billing/usage/flush`. This deletes old spans based on the plan's retention period defined in the entitlement quotas (e.g., Hobby = 30 days, Pro = 90 days, Business = 365 days).

### Observations for self-hosting

- Metering/quota enforcement is **fully independent of Stripe** — it uses Postgres + Redis
- Stripe sync is a separate, optional pipeline
- The meter system would work as-is for self-hosted — it just needs the right plan/quotas assigned
- Retention enforcement also works without Stripe
- For self-hosted, metering might still be useful (admin visibility into usage) even without billing

---

## 9. Throttling

Throttling is separate from metering. It uses **Redis-based token bucket / GCRA algorithms** via HTTP middleware.

### How it works

1. `throttling_middleware` is registered before auth middleware (only when `is_ee()`)
2. On every request: resolves org's plan → looks up throttle rules from `ENTITLEMENTS[plan][Tracker.THROTTLES]`
3. Categorizes request by endpoint pattern → applies token-bucket rate limit per org + category
4. Returns HTTP 429 with `X-RateLimit-*` headers if exceeded

Admin requests (with `request.state.admin`) bypass throttling.

If no subscription exists for the org, or the plan is not in `ENTITLEMENTS`, throttling is **bypassed** (request proceeds).

### Observations for self-hosting

- Throttling works independently of Stripe
- For self-hosted, throttling may or may not be desired — an enterprise customer might want unlimited or very high limits
- The custom plans (e.g., Humanity Labs) don't define throttles, which means they have no rate limiting at all
- Self-hosted EE plans could follow the same pattern: either generous throttles or none

---

## 10. Billing API Surface

All billing endpoints are defined in `api/ee/src/apis/fastapi/billing/router.py` and mounted under `/billing` (user-facing) and `/admin/billing` (admin).

### User-facing routes (`/billing`)

| Method | Path | Description | Requires Stripe? |
|--------|------|-------------|-------------------|
| POST | `/stripe/events/` | Stripe webhook receiver | Yes (no-ops if disabled) |
| POST | `/stripe/portals/` | Create Stripe billing portal session | Yes (no-ops if disabled) |
| POST | `/stripe/checkouts/` | Create Stripe checkout session | Yes (no-ops if disabled) |
| GET | `/plans` | List available plans from CATALOG | No |
| POST | `/plans/switch` | Switch org's plan | Yes (requires Stripe subscription) |
| GET | `/subscription` | Current subscription details | Partially (needs Stripe for non-hobby) |
| POST | `/subscription/cancel` | Cancel subscription | Yes (calls stripe.Subscription.cancel) |
| GET | `/usage` | Current meter values vs quotas | No |

### Admin routes (`/admin/billing`)

| Method | Path | Description | Requires Stripe? |
|--------|------|-------------|-------------------|
| POST | `/stripe/portals/` | Admin: create portal by org ID | Yes |
| POST | `/stripe/checkouts/` | Admin: create checkout by org ID | Yes |
| POST | `/plans/switch` | Admin: switch plans by org ID | Yes |
| POST | `/subscription/cancel` | Admin: cancel by org ID | Yes |
| POST | `/usage/report` | Sync meters to Stripe (cron) | Yes (no-ops if disabled) |
| POST | `/usage/report/unlock` | Force-release report lock | No |
| POST | `/usage/flush` | Span retention cleanup (cron) | No |

### OSS endpoints with entitlement coupling

These OSS endpoints conditionally call `check_entitlements()` when `is_ee()`:

| Endpoint | Entitlement check |
|----------|-------------------|
| `POST /apps/` | `Gauge.APPLICATIONS` (delta=+1), `Flag.HOOKS` |
| `DELETE /apps/{id}/` | `Gauge.APPLICATIONS` (delta=-1) |
| `POST /otlp/v1/traces` | `Counter.TRACES` (soft check) |
| Tracing worker (async) | `Counter.TRACES` (hard check) |
| `POST /organizations/{id}/invite/` | `Gauge.USERS` (delta=+1) |
| `DELETE /workspaces/{id}/members/` | `Gauge.USERS` (delta=-1) |
| `GET /permissions/verify` | `Counter.CREDITS` (delta=+1) |
| Evaluation task completion | `Counter.EVALUATIONS` (delta=-1 on failure) |
| Events worker | `Flag.ACCESS` |
| Org domain/SSO endpoints | `Flag.DOMAINS`, `Flag.SSO` |
| Org flag updates | `Flag.ACCESS` |
| RBAC permission check | `Flag.RBAC` |

### Are billing routes removed when Stripe is disabled?

**No.** The billing routes are always mounted when `is_ee()` is true, regardless of Stripe config. They are mounted unconditionally in `api/ee/src/main.py`:

```python
def extend_main(app):
    app.include_router(billing_router.router, prefix="/billing")
    app.include_router(billing_router.admin_router, prefix="/admin/billing")
```

There is no `if env.stripe.enabled` guard on route mounting. The routes exist but individual handlers return no-op responses like `{"status": "ok", "message": "Stripe not configured"}`.

This means in self-hosted EE without Stripe:
- `/billing/plans` works (returns CATALOG)
- `/billing/usage` works (returns meter values)
- `/billing/stripe/*` endpoints exist but return no-ops
- `/billing/plans/switch` exists but fails (needs Stripe subscription)
- `/billing/subscription/cancel` exists but fails (needs Stripe subscription)

### Observations for self-hosting

- Most billing endpoints gracefully degrade when Stripe is disabled (return 200 no-ops)
- `GET /plans`, `GET /usage` work without Stripe
- Plan switching and cancellation **cannot work** without Stripe today
- The admin `POST /admin/billing/plans/switch` also requires Stripe — there is no admin-only plan assignment that bypasses Stripe
- Self-hosted needs a non-Stripe mechanism for plan assignment (either admin API or env-driven default)
- The billing routes should ideally not be mounted at all when irrelevant, or should be replaced with a simpler entitlement/usage API for self-hosted

---

## 11. Frontend Billing & Feature Gating

### How the frontend decides what to show

Three layers of gating:

1. **Env var**: `NEXT_PUBLIC_AGENTA_LICENSE` checked via `isEE()` in `web/oss/src/lib/helpers/isEE.ts`:
   ```typescript
   export const isEE = () => {
       const license = getEnv("NEXT_PUBLIC_AGENTA_LICENSE")?.toLowerCase()
       if (!license) return false
       return license === "ee" || license.startsWith("cloud")
   }
   ```

2. **TypeScript path alias override**: `@/oss/*` resolves to `ee/src/*` first, then `oss/src/*`. EE components automatically substitute OSS ones at build time.

3. **Runtime ownership check**: billing tab only shown when `isEE() && isOwner`.

### Entitlement resolution on the frontend

The frontend derives entitlements **entirely from the plan name** — it does not call a server entitlement API:

```typescript
// web/oss/src/lib/helpers/useEntitlements.ts
const isFeatureEntitled = (plan: Plan | undefined, feature: Feature): boolean => {
    if (!plan) return false
    if (plan === "cloud_v0_hobby" || plan === "cloud_v0_pro") return false
    if (plan === "cloud_v0_business" || plan === "cloud_v0_enterprise") return true
    return false
}
```

This is a **hardcoded client-side mapping**. It does not handle custom plans. The `Plan` type only includes: `cloud_v0_hobby`, `cloud_v0_pro`, `cloud_v0_business`, `cloud_v0_enterprise`.

### Billing-related frontend files

| Area | File |
|------|------|
| State (atoms) | `web/ee/src/state/billing/atoms.ts` |
| Hooks | `web/ee/src/state/billing/hooks.ts` |
| Service layer | `web/ee/src/services/billing/index.tsx` |
| Types | `web/ee/src/services/billing/types.d.ts` |
| Billing page | `web/ee/src/components/pages/settings/Billing/index.tsx` |
| Usage bars | `web/ee/src/components/pages/settings/Billing/assets/UsageProgressBar/` |
| Pricing modal | `web/ee/src/components/pages/settings/Billing/Modals/PricingModal/` |
| Cancel modal | `web/ee/src/components/pages/settings/Billing/Modals/AutoRenewalCancelModal/` |
| Sidebar banners | `web/ee/src/components/SidebarBanners/` |
| Entitlement hook | `web/oss/src/lib/helpers/useEntitlements.ts` |
| Subscription wrapper | `web/oss/src/lib/helpers/useSubscriptionDataWrapper.ts` |
| Upgrade prompt | `web/oss/src/components/pages/settings/Organization/UpgradePrompt.tsx` |

### Conditional rendering based on entitlements

| Component | Gated by | Effect when false |
|-----------|----------|-------------------|
| Access Controls (org settings) | `hasAccessControl` | Shows UpgradePrompt paywall |
| Verified Domains (org settings) | `hasDomains` | Shows UpgradePrompt paywall |
| SSO Providers (org settings) | `hasSSO` | Shows UpgradePrompt paywall |
| Role selector in invite modal | `isEE() && hasRBAC` | Shows informational tag instead |
| Role column in members table | `hasRBAC` | Hidden |
| Trial sidebar banner | `subscription.free_trial === true` | Not shown |
| Upgrade sidebar banner | `subscription.plan === Plan.Hobby` | Not shown |

### Observations for self-hosting

- The frontend entitlement mapping is hardcoded and cloud-plan-specific
- Custom plans (like what self-hosted would use) fall through to `return false` — all features disabled
- The billing page, pricing modal, and checkout flow are all cloud-specific
- For self-hosted EE, the frontend needs to either:
  - Recognize the self-hosted plan as "Business+" equivalent
  - Or get entitlements from the server instead of deriving from plan name
- The sidebar banners (trial/upgrade nudges) should not appear in self-hosted
- The billing tab in settings should be hidden or replaced with a usage-only view

---

## 12. Organization Lifecycle

### Org creation flow

1. **User signs up** → `create_accounts()` in `api/ee/src/services/commoners.py`
2. Acquires distributed lock (prevents race conditions)
3. Creates user (or returns existing)
4. If new user with no orgs:
   - Adds to demo projects (if `AGENTA_DEMOS` configured)
   - Creates org with `create_organization_with_subscription(use_reverse_trial=True)`
5. Enforces domain policies (auto-join)

`create_organization_with_subscription()` (line 249):
1. Creates `OrganizationDB` record with the user as `owner`
2. Creates default "Default" workspace
3. Creates default project
4. Starts subscription: reverse trial (if `use_reverse_trial=True`) or free plan (if false)
5. Checks entitlements for `Gauge.USERS` (delta=+1)

### Org creation policy

**Any authenticated user can create unlimited organizations.** There is no policy check, no limit, no admin approval.

The only restriction is on **deletion**: a user cannot delete their last organization.

### Observations for self-hosting

- No org creation policy — critical gap for self-hosted (admin should control who can create orgs)
- No concept of "initial" or "bootstrap" org
- Default entitlement is always Hobby (free) — no way to change default plan
- The org creation flow is tightly coupled to the subscription/trial system

---

## 13. Organization Flags vs Plan Entitlements

These are two separate systems that interact but are often confused.

### Organization flags (per-org settings)

Stored on `OrganizationDB` in a `flags` JSON column. These control **auth/access behavior per org**:

| Flag | What it controls | Default on creation |
|------|-----------------|---------------------|
| `is_demo` | Whether this is a demo org | `False` |
| `allow_email` | Can members use email/password auth? | `True` (from `env.auth.email_enabled`) |
| `allow_social` | Can members use Google/GitHub OAuth? | `True` (from `env.auth.oidc_enabled`) |
| `allow_sso` | Can members use enterprise SSO? | `False` |
| `allow_root` | Can the owner bypass auth policies? | `False` |
| `domains_only` | Restrict to verified email domains? | `False` |
| `auto_join` | Auto-add users with matching domains? | `False` |

These are set in `create_organization()` in `api/ee/src/services/db_manager_ee.py`.

### Plan entitlements (per-plan capabilities)

Defined in the `ENTITLEMENTS` dict. These control **whether you can configure the org flags above**:

| Entitlement flag | What it gates |
|-----------------|---------------|
| `Flag.ACCESS` | Whether you can edit org flags at all |
| `Flag.SSO` | Whether you can enable `allow_sso` on the org |
| `Flag.DOMAINS` | Whether you can manage verified domains |

### How they interact

```
Entitlement: Flag.SSO = True?
    ↓ yes
Org setting: allow_sso = True/False (admin can toggle)
    ↓ if True
SSO login is available for this org
```

The entitlement gates the ability to configure the setting. The setting controls the actual behavior.

### Why the defaults are hardcoded

The org flag defaults are hardcoded in `create_organization()` because there is no configuration mechanism for them. They are NOT defined in a plan — they are per-org state. The plan only controls whether you *can change* them.

For self-hosted EE, some of these defaults should be different. For example:
- If the customer has SSO configured, `allow_sso` should default to `True`
- If org creation is admin-only, `allow_root` might default differently
- These could come from env vars or a platform config table

### On subscription cancellation

When a subscription is cancelled (via Stripe webhook), `_reset_organization_flags()` resets the org flags to defaults:
```python
default_flags = {
    "allow_sso": False,
    "allow_root": False,
    "domains_only": False,
    "auto_join": False,
    ...
}
```
This is a cloud-specific behavior — downgrading should disable enterprise features. For self-hosted, this reset would not make sense since there is no downgrade path.

---

## 14. RBAC & Permissions

### Roles

Defined in `api/ee/src/models/shared_models.py`:

```python
class WorkspaceRole(str, Enum):
    OWNER = "owner"
    VIEWER = "viewer"
    EDITOR = "editor"
    EVALUATOR = "evaluator"
    WORKSPACE_ADMIN = "workspace_admin"
    DEPLOYMENT_MANAGER = "deployment_manager"
```

Organization membership has a separate concept: `"owner"` or `"member"` (string, not enum, DB default is `"member"`).

### Default role assignments

| Context | Org role | Workspace/Project role |
|---------|----------|----------------------|
| Creates org | `"owner"` | `"owner"` |
| Joins via invitation | `"member"` (DB default) | Role specified by inviter (default: `"editor"`) |
| Joins via domain auto-join | `"member"` | `"editor"` |
| Added to demos | `"member"` | `"viewer"` |

### RBAC enforcement

RBAC is enforced via inline checks in route handlers, not middleware:

```python
# Pattern in every route handler:
if is_ee():
    if not await check_action_access(
        user_uid=request.state.user_id,
        project_id=request.state.project_id,
        permission=Permission.EDIT_WORKFLOWS,
    ):
        raise FORBIDDEN_EXCEPTION
```

The check flow:
1. `check_action_access()` → cache lookup → `check_rbac_permission()`
2. `check_rbac_permission()` → verifies workspace membership → `check_project_has_role_or_permission()`
3. `check_project_has_role_or_permission()`:
   - If **demo member**: always restricted
   - If **not demo**: checks `Flag.RBAC` entitlement
     - **If RBAC flag is False → grants full access** (returns True, bypasses all role checks)
     - If RBAC flag is True → checks role-based permissions
   - **Organization owner**: always has full access (bypasses role check)
   - **Workspace OWNER**: always has full access

### Permission matrix

| Role | Access level |
|------|-------------|
| **OWNER** | All permissions |
| **WORKSPACE_ADMIN** | All except: delete workspace/org, edit org, add to org, edit billing |
| **EDITOR** | Most except: destructive ops, org management, billing, role mgmt, deployments |
| **DEPLOYMENT_MANAGER** | Viewer + deploy |
| **EVALUATOR** | Viewer + create/run evaluations |
| **VIEWER** | Read-only |

### No platform admin concept

There is no cross-organization "super admin" or "platform admin". The `admin_manager.py` provides internal functions for programmatic user/org/workspace creation, but there is no admin role that spans organizations.

### Observations for self-hosting

- **RBAC disabled on Hobby/Pro plans** is a critical issue for self-hosted EE. A self-hosted customer paying for enterprise expects RBAC to work regardless of "plan tier".
- No platform admin concept — self-hosted needs someone who can manage all orgs
- No admin bootstrapping — first user is just a regular org owner
- The role system itself (6 roles, permission matrix) is well-designed and works independently of billing

---

## 15. Env Vars & Config

### Primary EE toggle

| Variable | Value | Effect |
|----------|-------|--------|
| `AGENTA_LICENSE` | `"ee"` | Enables EE mode (`is_ee()` returns true). Also controls DB names (`agenta_ee_core` vs `agenta_oss_core`) and Alembic migration paths. |

### Stripe / Billing

| Variable | Effect |
|----------|--------|
| `STRIPE_API_KEY` | Enables Stripe. Without it, all Stripe operations are no-ops. |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification |
| `STRIPE_WEBHOOK_TARGET` | Multi-environment webhook routing (defaults to MAC address) |
| `STRIPE_PRICING` / `AGENTA_PRICING` | JSON: Plan → Stripe price ID mapping |

### Auth / SSO

| Variable | Effect |
|----------|--------|
| `SUPERTOKENS_URI_CORE` / `SUPERTOKENS_CONNECTION_URI` | SuperTokens connection |
| `SUPERTOKENS_API_KEY` | SuperTokens API key |
| `GOOGLE_OAUTH_CLIENT_ID` + `_SECRET` | Google OAuth |
| `GITHUB_OAUTH_CLIENT_ID` + `_SECRET` | GitHub OAuth |
| `OKTA_*` | Okta SSO |
| `AZURE_AD_*` | Azure AD SSO |
| `BOXY_SAML_*` | BoxySAML SSO |
| `CLOUDFLARE_TURNSTILE_*` | Captcha (EE only) |

### Other

| Variable | Effect |
|----------|--------|
| `AGENTA_DEMOS` | JSON array of demo project IDs |
| `AGENTA_BLOCKED_EMAILS` / `AGENTA_BLOCKED_DOMAINS` | Signup restrictions |
| `AGENTA_ALLOWED_DOMAINS` | Signup whitelist |
| `SENDGRID_API_KEY` + `FROM_ADDRESS` | Email (invitations, OTP) |
| `LOOPS_API_KEY` | Marketing emails (cloud-only concept) |
| `CRISP_WEBSITE_ID` | Chat widget |

### Frontend

| Variable | Effect |
|----------|--------|
| `NEXT_PUBLIC_AGENTA_LICENSE` | `"ee"` or `"cloud*"` enables EE features |
| `NEXT_PUBLIC_AGENTA_SENDGRID_ENABLED` | Enables email invitations |
| `NEXT_PUBLIC_AGENTA_TOOLS_ENABLED` | Enables tools feature |

### Observations for self-hosting

- No env var for deployment mode (cloud vs self-hosted)
- No env var for default plan/entitlement
- No env var for org creation policy
- No env var for admin user bootstrapping
- The system is configurable for auth providers (good) but not for entitlement/org policies (gap)

---

## 16. Gaps for Self-Hosted EE

Based on this research, here are the critical gaps:

### 1. No way to assign a plan without Stripe

Orgs are permanently stuck on `CLOUD_V0_HOBBY` when Stripe is disabled. The `admin/billing/plans/switch` endpoint also requires Stripe. There is no admin API or env var to set a default plan.

### 2. RBAC disabled on Hobby/Pro

When `Flag.RBAC` is `False` (Hobby/Pro plans), `check_project_has_role_or_permission()` returns `True` for all non-demo users — granting full access regardless of assigned role. This is a cloud pricing lever (RBAC is a Business+ feature). A self-hosted EE customer expects RBAC to always be enforced regardless of plan name.

### 3. No default entitlement configuration

The default plan is hardcoded as `FREE_PLAN = Plan.CLOUD_V0_HOBBY`. There is no env var or mechanism to change what new orgs get.

### 4. No org creation policy

Any authenticated user can create unlimited organizations. Self-hosted deployments typically need this controlled (admin-only, or first-user-only, or invite-only).

### 5. No platform admin concept

There is no super-admin or platform-admin role. Self-hosted needs someone who can manage plans, orgs, and users across the platform.

### 6. No admin bootstrapping

The first user just creates an org and becomes owner. There is no setup wizard, bootstrap token, or designated admin mechanism.

### 7. Plan names are cloud-branded

All plans are `cloud_v0_*` which doesn't make sense for self-hosted. The frontend also hardcodes these names for entitlement resolution.

### 8. Frontend entitlements are hardcoded to cloud plans

The `useEntitlements` hook maps plan names to features client-side. Custom plans (like what self-hosted would need) all return `false` for every feature.

### 9. Cloud-specific UI elements

- Sidebar banners show trial/upgrade prompts
- Pricing modal links to Stripe checkout
- `extend_app_schema()` hardcodes `servers` to `cloud.agenta.ai`
- CATALOG includes pricing information irrelevant for self-hosted

### 10. Subscription record is mandatory

Every org must have a row in `subscriptions` or `check_entitlements` raises an exception. The subscription is created as part of the signup flow, but there is no migration or bootstrap path for existing orgs.

### 11. Org flag defaults are hardcoded and cloud-assumed

Org flags (allow_sso, allow_root, domains_only, auto_join) are hardcoded at creation time and reset to cloud defaults on subscription cancellation (see section 13). A self-hosted customer with SSO configured would expect `allow_sso=True` by default. The cancellation-triggered flag reset is also cloud-specific and should not apply in self-hosted mode.

### 12. `create_organization_with_subscription` is cloud-specific

The only org creation path (`commoners.py`) forces a choice between reverse trial or free plan — both hardcoded to `CLOUD_V0_HOBBY`. There is no parameter for "create this org with plan X." Self-hosted needs a generalized path: create org → create subscription with configured default plan → done.

### What already works well for self-hosting

- Entitlement enforcement engine (flags, counters, gauges) — no Stripe dependency
- Metering pipeline (Postgres + Redis) — fully independent
- Throttling middleware — fully independent
- RBAC permission model (6 roles, fine-grained permissions) — just needs to be enabled
- SSO provider configuration — env-var driven
- Subscription table schema — already supports nullable Stripe fields
- Custom plans — demonstrate the pattern of entitlements without Stripe

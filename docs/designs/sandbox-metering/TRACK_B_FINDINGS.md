# Track B — new metering, measurement only

Consolidates `feat/sandbox-metering-phase-1` (sandbox compute providers + sink) and
`feat/sandbox-metering-phase-4` (storage gauge) into `feat/metering-track-b`, on top of
`feat/add-sandbox-metering` (Track A) + big-agents. Pure measurement: nothing added to
`REPORTS`, no Stripe pricing.

## What was brought in

From phase-1 (renamed `sandbox_metering` -> `sandboxes` at both core and API level):
- `api/ee/src/core/sandboxes/{__init__,dtos,exceptions,service}.py`
- `api/ee/src/apis/fastapi/sandboxes/{__init__,models,router}.py`
- `main.py` sandboxes service/router wiring; `entrypoints/routers.py` best-effort E2B
  webhook registration in `lifespan()`.

From phase-4 (storage gauge), rewired to the existing shared store config:
- `api/ee/src/core/storage/{__init__,types,paths,adapters,service,reconcile}.py`
- `subscriptions/interfaces.py` + `dbs/postgres/subscriptions/dao.py`: `list_active()`
- `billing/router.py`: `POST /admin/billing/storage/reconcile` +
  `.../storage/reconcile/unlock`, mirroring the existing `usage/report` lock pattern.

The 4 junk files listed in the task (`.agents/skills/agenta-package-practices/SKILL.md`,
`web/AGENTS.md`, `web/packages/agenta-entities/src/loadable/controller.ts`,
`web/packages/agenta-entities/tests/unit/trace-run-error.test.ts`) were never touched.

## Renames

`sandbox_metering` -> `sandboxes` everywhere: directory names, import paths, log-tag
prefixes (`[sandbox_metering]` -> `[sandboxes]`), Redis key namespaces
(`sandbox_metering:e2b`/`:daytona` -> `sandboxes:e2b`/`:daytona`), FastAPI
`operation_id`s, and the router constructor kwarg (`sandbox_metering_service` ->
`sandboxes_service`). Class names `SandboxMeteringService`/`SandboxMeteringRouter` were
kept (descriptive class names, not paths). Mount points:
`/webhooks/sandboxes` (public E2B receiver) and `/admin/sandboxes` (Daytona poll
trigger). `core/sandbox/` (phase-2, singular) is Track C and was not touched.

## Meter key naming (final)

Went through two naming revisions mid-task; the committed state uses the final,
simplest scheme — plain 3-letter resource tokens, no unit token:

| Counter key            | value                   |
|-------------------------|--------------------------|
| `SANDBOX_CPU_SECONDS`   | `sandbox_cpu_seconds`   |
| `SANDBOX_RAM_SECONDS`   | `sandbox_ram_seconds`   |
| `SANDBOX_SSD_SECONDS`   | `sandbox_ssd_seconds`   |
| `SANDBOX_GPU_SECONDS`   | `sandbox_gpu_seconds`   |

Plus `Gauge.STORAGE_BYTES` (`storage_bytes`) — the storage-size gauge, distinct from
`SANDBOX_SSD_SECONDS` (sandbox disk *compute-time*, not stored bytes). Applied
consistently to: `Counter` enum, `Meters` mirror, `DEFAULT_ENTITLEMENTS` quotas,
`CONSTRAINTS`, the `ee0000000004` migration's enum labels, and the sandboxes service's
meter-delta mapping. A stray `docs/designs/sandbox-metering/NAMING.md` on disk
(untracked, authored elsewhere) documents an earlier, superseded 4-letter-token variant
of this scheme — not updated as part of this task since it wasn't in Track B's file
list; the code is the source of truth.

## Entitlements (measurement only)

- `Counter.SANDBOX_{CPU,RAM,SSD,GPU}_SECONDS` and `Gauge.STORAGE_BYTES` added.
- Every plan (`HOBBY`, `PRO`, `BUSINESS`, `AGENTA_AI`, `SELF_HOSTED_ENTERPRISE`) gets a
  non-blocking `Quota(period=Period.MONTHLY)` for each sandbox counter — no
  `free`/`limit`/`strict`, so `check_entitlements` records but never blocks.
  `SandboxMeteringService.record_usage()` also calls `check_entitlements` with
  `cache=False` per delta (Layer-2 atomic adjust) purely to persist the meter row; the
  call fails open on error.
- Storage caps carried over from phase-4's design: HOBBY 1 GiB (free=limit=strict),
  PRO 5 GiB free / 10 GiB limit (strict), BUSINESS 50 GiB free only (strict, no hard
  limit). AGENTA_AI and SELF_HOSTED_ENTERPRISE get no storage cap (unlimited, matching
  their existing unlimited-everything pattern).
- `CONSTRAINTS[BLOCKED][GAUGES]` gained `Gauge.STORAGE_BYTES`; `CONSTRAINTS[READ_ONLY][COUNTERS]`
  gained the 4 sandbox counters (same treatment as every other counter).
- **`REPORTS` is untouched** — still `{Counter.TRACES_INGESTED.value: "traces"}`. No
  Stripe line items, no billing wiring for sandboxes or storage.

## Storage wiring to `env.store`

Phase-4 originally introduced its own `env.agenta.storage.*` (`StorageConfig`) with a
provider string, bucket, endpoint, and a boto3/httpx-based size adapter. Per the
reconciliation facts, that duplicate config was **deleted** and the storage gauge now
consumes the existing `env.store` (`StoreConfig` in `api/oss/src/utils/env.py`) and the
existing S3-compatible client:

- `storage/adapters.py`: `get_org_storage_bytes()` builds an `ObjectStore` (from
  `oss.src.core.store.storage`, the same client `mounts` already uses) from
  `env.store.{endpoint_url,access_key,secret_key,region,sts_endpoint_url,signing_key}`
  and sums `list_objects_v2(bucket=env.store.bucket, prefix=org_prefix(org_id))`. Dropped
  the separate boto3/httpx-per-provider code path entirely — SeaweedFS vs. real-S3
  selection already lives in `ObjectStore.is_seaweedfs` (keyed on `signing_key`
  presence), so `storage/types.py`'s now-dead `StorageProvider` enum was removed too.
- `storage/reconcile.py`: gate changed from `env.agenta.storage.reconcile_enabled` /
  `.enabled` to `env.store.reconcile_enabled` / `env.store.enabled`.
- `env.py`: added one field, `StoreConfig.reconcile_enabled`
  (`AGENTA_STORE_RECONCILE_ENABLED`, default `false`). No new top-level config class.
- `storage/service.py` (delta tracking + `reconcile_org_storage`) needed no changes —
  it already only touched `Gauge.STORAGE_BYTES` / `Meters.STORAGE_BYTES` via
  `check_entitlements`, no direct env access.

## Migration

`api/ee/databases/postgres/migrations/core_ee/versions/ee0000000004_add_sandbox_and_storage_meters.py`,
`down_revision = "ee0000000003"` (the current head — `add_records_ingested_meter`).
Appends 5 enum labels to `meters_type` via `ALTER TYPE ... ADD VALUE IF NOT EXISTS`:
`SANDBOX_CPU_SECONDS`, `SANDBOX_RAM_SECONDS`, `SANDBOX_SSD_SECONDS`,
`SANDBOX_GPU_SECONDS`, `STORAGE_BYTES` (uppercase Python-enum-member-name labels, matching
the existing `SQLEnum(Meters, name="meters_type")` convention — verified against
`ee0000000002`'s `CREATE TYPE` and `ee0000000003`). `downgrade()` is a no-op (Postgres
can't drop enum labels), matching `ee0000000003`. Chain
`ee0000000000 -> ...0001 -> ...0002 -> ...0003 -> ...0004` is linear, single head.

## Deliberately left out (per task scope)

- **Records metering** (phase-3 / `RECORDS_INGESTED`): already fully on big-agents
  (Counter member, per-plan quotas, `ee0000000003` migration). Not touched. Size-cap +
  two-layer wiring for records is separately deferred pending the transcripts->records
  rename.
- **REPORTS / Stripe billing**: nothing added for sandboxes or storage. Storage billing
  stays commented/deferred (phase-4's `DEFAULT_CATALOG` had `"storage": {"type":
  "tiered", "tiers": []}` TODO(pricing) placeholders per plan — not brought in, since
  `DEFAULT_CATALOG` pricing entries are a Track A/billing concern, not measurement).
  Track A's unrelated retention/pricing changes (WEEKLY->MONTHLY retention bumps, PRO
  price bump, per-seat pricing) that were tangled into both phase branches' diffs of
  `entitlements/types.py` were **not** cherry-picked — only the pure sandbox-counter and
  storage-gauge additions were extracted.
- **`core/sandbox/` (phase-2, singular)**: Track C, not in scope here.
- **Credits keys**: Track C; no `SANDBOX_*_CREDITS` or aggregate credits meter added.

## Verification

- `cd api && ruff format . && ruff check .` — clean, no errors.
- `uv run python3 -c "import ee.src.core.sandboxes.service, ee.src.core.storage.service, ee.src.main, ..."`
  — all new modules import cleanly, including `ee.src.main` (exercises the full service +
  router instantiation and mount wiring). `import entrypoints.routers` fails on
  `alembic.util.exc.CommandError: No 'script_location' key found` — a pre-existing
  local-env limitation (needs the docker-compose env loaded per repo `AGENTS.md`), not
  caused by this change; unaffected by anything in this branch.
- Confirmed `env.e2b.enabled`, `env.daytona.enabled`, `env.store.reconcile_enabled`
  properties evaluate without error, and `Meters`/`Counter`/`Gauge`/`REPORTS` reflect the
  expected final state at runtime.

## Commits

1. `feat(metering): sandbox compute meters + providers (sandboxes domain)` — phase-1
   core+API files under the `sandboxes` rename, entitlements/meters key additions
   (first naming pass), `env.py` E2B/Daytona config, `main.py`/`routers.py` wiring.
2. `fixup(metering): rename sandbox meter keys to SANDBOX_{CPU,RAM,SSD,GPU}_SECONDS` —
   applies the final naming decision across the Counter enum, Meters mirror, quotas,
   constraints, and the sandboxes service; adds the `ee0000000004` migration (was
   deferred to this commit since the migration was written after the naming settled).
3. `feat(metering): storage gauge on env.store` — phase-4 storage domain rewired off
   the duplicate `StorageConfig` onto `env.store` + the existing `ObjectStore` client,
   `list_active()` on subscriptions, billing router admin reconcile endpoints.

Not pushed, per instructions.

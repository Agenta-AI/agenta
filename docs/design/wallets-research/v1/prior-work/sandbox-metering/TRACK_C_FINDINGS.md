# Track C — new billing (credits + gating)

Adds the billing layer on top of Track B's measurement-only sandbox meters:
the credits unit that rolls up the raw per-dimension sandbox meters into one
billable meter, plus create-time/mid-session entitlement gating. Built on
`feat/metering-track-b` (sandbox compute meters + storage gauge, nothing in
`REPORTS`).

## What was brought in

From `feat/metering-credits-layer` (`api/ee/src/core/sandbox_metering/`):
- `credits.py` -> `api/ee/src/core/sandboxes/credits.py` -- renamed
  `Dimension.{VCPU,RAM,DISK,GPU}` to `{CPU,RAM,SSD,GPU}` and `ProviderRates`
  fields `vcpu/ram/disk/gpu` to `cpu/ram/ssd/gpu`, matching the locked naming
  in `NAMING.md`. Rewired `env.sandbox.credit_rates.rates` (old, nonexistent
  `env.sandbox_metering`-style path) to the new `env.sandbox.credit_rates`
  dict added to `api/oss/src/utils/env.py`.
- `sink.py` -> `api/ee/src/core/sandboxes/sink.py` -- renamed
  `record_usage()` to `record_usage_credits()` (the pre-existing
  `SandboxMeteringService.record_usage()` already owns that name for the raw
  seconds); dropped the raw `*_seconds` adjust loop (Track B's service
  already does that) so this module is credits-only. Wired as the last step
  of `SandboxMeteringService.record_usage()` in `core/sandboxes/service.py`.
- `test_sandbox_credits.py` -> `api/ee/tests/pytest/unit/test_sandbox_credits.py`,
  same rename treatment (42 assertions, all renamed VCPU/DISK -> CPU/SSD).

From `feat/sandbox-metering-phase-2` (`api/ee/src/core/sandbox/metering.py`,
singular -- a different, unmerged branch from Track B's `sandboxes`):
- `metering.py` -> `api/ee/src/core/sandboxes/gating.py`. Renamed
  `check_sandbox_quota()` (kept) and `record_sandbox_usage()` ->
  `check_sandbox_credits_true_up()` -- Track B's service already performs
  the authoritative meter writes (raw seconds + credits via sink.py), so
  Layer 2 here is now a **read-only recheck** (`delta=0`) of
  `SANDBOX_CREDITS` rather than a second write path. Deleted the inline
  `_derive_credits()` (ad hoc `vcpu_seconds + ram_seconds` sum) entirely --
  credits now come exclusively from `credits.to_credits()`.
- `test_sandbox_metering.py` -> `api/ee/tests/pytest/unit/test_sandbox_gating.py`,
  adapted to the new function names/module path, plus the REPORTS/
  CONSTRAINTS/DEFAULT_ENTITLEMENTS assertions from that file kept (still
  valid against the new key set).

The 4 junk files (`.agents/skills/agenta-package-practices/SKILL.md`,
`web/AGENTS.md`, `web/packages/agenta-entities/src/loadable/controller.ts`,
`web/packages/agenta-entities/tests/unit/trace-run-error.test.ts`) were
never touched — confirmed neither scratch branch's relevant file list nor
this branch's diff includes them.

## Credit keys (locked naming)

| Counter key              | value                     |
|---------------------------|---------------------------|
| `SANDBOX_CPU_CREDITS`     | `sandbox_cpu_credits`     |
| `SANDBOX_RAM_CREDITS`     | `sandbox_ram_credits`     |
| `SANDBOX_SSD_CREDITS`     | `sandbox_ssd_credits`     |
| `SANDBOX_GPU_CREDITS`     | `sandbox_gpu_credits`     |
| `SANDBOX_CREDITS`         | `sandbox_credits`         |

Added to `Counter` (`entitlements/types.py`) and mirrored into `Meters`
(`meters/types.py`). Every default plan (`HOBBY`, `PRO`, `BUSINESS`,
`AGENTA_AI`, `SELF_HOSTED_ENTERPRISE`) gets a non-blocking
`Quota(period=Period.MONTHLY)` for all 5 — no `free`/`limit`/`strict`, same
pattern as Track B's raw-second quotas, with a `# TODO(pricing)` marker
since real free/limit numbers aren't decided yet. Added to
`CONSTRAINTS[READ_ONLY][COUNTERS]`.

## Rate table (`core/sandboxes/credits.py`)

`Dimension` enum: `CPU | RAM | SSD | GPU` (mirrors the meter key tokens).
`ProviderRates` is a typed Pydantic model (`cpu`/`ram`/`ssd`/`gpu`, all
`Decimal`) — one instance per provider in `DEFAULT_PROVIDER_RATES` (`e2b`,
`daytona`, `local`). `local` is zero-rated (no billing cost). `to_credits()`
is pure: `raw_units: Decimal -> Decimal`, no I/O, no money math — Stripe
owns credit->money conversion, same division of responsibility as
`traces_ingested`. Values <= 0, unknown providers, and unknown dimensions
all return `Decimal("0")`.

Env override: `AGENTA_SANDBOX_CREDIT_RATES` (JSON, `env.sandbox.credit_rates`
in `api/oss/src/utils/env.py`), a dict keyed by provider slug with partial
per-dimension string overrides merged onto the code defaults, parsed lazily
and cached in a module-level `_RATES` dict (first call wins — same lazy-init
pattern as the rest of the entitlements layer).

## Sink (`core/sandboxes/sink.py`)

`record_usage_credits()` is called from `SandboxMeteringService.record_usage()`
(in `core/sandboxes/service.py`) immediately after the existing raw
`SANDBOX_{CPU,RAM,SSD,GPU}_SECONDS` adjust loop. Per event: converts each
dimension's raw seconds to credits via `to_credits()`, adjusts the 4
per-dimension `*_CREDITS` meters, sums into `total_credits`, and adjusts
`SANDBOX_CREDITS`. All deltas are stored as **millicredits** (`credits x
1000`, truncated to `int`) to keep the int-typed `MeterDTO.delta` field
precise without a schema change — a Stripe per-millicredit price accounts
for the factor at billing time. One `check_entitlements(cache=False)` call
per meter, org-scoped via `MeterScope(organization_id=...)`; each call is
independently try/excepted and fails open with a warning log (mirrors
Track B's existing per-meter error handling in the same service).

## REPORTS wiring

```python
REPORTS: dict[str, str] = {
    Counter.TRACES_INGESTED.value: "traces",
    Counter.SANDBOX_CREDITS.value: "sandbox_credits",
}
```

Only `sandbox_credits` (2 entries total). The 4 raw `*_seconds` meters and
the 4 per-dimension `*_credits` meters are recorded (adjusted, cached,
queryable) but **not** in `REPORTS` — so nothing per-dimension is billed to
Stripe. Flipping per-dimension billing on later is a one-line `REPORTS`
addition, no other code change, since `MetersService`'s report path already
resolves any `REPORTS`-listed key generically.

Confirmed at runtime: `REPORTS == {'traces_ingested': 'traces',
'sandbox_credits': 'sandbox_credits'}`.

Storage (`Gauge.BYTES`) stays out of `REPORTS`, unchanged from
Track B — deferred per that track's findings.

## Pricing slots

`AGENTA_BILLING_PRICING` (`ee/src/core/subscriptions/settings.py`) has no
code default (`_default_pricing()` returns `{}`) and is fully generic: any
top-level key present in `REPORTS`'s *values* becomes a valid Stripe meter
slot name once an operator sets a `{"price": "price_..."}` entry for it. No
code change was needed there — `sandbox_credits` already works as a slot
name because `REPORTS` now maps `Counter.SANDBOX_CREDITS.value ->
"sandbox_credits"`.

`DEFAULT_CATALOG` (the user-facing pricing-modal display metadata, separate
from Stripe wiring) got `# TODO(pricing)` comment placeholders in the Pro
and Business tiers' `price` blocks, next to the existing `traces` tiered
entry — no numbers, since real sandbox pricing isn't decided. Hobby/
Enterprise/Agenta entries were left untouched (Hobby has no `price.traces`
either; Enterprise/Agenta have no `price` block at all).

## Gating (`core/sandboxes/gating.py`)

Two layers, both gated on `Counter.SANDBOX_CREDITS` only (not the raw or
per-dimension meters):

- **Layer 1** `check_sandbox_quota(organization_id, provider="e2b")` --
  create-time soft pre-check before a sandbox launches. Uses
  `check_entitlements(cache=True)` (Redis-cached read) plus an estimated
  in-flight accrual: `env.sandbox.estimated_vcpu *
  env.sandbox.estimated_run_seconds` seconds of CPU-dimension usage,
  converted through `credits.to_credits()` for the target provider (so the
  estimate honors the same rate table as real usage, unlike phase-2's
  hardcoded `1 credit = 1 vCPU-second` constant). Returns
  `(allowed, reason)`; fails open (`True, None`) on any non-
  `EntitlementsException` error.
- **Layer 2** `check_sandbox_credits_true_up(organization_id)` -- called
  after `SandboxMeteringService.record_usage()` has already written the
  authoritative meters via the sink. This is a **read-only recheck**
  (`delta=0`, `cache=False`) of `SANDBOX_CREDITS`, not a second write --
  the old phase-2 design re-adjusted all 4 counters a second time here,
  which Track B's service already owns. Returns `True`/`False`; `False`
  logs a warning that session-kill (Layer 2b) isn't wired yet
  (`DELETE /sessions/streams/{id}` + runner `/kill`, tracked in
  `tasks.md`).

RBAC (`RUN_SESSIONS` permission) is untouched by this module — callers must
check it separately before calling either gating function; `gating.py` only
ever looks at `Counter.SANDBOX_CREDITS`.

New env knobs (`api/oss/src/utils/env.py`, `SandboxConfig` /
`env.sandbox`): `AGENTA_SANDBOX_CREDIT_RATES` (credit-rate overrides, used
by `credits.py`), `AGENTA_SANDBOX_ESTIMATED_VCPU` (default `2`),
`AGENTA_SANDBOX_ESTIMATED_RUN_SECONDS` (default `300`) — the Layer-1
accrual estimate inputs.

## Migration

`api/ee/databases/postgres/migrations/core_ee/versions/ee0000000005_add_sandbox_credit_meters.py`,
`down_revision = "ee0000000004"` (Track B's sandbox + storage meters
migration, the current head). Appends 5 enum labels to `meters_type`:
`SANDBOX_CPU_CREDITS`, `SANDBOX_RAM_CREDITS`, `SANDBOX_SSD_CREDITS`,
`SANDBOX_GPU_CREDITS`, `SANDBOX_CREDITS` via `ALTER TYPE ... ADD VALUE IF
NOT EXISTS` (uppercase Python-enum-member-name labels, matching
`ee0000000003`/`ee0000000004`). `downgrade()` is a no-op (Postgres can't
drop enum labels). Verified `revision="ee0000000005"`,
`down_revision="ee0000000004"` by direct module import — chain is linear,
single head.

## Tests

- `api/ee/tests/pytest/unit/test_sandbox_credits.py` -- 30 tests on
  `to_credits()`/`DEFAULT_PROVIDER_RATES`/`ProviderRates`: per-dimension
  conversion for e2b/daytona/local, dimension independence, edge cases
  (zero/negative/unknown provider/unknown dimension/case-insensitivity),
  Decimal-exactness (no float drift), and the informational reference-
  machine-minute cross-check.
- `api/ee/tests/pytest/unit/test_sandbox_gating.py` -- 12 tests on
  `check_sandbox_quota()` / `check_sandbox_credits_true_up()` (allowed /
  denied / fails-open / OSS-passthrough, mocked `check_entitlements` and
  `is_ee`), plus 4 wiring assertions: `Meters` mirrors `Counter` for all 5
  credit keys, `REPORTS` contains only `sandbox_credits` (not the raw or
  per-dimension meters), all 5 credit counters are in
  `CONSTRAINTS[READ_ONLY][COUNTERS]`, and every `DEFAULT_ENTITLEMENTS` plan
  carries a `Quota` for all 5.
- `cd api && ruff format . && ruff check --fix .` -- clean, no errors
  (`1263 files left unchanged`, `All checks passed!`).
- `uv run pytest ee/tests/pytest/unit/test_sandbox_credits.py
  ee/tests/pytest/unit/test_sandbox_gating.py -q` -- 42 passed.
- `uv run pytest ee/tests/pytest/unit -q -k "entitle or sandbox or meter"`
  -- 98 passed (no regressions in adjacent entitlements/meters/sandboxes
  unit tests).
- Import-tested `ee.src.core.sandboxes.{credits,sink,gating,service}`,
  `ee.src.core.access.entitlements.types`, `ee.src.core.meters.types`, and
  the full `ee.src.main` composition root (exercises service + router
  wiring end-to-end) -- all clean.

## Commits

1. `feat(billing): sandbox credits unit + per-dimension rate table` --
   `credits.py` + its test, renamed to the CPU/RAM/SSD/GPU scheme.
2. `feat(billing): wire sandbox credits sink into the meters + REPORTS layer`
   -- `sink.py`, wired into `service.py`; `entitlements/types.py` (Counter,
   quotas, REPORTS, CONSTRAINTS, DEFAULT_CATALOG TODO placeholders);
   `meters/types.py` mirror; `env.py` `SandboxConfig`.
3. `feat(billing): create-time + true-up gating on sandbox_credits` --
   `gating.py` + its test.
4. `chore(db): credit meters enum migration` -- `ee0000000005`.

Not pushed, per instructions.

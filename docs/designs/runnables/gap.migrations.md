# Gap Analysis: Migrations — Active Migration Backlog

> Status: resolved — see status table below
> Date: 2026-04-01
> Companion: [gap-analysis.md](./gap-analysis.md), [gap.catalog.md](./gap.catalog.md), [plan.md](./plan.md)

This document tracks migration work that remains in scope for the runnables rollout.

It is intentionally narrower than [gap.GMigrations.md](./gap.GMigrations.md), which remains the older consolidated migration snapshot. Use this file for the active migration backlog that still needs explicit handling, especially where the branch intentionally removed or simplified prior contracts.

## Rules

- Intentional contract breaks must be tracked here, not kept alive as generic active findings forever.
- No backward-compatibility shim is assumed by default.
- If a break later proves to be a real bug in a concrete consumer, reopen it as a scoped bug in the relevant workstream instead of restoring broad compatibility blindly.

## Resolution Status (as of 2026-04-01)

Full item-level status is tracked in [gap.GMigrations.md — Resolution Status](./gap.GMigrations.md#resolution-status-as-of-2026-04-01).

Summary:

- **DB migrations (M1, M3a, M3b, M3e):** DONE — Alembic migration `c2d3e4f5a6b7` handles URI backfills, flag normalization, legacy field stripping, and script flattening.
- **Flag derivation (M2a, M2c, M2e):** DONE — flags are inferred at commit time, not stored.
- **Flag rework (M2b, M2d):** WONTFIX — `is_human` stays; no `aggregate` param (implicit rule).
- **API responses (M4a, M4b):** DONE — derived flags in revision DTOs.
- **API filters (M4c):** WONTFIX — no `is_runnable` concept needed.
- **Frontend (M5a, M5b, M5c):** TODO — legacy `/openapi.json` schema extraction path to be removed with frontend rework.
- **Frontend (M5d):** WONTFIX — N/A.
- **Legacy adapter/serving (M6a, M6b):** DONE.

## Archived Migration Scope

### M1. Frontend and Consumer Alignment for Removed Runnable Fields

> Status: deferred to catalog integration work

**What:** Some API payload fields were intentionally removed or renamed in the runnable/catalog surface. That migration work now belongs to the consumer-alignment backlog rather than to the current branch findings list.

**Current state:**
- `ground_truth_key` was removed from evaluator schema payloads
- `advanced` was renamed to `x-ag-ui-advanced`
- this branch intentionally does not preserve backward compatibility for those old keys

**Target state:**
- active frontend and other consumers are updated to the new contract when the catalog/web integration work is taken on
- any real break discovered during that work is reopened as a concrete bug with a reproducer
- no generic compatibility shim is added to keep the old contract alive by default

**Depends on:** catalog integration work in [gap.catalog.md](./gap.catalog.md)

**Migration type:** Frontend / generated-type / consumer alignment

### M2. Database and Stored-Payload Migration Follow-Ups

> Status: DONE — Alembic migration `c2d3e4f5a6b7`

**What:** Runnable rollout still has explicit DB and stored-payload migration work that should be tracked as migration scope rather than as active code-review findings on every branch.

**Current state:**
- the branch is already mixed expand/contract
- some compatibility obligations are intentionally handled via migration work instead of runtime wrappers
- migration/backfill work remains a separate implementation track

**Target state:**
- DB and persisted-payload migrations are handled as explicit backlog work
- generated client and frontend shape alignment are handled where those migrations land
- findings are reopened only when a concrete migration gap turns into a reproducible bug

**Depends on:** plan checkpoints and concrete migration implementation work

**Migration type:** DB / payload normalization / client alignment

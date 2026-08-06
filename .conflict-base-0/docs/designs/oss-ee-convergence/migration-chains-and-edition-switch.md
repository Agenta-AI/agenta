# Migration chains and the OSS→EE edition switch

Decided design for splitting the alembic chains after the convergence stack,
and for supporting in-place OSS→EE switches. Companion docs:
[db-integrity-audit.md](db-integrity-audit.md), [pr-plan.md](pr-plan.md).

## Layout

This shows the **core** database. The **tracing** database has the same shape in
its own DB — legacy parked at `park00000000`, then `tracing_oss`
(`alembic_version_oss`) and `tracing_ee` (`alembic_version_ee`).

```
                LEGACY (frozen)                      POST-ALIGNMENT
        version table: alembic_version       alembic_version_oss      alembic_version_ee

OSS:  oss history ──► align ─╫ parked        s0 ─► s1 ─► … ─► sN      (never exists)
EE:   ee history ──►  align ─╫ parked        s0 ─► s1 ─► … ─► sN      e0 ─► e1 ─► … ─► eM
                       ▲                      ▲ new root,              ▲ new root,
   align = park00000000, SAME id in both      oss/…/core_oss/          ee/…/core_ee/
   editions (different down_revision);        runs in BOTH editions    EE only
   this is what makes adoption resolve
```

- The legacy chains are immutable history. Each gains one final empty revision
  (`park00000000`) and parks forever.
- The shared chain lives once, under `oss/` (`core_oss/`), tracked in
  `alembic_version_oss`, rooted at `oss000000000`. EE images ship the `oss/`
  tree, so EE runs it from there — no copies, no drift.
- The EE-only chain is rooted at `ee0000000000`; adoption lands at `ee0000000002`.
- Revision ids use readable 12-char prefixes (`park…`, `oss…`, `ee…`); alembic
  ids are arbitrary strings, not hex, so the prefix is free to encode the chain.
- The EE-only chain (`ee/…/core_ee/`, `alembic_version_ee`) holds every future
  EE-only change, however many times EE diverges. It never perturbs shared ids,
  so the editions never re-fork.
- Runner order (asserted, not assumed): legacy core → must be parked at align
  → shared core chain → (EE only) ee core chain → legacy tracing → must be
  parked at align → shared tracing chain → (EE only) ee tracing chain. New
  chains derive their alembic config from `__file__`; there is no env var to
  misconfigure.
- **Tracing gets the identical split**, in its own database: the legacy tracing
  chain parks at `park00000000`, then `tracing_oss`
  (`alembic_version_oss`, rooted at `oss000000000`, runs in both
  editions) and `tracing_ee` (`alembic_version_ee`, rooted at
  `ee0000000000`, EE only). The ids reuse the core scheme (`park…`/`oss…`/`ee…`):
  the tracing database has its own version tables, so there is no collision with
  the core chains. Tracing has no edition-divergent tables today, so `tracing_ee`
  is root + proof only (no adoption migration — no EE-only tracing schema to
  create on a switch).

## Rules

1. **FK discipline:** migrations in the ee chain may reference only EE tables
   and forever-stable shared PKs (`organizations.id`, `users.id`,
   `projects.id`, `workspaces.id`, `secrets.id`). Those columns are a frozen
   contract: no rename, no drop, no type change, ever.
2. **Replay skew:** on fresh installs and adoptions, the ee chain replays from
   zero against the shared schema at head — not as it was when each revision
   was written. EE migrations are therefore written defensively (conditional
   DDL, frozen shapes, no reads of mutable shared columns). A shared change
   that would break a replayed ee revision must patch the ee chain in the same
   PR.
3. **Table moves (EE → shared):** one conditional shared revision ("ensure
   table exists in canonical shape": creates on OSS, aligns drift on EE); the
   ee chain stops touching the table forever. Moves never go the other way
   (OSS ⊆ EE; a shared migration cannot drop in one edition only).
4. **Lifecycle/FK conventions:** per the integrity audit — six nullable
   lifecycle columns everywhere, no FKs on actor columns, hard CASCADE FK at
   the owning scope, loose UUIDs below it.

## Flows

```
                        alembic_version       alembic_version_oss   alembic_version_ee
fresh OSS               …→ align (parked)     s0…sN                 —
existing OSS upgrade    …→ align (parked)     s0…sN                 —
fresh EE                …→ align (parked)     s0…sN                 e0…eM
existing EE upgrade     …→ align (parked)     s0…sN                 e0…eM
OSS→EE switch           align (same id ⇒      already at sK,        ∅ → e0 (adoption:
                        resolves from EE)     continues → sN              create+backfill) → eM
```

Floor rule: an OSS database must be at the align revision (or later) before
switching editions; pre-align OSS ids are unresolvable from the EE config.

## OSS→EE switch runbook

The adoption revision (`e0`-successor in the ee chain, shipped by the switch
PR) creates the EE-only tables if missing and backfills: one subscription per
org on the configured free plan (anchor = switch day), the USERS gauge per org
recomputed from memberships. Domains/providers start empty. Database names
resolve as: explicit `POSTGRES_URI_*` → `POSTGRES_DB_PREFIX` + existing
user/password/port vars → `agenta_{license}` (today's default).

Docker compose — migrations run via the stack's `alembic` service; the project
name must stay the same so the EE stack reuses the OSS postgres volume:

```bash
cd hosting/docker-compose/oss
docker compose -p agenta-oss-gh -f docker-compose.gh.yml --env-file .env.oss.gh down
# optional backup: up -d postgres; exec postgres pg_dumpall -U username > backup.sql

cd ../ee   # .env.ee.gh: carry over AGENTA_AUTH_KEY + supertokens keys,
           # set POSTGRES_DB_PREFIX=agenta_oss
docker compose -p agenta-oss-gh -f docker-compose.gh.yml --env-file .env.ee.gh up -d
```

Kubernetes — edition comes from `agenta.license`; the post-upgrade hook Job
runs the runner against the same PVCs:

```bash
helm upgrade agenta <chart> -f values.yaml \
  --set agenta.license=ee --set postgres.dbPrefix=agenta_oss
kubectl logs -f job/agenta-alembic
```

## Enforcement

CI replays three flows from scratch and diffs schema dumps (the dump script in
this folder prints all three version tables): OSS scratch, EE scratch, and
OSS-then-switch. A frozen-contract breach or replay-skew regression fails the
build the day it is written.

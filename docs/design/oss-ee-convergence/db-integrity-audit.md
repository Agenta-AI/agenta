# Database integrity audit — lifecycle columns and foreign keys

Full per-table audit of both editions' core databases plus the tracing
database, against the conventions settled in the phase-2 review. Source of
truth: the DBA/DBE classes and `db_models.py` (verified against the schema
dumps where they existed). Companion to the phase-2 task list in
[pr-plan.md](pr-plan.md).

## Target conventions

1. **Lifecycle, every table, no exceptions:** `created_at` (NOT NULL, server
   default now), `updated_at`, `deleted_at`, `created_by_id`, `updated_by_id`,
   `deleted_by_id`. None of the `*_by_id` columns carry FKs, period.
2. **FK policy:** hard FK with `ON DELETE CASCADE` from a row to its *owning
   scope* (the thing whose deletion should erase it), targeting forever-stable
   PKs only (`organizations.id`, `workspaces.id`, `projects.id`, `users.id`,
   `secrets.id`, and same-domain parent PKs). Everything below the owning
   scope — secondary scope dimensions, lifecycle actors, analytics
   dimensions — stays a loose UUID so history survives deletions.
3. **Cross-database references can never be FKs** (core ↔ tracing).
4. **Models and DB must agree** — every column mapped, every FK declaration
   matching the real constraint.

Settled: all six lifecycle columns are fully nullable, everywhere, for
backward compatibility — one rule, no exceptions. `created_at` keeps its
server default (never NULL in practice); the NOT NULLs that `LifecycleDBA`
declares today on `created_at`/`created_by_id` are relaxed in the cleanup
migration (`DROP NOT NULL` is metadata-only) and removed from the mixin, which
also retires the per-table nullable overrides (events, webhook_deliveries).

This relaxation is GLOBAL: every table built on LifecycleDBA gets
`ALTER COLUMN created_at DROP NOT NULL` and `ALTER COLUMN created_by_id DROP
NOT NULL` in the cleanup migration. The per-table "Fixes" columns below list
only work beyond that global pass — "none" means "nothing besides the global
nullability relaxation".

## Verdicts — core, account tables (shared)

| Table | Lifecycle | FKs | Fixes |
| --- | --- | --- | --- |
| `organizations` | full six | `owner_id`→users ✓ (domain, keep); FKs on `created/updated/deleted_by_id` ✗ | drop the 3 lifecycle FKs |
| `users` | `created_at`, `updated_at` only | — | add `deleted_at` + actor trio |
| `workspaces` | `created_at`, `updated_at` only | org ✓ CASCADE | add `deleted_at` + actor trio |
| `projects` | `created_at`, `updated_at` only | org ✓, workspace ✓ CASCADE | add `deleted_at` + actor trio |
| `organization_members` | DB has `created_at/updated_at/updated_by_id`; **model maps none of them** | org ✓ CASCADE; user FK: **model says CASCADE, DB has NO ACTION** | map existing columns; add missing three; DB user FK → CASCADE |
| `workspace_members` | model misses `updated_by_id` (DB has it) | same drift as above | same |
| `project_members` | model misses `updated_by_id` (DB has it) | same drift as above | same |
| `project_invitations` | `created_at` + `expiration_date` (domain col, keep) | project ✓ CASCADE; `user_id`→users no-action | add five missing lifecycle cols; `user_id` FK → SET NULL (domain ref, stable target) |
| `api_keys` | has `created_at/updated_at/created_by_id` + `expiration_date` | `project_id` ✓ CASCADE; `created_by_id`→users FK ✗ (rule) | drop FK (OSS migration; EE parity no longer adds it — amended); add `deleted_at`, `updated_by_id`, `deleted_by_id` |
| `secrets` | LegacyLifecycleDBA (`created_at/updated_at/updated_by_id`) | `project_id`, `organization_id` loose | move to full six; add owning-scope FKs CASCADE (note: cascades through `organization_providers.secret_id`) |
| `user_identities` | full six ✓ | `user_id`→users CASCADE ✓ | none |

## Verdicts — core, new-architecture tables

| Table(s) | Lifecycle | FKs | Fixes |
| --- | --- | --- | --- |
| `workflow_/testset_/query_/environment_` × `artifacts/variants/revisions` | full six ✓ (global relaxation applies) | project CASCADE ✓; composite scoped parent FKs ✓; `folder_id`→folders SET NULL ✓ | none — this is the reference pattern for FKs |
| `testcase_blobs` | full six ✓ | project ✓; `set_id`→testset_artifacts CASCADE ✓ | none |
| `folders` | full six ✓ | project ✓; self-ref parent CASCADE ✓ | none |
| `tool_connections` | full six ✓ | project ✓ | none |
| `evaluation_runs/scenarios/results/metrics/queues` | full six ✓ | project + composite run/scenario FKs ✓; `testcase_id`/`trace_id` loose (history, cross-DB) ✓ | none |
| `webhook_subscriptions` | full six ✓ | project ✓; `secret_id` SET NULL ✓; `created_by_id`→users FK ✗ (rule) | drop the `created_by_id` FK |
| `webhook_deliveries` | full six ✓ (`created_by_id` nullable: system actor, fine) | all loose | add `project_id`→projects CASCADE and `subscription_id`→webhook_subscriptions CASCADE; `event_id` stays loose (**cross-DB**: events lives in tracing) |

Accepted deviation: `RevisionDBA` also carries `author`/`date`/`message`
(CommitDBA). `author` is commit semantics, not row lifecycle; it stays,
loose, alongside `created_by_id`.

## Verdicts — core, EE-only tables

| Table | Lifecycle | FKs | Fixes |
| --- | --- | --- | --- |
| `subscriptions` | none | **no FK to organizations at all** | add full six; add `organization_id`→organizations CASCADE |
| `meters` | none | `organization_id`→subscriptions(organization_id), no ondelete | add full six (actor cols nullable: system writes); retarget FK → organizations.id CASCADE |
| `organization_domains` | full six ✓ | org CASCADE ✓ | none |
| `organization_providers` | full six ✓ | org CASCADE ✓; secret CASCADE ✓ | none |

## Verdicts — tracing database

| Table | Lifecycle | FKs | Fixes |
| --- | --- | --- | --- |
| `spans` | full six ✓ (`created_by_id` per system-actor note) | `project_id` loose (**cross-DB, by necessity**); `parent_id` loose self-ref (OTLP spans arrive out of order; partial trees are valid) | none |
| `events` | full six ✓ (`created_by_id` nullable: system) | `project_id` loose (**cross-DB**) | none |

## Cosmetic / model-only cleanups (no schema change)

- `db_models.py` account tables use `DateTime(timezone=True)` + Python-lambda
  defaults; the dbas standard is `TIMESTAMP(timezone=True)` + `server_default`.
  Identical in Postgres; align the model declarations when touching them.
- After the FK drops land, remove the corresponding `ForeignKey(...)`
  declarations from `OrganizationDB`, `APIKeyDB`, `WebhookSubscriptionDBA`
  so models and DB agree.

## Execution notes

- All fixes above land in the existing cleanup PR (#4676), as one migration
  per chain (OSS core, EE core; tracing needs nothing), before the alignment
  point — the post-split chains start with zero debt.
- The EE parity migration (#4671) was amended in place rather than
  add-then-drop: it no longer creates the `api_keys.created_by_id` FK
  (nothing in this stack has shipped, so editing unshipped migrations is the
  rule — never ship a constraint a later unshipped PR removes).
- Verification: regenerate the schema dumps after the cleanup and re-diff;
  the OSS↔EE cross-edition diff should then show only the four EE tables,
  `meters_type`, and the chain heads.

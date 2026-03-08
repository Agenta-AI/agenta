# rubrics/databases.md – Database Review

**Domain:** Schema design, migrations, query safety, data integrity, access control.
**Applies to:** Schema changes, ORM models, raw SQL, migration scripts, seed data, and stored procedures.

---

## Goals

- Verify that schema changes are backward-compatible and safely reversible.
- Confirm that queries are safe from injection and efficient at scale.
- Ensure data integrity constraints are defined and enforced at the database level.

---

## Checklist

### Schema design

| # | Criterion | Severity if violated |
|---|---|---|
| D‑1 | Primary keys are defined on every table | high |
| D‑2 | Foreign key constraints are declared for relationships; orphaned rows cannot exist silently | high |
| D‑3 | NOT NULL constraints are applied to columns that must always have a value | medium |
| D‑4 | Unique constraints are defined at the DB level, not only in application code | medium |
| D‑5 | Column types match their semantic purpose (e.g., `DECIMAL` for money, `TIMESTAMPTZ` for timestamps) | medium |
| D‑6 | Indexes exist on columns used in `WHERE`, `JOIN`, `ORDER BY`, and `GROUP BY` clauses on large tables | high |
| D‑7 | Composite indexes have columns ordered from most to least selective | medium |
| D‑8 | Indexes are not duplicated or superseded by broader existing indexes | low |

### Migrations

| # | Criterion | Severity if violated |
|---|---|---|
| D‑9 | Each migration has a corresponding rollback / down migration | high |
| D‑10 | `ALTER TABLE … ADD COLUMN` on a large table does not lock the table for a significant duration (uses `DEFAULT` only in supported DB versions, or a multi-step migration) | high |
| D‑11 | Column renames and type changes are done in phases to preserve backward compatibility | high |
| D‑12 | Data migrations are idempotent; re-running them does not corrupt data | high |
| D‑13 | Seed data and test fixtures are clearly separated from production migrations | medium |
| D‑14 | Migrations do not drop columns or tables while application code still references them | critical |

### Query safety and correctness

| # | Criterion | Severity if violated |
|---|---|---|
| D‑15 | All queries use parameterised statements or the ORM's query builder; no string interpolation with user input | critical |
| D‑16 | `DELETE` and `UPDATE` statements have `WHERE` clauses; a missing `WHERE` is deliberate and documented | critical |
| D‑17 | Transactions wrap multi-step writes that must succeed or fail atomically | high |
| D‑18 | Long-running queries are time-boxed with a statement timeout | medium |
| D‑19 | `EXPLAIN` / query plan has been checked for expensive full-table scans on large tables | high |

### Data integrity

| # | Criterion | Severity if violated |
|---|---|---|
| D‑20 | Business rules that must always hold are enforced by constraints, not only by application logic | medium |
| D‑21 | Enum types or check constraints prevent invalid values from being stored | medium |
| D‑22 | Soft-delete patterns include a clear convention (e.g., `deleted_at` column) and queries filter on it consistently | medium |
| D‑23 | Cascading deletes are intentional and documented; accidental data loss is prevented | high |

### Access control

| # | Criterion | Severity if violated |
|---|---|---|
| D‑24 | Application users connect with the minimum required DB privileges (no `SUPERUSER` or `DBA` for the app user) | high |
| D‑25 | Sensitive columns (PII, tokens) are encrypted at rest or access is restricted at the row level | high |
| D‑26 | Audit trail tables or triggers exist for regulated data that requires change history | medium |

---

## Scoring guidance

Unsafe migration patterns (lock-heavy `ALTER TABLE`, missing rollback) on a live production database with large tables are **high** or **critical** depending on the expected downtime.  Missing parameterisation is always **critical**.  Schema design issues without immediate impact are **medium**.

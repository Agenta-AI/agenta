# Migrations with Alembic

> [!IMPORTANT]
> **This `tracing/` chain is PARKED (frozen legacy history).** Do **not** add new
> revisions here — it ends at `park00000000` and never advances. Author new tracing
> migrations in `tracing_oss/` (shared, runs in both editions) or `tracing_ee/` (EE-only).
> See the parked `core/README.md` banner and
> `docs/designs/oss-ee-convergence/migration-chains-and-edition-switch.md`.

Generic single-database configuration with an async dbapi.

## Autogenerate Migrations

One of Alembic's key features is its ability to auto-generate migration scripts. By analyzing the current database state and comparing it with the application's table metadata, Alembic can automatically generate the necessary migration scripts using the `--autogenerate` flag in the alembic revision command.

Note that autogenerate sometimes does not detect all database changes and it is always necessary to manually review (and correct if needed) the candidate migrations that autogenerate produces.

### Making migrations

To make migrations after creating a new table schema or modifying a current column in a table, run the following commands:


```bash
docker exec -e PYTHONPATH=/app -w /app/oss/databases/postgres/migrations/tracing agenta-oss-dev-api-1 alembic -c alembic.ini revision --autogenerate -m "migration message"
```

The above command will create a script that contains the changes that was made to the database schema. Kindly update "migration message" with a message that is clear to indicate what change was made. Here are some examples:

- added username column in users table
- renamed template_uri to template_repository_uri
- etc

### Applying Migrations

```bash
docker exec -e PYTHONPATH=/app -w /app/oss/databases/postgres/migrations/tracing agenta-oss-dev-api-1 alembic -c alembic.ini upgrade head
```

The above command will be used to apply the changes in the script created to the database table(s).

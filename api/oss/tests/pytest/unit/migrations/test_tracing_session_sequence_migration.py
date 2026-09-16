import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config
import asyncpg
import pytest

from oss.src.dbs.postgres.shared import config as postgres_config


DATABASE_NAME = "agenta_m2idx_tracing"
ADMIN_DSN = "postgresql://username:password@localhost:5444/postgres"
DATABASE_DSN = f"postgresql://username:password@localhost:5444/{DATABASE_NAME}"
SQLALCHEMY_URL = (
    f"postgresql+asyncpg://username:password@localhost:5444/{DATABASE_NAME}"
)
VERSIONS_ROOT = (
    Path(__file__).resolve().parents[4] / "databases/postgres/migrations/tracing_oss"
)


async def _recreate_database() -> None:
    admin = await asyncpg.connect(ADMIN_DSN)
    try:
        await admin.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname=$1 AND pid<>pg_backend_pid()",
            DATABASE_NAME,
        )
        await admin.execute(f'DROP DATABASE IF EXISTS "{DATABASE_NAME}"')
        await admin.execute(f'CREATE DATABASE "{DATABASE_NAME}"')
    finally:
        await admin.close()


async def _drop_database() -> None:
    admin = await asyncpg.connect(ADMIN_DSN)
    try:
        await admin.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname=$1 AND pid<>pg_backend_pid()",
            DATABASE_NAME,
        )
        await admin.execute(f'DROP DATABASE IF EXISTS "{DATABASE_NAME}"')
    finally:
        await admin.close()


async def _prepare_records_table(row_count: int) -> None:
    connection = await asyncpg.connect(DATABASE_DSN)
    try:
        await connection.execute(
            """
            CREATE TABLE records (
                project_id UUID NOT NULL,
                record_id UUID NOT NULL,
                session_id VARCHAR NOT NULL,
                payload INTEGER NOT NULL,
                PRIMARY KEY (project_id, record_id)
            );
            CREATE TABLE alembic_version_oss (
                version_num VARCHAR(32) NOT NULL
            );
            INSERT INTO alembic_version_oss (version_num)
            VALUES ('oss000000005');
            """
        )
        if row_count:
            await connection.execute(
                """
                INSERT INTO records (project_id, record_id, session_id, payload)
                SELECT
                    '00000000-0000-0000-0000-000000000001'::uuid,
                    md5(value::text)::uuid,
                    'session-' || (value % 32),
                    value
                FROM generate_series(1, $1) AS value
                """,
                row_count,
            )
    finally:
        await connection.close()


async def _migration_result() -> tuple[int, int | None, int, str]:
    connection = await asyncpg.connect(DATABASE_DSN)
    try:
        row = await connection.fetchrow(
            """
            SELECT
                count(*) AS row_count,
                sum(payload) AS payload_sum,
                count(*) FILTER (WHERE sequence IS NULL) AS null_sequences
            FROM records
            """
        )
        index_definition = await connection.fetchval(
            """
            SELECT indexdef
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'records'
              AND indexname = 'ux_records_session_id_sequence'
            """
        )
        return (
            row["row_count"],
            row["payload_sum"],
            row["null_sequences"],
            index_definition,
        )
    finally:
        await connection.close()


async def _downgrade_result() -> tuple[int, int | None, bool, bool, bool]:
    connection = await asyncpg.connect(DATABASE_DSN)
    try:
        row = await connection.fetchrow(
            "SELECT count(*) AS row_count, sum(payload) AS payload_sum FROM records"
        )
        index_exists = await connection.fetchval(
            "SELECT to_regclass('public.ux_records_session_id_sequence') IS NOT NULL"
        )
        sequence_exists = await connection.fetchval(
            """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'records'
                  AND column_name = 'sequence'
            )
            """
        )
        cursor_table_exists = await connection.fetchval(
            "SELECT to_regclass('public.session_sequence_cursors') IS NOT NULL"
        )
        return (
            row["row_count"],
            row["payload_sum"],
            index_exists,
            sequence_exists,
            cursor_table_exists,
        )
    finally:
        await connection.close()


@pytest.fixture
def scratch_tracing_database():
    try:
        asyncio.run(_recreate_database())
    except (OSError, asyncpg.PostgresConnectionError) as exc:
        pytest.skip(f"scratch Postgres is unavailable: {exc}")

    try:
        yield
    finally:
        asyncio.run(_drop_database())


def test_session_sequence_migration_preserves_records_and_creates_index(
    monkeypatch,
    scratch_tracing_database,
):
    monkeypatch.setattr(postgres_config, "POSTGRES_URI_TRACING", SQLALCHEMY_URL)

    for row_count in (0, 4096):
        asyncio.run(_recreate_database())
        asyncio.run(_prepare_records_table(row_count))

        alembic_config = Config()
        alembic_config.set_main_option("script_location", str(VERSIONS_ROOT))
        command.upgrade(alembic_config, "oss000000006")

        actual_count, payload_sum, null_sequences, index_definition = asyncio.run(
            _migration_result()
        )
        expected_sum = row_count * (row_count + 1) // 2 if row_count else None
        assert actual_count == row_count
        assert payload_sum == expected_sum
        assert null_sequences == row_count
        assert index_definition is not None
        assert "UNIQUE INDEX" in index_definition
        assert "(project_id, session_id, sequence)" in index_definition

        command.downgrade(alembic_config, "oss000000005")
        downgrade_result = asyncio.run(_downgrade_result())
        assert downgrade_result == (row_count, expected_sum, False, False, False)

"""The data migration that moves an MCP endpoint's credential header onto a binding.

Runs `oss000000041`'s own `upgrade()` and `downgrade()` against a real Postgres, over a
scratch database holding the one table and column they touch. Real SQL, because the
migration is `jsonb` path editing on a `json` column, which a fake cannot check.
"""

from __future__ import annotations

import importlib.util
import json
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.ext.asyncio import create_async_engine

from oss.src.core.gateways.mcps.dtos import MCPEndpointData
from oss.tests.pytest.utils.postgres import require_core_uri

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]

_REVISION_PATH = (
    Path(__file__).resolve().parents[4]
    / "databases/postgres/migrations/core_oss/versions"
    / "oss000000041_move_mcp_credential_header_to_binding.py"
)

_SCHEMA = """
CREATE TABLE mcps_endpoints (
    id UUID PRIMARY KEY,
    data JSON
)
"""

_URL = "https://mcp.example.com/mcp"


def _load_revision():
    """Import the revision file by path; `versions/` is not an importable package."""
    spec = importlib.util.spec_from_file_location("_binding_revision", _REVISION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
async def scratch_engine():
    """A database of this test's own, created and dropped around it."""
    core_uri = require_core_uri()

    database = f"agenta_binding_{uuid.uuid4().hex[:12]}"
    admin = create_async_engine(core_uri, isolation_level="AUTOCOMMIT")
    async with admin.connect() as connection:
        await connection.execute(sa.text(f'CREATE DATABASE "{database}"'))
    await admin.dispose()

    engine = create_async_engine(core_uri.rsplit("/", 1)[0] + f"/{database}")
    try:
        async with engine.begin() as connection:
            await connection.execute(sa.text(_SCHEMA))
        yield engine
    finally:
        await engine.dispose()
        admin = create_async_engine(core_uri, isolation_level="AUTOCOMMIT")
        async with admin.connect() as connection:
            await connection.execute(
                sa.text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :name AND pid <> pg_backend_pid()"
                ),
                {"name": database},
            )
            await connection.execute(sa.text(f'DROP DATABASE IF EXISTS "{database}"'))
        await admin.dispose()


async def _seed(engine, data) -> uuid.UUID:
    endpoint_id = uuid.uuid4()
    async with engine.begin() as connection:
        await connection.execute(
            sa.text("INSERT INTO mcps_endpoints (id, data) VALUES (:id, :data)"),
            {"id": endpoint_id, "data": None if data is None else json.dumps(data)},
        )
    return endpoint_id


async def _data_of(engine, endpoint_id):
    async with engine.connect() as connection:
        result = await connection.execute(
            sa.text("SELECT data FROM mcps_endpoints WHERE id = :id"),
            {"id": endpoint_id},
        )
        return result.scalar()


async def _run(engine, step: str) -> None:
    def run(sync_connection) -> None:
        context = MigrationContext.configure(sync_connection)
        with Operations.context(context):
            getattr(_load_revision(), step)()

    async with engine.begin() as connection:
        await connection.run_sync(run)


async def test_a_named_header_becomes_a_header_binding_with_no_prefix(scratch_engine):
    """No prefix, because the old field sent the value verbatim."""
    endpoint_id = await _seed(
        scratch_engine,
        {
            "route": {"base_url": _URL, "credential_header": " x-api-key "},
            "tools": {"allowlist": ["search"]},
        },
    )

    await _run(scratch_engine, "upgrade")

    data = await _data_of(scratch_engine, endpoint_id)
    assert data == {
        "route": {
            "base_url": _URL,
            "credential_binding": {"kind": "header", "name": "x-api-key"},
        },
        "tools": {"allowlist": ["search"]},
    }
    # The row the migration wrote is one the API reads.
    assert MCPEndpointData(**data).route.credential_binding.name == "x-api-key"


@pytest.mark.parametrize("blank", ["", "   ", None])
async def test_a_blank_header_is_dropped_and_falls_back_to_bearer(
    scratch_engine, blank
):
    endpoint_id = await _seed(
        scratch_engine, {"route": {"base_url": _URL, "credential_header": blank}}
    )

    await _run(scratch_engine, "upgrade")

    data = await _data_of(scratch_engine, endpoint_id)
    assert data == {"route": {"base_url": _URL}}
    assert MCPEndpointData(**data).route.credential_binding is None


async def test_rows_without_the_field_are_left_alone(scratch_engine):
    untouched = {"route": {"base_url": _URL}, "oauth": {"scopes_offered": ["read"]}}
    endpoint_id = await _seed(scratch_engine, untouched)
    empty_id = await _seed(scratch_engine, None)

    await _run(scratch_engine, "upgrade")

    assert await _data_of(scratch_engine, endpoint_id) == untouched
    assert await _data_of(scratch_engine, empty_id) is None


async def test_downgrade_restores_a_header_binding_with_no_prefix(scratch_engine):
    original = {"route": {"base_url": _URL, "credential_header": "x-api-key"}}
    endpoint_id = await _seed(scratch_engine, original)

    await _run(scratch_engine, "upgrade")
    await _run(scratch_engine, "downgrade")

    assert await _data_of(scratch_engine, endpoint_id) == original


@pytest.mark.parametrize(
    "binding",
    [
        {"kind": "header", "name": "Authorization", "prefix": "Basic"},
        {"kind": "query", "name": "exaApiKey"},
    ],
)
async def test_downgrade_drops_a_binding_the_old_field_cannot_express(
    scratch_engine, binding
):
    endpoint_id = await _seed(
        scratch_engine, {"route": {"base_url": _URL, "credential_binding": binding}}
    )

    await _run(scratch_engine, "downgrade")

    assert await _data_of(scratch_engine, endpoint_id) == {"route": {"base_url": _URL}}


async def test_a_key_in_the_url_survives_a_rollback_and_a_new_upgrade(scratch_engine):
    """Downgrade drops the `url` binding but the URL keeps `{secret}`; upgrade restores it."""
    url = "https://mcp.example.com/{secret}/v2/mcp"
    original = {"route": {"base_url": url, "credential_binding": {"kind": "url"}}}
    endpoint_id = await _seed(scratch_engine, original)

    await _run(scratch_engine, "downgrade")
    assert await _data_of(scratch_engine, endpoint_id) == {"route": {"base_url": url}}

    await _run(scratch_engine, "upgrade")

    data = await _data_of(scratch_engine, endpoint_id)
    assert data == original
    # The row the migration wrote is one the API reads.
    assert MCPEndpointData(**data).route.credential_binding.kind == "url"

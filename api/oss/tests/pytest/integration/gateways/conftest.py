import uuid

import pytest
from sqlalchemy import text

import oss.src.dbs.postgres.secrets.dbes  # noqa: F401  — registers `secrets`
import oss.src.dbs.postgres.shared.engine as engine_module
import oss.src.models.db_models  # noqa: F401  — registers `projects`; both FK targets
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.postgres import use_reachable_core_uri


@pytest.fixture(autouse=True)
def _skip_when_postgres_unreachable(request):
    # Keyed on the fixture, not the directory: the mock-upstream module lives here too
    # and needs the two mock services, never Postgres.
    if "seeded_project" not in request.fixturenames:
        return
    if use_reachable_core_uri() is None:
        pytest.skip("Postgres not reachable — skipping gateways DAO integration tests")


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    # asyncpg binds its connections to the loop that opened them, and each test gets a
    # new loop — a cached engine from an earlier test fails with "attached to a
    # different loop" (same fixture as integration/sessions).
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def seeded_project():
    """Provision the FK chain (org -> workspace -> project) and one bare
    `secrets` row, so llm_gateway_endpoints.secret_id / mcp_gateway_grants.secret_id
    have a real target to reference. The row's `data` is intentionally NULL — these
    tests never decrypt it, they only exercise the FK's ondelete behaviour."""
    engine = get_transactions_engine()
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    project_id = uuid.uuid4()
    secret_id = uuid.uuid4()

    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, uid, username, email) "
                "VALUES (:id, :uid, :username, :email)"
            ),
            {
                "id": user_id,
                "uid": str(user_id),
                "username": "gateways-dao-test",
                "email": f"gateways-dao-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {"id": organization_id, "name": "gw-org", "owner_id": user_id},
        )
        await session.execute(
            text(
                "INSERT INTO workspaces (id, name, organization_id) "
                "VALUES (:id, :name, :organization_id)"
            ),
            {"id": workspace_id, "name": "gw-ws", "organization_id": organization_id},
        )
        await session.execute(
            text(
                "INSERT INTO projects "
                "(id, project_name, workspace_id, organization_id) "
                "VALUES (:id, :name, :workspace_id, :organization_id)"
            ),
            {
                "id": project_id,
                "name": "gw-project",
                "workspace_id": workspace_id,
                "organization_id": organization_id,
            },
        )
        await session.execute(
            text("INSERT INTO secrets (id, project_id) VALUES (:id, :project_id)"),
            {"id": secret_id, "project_id": project_id},
        )
        await session.commit()

    yield {
        "project_id": project_id,
        "user_id": user_id,
        "secret_id": secret_id,
    }

    async with engine.session() as session:
        await session.execute(
            text("DELETE FROM llm_gateway_endpoints WHERE project_id = :project_id"),
            {"project_id": project_id},
        )
        await session.execute(
            text("DELETE FROM mcp_gateway_grants WHERE project_id = :project_id"),
            {"project_id": project_id},
        )
        await session.execute(
            text("DELETE FROM mcp_gateway_endpoints WHERE project_id = :project_id"),
            {"project_id": project_id},
        )
        await session.execute(
            text("DELETE FROM secrets WHERE project_id = :project_id"),
            {"project_id": project_id},
        )
        await session.execute(
            text("DELETE FROM projects WHERE id = :id"), {"id": project_id}
        )
        await session.execute(
            text("DELETE FROM workspaces WHERE id = :id"), {"id": workspace_id}
        )
        await session.execute(
            text("DELETE FROM organizations WHERE id = :id"),
            {"id": organization_id},
        )
        await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        await session.commit()

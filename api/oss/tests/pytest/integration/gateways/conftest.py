import json
import uuid
from dataclasses import dataclass, field
from urllib.parse import parse_qs
from uuid import UUID

import httpx

import pytest
from sqlalchemy import text

import oss.src.dbs.postgres.secrets.dbes  # noqa: F401  — registers `secrets`
import oss.src.dbs.postgres.shared.engine as engine_module
import oss.src.models.db_models  # noqa: F401  — registers `projects`; both FK targets
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.core.gateways.mcps.oauth.client import MCPOAuthClient
from oss.src.core.gateways.mcps.oauth.service import MCPOAuthConnectService
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.services import VaultService
from oss.tests.pytest.utils.postgres import use_reachable_core_uri


@dataclass
class LocalMCPOAuthProvider:
    """In-process RFC-shaped OAuth provider for gateway service integration tests.

    It intentionally exposes endpoints and callback parameters, never token values.
    Consumers inject ``transport`` into ``MCPOAuthClient``; this keeps the integration
    deterministic and avoids binding a TCP listener during parallel pytest runs.
    """

    server_url: str = "https://mcp.oauth.local/"
    authorization_server: str = "https://auth.oauth.local/"
    _codes: set[str] = field(default_factory=set)

    @property
    def authorize_url(self) -> str:
        return f"{self.authorization_server}authorize"

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def issue_code(self, *, subject: str = "test-user") -> str:
        code = f"code-{subject}-{uuid.uuid4().hex}"
        self._codes.add(code)
        return code

    def callback_params(self, *, state: str, code: str | None = None) -> dict[str, str]:
        return {"code": code or self.issue_code(), "state": state}

    def _handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/.well-known/oauth-protected-resource":
            return httpx.Response(
                200,
                json={
                    "resource": self.server_url,
                    "authorization_servers": [self.authorization_server],
                    "scopes_supported": ["tools:call"],
                },
            )
        if path == "/.well-known/oauth-authorization-server":
            return httpx.Response(
                200,
                json={
                    "issuer": self.authorization_server,
                    "authorization_endpoint": self.authorize_url,
                    "token_endpoint": f"{self.authorization_server}token",
                    "registration_endpoint": f"{self.authorization_server}register",
                    "scopes_supported": ["tools:call"],
                },
            )
        if path == "/register":
            return httpx.Response(
                201,
                json={
                    **json.loads(request.content),
                    "client_id": "local-mcp-oauth-client",
                    "client_secret": "local-mcp-oauth-client-secret",
                },
            )
        if path == "/token":
            code = parse_qs(request.content.decode()).get("code", [None])[0]
            if code not in self._codes:
                return httpx.Response(400, json={"error": "invalid_grant"})
            self._codes.remove(code)
            return httpx.Response(
                200,
                json={
                    "access_token": f"local-access-{uuid.uuid4().hex}",
                    "refresh_token": f"local-refresh-{uuid.uuid4().hex}",
                    "token_type": "Bearer",
                    "expires_in": 3600,
                    "scope": "tools:call",
                },
            )
        return httpx.Response(404)


@pytest.fixture
def local_mcp_oauth_provider() -> LocalMCPOAuthProvider:
    return LocalMCPOAuthProvider()


class _InMemorySecretsDAO:
    """The narrow SecretsDAO shape exercised by the OAuth storage adapter."""

    def __init__(self) -> None:
        self.records: list[tuple[UUID, SecretResponseDTO]] = []

    def _scoped(self, project_id: UUID) -> list[SecretResponseDTO]:
        return [record for owner, record in self.records if owner == project_id]

    async def create(self, *, project_id=None, organization_id=None, create_secret_dto):
        record = SecretResponseDTO(
            id=uuid.uuid4(),
            slug=create_secret_dto.slug,
            kind=create_secret_dto.secret.kind,
            data=create_secret_dto.secret.data.model_dump(exclude_none=True),
            header=create_secret_dto.header,
        )
        self.records.append((project_id, record))
        return record

    async def get_by_id(self, secret_id, project_id=None, organization_id=None):
        return next(
            (record for record in self._scoped(project_id) if record.id == secret_id),
            None,
        )

    async def get_by_slug(self, secret_slug, project_id=None, organization_id=None):
        return next(
            (
                record
                for record in self._scoped(project_id)
                if record.slug == secret_slug
            ),
            None,
        )

    async def list(self, project_id=None, organization_id=None):
        return self._scoped(project_id)

    async def update(
        self,
        secret_id,
        update_secret_dto,
        project_id=None,
        organization_id=None,
        user_id=None,
        resolve_update=None,
    ):
        existing = await self.get_by_id(secret_id, project_id=project_id)
        if existing is None:
            return None
        if resolve_update is not None:
            update_secret_dto = resolve_update(existing, update_secret_dto)
        updated = SecretResponseDTO(
            id=existing.id,
            slug=existing.slug,
            kind=existing.kind,
            data=update_secret_dto.secret.data.model_dump(exclude_none=True),
            header=update_secret_dto.header or existing.header,
        )
        self.records[self.records.index((project_id, existing))] = (project_id, updated)
        return updated

    async def delete(self, secret_id, project_id=None, organization_id=None):
        self.records = [
            (owner, record)
            for owner, record in self.records
            if not (owner == project_id and record.id == secret_id)
        ]


@pytest.fixture
def local_mcp_oauth_connect_service(local_mcp_oauth_provider):
    """Service+vault fixture for the local OAuth provider integration contract."""
    dao = _InMemorySecretsDAO()
    service = MCPOAuthConnectService(
        vault_service=VaultService(secrets_dao=dao),
        client=MCPOAuthClient(transport=local_mcp_oauth_provider.transport),
        api_url="https://api.oauth.local",
        secret_key="local-mcp-oauth-test-key",
        resolve=lambda _hostname: ["10.0.0.1"],
    )
    return service, dao


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
    `secrets` row, so llms_endpoints.secret_id / mcps_endpoints.secret_id
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
            text("DELETE FROM llms_endpoints WHERE project_id = :project_id"),
            {"project_id": project_id},
        )
        await session.execute(
            text("DELETE FROM mcps_endpoints WHERE project_id = :project_id"),
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

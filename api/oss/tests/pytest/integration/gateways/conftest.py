import json
import uuid
from dataclasses import dataclass, field
from urllib.parse import parse_qs, urlparse
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
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.tests.pytest.utils.mcp_oauth_attempts import InMemoryMCPOAuthAttemptsDAO
from oss.tests.pytest.utils.postgres import use_reachable_core_uri

# example.com: routable and in no blocked range.
_PUBLIC_ADDRESS = "93.184.216.34"


@pytest.fixture
def _public_dns_for_the_oauth_provider(monkeypatch):
    """The OAuth client resolves and pins before it dials (`core/gateways/egress.py`).

    The in-process provider below answers on `.local` names that no resolver knows, so the
    gateway's own resolver returns one public address for them. The guard still runs for
    real against that answer; the refusal cases live in
    `unit/gateways/test_gateways_egress.py`.

    Deliberately not autouse, and deliberately not a patch of `socket.getaddrinfo`. Patching
    the socket module replaces DNS for every test in this directory, including the ones that
    only touch Postgres, and a stubbed answer missing a real address family fails those at
    setup wherever the database is reached by hostname.
    """
    monkeypatch.setattr(
        "oss.src.core.gateways.egress.resolve_validated_ip",
        lambda hostname, **_kwargs: _PUBLIC_ADDRESS,
    )


@dataclass
class LocalMCPOAuthProvider:
    """In-process RFC-shaped OAuth provider for gateway service integration tests.

    It intentionally exposes endpoints and callback parameters, never token values.
    Consumers inject ``transport`` into ``MCPOAuthClient``; this keeps the integration
    deterministic and avoids binding a TCP listener during parallel pytest runs.

    It is also the MCP server the authorization protects: a ``POST`` at the server URL is
    answered only for a bearer this provider issued and has not retired. One object serves
    both because the recovery cases are about the seam between them — a credential this
    provider stops honouring is a credential the gateway has to notice at relay time — and
    two fixtures could disagree about which tokens are live.

    The switches a recovery case needs, each standing in for something a real provider
    does and this deployment cannot see coming: :meth:`revoke` retires every credential
    already issued, and ``times_out`` makes the server stop answering.
    """

    server_url: str = "https://mcp.oauth.local/"
    authorization_server: str = "https://auth.oauth.local/"
    # The server stops answering rather than refusing: what a caller sees is silence
    # until the timeout, which is a different ending from any status code.
    times_out: bool = False
    # What actually reached the provider, for cases whose claim is about the number of
    # upstream calls rather than their result.
    token_requests: int = 0
    relay_requests: int = 0
    _codes: set[str] = field(default_factory=set)
    _refresh_tokens: set[str] = field(default_factory=set)
    _access_tokens: set[str] = field(default_factory=set)

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

    def revoke(self) -> None:
        """Retire every credential issued so far, as removing an application does.

        Both halves, because that is what revocation means at a provider: the access
        tokens stop being honoured at the MCP surface, and the renewal handles stop being
        honoured at the token endpoint, so there is no way back except consenting again.
        Nothing tells the deployment; a stored grant's recorded expiry is untouched and
        still lies in the future, which is the whole difficulty this stands in for.
        """
        self._access_tokens.clear()
        self._refresh_tokens.clear()

    def revoke_renewal_handles(self) -> None:
        """Retire the renewal handles only, leaving issued access tokens honoured.

        The narrower revocation a provider performs when a refresh token is withdrawn on
        its own, and the case a renewal has to fail cleanly on.
        """
        self._refresh_tokens.clear()

    def revoke_access_token(self, access_token: str) -> None:
        """Retire one issued access token, leaving every other credential alone.

        Revocation at a provider is per account, so a case about one connection failing
        while its sibling keeps working has to be able to retire exactly one token.
        """
        self._access_tokens.discard(access_token)

    def honours(self, access_token: str) -> bool:
        return access_token in self._access_tokens

    def _bearer(self, request: httpx.Request) -> str:
        scheme, _, value = (request.headers.get("Authorization") or "").partition(" ")
        return value.strip() if scheme.lower() == "bearer" else ""

    def _serve_mcp(self, request: httpx.Request) -> httpx.Response:
        """The protected MCP surface: one JSON-RPC answer, bearer required."""
        self.relay_requests += 1
        if self.times_out:
            raise httpx.ReadTimeout("upstream did not answer", request=request)
        if not self.honours(self._bearer(request)):
            return httpx.Response(
                401,
                headers={
                    "WWW-Authenticate": 'Bearer realm="local", error="invalid_token"'
                },
                json={"error": "invalid_token"},
            )
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "result": {"content": [{"type": "text", "text": "ok"}]},
            },
        )

    def _handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        # The MCP server lives at the server URL's own path. Discovery only ever GETs the
        # well-known documents, so the method alone separates the two surfaces.
        if request.method == "POST" and path == urlparse(self.server_url).path:
            return self._serve_mcp(request)
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
            self.token_requests += 1
            form = parse_qs(request.content.decode())
            if form.get("grant_type", [None])[0] == "refresh_token":
                presented = form.get("refresh_token", [None])[0]
                # Rotating, like the servers this stands in for: a handle dies the
                # moment it is spent. That is what makes renewing the wrong
                # connection's grant destructive rather than merely untidy, so the
                # fixture has to behave that way for a test to be able to prove it.
                if presented not in self._refresh_tokens:
                    return httpx.Response(400, json={"error": "invalid_grant"})
                self._refresh_tokens.remove(presented)
                return self._issue()
            code = form.get("code", [None])[0]
            if code not in self._codes:
                return httpx.Response(400, json={"error": "invalid_grant"})
            self._codes.remove(code)
            return self._issue()
        return httpx.Response(404)

    def _issue(self) -> httpx.Response:
        refresh_token = f"local-refresh-{uuid.uuid4().hex}"
        self._refresh_tokens.add(refresh_token)
        access_token = f"local-access-{uuid.uuid4().hex}"
        self._access_tokens.add(access_token)
        return httpx.Response(
            200,
            json={
                "access_token": access_token,
                "refresh_token": refresh_token,
                "token_type": "Bearer",
                "expires_in": 3600,
                "scope": "tools:call",
            },
        )


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
async def project(seeded_project):
    """`seeded_project` plants one `secrets` row whose `data` is NULL as a bare FK
    target. Reading the vault decrypts every row in the project, so it has to go before
    these cases list anything."""
    engine = get_transactions_engine()
    async with engine.session() as session:
        await session.execute(
            text("DELETE FROM secrets WHERE id = :id"),
            {"id": seeded_project["secret_id"]},
        )
        await session.commit()
    return seeded_project


@pytest.fixture
def connect_service(local_mcp_oauth_provider, _public_dns_for_the_oauth_provider):
    """The real connect service over the local provider, writing to real Postgres.

    Distinct from `local_mcp_oauth_connect_service` below, which hands back an in-memory
    secrets DAO beside the service: the cases that use this one assert on rows a unique
    index arbitrates, which only real Postgres has.
    """
    return MCPOAuthConnectService(
        vault_service=VaultService(secrets_dao=SecretsDAO()),
        client=MCPOAuthClient(transport=local_mcp_oauth_provider.transport),
        api_url="https://api.oauth.local",
        attempts_dao=InMemoryMCPOAuthAttemptsDAO(),
        resolve=lambda _hostname: ["10.0.0.1"],
    )


@pytest.fixture
def local_mcp_oauth_connect_service(
    local_mcp_oauth_provider, _public_dns_for_the_oauth_provider
):
    """Service+vault fixture for the local OAuth provider integration contract."""
    dao = _InMemorySecretsDAO()
    service = MCPOAuthConnectService(
        vault_service=VaultService(secrets_dao=dao),
        client=MCPOAuthClient(transport=local_mcp_oauth_provider.transport),
        api_url="https://api.oauth.local",
        attempts_dao=InMemoryMCPOAuthAttemptsDAO(),
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
async def other_project():
    """A second tenant, with its own project and one bare `secrets` row.

    `seeded_project` alone cannot express the case OR62 is about: a credential that
    genuinely exists, so the `secret_id` foreign key is satisfied, and belongs to somebody
    else. Same FK chain, same NULL `data` — nothing here is ever decrypted.
    """
    engine = get_transactions_engine()
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    project_id = uuid.uuid4()
    credential_id = uuid.uuid4()

    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, uid, username, email) "
                "VALUES (:id, :uid, :username, :email)"
            ),
            {
                "id": user_id,
                "uid": str(user_id),
                "username": "gateways-dao-other",
                "email": f"gateways-other-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {"id": organization_id, "name": "gw-other-org", "owner_id": user_id},
        )
        await session.execute(
            text(
                "INSERT INTO workspaces (id, name, organization_id) "
                "VALUES (:id, :name, :organization_id)"
            ),
            {
                "id": workspace_id,
                "name": "gw-other-ws",
                "organization_id": organization_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO projects "
                "(id, project_name, workspace_id, organization_id) "
                "VALUES (:id, :name, :workspace_id, :organization_id)"
            ),
            {
                "id": project_id,
                "name": "gw-other-project",
                "workspace_id": workspace_id,
                "organization_id": organization_id,
            },
        )
        await session.execute(
            text("INSERT INTO secrets (id, project_id) VALUES (:id, :project_id)"),
            {"id": credential_id, "project_id": project_id},
        )
        await session.commit()

    yield {
        "project_id": project_id,
        "user_id": user_id,
        "secret_id": credential_id,
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
        "organization_id": organization_id,
        "workspace_id": workspace_id,
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

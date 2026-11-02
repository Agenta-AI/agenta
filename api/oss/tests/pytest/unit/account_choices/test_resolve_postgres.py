"""`AccountChoicesService.resolve` on a real Postgres: the resolution chain of every item
kind, and exactly ONE SQL statement for a run's "user" items. Skipped when Postgres is not
reachable."""

import socket
from types import SimpleNamespace
import time
import uuid
from urllib.parse import urlparse

import pytest
import pytest_asyncio
from sqlalchemy import event, text

from agenta.sdk.agents.accounts import UserItem, user_item_key

import oss.src.dbs.postgres.shared.engine as engine_module
import oss.src.models.db_models  # noqa: F401
from oss.src.core.account_choices.claims import run_accounts_claim
from oss.src.core.account_choices.dtos import AccountChoiceUpsert, AccountMatch
from oss.src.core.account_choices.exceptions import (
    AccountNotForItem,
    AccountNotYours,
    ChoiceNotSupported,
)
from oss.src.core.account_choices.service import AccountChoicesService
from oss.src.core.gateway.connections.dtos import (
    ConnectionCreate,
    ConnectionProviderKind,
)
from oss.src.core.gateways.mcps.oauth.storage import grant_slug, token_slug
from oss.src.core.secrets.dtos import CreateSecretDTO, SecretOwner
from oss.src.core.secrets.services import VaultService
from oss.src.dbs.postgres.account_choices.dao import AccountChoicesDAO
from oss.src.dbs.postgres.gateway.connections.dao import ConnectionsDAO
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.env import env

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


def _reachable() -> bool:
    parsed = urlparse(env.postgres.uri_core)
    try:
        with socket.create_connection(
            (parsed.hostname or "postgres", parsed.port or 5432), timeout=0.5
        ):
            return True
    except OSError:
        return False


@pytest.fixture(autouse=True)
def _skip_without_postgres():
    if not _reachable():
        pytest.skip("Postgres not reachable")


@pytest_asyncio.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


def item(kind: str, match_text: str) -> UserItem:
    return UserItem(
        item_key=user_item_key(kind=kind, match_text=match_text),
        kind=kind,
        match_text=match_text,
        paths=[],
    )


@pytest_asyncio.fixture
async def world():
    engine = get_transactions_engine()
    alice, bob = uuid.uuid4(), uuid.uuid4()
    organization_id, workspace_id, project_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    artifact_id = uuid.uuid4()
    oauth_server, token_server = uuid.uuid4(), uuid.uuid4()
    async with engine.session() as session:
        for user in (alice, bob):
            await session.execute(
                text(
                    "INSERT INTO users (id, uid, username, email) "
                    "VALUES (:id, :uid, 'accounts-test', :email)"
                ),
                {"id": user, "uid": str(user), "email": f"{user.hex[:10]}@example.com"},
            )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) VALUES (:id, 'o', :u)"
            ),
            {"id": organization_id, "u": alice},
        )
        await session.execute(
            text(
                "INSERT INTO workspaces (id, name, organization_id) VALUES (:id, 'w', :o)"
            ),
            {"id": workspace_id, "o": organization_id},
        )
        await session.execute(
            text(
                "INSERT INTO projects (id, project_name, workspace_id, organization_id) "
                "VALUES (:id, 'p', :w, :o)"
            ),
            {"id": project_id, "w": workspace_id, "o": organization_id},
        )
        await session.execute(
            text(
                "INSERT INTO workflow_artifacts (project_id, id, slug) "
                "VALUES (:p, :id, :slug)"
            ),
            {
                "p": project_id,
                "id": artifact_id,
                "slug": f"agent-{artifact_id.hex[:8]}",
            },
        )
        for endpoint_id, slug, mode in (
            (oauth_server, "linear", "OAUTH"),
            (token_server, "notion", "API_KEY"),
            (uuid.uuid4(), "open-docs", "NONE"),
        ):
            await session.execute(
                text(
                    "INSERT INTO mcps_endpoints (id, project_id, slug, auth_mode) "
                    "VALUES (:id, :p, :slug, :mode)"
                ),
                {"id": endpoint_id, "p": project_id, "slug": slug, "mode": mode},
            )
        await session.commit()

    yield dict(
        alice=alice,
        bob=bob,
        organization_id=organization_id,
        project_id=project_id,
        artifact_id=artifact_id,
        oauth_server=oauth_server,
        token_server=token_server,
    )

    async with engine.session() as session:
        await session.execute(
            text("DELETE FROM organizations WHERE id = :id"), {"id": organization_id}
        )
        await session.execute(
            text("DELETE FROM users WHERE id = ANY(:ids)"), {"ids": [alice, bob]}
        )
        await session.commit()


def _service() -> AccountChoicesService:
    return AccountChoicesService(account_choices_dao=AccountChoicesDAO())


async def _connection(owner, slug, *, valid=True):
    return await ConnectionsDAO().create_connection(
        project_id=None,
        user_id=owner.id,
        owner=owner,
        connection_create=ConnectionCreate(
            slug=slug,
            provider_key=ConnectionProviderKind.COMPOSIO,
            integration_key="gmail",
            flags={"is_active": True, "is_valid": valid},
        ),
    )


def _secret(slug, kind, data):
    return CreateSecretDTO.model_validate(
        {"slug": slug, "header": {"name": slug}, "secret": {"kind": kind, "data": data}}
    )


async def test_the_chain_of_every_kind_in_one_statement(world):
    alice = SecretOwner.for_user(
        organization_id=world["organization_id"], user_id=world["alice"]
    )
    vault = VaultService(SecretsDAO())
    default = await _connection(alice, "gmail-main")
    other = await _connection(alice, "gmail-other", valid=False)
    custom = await vault.create_personal_secret(
        organization_id=world["organization_id"],
        user_id=world["alice"],
        create_secret_dto=_secret(
            "github", "custom_secret", {"secret": {"format": "text", "content": "v"}}
        ),
    )
    expired_grant = await vault.put_personal_secret(
        organization_id=world["organization_id"],
        user_id=world["alice"],
        create_secret_dto=_secret(
            grant_slug(world["oauth_server"]),
            "oauth_grant",
            {
                "grant": {
                    "server": "https://mcp.example.com",
                    "scopes": [],
                    "access_token": "a",
                    "expires_at": int(time.time()) - 60,
                }
            },
        ),
    )
    await vault.put_personal_secret(
        organization_id=world["organization_id"],
        user_id=world["alice"],
        create_secret_dto=_secret(
            token_slug(world["token_server"]),
            "mcp_token",
            {"secret": {"format": "text", "content": "t"}},
        ),
    )
    service = _service()
    await service.upsert(
        organization_id=world["organization_id"],
        project_id=world["project_id"],
        user_id=world["alice"],
        choice=AccountChoiceUpsert(
            workflow_id=world["artifact_id"],
            item_key="secret:user/GITHUB_TOKEN",
            secret_id=custom.id,
        ),
    )

    items = [
        item("app_connection", "gmail"),
        item("secret", "GITHUB_TOKEN"),
        item("secret", "OTHER_TOKEN"),
        item("mcp_server", "linear"),
        item("mcp_server", "notion"),
        item("mcp_server", "open-docs"),
        item("subscription", "claude"),
    ]
    statements = []
    sync_engine = get_transactions_engine()._engine.sync_engine

    def count(_conn, _cursor, statement, *_args, **_kwargs):
        # The pool's liveness ping is not a statement of the code under test.
        if statement.strip().upper() != "SELECT 1":
            statements.append(statement)

    event.listen(sync_engine, "before_cursor_execute", count)
    try:
        resolved = await service.resolve(
            organization_id=world["organization_id"],
            project_id=world["project_id"],
            artifact_id=world["artifact_id"],
            user_id=world["alice"],
            items=items,
        )
    finally:
        event.remove(sync_engine, "before_cursor_execute", count)
    assert len(statements) == 1

    by_key = {entry.item_key: entry for entry in resolved}
    assert [entry.item_key for entry in resolved] == [i.item_key for i in items]

    gmail = by_key["app_connection:user/gmail"]
    assert (gmail.match, gmail.gateway_connection_id, gmail.is_ready) == (
        AccountMatch.DEFAULT,
        default.id,
        True,
    )
    assert gmail.candidates == 2

    github = by_key["secret:user/GITHUB_TOKEN"]
    assert (github.match, github.secret_id, github.is_ready) == (
        AccountMatch.CHOICE,
        custom.id,
        True,
    )
    assert github.candidates == 1
    assert by_key["secret:user/OTHER_TOKEN"].match is None

    linear = by_key["mcp_server:user/linear"]
    assert (linear.match, linear.secret_id, linear.is_ready) == (
        AccountMatch.SIGN_IN,
        expired_grant.id,
        False,  # expired, no refresh token
    )
    notion = by_key["mcp_server:user/notion"]
    assert notion.match == AccountMatch.SIGN_IN and notion.is_ready is True

    # A server with no sign-in method is ready with no account, and stays out of the
    # claim.
    open_docs = by_key["mcp_server:user/open-docs"]
    assert (open_docs.match, open_docs.secret_id, open_docs.is_ready) == (
        None,
        None,
        True,
    )
    assert run_accounts_claim([open_docs]) == []

    assert by_key["subscription:user/claude"].match is None

    # A chosen connection beats the default, and is not ready when invalid.
    await service.upsert(
        organization_id=world["organization_id"],
        project_id=world["project_id"],
        user_id=world["alice"],
        choice=AccountChoiceUpsert(
            workflow_id=world["artifact_id"],
            item_key="app_connection:user/gmail",
            gateway_connection_id=other.id,
        ),
    )
    (chosen,) = await service.resolve(
        organization_id=world["organization_id"],
        project_id=world["project_id"],
        artifact_id=world["artifact_id"],
        user_id=world["alice"],
        items=[item("app_connection", "gmail")],
    )
    assert (chosen.match, chosen.gateway_connection_id, chosen.is_ready) == (
        AccountMatch.CHOICE,
        other.id,
        False,
    )


async def test_another_person_never_gets_alices_accounts(world):
    alice = SecretOwner.for_user(
        organization_id=world["organization_id"], user_id=world["alice"]
    )
    await _connection(alice, "gmail-main")
    resolved = await _service().resolve(
        organization_id=world["organization_id"],
        project_id=world["project_id"],
        artifact_id=world["artifact_id"],
        user_id=world["bob"],
        items=[item("app_connection", "gmail"), item("secret", "GITHUB_TOKEN")],
    )
    assert all(entry.match is None and entry.candidates == 0 for entry in resolved)


async def test_no_items_or_no_person_reads_nothing(world):
    statements = []
    sync_engine = get_transactions_engine()._engine.sync_engine

    def count(_conn, _cursor, statement, *_args, **_kwargs):
        # The pool's liveness ping is not a statement of the code under test.
        if statement.strip().upper() != "SELECT 1":
            statements.append(statement)

    event.listen(sync_engine, "before_cursor_execute", count)
    try:
        assert (
            await _service().resolve(
                organization_id=world["organization_id"],
                project_id=world["project_id"],
                artifact_id=world["artifact_id"],
                user_id=world["alice"],
                items=[],
            )
            == []
        )
        (entry,) = await _service().resolve(
            organization_id=world["organization_id"],
            project_id=world["project_id"],
            artifact_id=world["artifact_id"],
            user_id=None,
            items=[item("secret", "GITHUB_TOKEN")],
        )
    finally:
        event.remove(sync_engine, "before_cursor_execute", count)
    assert statements == []
    assert entry.match is None


async def test_upsert_refuses_other_peoples_and_unfit_accounts(world):
    alice = SecretOwner.for_user(
        organization_id=world["organization_id"], user_id=world["alice"]
    )
    connection = await _connection(alice, "gmail-main")
    service = _service()

    def choice(**fields):
        return AccountChoiceUpsert(workflow_id=world["artifact_id"], **fields)

    with pytest.raises(ChoiceNotSupported):
        await service.upsert(
            organization_id=world["organization_id"],
            project_id=world["project_id"],
            user_id=world["alice"],
            choice=choice(
                item_key="mcp_server:user/linear", gateway_connection_id=connection.id
            ),
        )
    with pytest.raises(AccountNotYours):
        await service.upsert(
            organization_id=world["organization_id"],
            project_id=world["project_id"],
            user_id=world["bob"],
            choice=choice(
                item_key="app_connection:user/gmail",
                gateway_connection_id=connection.id,
            ),
        )
    with pytest.raises(AccountNotForItem):
        await service.upsert(
            organization_id=world["organization_id"],
            project_id=world["project_id"],
            user_id=world["alice"],
            choice=choice(
                item_key="app_connection:user/slack",
                gateway_connection_id=connection.id,
            ),
        )
    stored = await service.upsert(
        organization_id=world["organization_id"],
        project_id=world["project_id"],
        user_id=world["alice"],
        choice=choice(
            item_key="app_connection:user/gmail", gateway_connection_id=connection.id
        ),
    )
    # Deleting the account deletes the choice (the foreign key cascades).
    assert await ConnectionsDAO().delete_connection(
        project_id=None, connection_id=connection.id, owner=alice
    )
    assert (
        await service.fetch(
            project_id=world["project_id"],
            user_id=world["alice"],
            account_choice_id=stored.id,
        )
        is None
    )


async def test_the_vault_reads_a_persons_secrets_by_id_and_deletes_them_all(world):
    vault = VaultService(SecretsDAO())
    mine = await vault.create_personal_secret(
        organization_id=world["organization_id"],
        user_id=world["alice"],
        create_secret_dto=_secret(
            "github", "custom_secret", {"secret": {"format": "text", "content": "v"}}
        ),
    )
    await vault.put_personal_secret(
        organization_id=world["organization_id"],
        user_id=world["alice"],
        create_secret_dto=_secret(
            token_slug(world["token_server"]),
            "mcp_token",
            {"secret": {"format": "text", "content": "t"}},
        ),
    )
    read = await vault.list_personal_secrets_by_ids(
        organization_id=world["organization_id"],
        user_id=world["alice"],
        secret_ids=[mine.id, uuid.uuid4()],
    )
    assert [secret.id for secret in read] == [mine.id]
    assert read[0].data.secret.content == "v"
    # Bob never reads Alice's secret by its id.
    assert (
        await vault.list_personal_secrets_by_ids(
            organization_id=world["organization_id"],
            user_id=world["bob"],
            secret_ids=[mine.id],
        )
        == []
    )
    assert (
        await vault.delete_personal_secrets(
            organization_id=world["organization_id"], user_id=world["alice"]
        )
        == 2
    )


async def test_a_corrupt_grant_never_fails_the_run(world, monkeypatch, caplog):
    import oss.src.core.account_choices.policy as policy_module
    import oss.src.core.account_choices.service as service_module
    from oss.src.core.account_choices.claims import sign_run_accounts
    from oss.tests.pytest.utils.principals import make_envelope

    async with get_transactions_engine().session() as session:
        await session.execute(
            text(
                "INSERT INTO secrets (id, organization_id, user_id, slug, kind, data) "
                "VALUES (:id, :o, :u, :slug, 'OAUTH_GRANT', "
                "pgp_sym_encrypt('not json', :key))"
            ),
            {
                "id": uuid.uuid4(),
                "o": world["organization_id"],
                "u": world["alice"],
                "slug": grant_slug(world["oauth_server"]),
                "key": env.agenta.crypt_key,
            },
        )
        await session.commit()
    monkeypatch.setattr(
        policy_module.env.agenta.access, "personal_accounts_enabled", True
    )
    monkeypatch.setattr(service_module, "_account_choices_service", _service())
    envelope = make_envelope(
        kind="human",
        principal_id=world["alice"],
        organization_id=world["organization_id"],
        project_id=world["project_id"],
    )
    assert (
        await sign_run_accounts(
            envelope=envelope,
            items=[item("mcp_server", "linear"), item("secret", "GITHUB_TOKEN")],
            artifact_id=world["artifact_id"],
        )
        is None
    )
    # The statement binds the data encryption key; no log line may carry it.
    import oss.src.core.account_choices.claims as claims_module

    lines = []
    monkeypatch.setattr(
        claims_module,
        "log",
        SimpleNamespace(
            error=lambda *a, **k: lines.append((a, k)),
            info=lambda *a, **k: lines.append((a, k)),
        ),
    )
    await sign_run_accounts(
        envelope=envelope,
        items=[item("mcp_server", "linear")],
        artifact_id=world["artifact_id"],
    )
    assert lines and env.agenta.crypt_key not in repr(lines)
    assert all("exc_info" not in kwargs for _, kwargs in lines)

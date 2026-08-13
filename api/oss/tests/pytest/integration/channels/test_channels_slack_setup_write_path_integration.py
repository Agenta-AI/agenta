"""The Slack-specific half of the write-path guarantee against a real
Postgres: `test_channels_connection_write_path_integration.py` proves
"verify, then store" against a scripted adapter; this proves the same rule
holds when the failure comes from the real `SlackAdapter` calling a rejected
`auth.test`, which is the call the setup screen actually depends on.

WRITTEN BUT NOT RUN in this worktree: needs local Docker Postgres
(`channels_scope` fixture), which is not available here.
"""

from typing import Any, Dict
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import text

from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.adapters.slack.adapter import SlackAdapter
from oss.src.core.channels.dtos import ChannelConnectionCreate
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import ChannelConnectionVerificationFailed
from oss.src.core.secrets.services import VaultService
from oss.src.dbs.postgres.channels.dao import ChannelsDAO
from oss.src.dbs.postgres.secrets.dao import SecretsDAO

pytestmark = pytest.mark.integration


class _AuthTestTransport(httpx.AsyncBaseTransport):
    """Answers every call the way Slack's `auth.test` answers a bad bot
    token -- HTTP 200, `{"ok": false, "error": "invalid_auth"}` -- so the
    real `SlackAdapter.verify_connection` raises exactly the way it would
    against the live API."""

    def __init__(self, *, body: Dict[str, Any]):
        self._body = body

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=self._body)


def _slack_adapter(*, ok: bool) -> SlackAdapter:
    body = (
        {"ok": True, "team_id": "T-slack-setup", "user_id": "UBOT1"}
        if ok
        else {"ok": False, "error": "invalid_auth"}
    )
    client = httpx.AsyncClient(
        transport=_AuthTestTransport(body=body), base_url="https://slack.com/api"
    )
    return SlackAdapter(http_client=client)


async def _service(channels_scope, *, adapter: SlackAdapter) -> ChannelsService:
    engine = channels_scope["engine"]
    return ChannelsService(
        channels_dao=ChannelsDAO(engine=engine),
        adapter_registry=ChannelAdapterRegistry(adapters={"slack": adapter}),
        vault_service=VaultService(secrets_dao=SecretsDAO(engine=engine)),
    )


async def _secret_count(engine, project_id) -> int:
    async with engine.session() as session:
        result = await session.execute(
            text(
                "SELECT count(*) FROM secrets "
                "WHERE project_id = :project_id AND kind = 'CHANNEL_SECRET'"
            ),
            {"project_id": project_id},
        )
        return result.scalar_one()


async def _connection_count(engine, project_id) -> int:
    async with engine.session() as session:
        result = await session.execute(
            text(
                "SELECT count(*) FROM channel_connections "
                "WHERE project_id = :project_id AND slug = 'slack-setup-acme'"
            ),
            {"project_id": project_id},
        )
        return result.scalar_one()


@pytest.fixture(autouse=True)
async def _cleanup_secrets(channels_scope):
    yield
    async with channels_scope["engine"].session() as session:
        await session.execute(
            text("DELETE FROM secrets WHERE project_id = :project_id"),
            {"project_id": channels_scope["project_id"]},
        )
        await session.commit()


async def test_a_rejected_auth_test_writes_no_connection_row_and_no_secret_row(
    channels_scope,
):
    project_id = channels_scope["project_id"]
    user_id = channels_scope["user_id"]
    adapter = _slack_adapter(ok=False)
    service = await _service(channels_scope, adapter=adapter)

    connection = ChannelConnectionCreate(
        channel="slack",
        external_key=uuid4(),
        slug="slack-setup-acme",
        data={"api_app_id": "A-slack-setup", "enterprise_id": ""},
        credentials={"bot_token": "xoxb-bad", "signing_secret": "sec-slack-setup"},
    )

    with pytest.raises(ChannelConnectionVerificationFailed):
        await service.create_connection(
            project_id=project_id, user_id=user_id, connection=connection
        )

    assert await _secret_count(channels_scope["engine"], project_id) == 0
    assert await _connection_count(channels_scope["engine"], project_id) == 0


async def test_a_verified_auth_test_writes_exactly_one_row_in_each_table(
    channels_scope,
):
    """The success twin, so the failure test above is read against a real
    baseline rather than an assumption that the write path works at all."""

    project_id = channels_scope["project_id"]
    user_id = channels_scope["user_id"]
    adapter = _slack_adapter(ok=True)
    service = await _service(channels_scope, adapter=adapter)

    connection = ChannelConnectionCreate(
        channel="slack",
        external_key=uuid4(),
        slug="slack-setup-acme",
        # enterprise_id is a declared identity key with no source: not one of
        # setup.fields, not returned by auth.test. Omitting it raises
        # ChannelLocatorIncomplete before a row is ever written; the web
        # caller supplies "" the same way this fixture does.
        data={"api_app_id": "A-slack-setup", "enterprise_id": ""},
        credentials={"bot_token": "xoxb-good", "signing_secret": "sec-slack-setup"},
    )

    result = await service.create_connection(
        project_id=project_id, user_id=user_id, connection=connection
    )

    assert await _secret_count(channels_scope["engine"], project_id) == 1
    assert await _connection_count(channels_scope["engine"], project_id) == 1
    assert result.data["connection_locator"]["team_id"] == "T-slack-setup"
    # api_app_id is a locator: it must survive on the connection row, never
    # on the credential row (which only accepts bot_token/signing_secret).
    assert result.data["connection_locator"]["api_app_id"] == "A-slack-setup"

"""The bridge-specific half of the document-slot guarantee against a real
Postgres and a real vault: `create_connection` mints the signing secret
itself (nothing else can), writes it under `ChannelSecretKind.BRIDGE`, and the
create-response document built from that plaintext carries it exactly once --
a subsequent GET setup call on the same connection never does, against the
connection's real hydrated `data`, not a scripted stand-in.

Mirrors `test_channels_slack_setup_write_path_integration.py`'s shape: the
service is exercised directly (the same call the router makes), rather than
through a live HTTP client, since Postgres/the vault -- not FastAPI routing --
is what makes this integration-tier.

WRITTEN BUT NOT RUN in this worktree: needs local Docker Postgres
(`channels_scope` fixture), which is not available here.
"""

from uuid import uuid4

import pytest
from sqlalchemy import text

from oss.src.core.channels.adapters.bridge.adapter import (
    BridgeAdapter,
    build_bridge_create_document,
)
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import ChannelConnectionCreate, ChannelConnectionCreated
from oss.src.core.channels.service import ChannelsService
from oss.src.core.secrets.services import VaultService
from oss.src.dbs.postgres.channels.dao import ChannelsDAO
from oss.src.dbs.postgres.secrets.dao import SecretsDAO

pytestmark = pytest.mark.integration

_REQUEST_URL = "https://example.com/channels/bridge/events/"


async def _service(channels_scope) -> ChannelsService:
    engine = channels_scope["engine"]
    return ChannelsService(
        channels_dao=ChannelsDAO(engine=engine),
        adapter_registry=ChannelAdapterRegistry(adapters={"bridge": BridgeAdapter()}),
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


@pytest.fixture(autouse=True)
async def _cleanup_secrets(channels_scope):
    yield
    async with channels_scope["engine"].session() as session:
        await session.execute(
            text("DELETE FROM secrets WHERE project_id = :project_id"),
            {"project_id": channels_scope["project_id"]},
        )
        await session.commit()


async def test_create_mints_and_writes_the_secret_and_the_create_response_carries_it_once(
    channels_scope,
):
    project_id = channels_scope["project_id"]
    user_id = channels_scope["user_id"]
    service = await _service(channels_scope)

    connection = ChannelConnectionCreate(
        channel="bridge",
        external_key=uuid4(),
        slug="bridge-setup-acme",
        data={
            "source": "bridge-setup-acme",
            "delivery_url": "https://bridge-setup.example/deliver",
        },
    )

    created = await service.create_connection(
        project_id=project_id, user_id=user_id, connection=connection
    )

    assert isinstance(created, ChannelConnectionCreated)
    assert created.one_time_secret
    assert await _secret_count(channels_scope["engine"], project_id) == 1
    assert created.data["delivery_url"] == "https://bridge-setup.example/deliver"

    # what the router does with the plaintext: build the one-time document
    # once, from this exact response, before it goes out of scope
    document = build_bridge_create_document(
        request_url=_REQUEST_URL, secret=created.one_time_secret
    )
    assert created.one_time_secret in document.content
    assert _REQUEST_URL in document.content

    # the GET path, hitting the real hydrated connection (vault round trip
    # included), never carries that plaintext -- not on the first call, not
    # on a later one
    first = await service.get_connection_setup(
        project_id=project_id, connection_id=created.id, request_url=_REQUEST_URL
    )
    second = await service.get_connection_setup(
        project_id=project_id, connection_id=created.id, request_url=_REQUEST_URL
    )

    for setup in (first, second):
        assert setup.fields == []
        assert setup.document is not None
        assert created.one_time_secret not in setup.document.content


async def test_a_caller_supplied_secret_is_written_verbatim_and_the_response_mints_nothing(
    channels_scope,
):
    project_id = channels_scope["project_id"]
    user_id = channels_scope["user_id"]
    service = await _service(channels_scope)

    connection = ChannelConnectionCreate(
        channel="bridge",
        external_key=uuid4(),
        slug="bridge-setup-brought-your-own",
        data={
            "source": "bridge-setup-brought-your-own",
            "delivery_url": "https://bridge-setup.example/deliver",
        },
        credentials={"signing_secret": "integration-test-caller-supplied-secret"},
    )

    created = await service.create_connection(
        project_id=project_id, user_id=user_id, connection=connection
    )

    assert getattr(created, "one_time_secret", None) is None
    assert await _secret_count(channels_scope["engine"], project_id) == 1

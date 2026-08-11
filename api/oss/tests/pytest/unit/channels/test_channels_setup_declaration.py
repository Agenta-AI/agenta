"""The setup declaration: three slots, any of them empty. Empty is a
declaration, not a special case -- proved here by running a channel that
fills none (mock, standing in for the credential-less shape Agenta will
also be) and a channel that fills all three (Slack) through the exact same
`ChannelsService.get_connection_setup` code path.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.adapters.mock.adapter import MockAdapter
from oss.src.core.channels.adapters.mock.capabilities import full as mock_full
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.adapters.slack.adapter import SlackAdapter
from oss.src.core.channels.dtos import ChannelConnection, ChannelSetupField
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import ChannelConnectionNotFound


def _service(*, channel: str, adapter, connection) -> ChannelsService:
    dao = MagicMock()
    dao.fetch_connection = AsyncMock(return_value=connection)
    return ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(adapters={channel: adapter}),
    )


async def test_a_channel_declaring_nothing_renders_an_empty_setup():
    connection = ChannelConnection(
        id=uuid4(), slug="m", channel="mock", external_key=uuid4()
    )
    service = _service(
        channel="mock",
        adapter=MockAdapter(capabilities=mock_full()),
        connection=connection,
    )

    setup = await service.get_connection_setup(
        project_id=uuid4(),
        connection_id=connection.id,
        request_url="https://example.com/channels/mock/events/",
    )

    assert setup.instructions == []
    assert setup.fields == []
    assert setup.document is None


async def test_slack_renders_all_three_slots_through_the_same_code_path():
    connection = ChannelConnection(
        id=uuid4(), slug="s", channel="slack", external_key=uuid4()
    )
    service = _service(channel="slack", adapter=SlackAdapter(), connection=connection)

    setup = await service.get_connection_setup(
        project_id=uuid4(),
        connection_id=connection.id,
        request_url="https://example.com/channels/slack/events/",
    )

    assert setup.instructions
    assert {field.name for field in setup.fields} == {
        "bot_token",
        "signing_secret",
        "api_app_id",
    }
    assert setup.document is not None
    assert "https://example.com/channels/slack/events/" in setup.document.content


async def test_setup_raises_a_domain_error_for_a_missing_connection():
    dao = MagicMock()
    dao.fetch_connection = AsyncMock(return_value=None)
    service = ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(adapters={"mock": MockAdapter()}),
    )

    with pytest.raises(ChannelConnectionNotFound):
        await service.get_connection_setup(
            project_id=uuid4(),
            connection_id=uuid4(),
            request_url="https://example.com/channels/mock/events/",
        )


# --- interface defaults: both methods default to nothing -------------------- #


class _MinimalAdapter(ChannelAdapterInterface):
    """Implements only the abstract methods -- proves the two setup methods
    are usable without an override."""

    channel = "minimal"

    async def fetch_capabilities(self, *, connection=None):
        raise NotImplementedError

    def connection_locator(self, *, request):
        raise NotImplementedError

    async def verify_signature(self, *, request, connection):
        raise NotImplementedError

    async def parse_event(self, *, body, connection=None):
        raise NotImplementedError

    async def post_message(self, *, connection, locator, content, idempotency_key):
        raise NotImplementedError

    async def edit_message(
        self, *, connection, external_locator, content, idempotency_key
    ):
        raise NotImplementedError

    async def discover_spaces(self, *, connection):
        raise NotImplementedError

    async def fetch_history(self, *, connection, locator, limit):
        raise NotImplementedError


async def test_build_setup_document_defaults_to_none():
    adapter = _MinimalAdapter()

    assert await adapter.build_setup_document(request_url="https://x") is None


async def test_verify_connection_defaults_to_trivial_success():
    adapter = _MinimalAdapter()

    assert await adapter.verify_connection(connection=None, credentials={}) == {}


def test_channel_setup_field_declares_name_label_secret_required_help():
    field = ChannelSetupField(name="bot_token", label="Bot token")

    assert field.secret is False
    assert field.required is True
    assert field.help is None

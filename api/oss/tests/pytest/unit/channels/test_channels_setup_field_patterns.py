"""A declared setup field's pattern refuses a Client ID pasted where the
Slack App ID belongs, before anything is verified or written."""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import ChannelConnectionCreate
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import ChannelSetupFieldInvalid
from oss.tests.pytest.unit.channels.slack.fake_slack import (
    make_adapter_and_workspace,
)

pytestmark = pytest.mark.asyncio


def _service(*, adapter, dao) -> ChannelsService:
    return ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(adapters={"slack": adapter}),
    )


def _dao() -> MagicMock:
    dao = MagicMock()
    dao.create_connection = AsyncMock()
    return dao


# --- setup field patterns --------------------------------------------------- #


def _slack_create(api_app_id: str) -> ChannelConnectionCreate:
    return ChannelConnectionCreate(
        channel="slack",
        external_key=uuid4(),
        data={"api_app_id": api_app_id},
        credentials={"bot_token": "xoxb-fake", "signing_secret": "sec"},
    )


async def test_a_client_id_in_the_app_id_field_is_refused_before_anything_runs():
    adapter, _workspace, transport = make_adapter_and_workspace()
    dao = _dao()

    with pytest.raises(ChannelSetupFieldInvalid) as raised:
        await _service(adapter=adapter, dao=dao).create_connection(
            project_id=uuid4(),
            user_id=uuid4(),
            connection=_slack_create("7970714728294.12134175385185"),
        )

    assert raised.value.field == "api_app_id"
    assert "App ID" in str(raised.value) and "Client ID" in str(raised.value)
    assert transport.requests == []
    dao.create_connection.assert_not_awaited()


@pytest.mark.parametrize("value", ["a0B12CD34", "A0B1-2CD", "", "0A123456"])
async def test_anything_but_an_a_prefixed_app_id_is_refused(value):
    adapter, _workspace, _transport = make_adapter_and_workspace()

    with pytest.raises(ChannelSetupFieldInvalid):
        await _service(adapter=adapter, dao=_dao()).create_connection(
            project_id=uuid4(), user_id=uuid4(), connection=_slack_create(value)
        )


async def test_a_real_app_id_passes_the_pattern_and_is_trimmed():
    adapter, _workspace, transport = make_adapter_and_workspace()
    connection = _slack_create("  A0B12CD34EF ")
    dao = _dao()
    # stop right after the pattern check: verification is the next step
    transport.force_error("auth.test", error="invalid_auth")

    with pytest.raises(Exception) as raised:
        await _service(adapter=adapter, dao=dao).create_connection(
            project_id=uuid4(), user_id=uuid4(), connection=connection
        )

    assert not isinstance(raised.value, ChannelSetupFieldInvalid)
    assert connection.data["api_app_id"] == "A0B12CD34EF"

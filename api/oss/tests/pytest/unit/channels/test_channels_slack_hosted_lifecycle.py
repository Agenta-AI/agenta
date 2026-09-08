"""`ChannelsService.deactivate_connection` (the `app_uninstalled` /
`tokens_revoked` path) and `describe_connection_teardown` (the removal
notice). Both route through the generic adapter hook
(`revoke_installation`) rather than branching on "hosted" in the service --
core never learns that app models exist.
"""

from typing import Optional
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import ChannelConnection, ChannelConnectionFlags
from oss.src.core.channels.service import ChannelsService

pytestmark = pytest.mark.asyncio


class _MinimalAdapter(ChannelAdapterInterface):
    channel = "slack"

    def __init__(self, *, revoke_notice: Optional[str] = None):
        self._revoke_notice = revoke_notice
        self.revoke_calls = []

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

    async def revoke_installation(self, *, connection):
        self.revoke_calls.append(connection)
        return self._revoke_notice


def _connection(**overrides) -> ChannelConnection:
    fields = dict(
        id=uuid4(),
        slug="slack-conn",
        channel="slack",
        external_key=uuid4(),
        name="Acme workspace",
        description="the acme install",
        data={"team_id": "T1"},
        flags=ChannelConnectionFlags(is_active=True, is_hosted=True, is_verified=True),
    )
    fields.update(overrides)
    return ChannelConnection(**fields)


def _service(*, dao, adapter) -> ChannelsService:
    registry = ChannelAdapterRegistry(adapters={adapter.channel: adapter})
    return ChannelsService(channels_dao=dao, adapter_registry=registry)


# --- deactivate_connection ------------------------------------------------------ #


async def test_deactivate_flips_is_active_off_and_nothing_else():
    existing = _connection()
    dao = MagicMock()
    dao.fetch_connection = AsyncMock(return_value=existing)
    dao.edit_connection = AsyncMock(
        side_effect=lambda **kw: existing.model_copy(
            update={"flags": kw["connection"].flags}
        )
    )
    service = _service(dao=dao, adapter=_MinimalAdapter())

    result = await service.deactivate_connection(
        project_id=uuid4(), connection_id=existing.id
    )

    assert result.flags.is_active is False
    edit_call = dao.edit_connection.await_args.kwargs["connection"]
    # Full-PUT edit contract: name/description must be carried through from
    # the fetched row, not dropped to None by an edit that only meant to
    # touch is_active.
    assert edit_call.name == "Acme workspace"
    assert edit_call.description == "the acme install"


async def test_deactivate_is_a_no_op_for_a_connection_that_no_longer_exists():
    dao = MagicMock()
    dao.fetch_connection = AsyncMock(return_value=None)
    service = _service(dao=dao, adapter=_MinimalAdapter())

    result = await service.deactivate_connection(
        project_id=uuid4(), connection_id=uuid4()
    )

    assert result is None


# --- describe_connection_teardown ------------------------------------------------ #


async def test_teardown_notice_is_generic_when_the_adapter_declines_to_override():
    adapter = _MinimalAdapter(revoke_notice=None)
    service = _service(dao=MagicMock(), adapter=adapter)
    connection = _connection(flags=ChannelConnectionFlags(is_hosted=False))

    notice = await service.describe_connection_teardown(connection=connection)

    assert "never own the customer's app" in notice
    assert adapter.revoke_calls == [connection]


async def test_teardown_notice_comes_from_the_adapter_when_it_revokes():
    adapter = _MinimalAdapter(revoke_notice="Revoked on Slack's side too.")
    service = _service(dao=MagicMock(), adapter=adapter)
    connection = _connection()

    notice = await service.describe_connection_teardown(connection=connection)

    assert notice == "Revoked on Slack's side too."

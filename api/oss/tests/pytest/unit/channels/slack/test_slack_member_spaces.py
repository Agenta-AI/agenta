"""`list_member_spaces`: the channels the bot is in, for the channel tools'
destination list. One `users.conversations` read, not the whole workspace's
channel listing."""

from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.telegram.adapter import TelegramAdapter
from oss.src.core.channels.dtos import ChannelConnection, ChannelSpaceKind
from oss.src.core.channels.types import ChannelNotSupported
from oss.tests.pytest.unit.channels.slack.fake_slack import make_adapter_and_workspace

pytestmark = pytest.mark.asyncio


def _connection() -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        slug="slack-connection",
        channel="slack",
        external_key=uuid4(),
        data={
            "bot_token": "xoxb-fake",
            "connection_locator": {"team_id": "T1"},
        },
    )


async def test_list_member_spaces_follows_cursor_and_skips_non_members():
    adapter, workspace, transport = make_adapter_and_workspace()
    for index in range(5):
        workspace.add_channel(id=f"C{index}", name=f"chan-{index}", is_member=True)
    workspace.add_channel(id="CX", name="not-in", is_member=False)
    workspace.add_channel(id="CP", name="secret", is_member=True, is_private=True)

    adapter._member_page_size = 2  # force paging
    spaces = await adapter.list_member_spaces(connection=_connection())

    names = sorted(space.display_name for space in spaces)
    assert names == ["chan-0", "chan-1", "chan-2", "chan-3", "chan-4", "secret"]
    assert all(space.external_locator["team"] == "T1" for space in spaces)
    assert {space.kind for space in spaces} == {ChannelSpaceKind.TOPIC}
    calls = [
        r for r in transport.requests if r.url.path.endswith("users.conversations")
    ]
    assert len(calls) > 1
    assert calls[0].url.params["types"] == "public_channel,private_channel"


async def test_list_member_spaces_skips_group_dms():
    adapter, workspace, _ = make_adapter_and_workspace()
    workspace.add_channel(id="C1", name="general", is_member=True)
    workspace.add_channel(id="G1", name="mpdm-a--b", is_member=True, is_mpim=True)

    spaces = await adapter.list_member_spaces(connection=_connection())

    assert [space.external_locator["channel"] for space in spaces] == ["C1"]


async def test_telegram_has_no_member_listing():
    with pytest.raises(ChannelNotSupported):
        await TelegramAdapter().list_member_spaces(connection=_connection())

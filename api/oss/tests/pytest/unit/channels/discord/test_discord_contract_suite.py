"""Runs the shared contract suite against DiscordAdapter over the fake
Discord API. Discord has no HTTP ingress, so the suite skips its signature
assertions; `test_discord_adapter.py` pins that `verify_signature` is never
offered."""

from uuid import uuid4

import httpx

from oss.src.core.channels.adapters.discord.adapter import DiscordAdapter
from oss.src.core.channels.dtos import ChannelConnection

from ..contract.test_channel_adapter_contract import run_contract_suite
from . import payloads as p
from .fake_discord import BASE_URL, FakeDiscord


class _InspectedDiscordAdapter(DiscordAdapter):
    def __init__(self, fake: FakeDiscord) -> None:
        super().__init__(
            http_client=httpx.AsyncClient(
                transport=httpx.ASGITransport(app=fake.app), base_url=BASE_URL
            )
        )
        self._fake = fake

    def inspect_posted(self, receipt):
        # What reached Discord, after any degradation to numbered text.
        [message] = [m for m in self._fake.sent if m["id"] == receipt["message_id"]]
        return [
            {"type": "button", "id": button["custom_id"]}
            for row in message.get("components") or []
            for button in row["components"]
        ]


async def test_discord_adapter_passes_the_shared_contract_suite():
    connection = ChannelConnection(
        id=uuid4(),
        slug="discord-contract-suite",
        channel="discord",
        external_key=uuid4(),
        data={
            "connection_locator": {"application_id": p.APPLICATION_ID},
            "bot_token": p.BOT_TOKEN,
            "bot_user_id": p.BOT_USER_ID,
        },
    )

    await run_contract_suite(
        _InspectedDiscordAdapter(FakeDiscord()),
        connection=connection,
        locator={"guild_id": p.GUILD_ID, "channel_id": p.CHANNEL_ID},
        signed=False,
    )

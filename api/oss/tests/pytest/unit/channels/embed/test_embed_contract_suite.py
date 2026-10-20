"""Runs the shared contract suite against `EmbedAdapter`. The suite's generic
good header becomes a strong visitor key; every other method is the real
adapter."""

import string
from uuid import uuid4

from oss.src.core.channels.adapters.embed.adapter import (
    VISITOR_KEY_HEADER,
    EmbedAdapter,
)
from oss.src.core.channels.dtos import ChannelConnection, ChannelRequestContext

from ..contract.fakes import VALID_SIGNATURE_HEADER, VALID_SIGNATURE_VALUE
from ..contract.test_channel_adapter_contract import run_contract_suite

STRONG_KEY = string.ascii_letters[:40]  # a strong key: 40 distinct


class _KeyedEmbedAdapter(EmbedAdapter):
    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        headers = (
            {VISITOR_KEY_HEADER: STRONG_KEY}
            if request.headers.get(VALID_SIGNATURE_HEADER) == VALID_SIGNATURE_VALUE
            else {}
        )
        return await super().verify_signature(
            request=ChannelRequestContext(
                headers=headers, path=request.path, body=request.body
            ),
            connection=connection,
        )


async def test_embed_adapter_passes_the_shared_contract_suite():
    connection = ChannelConnection(
        id=uuid4(),
        slug="embed-contract-suite",
        channel="embed",
        external_key=uuid4(),
        data={"connection_locator": {"embed": "embed-id"}},
    )

    await run_contract_suite(_KeyedEmbedAdapter(), connection=connection)

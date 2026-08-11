"""Runs the reusable contract suite against `AgentaAdapter`.

Mirrors `slack/test_slack_contract_suite.py` exactly: `verify_signature` is
swapped for the suite's own fake header scheme via a test-local subclass,
since a real API-key check correctly rejects that header. Every other
method -- capabilities, connection_locator, parse_event, post/edit,
discover_spaces, fetch_history -- is the real AgentaAdapter, unmodified.
"""

from uuid import uuid4

from oss.src.core.channels.adapters.agenta.adapter import AgentaAdapter
from oss.src.core.channels.dtos import ChannelConnection, ChannelRequestContext
from oss.src.core.channels.types import ChannelSignatureInvalid

from ..contract.fakes import (
    INSTALLATION_ID,
    VALID_SIGNATURE_HEADER,
    VALID_SIGNATURE_VALUE,
)
from ..contract.test_channel_adapter_contract import run_contract_suite


class _NullChannelsDAO:
    async def query_spaces(self, *, project_id, space=None, windowing=None):
        return []


class _SuiteAdaptedAgentaAdapter(AgentaAdapter):
    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        if request.headers.get(VALID_SIGNATURE_HEADER) != VALID_SIGNATURE_VALUE:
            raise ChannelSignatureInvalid(channel=self.channel)
        return INSTALLATION_ID


def _connection() -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        slug="agenta-contract-suite",
        channel="agenta",
        external_key=uuid4(),
        data={"connection_locator": {"project": INSTALLATION_ID, "bot": "support"}},
    )


async def test_agenta_adapter_passes_the_shared_contract_suite():
    adapter = _SuiteAdaptedAgentaAdapter(
        channels_dao=_NullChannelsDAO(),
        resolve_project=lambda raw_key: None,
    )

    await run_contract_suite(adapter, connection=_connection())

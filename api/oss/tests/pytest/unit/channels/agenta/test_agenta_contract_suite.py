"""Runs the reusable contract suite against `AgentaAdapter`, built with
dependencies shaped like `build_channel_adapter_registry`'s: a `channels_dao`
that answers instead of a `None` the adapter can never reach, and a
`resolve_project` that actually resolves a key instead of always returning
nothing. `_CredentialedAgentaAdapter` translates the suite's generic good/bad
header into the real `Authorization` header AgentaAdapter's own
`verify_signature` expects, so that resolver is what decides accept/reject --
every other method, including `verify_signature` itself, is the real
AgentaAdapter, unmodified.
"""

from typing import Optional
from uuid import uuid4

from oss.src.core.channels.adapters.agenta.adapter import AgentaAdapter
from oss.src.core.channels.dtos import ChannelConnection, ChannelRequestContext

from ..contract.fakes import VALID_SIGNATURE_HEADER, VALID_SIGNATURE_VALUE
from ..contract.test_channel_adapter_contract import run_contract_suite

GOOD_KEY = "prefix.contract-suite-key"
PROJECT_ID = str(uuid4())


class _FakeChannelsDAO:
    """The one method AgentaAdapter calls, shaped like the composition
    root's real ChannelsDAO rather than a None the dependency can never
    reach."""

    async def query_spaces(self, *, project_id, space=None, windowing=None):
        return []


async def _resolve_project(raw_key: str) -> Optional[str]:
    return PROJECT_ID if raw_key == GOOD_KEY else None


class _CredentialedAgentaAdapter(AgentaAdapter):
    """Translates the suite's generic good/bad signal into the real
    Authorization header this adapter's own verify_signature expects, so the
    injected resolve_project is what actually decides accept/reject."""

    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        headers = (
            {"Authorization": f"ApiKey {GOOD_KEY}"}
            if request.headers.get(VALID_SIGNATURE_HEADER) == VALID_SIGNATURE_VALUE
            else {}
        )
        return await super().verify_signature(
            request=ChannelRequestContext(
                headers=headers, path=request.path, body=request.body
            ),
            connection=connection,
        )


def _connection() -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        slug="agenta-contract-suite",
        channel="agenta",
        external_key=uuid4(),
        data={"connection_locator": {"project": PROJECT_ID, "bot": "support"}},
    )


async def test_agenta_adapter_passes_the_shared_contract_suite():
    adapter = _CredentialedAgentaAdapter(
        channels_dao=_FakeChannelsDAO(),
        resolve_project=_resolve_project,
    )

    await run_contract_suite(adapter, connection=_connection())

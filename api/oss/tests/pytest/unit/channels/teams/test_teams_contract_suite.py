"""Runs the shared contract suite against TeamsAdapter.

The suite's two signature checks post its own generic good or bad header
(`x-fake-signature`, contract/fakes.py), not a Teams JWT. The subclass here
only turns that signal into a real request: a JWT signed with the test key
over a fixture activity, or no token. The real `verify_signature` checks it.
"""

import pytest

from oss.src.core.channels.adapters.teams.adapter import TeamsAdapter
from oss.src.core.channels.adapters.teams.capabilities import (
    fetch_teams_capabilities,
)
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelKeyGrain,
    ChannelRequestContext,
)
from oss.src.core.channels.types import ChannelLocatorIncomplete
from oss.src.core.channels.utils import compose_external_key

from ..contract.fakes import VALID_SIGNATURE_HEADER, VALID_SIGNATURE_VALUE
from ..contract.test_channel_adapter_contract import run_contract_suite
from . import fake_teams as f
from . import payloads as p


class _SuiteAdaptedTeamsAdapter(TeamsAdapter):
    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        signed = request.headers.get(VALID_SIGNATURE_HEADER) == VALID_SIGNATURE_VALUE
        return await super().verify_signature(
            request=ChannelRequestContext(
                headers=f.auth_headers() if signed else {},
                path=request.path,
                body=p.encode(p.message()),
            ),
            connection=connection,
        )


async def test_teams_adapter_passes_the_shared_contract_suite():
    adapter = _SuiteAdaptedTeamsAdapter(http_client=f.client_for(f.FakeMicrosoft()))

    await run_contract_suite(adapter, connection=p.connection())


def test_two_channel_threads_never_share_a_key():
    capabilities = fetch_teams_capabilities()
    base = {"tenant_id": p.TENANT_ID, "conversation_id": p.CHANNEL_CONVERSATION}

    one = compose_external_key(
        capabilities, ChannelKeyGrain.THREAD, {**base, "thread_id": "111"}
    )
    two = compose_external_key(
        capabilities, ChannelKeyGrain.THREAD, {**base, "thread_id": "222"}
    )

    assert one != two
    with pytest.raises(ChannelLocatorIncomplete):
        compose_external_key(capabilities, ChannelKeyGrain.THREAD, base)

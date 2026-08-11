"""Runs the reusable contract suite against `AgentaAdapter`.

Mirrors `slack/test_slack_contract_suite.py` exactly: `verify_signature` is
swapped for the suite's own fake header scheme via a test-local subclass,
since a real API-key check correctly rejects that header. Every other
method -- capabilities, connection_locator, parse_event, post/edit,
discover_spaces, fetch_history -- is the real AgentaAdapter, unmodified.
"""

from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.agenta.adapter import AgentaAdapter
from oss.src.core.channels.dtos import ChannelConnection, ChannelRequestContext
from oss.src.core.channels.types import ChannelSignatureInvalid

from ..contract.fakes import (
    INSTALLATION_ID,
    VALID_SIGNATURE_HEADER,
    VALID_SIGNATURE_VALUE,
)
from ..contract.test_channel_adapter_contract import (
    _assert_backfill,
    _assert_buttons_max,
    _assert_controls_update,
    _assert_parse_event_addressed_is_bool,
    _assert_verify_signature_accepts_good_signature,
    _assert_verify_signature_rejects_bad_signature,
    run_contract_suite,
)


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


@pytest.mark.xfail(
    strict=True,
    reason=(
        "suite bug, not an adapter defect: the shared identity assertions "
        "compose THREAD-grain keys from THREAD_LOCATOR_A/B/INCOMPLETE, whose "
        "fields are hardcoded to team/channel/thread_ts. Any adapter "
        "declaring identity.keys[thread] under different names -- agenta's "
        "is ['thread'], per the spec -- cannot satisfy those assertions; "
        "the suite has no per-adapter fixture override for this grain."
    ),
)
async def test_agenta_adapter_passes_the_shared_contract_suite():
    adapter = _SuiteAdaptedAgentaAdapter(
        channels_dao=_NullChannelsDAO(),
        resolve_project=lambda raw_key: None,
    )

    await run_contract_suite(adapter, connection=_connection())


async def test_agenta_adapter_passes_every_non_identity_contract_assertion():
    """The suite's per-grain identity assertions are the one part this
    adapter cannot run through unmodified (see the xfail above); every other
    assertion the suite makes runs clean, called directly since
    `run_contract_suite` itself does not let them run without the rest."""

    adapter = _SuiteAdaptedAgentaAdapter(
        channels_dao=_NullChannelsDAO(),
        resolve_project=lambda raw_key: None,
    )
    connection = _connection()
    capabilities = await adapter.fetch_capabilities(connection=connection)

    await _assert_controls_update(adapter, capabilities, connection)
    await _assert_buttons_max(adapter, capabilities, connection)
    await _assert_backfill(adapter, capabilities, connection)
    await _assert_verify_signature_rejects_bad_signature(adapter, connection)
    await _assert_verify_signature_accepts_good_signature(adapter, connection)
    await _assert_parse_event_addressed_is_bool(adapter)

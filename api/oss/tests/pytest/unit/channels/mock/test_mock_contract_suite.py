"""Runs the reusable contract suite against `MockAdapter`, unmodified — no
adapter-local override, no test-local subclass swapping verify_signature.

Mock's shared-secret signature scheme defaults to the exact header/value the
suite's own fixtures use (`x-fake-signature: valid`), so it is the one adapter
for which the suite's two signature assertions hold by construction. Slack
runs the same suite through a test-local subclass, because a real HMAC check
correctly rejects the suite's fake header.
"""

import pytest

from oss.src.core.channels.adapters.mock.adapter import MockAdapter

from ..contract.test_channel_adapter_contract import run_contract_suite


@pytest.mark.asyncio
async def test_mock_adapter_passes_wp2_contract_suite_unmodified():
    await run_contract_suite(MockAdapter())

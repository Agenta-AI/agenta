"""Wallet-owned fake LLM/MCP message content and component preservation."""

from uuid import uuid4

import pytest

from ee.src.core.wallets.contracts import GatewayKind
from ee.tests.pytest.acceptance.wallets.fakes.llm import run_fake_llm_request
from ee.tests.pytest.acceptance.wallets.fakes.mcp import run_fake_mcp_request
from ee.tests.pytest.utils.measurements.fakes import InMemoryMeasurementPublisher


@pytest.mark.asyncio
async def test_fake_llm_publishes_exactly_one_measurement_command():
    publisher = InMemoryMeasurementPublisher()
    project_id = uuid4()

    result = await run_fake_llm_request(project_id=project_id, publisher=publisher)

    assert result.published is True
    assert len(publisher.published) == 1
    assert publisher.published[0] is result.measurement_command


@pytest.mark.asyncio
async def test_fake_llm_message_content_and_component_preservation():
    publisher = InMemoryMeasurementPublisher()
    project_id = uuid4()

    result = await run_fake_llm_request(
        project_id=project_id,
        publisher=publisher,
        input_tokens=1200,
        cached_tokens=1000,
        output_tokens=380,
    )
    command = result.measurement_command

    assert command.gateway_kind == GatewayKind.LLM
    assert command.project_id == project_id
    assert command.endpoint_kind == "managed"

    by_key = {c.key: c for c in command.components}
    assert set(by_key) == {
        "request_count",
        "input_tokens",
        "cached_tokens",
        "output_tokens",
    }
    assert by_key["request_count"].value == 1
    assert by_key["request_count"].cost_musd is None
    assert by_key["input_tokens"].value == 1200
    assert (
        by_key["input_tokens"].cost_musd is not None
        and by_key["input_tokens"].cost_musd > 0
    )
    assert by_key["cached_tokens"].value == 1000
    assert by_key["output_tokens"].value == 380
    assert (
        by_key["output_tokens"].cost_musd is not None
        and by_key["output_tokens"].cost_musd > 0
    )

    # The completion itself is untouched by measurement publishing.
    assert "usage" in result.managed_result


@pytest.mark.asyncio
async def test_fake_mcp_publishes_exactly_one_measurement_command():
    publisher = InMemoryMeasurementPublisher()
    project_id = uuid4()

    result = await run_fake_mcp_request(project_id=project_id, publisher=publisher)

    assert result.published is True
    assert len(publisher.published) == 1


@pytest.mark.asyncio
async def test_fake_mcp_message_content_carries_only_request_count():
    publisher = InMemoryMeasurementPublisher()
    project_id = uuid4()

    result = await run_fake_mcp_request(project_id=project_id, publisher=publisher)
    command = result.measurement_command

    assert command.gateway_kind == GatewayKind.MCP
    assert len(command.components) == 1
    assert command.components[0].key == "request_count"
    assert command.components[0].value == 1
    assert command.components[0].cost_musd is None


@pytest.mark.asyncio
async def test_fake_result_unaffected_by_publish_failure():
    """A failed initial XADD means no measurement/debit — never a changed
    caller-visible result. The fake's `managed_result` must be identical
    whether or not the publish succeeds."""
    ok_publisher = InMemoryMeasurementPublisher()
    failing_publisher = InMemoryMeasurementPublisher()
    failing_publisher.fail_next = True
    project_id = uuid4()

    ok_result = await run_fake_llm_request(
        project_id=project_id, publisher=ok_publisher
    )
    failed_result = await run_fake_llm_request(
        project_id=project_id, publisher=failing_publisher
    )

    assert ok_result.published is True
    assert failed_result.published is False
    assert ok_result.managed_result["text"] == failed_result.managed_result["text"]

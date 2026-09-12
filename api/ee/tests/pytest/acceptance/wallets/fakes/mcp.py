"""Wallet-owned deterministic fake managed MCP call.

Returns a fixed local tool result (no network, no real MCP server) and
publishes exactly one `MeasurementCommandV1` carrying request count only —
MCP measurements have no cost component in Wave 1.
"""

from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import UUID, uuid4

from ee.src.core.wallets.contracts import (
    GatewayKind,
    MeasurementCommandV1,
    MeasurementComponentV1,
)
from ee.src.core.wallets.streaming import MeasurementPublisher
from ee.tests.pytest.acceptance.wallets.fakes.results import FakeGatewayResult

DEFAULT_RESOURCE_KEY = "mcp:agenta:fake-tool"


def _fake_tool_result(tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    return {"tool": tool_name, "arguments": arguments, "output": "[fake-mcp] ok"}


async def run_fake_mcp_request(
    *,
    project_id: UUID,
    publisher: MeasurementPublisher,
    user_id: Optional[UUID] = None,
    agent_id: Optional[UUID] = None,
    tool_name: str = "fake_tool",
    arguments: Optional[Dict[str, Any]] = None,
    request_count: int = 1,
    resource_key: str = DEFAULT_RESOURCE_KEY,
    endpoint_id: Optional[str] = "end_fake_mcp",
    endpoint_kind: str = "managed",
    references: Optional[Dict[str, Any]] = None,
) -> FakeGatewayResult:
    """Deterministic local built-in MCP result: no real MCP server, no network."""
    measurement_id = f"msr_{uuid4().hex}"
    request_id = f"req_{uuid4().hex}"
    now = datetime.now(timezone.utc)

    managed_result = _fake_tool_result(tool_name, arguments or {})

    components = [
        MeasurementComponentV1(
            key="request_count", value=request_count, cost_musd=None
        ),
    ]

    command = MeasurementCommandV1(
        measurement_id=measurement_id,
        project_id=project_id,
        user_id=user_id,
        agent_id=agent_id,
        gateway_kind=GatewayKind.MCP,
        request_id=request_id,
        resource_key=resource_key,
        resource_locator={
            "server": "agenta",
            "tool": tool_name,
            "endpoint_id": endpoint_id,
        },
        endpoint_id=endpoint_id,
        endpoint_kind=endpoint_kind,
        start_time=now,
        end_time=now,
        components=components,
        references=references or {},
        created_at=now,
    )

    published = await publisher.publish(command)

    return FakeGatewayResult(
        managed_result=managed_result,
        measurement_command=command,
        published=published,
    )

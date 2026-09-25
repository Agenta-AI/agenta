"""A stand-in MCP measurement producer, for tests only.

Wave 2 connected the LLM gateway to the wallet and built no MCP producer, so this is the
only thing that emits an MCP measurement, and the only thing the rate card's MCP
per-request price is tested against. A real producer replaces it when the MCP gateway's
`builtin` calls are measured: it must emit `request_count` under `gateway_kind="mcp"`,
`endpoint_kind="builtin"`, and a `resource_locator` carrying the `server` the rate card is
keyed by.
"""

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from ee.src.core.measurements.components import REQUEST_COUNT
from ee.src.core.wallets.contracts import (
    GatewayKind,
    MeasurementCommandV1,
    MeasurementComponentV1,
)
from ee.src.core.wallets.streaming import MeasurementPublisher


async def publish_mcp_measurement(
    *,
    project_id: UUID,
    publisher: MeasurementPublisher,
    organization_id: Optional[UUID] = None,
    server: str = "agenta",
    tool: str = "fake_tool",
    request_count: int = 1,
) -> MeasurementCommandV1:
    measurement_id = f"msr_{uuid4().hex}"
    now = datetime.now(timezone.utc)
    command = MeasurementCommandV1(
        measurement_id=measurement_id,
        organization_id=organization_id,
        project_id=project_id,
        gateway_kind=GatewayKind.MCP,
        request_id=measurement_id,
        resource_key=f"mcp:{server}:{tool}",
        resource_locator={"server": server, "tool": tool, "endpoint_id": None},
        endpoint_kind="builtin",
        end_time=now,
        components=[MeasurementComponentV1(key=REQUEST_COUNT, value=request_count)],
        created_at=now,
    )
    await publisher.publish(command)
    return command

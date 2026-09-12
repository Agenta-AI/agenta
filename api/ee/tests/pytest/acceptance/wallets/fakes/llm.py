"""Wallet-owned deterministic fake managed LLM call.

Returns a fixed local completion (no network, no real provider) and publishes
exactly one `MeasurementCommandV1` — carrying request count, input, cached, and
output tokens with their observed provider costs — to `streams:measurements`
via the injected publisher, after the managed result already exists.
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

DEFAULT_RESOURCE_KEY = "llm:google:gemini-2.5-flash"

# Deterministic fixture rates for the fake provider's OWN declared cost (musd
# per token) — independent of the wallet's own Wave 1 pricing fixture, which
# the measurement worker applies later.
INPUT_MUSD_PER_TOKEN = 0.2
CACHED_MUSD_PER_TOKEN = 0.02
OUTPUT_MUSD_PER_TOKEN = 2.0


def _fake_completion_text(prompt: str) -> str:
    return f"[fake-llm] {prompt.strip()}"[:200]


async def run_fake_llm_request(
    *,
    project_id: UUID,
    publisher: MeasurementPublisher,
    user_id: Optional[UUID] = None,
    agent_id: Optional[UUID] = None,
    prompt: str = "Hello from the wallet acceptance fake.",
    input_tokens: int = 1200,
    cached_tokens: int = 1000,
    output_tokens: int = 380,
    resource_key: str = DEFAULT_RESOURCE_KEY,
    endpoint_id: Optional[str] = "end_fake_llm",
    endpoint_kind: str = "managed",
    references: Optional[Dict[str, Any]] = None,
) -> FakeGatewayResult:
    """Deterministic local built-in LLM result: no real provider, no network."""
    measurement_id = f"msr_{uuid4().hex}"
    request_id = f"req_{uuid4().hex}"
    now = datetime.now(timezone.utc)

    managed_result = {
        "text": _fake_completion_text(prompt),
        "usage": {
            "input_tokens": input_tokens,
            "cached_tokens": cached_tokens,
            "output_tokens": output_tokens,
        },
    }

    components = [
        MeasurementComponentV1(key="request_count", value=1),
        MeasurementComponentV1(
            key="input_tokens",
            value=input_tokens,
            cost_musd=round(input_tokens * INPUT_MUSD_PER_TOKEN),
        ),
        MeasurementComponentV1(
            key="cached_tokens",
            value=cached_tokens,
            cost_musd=round(cached_tokens * CACHED_MUSD_PER_TOKEN),
        ),
        MeasurementComponentV1(
            key="output_tokens",
            value=output_tokens,
            cost_musd=round(output_tokens * OUTPUT_MUSD_PER_TOKEN),
        ),
    ]

    command = MeasurementCommandV1(
        measurement_id=measurement_id,
        project_id=project_id,
        user_id=user_id,
        agent_id=agent_id,
        gateway_kind=GatewayKind.LLM,
        request_id=request_id,
        resource_key=resource_key,
        resource_locator={
            "provider": "google",
            "model": "gemini-2.5-flash",
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

    # Best-effort — after the managed result already exists. A publish
    # failure never changes `managed_result`.
    published = await publisher.publish(command)

    return FakeGatewayResult(
        managed_result=managed_result,
        measurement_command=command,
        published=published,
    )

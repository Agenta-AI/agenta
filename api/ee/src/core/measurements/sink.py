"""The wallet's side of the gateway's usage hand-off: one gateway call becomes one
`MeasurementCommandV1` on `streams:measurements`."""

from datetime import datetime, timezone
from typing import List, Optional

import uuid_utils.compat as uuid

from oss.src.core.gateways.policy.dtos import GatewayOutcome, GatewayTarget
from oss.src.core.gateways.policy.interfaces import UsageSinkInterface
from oss.src.utils.context import AuthScope

from ee.src.core.measurements.components import (
    CACHE_READ_TOKENS,
    CACHE_WRITE_TOKENS,
    INPUT_TOKENS,
    OUTPUT_TOKENS,
    REQUEST_COUNT,
)
from ee.src.core.wallets.contracts import (
    GatewayKind,
    MeasurementCommandV1,
    MeasurementComponentV1,
)
from ee.src.core.wallets.streaming import MeasurementPublisher


class MeasurementUsageSink(UsageSinkInterface):
    """Publishes the measurement and returns. Pricing happens later, in the measurement
    worker, never on the request path. The gateway bounds and contains this call, and a
    refused publish, which the publisher logs, is a lost measurement."""

    def __init__(self, *, publisher: MeasurementPublisher):
        self.publisher = publisher

    async def record(
        self,
        *,
        scope: AuthScope,
        target: GatewayTarget,
        outcome: GatewayOutcome,
        run_id: Optional[str],
    ) -> None:
        await self.publisher.publish(
            measurement_from_call(
                scope=scope, target=target, outcome=outcome, run_id=run_id
            )
        )


def measurement_from_call(
    *,
    scope: AuthScope,
    target: GatewayTarget,
    outcome: GatewayOutcome,
    run_id: Optional[str],
) -> MeasurementCommandV1:
    # Minted once per call, here: the sink runs exactly once per relay, and from the
    # stream message onwards this id is the idempotency spine through to the debit's
    # `measurement:{id}` posting key. The gateway has no request id of its own to reuse.
    measurement_id = f"msr_{uuid.uuid7()}"
    now = datetime.now(timezone.utc)
    endpoint_id = str(target.endpoint_id) if target.endpoint_id is not None else None
    # `.value`, never the enum: an f-string renders a str-mixin enum as its class path,
    # and restricted credits prefix-match on this key.
    plane = target.plane.value
    return MeasurementCommandV1(
        measurement_id=measurement_id,
        organization_id=scope.organization_id,
        project_id=scope.project_id,
        user_id=scope.user_id,
        gateway_kind=GatewayKind(plane),
        request_id=measurement_id,
        resource_key=f"{plane}:{target.provider}:{target.model}",
        resource_locator={
            "provider": target.provider,
            "model": target.model,
            "endpoint_id": endpoint_id,
        },
        endpoint_id=endpoint_id,
        endpoint_kind=target.namespace.value,
        end_time=now,
        components=_components(outcome),
        references={"workflow": {"gateway_run_id": run_id}} if run_id else {},
        created_at=now,
    )


def _components(outcome: GatewayOutcome) -> List[MeasurementComponentV1]:
    usage = outcome.usage
    if usage is None:
        return []
    # A quantity the upstream did not report is absent, not zero.
    values = {
        REQUEST_COUNT: usage.calls,
        INPUT_TOKENS: usage.input_tokens,
        CACHE_READ_TOKENS: usage.cache_read_tokens,
        CACHE_WRITE_TOKENS: usage.cache_write_tokens,
        OUTPUT_TOKENS: usage.output_tokens,
    }
    return [
        MeasurementComponentV1(key=key, value=value)
        for key, value in values.items()
        if value is not None
    ]

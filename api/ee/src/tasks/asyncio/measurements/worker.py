"""Measurement worker — consumes `streams:measurements`, persists the
measurement, prices it with the Wave 1 fixture, and publishes `DebitCommandV1`
to `streams:debits` for every charge the gateway decides to make.

Imports NO core wallet table, DAO, or service — its only outbound edge is the
debit stream, published through `DebitPublisher` (a structural protocol; see
`ee.src.core.wallets.streaming`).
"""

from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from redis.asyncio import Redis

from oss.src.tasks.asyncio.shared.consumer import StreamConsumer
from oss.src.utils.logging import get_module_logger

from ee.src.core.measurements.interfaces import (
    MeasurementsDAOInterface,
    OrganizationResolverInterface,
)
from ee.src.core.measurements.pricing import calculate_fake_charge
from ee.src.core.wallets.contracts import STREAM_MEASUREMENTS, DebitCommandV1, DebitKind
from ee.src.core.wallets.errors import WalletTerminalError
from ee.src.core.wallets.streaming import (
    DebitPublisher,
    deserialize_measurement_command,
)

log = get_module_logger(__name__)


class MeasurementWorker(StreamConsumer):
    """Worker for gateway measurement persistence and pricing via Redis Streams.

    Consumes from: streams:measurements
    Consumer group: worker-measurements

    Per message:
    1. Deserialize/validate — malformed or unsupported-version envelopes are
       terminal: logged and ACKed, since retry cannot help.
    2. Resolve the optional `organization_id` from project scope.
    3. Idempotently insert the measurement and its component values (one
       tracing transaction).
    4. Price the measurement with the Wave 1 fixture; a result the gateway
       does not charge (e.g. non-managed endpoint) publishes nothing.
    5. Publish `DebitCommandV1` to `streams:debits`.
    6. ACK + DEL only after both the tracing write and the debit publish (if
       any) succeed. A tracing or Redis failure leaves the message pending
       for normal consumer-group redelivery.
    """

    log_prefix = "[MEASUREMENTS]"

    def __init__(
        self,
        measurements_dao: MeasurementsDAOInterface,
        organization_resolver: OrganizationResolverInterface,
        debit_publisher: DebitPublisher,
        redis_client: Redis,
        stream_name: str = STREAM_MEASUREMENTS,
        consumer_group: str = "worker-measurements",
        consumer_name: Optional[str] = None,
        max_batch_size: int = 50,
        max_block_ms: int = 5000,
        max_delay_ms: int = 250,
        max_batch_mb: int = 50,
    ):
        super().__init__(
            redis_client=redis_client,
            stream_name=stream_name,
            consumer_group=consumer_group,
            consumer_name=consumer_name,
            max_batch_size=max_batch_size,
            max_block_ms=max_block_ms,
            max_delay_ms=max_delay_ms,
            max_batch_mb=max_batch_mb,
        )
        self.measurements_dao = measurements_dao
        self.organization_resolver = organization_resolver
        self.debit_publisher = debit_publisher

    async def _process_one(self, command) -> bool:
        """Persist + (maybe) charge one already-deserialized command.

        Returns True when the message is safe to ACK (tracing write, and any
        debit publish, both succeeded).
        """
        organization_id = command.organization_id
        if organization_id is None:
            organization_id = await self.organization_resolver.resolve_organization_id(
                project_id=command.project_id
            )

        await self.measurements_dao.insert_measurement(command=command)

        charge = calculate_fake_charge(command=command)
        if charge is None:
            return True

        amount_musd, pricing_version = charge

        if organization_id is None:
            # Can't safely bill without an organization. The measurement is
            # already persisted; log and ACK rather than retry forever on a
            # project that will never resolve to an org.
            log.error(
                "[MEASUREMENTS] Chargeable measurement has no resolvable organization",
                measurement_id=command.measurement_id,
                project_id=str(command.project_id),
            )
            return True

        debit = DebitCommandV1(
            idempotency_key=f"measurement:{command.measurement_id}",
            organization_id=organization_id,
            debit_kind=DebitKind.GATEWAY_USAGE,
            amount_musd=amount_musd,
            pricing_version=pricing_version,
            resource_key=command.resource_key,
            resource_locator=command.resource_locator,
            created_at=datetime.now(timezone.utc),
        )
        return await self.debit_publisher.publish(debit)

    async def process_batch(
        self, batch: List[Tuple[bytes, Dict[bytes, bytes]]]
    ) -> Tuple[int, List[bytes]]:
        processed_ids: List[bytes] = []

        for msg_id, data in batch:
            try:
                command = deserialize_measurement_command(payload=data[b"data"])
            except WalletTerminalError as e:
                log.error(
                    "[MEASUREMENTS] Terminal envelope error, ACKing without retry",
                    msg_id=repr(msg_id),
                    error=str(e),
                )
                processed_ids.append(msg_id)
                continue
            except Exception:
                log.error(
                    "[MEASUREMENTS] Unexpected deserialization error, leaving pending",
                    msg_id=repr(msg_id),
                    exc_info=True,
                )
                continue

            try:
                ok = await self._process_one(command)
            except Exception:
                log.error(
                    "[MEASUREMENTS] Failed to process measurement, leaving pending",
                    msg_id=repr(msg_id),
                    measurement_id=command.measurement_id,
                    exc_info=True,
                )
                continue

            if ok:
                processed_ids.append(msg_id)
            else:
                log.error(
                    "[MEASUREMENTS] Debit publish failed, leaving message pending",
                    msg_id=repr(msg_id),
                    measurement_id=command.measurement_id,
                )

        return len(processed_ids), processed_ids

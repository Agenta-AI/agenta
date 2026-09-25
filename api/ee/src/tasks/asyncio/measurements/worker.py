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

from ee.src.core.measurements.dtos import ChargeDecision
from ee.src.core.measurements.interfaces import (
    MeasurementsDAOInterface,
    OrganizationResolverInterface,
)
from ee.src.core.measurements.pricing import calculate_fake_charge
from ee.src.core.wallets.contracts import (
    STREAM_MEASUREMENTS,
    DebitCommandV1,
    DebitKind,
    MeasurementCommandV1,
)
from ee.src.core.wallets.errors import (
    OrganizationNotResolvedError,
    WalletTerminalError,
)
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
       terminal: dead-lettered, since retry cannot help.
    2. Look the measurement up. A measurement id already stored with different
       content is terminal: the stored measurement stands and is not re-priced.
    3. An unseen measurement is priced, its organization resolved when it is
       charged, and inserted with its values and that charge decision in one
       tracing transaction. A seen one keeps the decision it was stored with.
    4. A measurement with no charge publishes nothing.
    5. Publish `DebitCommandV1`, built from the stored decision, to
       `streams:debits`.
    6. ACK + DEL only after both the tracing write and the debit publish (if
       any) succeed. A tracing or Redis failure leaves the message pending,
       and the consumer's reclaim pass (`reclaim_pending=True` below) brings
       it back, until `max_deliveries` moves it to `streams:measurements:dead`.
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
        reclaim_min_idle_ms: int = 30_000,
        # About ten minutes of retries at the default idle window before a measurement
        # that keeps failing leaves the pending list for `streams:measurements:dead`.
        max_deliveries: int = 20,
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
            # `read_batch` only ever asks Redis for `>`, so a measurement this worker
            # leaves pending is invisible to every later read of this group: without the
            # reclaim pass, "leave it pending for redelivery" means "lose the measurement
            # and its charge silently". Redelivery is safe because the measurement insert
            # is idempotent on `measurement_id` and the debit it publishes carries the
            # derived `measurement:{measurement_id}` idempotency key, on which the
            # settlement port is itself idempotent.
            reclaim_pending=True,
            reclaim_min_idle_ms=reclaim_min_idle_ms,
            max_deliveries=max_deliveries,
            dead_letter=True,
        )
        self.measurements_dao = measurements_dao
        self.organization_resolver = organization_resolver
        self.debit_publisher = debit_publisher

    def describe_message(self, data: Dict[bytes, bytes]) -> Optional[str]:
        """`measurement_id` for a dead letter, so it is traceable."""
        try:
            command = deserialize_measurement_command(payload=data[b"data"])
        except Exception:
            return None
        return command.measurement_id

    async def _process_one(self, command: MeasurementCommandV1) -> bool:
        """Persist + (maybe) charge one already-deserialized command.

        Returns True when the message is safe to ACK (tracing write, and any
        debit publish, both succeeded). Raises `WalletTerminalError` when it never
        will be.

        A measurement already stored is replayed from its stored decision alone: the
        organization lookup and the pricer are not consulted again, so a redelivery
        after a failed debit publish recovers even when either has changed or is down.
        """
        persisted = await self.measurements_dao.fetch_measurement(command=command)
        if persisted is None:
            persisted = await self.measurements_dao.insert_measurement(
                command=command, charge=await self._decide_charge(command)
            )

        charge = persisted.charge
        if charge is None:
            return True

        debit = DebitCommandV1(
            idempotency_key=f"measurement:{command.measurement_id}",
            organization_id=charge.organization_id,
            debit_kind=DebitKind.GATEWAY_USAGE,
            amount_musd=charge.amount_musd,
            pricing_version=charge.pricing_version,
            resource_key=command.resource_key,
            resource_locator=command.resource_locator,
            created_at=charge.created_at,
        )
        return await self.debit_publisher.publish(debit)

    async def _decide_charge(
        self, command: MeasurementCommandV1
    ) -> Optional[ChargeDecision]:
        priced = calculate_fake_charge(command=command)
        if priced is None:
            return None
        amount_musd, pricing_version = priced

        organization_id = command.organization_id
        if organization_id is None:
            organization_id = await self.organization_resolver.resolve_organization_id(
                project_id=command.project_id
            )
        if organization_id is None:
            # Nothing is stored: a measurement stored without its charge would be replayed
            # as free forever. The dead letter keeps the whole message for a replay.
            raise OrganizationNotResolvedError(
                f"project {command.project_id} resolves to no organization"
            )

        return ChargeDecision(
            amount_musd=amount_musd,
            pricing_version=pricing_version,
            organization_id=organization_id,
            created_at=datetime.now(timezone.utc),
        )

    async def process_batch(
        self, batch: List[Tuple[bytes, Dict[bytes, bytes]]]
    ) -> Tuple[int, List[bytes]]:
        processed_ids: List[bytes] = []

        for msg_id, data in batch:
            try:
                command = deserialize_measurement_command(payload=data[b"data"])
            except WalletTerminalError as e:
                await self.dead_letter([(msg_id, data)], reason=f"terminal: {e}")
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
            except WalletTerminalError as e:
                await self.dead_letter([(msg_id, data)], reason=f"terminal: {e}")
                continue
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

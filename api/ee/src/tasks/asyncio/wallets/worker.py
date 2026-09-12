"""DebitWorker — consumes `streams:debits` and settles each posting through a
`WalletSettlementPort`.

Imports NO amount/pricing/metric logic of its own: `DebitCommandV1` already carries the
final `amount_musd`, so the only domain call here is `WalletSettlementPort.settle(command)`,
passed the envelope's opaque `idempotency_key` unmodified.
"""

from typing import Dict, List, Optional, Tuple

from redis.asyncio import Redis

from oss.src.tasks.asyncio.shared.consumer import StreamConsumer
from oss.src.utils.logging import get_module_logger

from ee.src.core.wallets.contracts import STREAM_DEBITS
from ee.src.core.wallets.errors import WalletTerminalError
from ee.src.core.wallets.interfaces import WalletSettlementPort
from ee.src.core.wallets.streaming import deserialize_debit_command

log = get_module_logger(__name__)


class DebitWorker(StreamConsumer):
    """Worker for wallet debit settlement via Redis Streams.

    Consumes from: streams:debits
    Consumer group: worker-debits
    """

    log_prefix = "[WALLETS]"

    def __init__(
        self,
        settlement_port: WalletSettlementPort,
        redis_client: Redis,
        stream_name: str = STREAM_DEBITS,
        consumer_group: str = "worker-debits",
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
        self.settlement_port = settlement_port

    async def process_batch(
        self, batch: List[Tuple[bytes, Dict[bytes, bytes]]]
    ) -> Tuple[int, List[bytes]]:
        """Per message: deserialize, settle, ACK only after settlement succeeds.

        A malformed or unsupported-version envelope is terminal — logged and ACKed, since
        retry cannot help. A duplicate delivery is a normal successful settlement replay
        (the settlement port itself is idempotent on `idempotency_key`): no error, ACK. A
        core transaction, database, or Redis error while settling is retryable — the
        message is left pending for normal consumer-group redelivery.
        """
        processed_ids: List[bytes] = []

        for msg_id, data in batch:
            try:
                command = deserialize_debit_command(payload=data[b"data"])
            except WalletTerminalError as e:
                log.error(
                    "[WALLETS] Terminal envelope error, ACKing without retry",
                    msg_id=repr(msg_id),
                    error=str(e),
                )
                processed_ids.append(msg_id)
                continue
            except Exception:
                log.error(
                    "[WALLETS] Unexpected deserialization error, leaving pending",
                    msg_id=repr(msg_id),
                    exc_info=True,
                )
                continue

            try:
                await self.settlement_port.settle(command)
            except Exception:
                log.error(
                    "[WALLETS] Failed to settle debit, leaving pending",
                    msg_id=repr(msg_id),
                    idempotency_key=command.idempotency_key,
                    exc_info=True,
                )
                continue

            processed_ids.append(msg_id)

        return len(processed_ids), processed_ids

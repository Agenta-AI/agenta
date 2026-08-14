"""DebitWorker shell — consumes `streams:debits` and settles each posting through a
`WalletSettlementPort`.

Constructible so `WP-1-02` can register both wallet streams; `process_batch` raises
`NotImplementedError` so `WP-1-03` is the only package that owns settlement business logic.
"""

from typing import Dict, List, Optional, Tuple

from redis.asyncio import Redis

from oss.src.tasks.asyncio.shared.consumer import StreamConsumer

from ee.src.core.wallets.contracts import STREAM_DEBITS
from ee.src.core.wallets.interfaces import WalletSettlementPort


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
        raise NotImplementedError

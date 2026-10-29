from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from entrypoints import worker_streams


async def test_relay_initialization_failure_does_not_block_durable_consumers():
    records = SimpleNamespace(
        stream_name="streams:records",
        consumer_group="worker-records",
        consumer_name="records-1",
        create_consumer_group=AsyncMock(),
        run=AsyncMock(),
    )
    live_relay = SimpleNamespace(
        stream_name="streams:session-live-frames",
        consumer_group="worker-session-live-relay",
        consumer_name="relay-1",
        create_consumer_group=AsyncMock(
            side_effect=RuntimeError("relay XGROUP failed")
        ),
        run=AsyncMock(),
    )

    with (
        patch.object(worker_streams, "_selected_streams", return_value=["records"]),
        patch.object(worker_streams, "warn_deprecated_env_vars"),
        patch.object(worker_streams, "validate_required_env_vars"),
        patch.object(worker_streams, "is_ee", return_value=False),
        patch.object(worker_streams.Redis, "from_url", return_value=AsyncMock()),
        patch.object(
            worker_streams,
            "_build_records_worker",
            new=AsyncMock(return_value=records),
        ),
        patch.object(
            worker_streams,
            "_build_live_relay_worker",
            new=AsyncMock(return_value=live_relay),
        ),
        patch.object(
            worker_streams,
            "prune_idle_consumers",
            new=AsyncMock(return_value=[]),
        ),
        patch.object(worker_streams.env.sessions, "shared_reader", True),
    ):
        assert await worker_streams.main_async() == 0

    records.create_consumer_group.assert_awaited_once()
    records.run.assert_awaited_once()
    live_relay.create_consumer_group.assert_awaited_once()
    live_relay.run.assert_not_awaited()

from datetime import datetime, timezone

import pytest

from oss.src.core.tracing.dtos import Analytics, Bucket, MetricsBucket
from oss.src.dbs.postgres.tracing.mappings import sort_buckets_by_timestamp


UTC = timezone.utc
EARLIER = datetime(2026, 6, 19, 11, 22, 13, tzinfo=UTC)
LATER = datetime(2026, 7, 9, 11, 22, 13, tzinfo=UTC)


@pytest.mark.parametrize(
    "buckets",
    [
        [
            MetricsBucket(timestamp=LATER, interval=720, metrics={}),
            MetricsBucket(timestamp=EARLIER, interval=720, metrics={}),
        ],
        [
            Bucket(
                timestamp=LATER,
                interval=720,
                total=Analytics(),
                errors=Analytics(),
            ),
            Bucket(
                timestamp=EARLIER,
                interval=720,
                total=Analytics(),
                errors=Analytics(),
            ),
        ],
    ],
)
def test_sort_buckets_by_timestamp_returns_oldest_first(buckets):
    sorted_buckets = sort_buckets_by_timestamp(buckets)

    assert [bucket.timestamp for bucket in sorted_buckets] == [EARLIER, LATER]

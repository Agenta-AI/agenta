from unittest.mock import AsyncMock
from types import SimpleNamespace

import pytest
from miniopy_async.error import S3Error

from oss.src.core.store.storage import ObjectStore


@pytest.mark.asyncio
async def test_conditional_put_sends_precondition_and_never_falls_back():
    store = ObjectStore(endpoint_url=None, access_key=None, secret_key=None)
    put = AsyncMock()
    store._client = lambda: SimpleNamespace(_put_object=put)
    assert await store.put_object_if_absent(bucket="bucket", key="file", body=b"seed")
    put.assert_awaited_once_with("bucket", "file", b"seed", {"If-None-Match": "*"})

    put.side_effect = S3Error("PreconditionFailed", "exists", "file", None, None, None)
    assert not await store.put_object_if_absent(
        bucket="bucket", key="file", body=b"seed"
    )

    put.side_effect = S3Error("AccessDenied", "denied", "file", None, None, None)
    with pytest.raises(S3Error):
        await store.put_object_if_absent(bucket="bucket", key="file", body=b"seed")

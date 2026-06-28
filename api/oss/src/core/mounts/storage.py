from contextlib import asynccontextmanager
from typing import List, Optional, Tuple

import aioboto3

from oss.src.core.mounts.types import MountFileNotFound, MountStorageUnavailable


class MountStorage:
    """Thin S3/SeaweedFS adapter (aioboto3) for durable mount contents.

    Works whether or not a sandbox is live — reads/writes the object store
    directly. Same code path for dev (SeaweedFS) and platform (S3); only the
    endpoint/credentials differ, resolved from env at construction.
    """

    def __init__(
        self,
        *,
        endpoint_url: Optional[str],
        access_key: Optional[str],
        secret_key: Optional[str],
        region: str = "us-east-1",
    ):
        self._endpoint_url = endpoint_url
        self._access_key = access_key
        self._secret_key = secret_key
        self._region = region
        self._session = aioboto3.Session()

    @property
    def enabled(self) -> bool:
        return bool(self._access_key and self._secret_key)

    @asynccontextmanager
    async def _client(self):
        if not self.enabled:
            raise MountStorageUnavailable()
        async with self._session.client(
            "s3",
            endpoint_url=self._endpoint_url,
            aws_access_key_id=self._access_key,
            aws_secret_access_key=self._secret_key,
            region_name=self._region,
        ) as s3:
            yield s3

    async def list_objects(
        self,
        *,
        bucket: str,
        prefix: str,
    ) -> List[Tuple[str, int]]:
        """Return (key, size) for every object under `prefix`."""
        results: List[Tuple[str, int]] = []
        async with self._client() as s3:
            continuation: Optional[str] = None
            while True:
                kwargs = {"Bucket": bucket, "Prefix": prefix}
                if continuation:
                    kwargs["ContinuationToken"] = continuation
                resp = await s3.list_objects_v2(**kwargs)
                for obj in resp.get("Contents", []):
                    results.append((obj["Key"], obj.get("Size", 0)))
                if resp.get("IsTruncated"):
                    continuation = resp.get("NextContinuationToken")
                else:
                    break
        return results

    async def get_object(
        self,
        *,
        bucket: str,
        key: str,
    ) -> bytes:
        async with self._client() as s3:
            try:
                obj = await s3.get_object(Bucket=bucket, Key=key)
                return await obj["Body"].read()
            except s3.exceptions.NoSuchKey as e:
                raise MountFileNotFound() from e

    async def put_object(
        self,
        *,
        bucket: str,
        key: str,
        body: bytes,
    ) -> int:
        async with self._client() as s3:
            await s3.put_object(Bucket=bucket, Key=key, Body=body)
        return len(body)

    async def delete_keys(
        self,
        *,
        bucket: str,
        keys: List[str],
    ) -> int:
        if not keys:
            return 0
        async with self._client() as s3:
            # delete_objects caps at 1000 keys per call.
            for i in range(0, len(keys), 1000):
                await s3.delete_objects(
                    Bucket=bucket,
                    Delete={"Objects": [{"Key": k} for k in keys[i : i + 1000]]},
                )
        return len(keys)

    async def delete_prefix(
        self,
        *,
        bucket: str,
        prefix: str,
    ) -> int:
        """Delete every key under `prefix` (cascades a folder). Returns count."""
        objects = await self.list_objects(bucket=bucket, prefix=prefix)
        keys = [key for key, _ in objects]
        return await self.delete_keys(bucket=bucket, keys=keys)

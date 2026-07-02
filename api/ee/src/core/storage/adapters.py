"""Storage-size adapters for S3 (ListObjectsV2) and SeaweedFS (filer API)."""

from typing import Optional
from uuid import UUID

import httpx

from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env

log = get_module_logger(__name__)


async def get_s3_prefix_bytes(
    *,
    bucket: str,
    prefix: str,
    endpoint_url: Optional[str] = None,
    region: Optional[str] = None,
) -> int:
    """Return total object bytes under `prefix` in S3/MinIO using ListObjectsV2."""
    try:
        import boto3
    except ImportError:
        log.warning("[storage] boto3 not installed; S3 size check skipped")
        return 0

    try:
        kwargs = {}
        if endpoint_url:
            kwargs["endpoint_url"] = endpoint_url
        if region:
            kwargs["region_name"] = region

        s3 = boto3.client("s3", **kwargs)
        total = 0
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                total += obj.get("Size", 0)
        return total
    except Exception:
        log.warning("[storage] S3 size query failed", exc_info=True)
        return 0


async def get_seaweedfs_prefix_bytes(
    *,
    filer_url: str,
    prefix: str,
) -> int:
    """Return total bytes under `prefix` via SeaweedFS filer HTTP list API."""
    try:
        total = 0
        url = f"{filer_url.rstrip('/')}/{prefix.lstrip('/')}"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, params={"pretty": "y", "limit": "10000"})
            resp.raise_for_status()
            data = resp.json()
            for entry in data.get("Entries") or []:
                total += entry.get("FileSize", 0)
        return total
    except Exception:
        log.warning("[storage] SeaweedFS size query failed", exc_info=True)
        return 0


async def get_org_storage_bytes(*, org_id: UUID) -> int:
    """Authoritative total bytes for one org using the configured storage provider."""
    from ee.src.core.storage.paths import org_prefix

    prefix = org_prefix(org_id)
    provider = (env.agenta.storage.provider or "").lower()
    bucket = env.agenta.storage.bucket

    if provider == "s3":
        return await get_s3_prefix_bytes(
            bucket=bucket or "",
            prefix=prefix,
            endpoint_url=env.agenta.storage.endpoint_url,
            region=env.agenta.storage.aws_region,
        )

    if provider == "seaweedfs":
        filer_url = env.agenta.storage.endpoint_url or ""
        return await get_seaweedfs_prefix_bytes(filer_url=filer_url, prefix=prefix)

    log.debug("[storage] no provider configured; returning 0")
    return 0

"""Storage-size adapter: authoritative per-org byte count via the shared object store."""

from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env
from oss.src.core.store.storage import ObjectStore

log = get_module_logger(__name__)


async def get_org_storage_bytes(*, org_id: UUID) -> int:
    """Authoritative total bytes for one org, summed via ListObjectsV2 on env.store."""
    from ee.src.core.storage.paths import org_prefix

    if not env.store.enabled:
        log.debug("[storage] store not configured; returning 0")
        return 0

    store = ObjectStore(
        endpoint_url=env.store.endpoint_url,
        access_key=env.store.access_key,
        secret_key=env.store.secret_key,
        region=env.store.region,
        sts_endpoint_url=env.store.sts_endpoint_url,
        signing_key=env.store.signing_key,
    )
    bucket = env.store.bucket or ""
    prefix = org_prefix(org_id)

    try:
        objects = await store.list_objects_v2(bucket=bucket, prefix=prefix)
        return sum(size for _, size in objects)
    except Exception:
        log.warning("[storage] size query failed for org=%s", org_id, exc_info=True)
        return 0

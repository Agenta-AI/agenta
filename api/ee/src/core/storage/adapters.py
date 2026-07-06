"""Storage-size adapter: authoritative per-org byte count via the shared object store.

Mount object keys carry no org_id component (see MountsService._storage_key), so an
org's authoritative size is the sum over that org's projects' `mounts/<project_id>/`
prefixes, not a single org-level ListObjectsV2 scan.
"""

from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env
from oss.src.core.store.storage import ObjectStore
from oss.src.services.db_manager import fetch_projects_by_organization

from ee.src.core.storage.paths import project_prefix

log = get_module_logger(__name__)


async def get_org_storage_bytes(*, org_id: UUID) -> int:
    """Authoritative total bytes for one org: sum of its projects' mount prefixes."""
    if not env.store.enabled:
        log.debug("[storage] store not configured; returning 0")
        return 0

    projects = await fetch_projects_by_organization(str(org_id))
    if not projects:
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

    total = 0
    for project in projects:
        prefix = project_prefix(project.id)
        try:
            objects = await store.list_objects_v2(bucket=bucket, prefix=prefix)
            total += sum(size for _, size in objects)
        except Exception:
            log.warning(
                "[storage] size query failed for org=%s project=%s",
                org_id,
                project.id,
                exc_info=True,
            )
    return total

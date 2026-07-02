from uuid import UUID

from oss.src.utils.env import env


def project_prefix(project_id: UUID) -> str:
    """S3/SeaweedFS prefix for one project's mounts: [<namespace>/]mounts/<project_id>/.

    Matches MountsService._storage_key (api/oss/src/core/mounts/service.py):
    org_id is not a key component, so an org's bytes are the sum over its projects.
    """
    ns = (env.store.namespace or "").strip("/")
    base = f"{ns}/mounts/{project_id}" if ns else f"mounts/{project_id}"
    return f"{base}/"

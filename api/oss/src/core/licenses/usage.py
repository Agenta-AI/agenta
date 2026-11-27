"""Project and organization counts against the plan limits, for the License tab and
the create dialogs. The limits are enterprise code, so the OSS image reports none."""

from typing import Optional
from uuid import UUID

from oss.src.utils.common import is_ee


def _as_dict(usage) -> Optional[dict]:
    return None if usage is None else {"count": usage.count, "limit": usage.limit}


async def project_usage(organization_id: Optional[UUID]) -> Optional[dict]:
    """`{count, limit}` for the organization; `limit` None is unlimited. The same read
    as `check_project_limit`, so the bar and the refusal agree."""
    if not is_ee() or organization_id is None:
        return None
    from ee.src.core.access.entitlements.service import (  # noqa: PLC0415
        project_limit_usage,
    )

    return _as_dict(await project_limit_usage(organization_id))


async def organization_usage() -> Optional[dict]:
    """`{count, limit}` for the instance, the same read as
    `check_instance_organization_limit`. None on cloud, which has no organization limit."""
    if not is_ee():
        return None
    from ee.src.core.access.entitlements.service import (  # noqa: PLC0415
        instance_organization_limit_usage,
    )

    return _as_dict(await instance_organization_limit_usage())

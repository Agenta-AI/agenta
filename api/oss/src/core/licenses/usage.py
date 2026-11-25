"""Project and organization counts against the plan limits, for the License tab and
the create dialogs. The limits are enterprise code, so the OSS image reports none."""

from typing import Optional
from uuid import UUID

from oss.src.services import db_manager
from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


async def project_usage(organization_id: Optional[UUID]) -> Optional[dict]:
    """`{count, limit}` for the organization; `limit` None is unlimited. The same plan
    read as `check_project_limit`, so the bar and the refusal agree."""
    if not is_ee() or organization_id is None:
        return None
    from ee.src.core.access.entitlements.service import plan_for  # noqa: PLC0415
    from ee.src.core.access.entitlements.types import PROJECT_LIMITS  # noqa: PLC0415

    try:
        plan = await plan_for(organization_id)
    except Exception:  # pylint: disable=broad-exception-caught
        log.warning("[licenses] plan read failed; no project usage", exc_info=True)
        return None
    return {
        "count": await db_manager.count_organization_projects(str(organization_id)),
        "limit": PROJECT_LIMITS.get(plan) if plan else None,
    }


async def organization_usage() -> Optional[dict]:
    """`{count, limit}` for the instance, as `check_instance_organization_limit` reads it."""
    if not is_ee():
        return None
    from ee.src.core.access.entitlements.types import (  # noqa: PLC0415
        ORGANIZATION_LIMITS,
    )
    from ee.src.core.licenses.service import instance_plan  # noqa: PLC0415

    try:
        plan = await instance_plan()
    except Exception:  # pylint: disable=broad-exception-caught
        log.warning("[licenses] plan read failed; no organization usage", exc_info=True)
        return None
    return {
        "count": await db_manager.count_organizations(),
        "limit": ORGANIZATION_LIMITS.get(plan),
    }

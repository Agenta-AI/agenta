"""Composition helper for membership and access.

`bootstrap_access()` is the only place that picks the edition's membership policy and
RBAC adapter, and builds the principals DAO. Every process that checks access calls it at startup: the API
(`entrypoints/routers.py`) and both workers (`worker_streams.py`, `worker_queues.py`).
"""

from oss.src.core.access.rbac import AlwaysEnforcedRbac
from oss.src.core.access.service import AccessService, register_access_service
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import (
    MembershipsService,
    register_memberships_service,
)
from oss.src.dbs.postgres.access.dao import PrincipalsDAO
from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.common import is_ee


def bootstrap_access() -> AccessService:
    """Build and register the memberships and access services. Idempotent: a second
    call registers new instances."""

    memberships_service = MembershipsService(
        memberships_dao=MembershipsDAO(engine=get_transactions_engine()),
        policy=(
            MembershipPolicy.PROJECT_ROWS
            if is_ee()
            else MembershipPolicy.ORGANIZATION_WIDE
        ),
    )

    if is_ee():
        from ee.src.core.access.rbac import EntitlementsRbacEnforcement  # noqa: PLC0415

        rbac = EntitlementsRbacEnforcement()
    else:
        rbac = AlwaysEnforcedRbac()

    access_service = AccessService(
        memberships=memberships_service,
        rbac=rbac,
        principals=PrincipalsDAO(engine=get_transactions_engine()),
    )

    register_memberships_service(memberships_service=memberships_service)
    register_access_service(access_service=access_service)

    return access_service

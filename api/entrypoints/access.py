"""Composition helper for membership and access.

`bootstrap_access()` is the only place that picks the edition's membership policy and
RBAC adapter, and builds the principals DAO and the sharing service (the resource policy
of every access decision). Every process that checks access calls it at startup: the API
(`entrypoints/routers.py`) and both workers (`worker_streams.py`, `worker_queues.py`).
"""

from oss.src.core.access.rbac import NoRbacEntitlement
from oss.src.core.access.service import AccessService, register_access_service
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import (
    MembershipsService,
    register_memberships_service,
)
from oss.src.dbs.postgres.access.dao import PrincipalsDAO
from oss.src.core.sharing.service import SharingService, register_sharing_service
from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
from oss.src.dbs.postgres.sharing.dao import SharingDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.common import is_ee

from oss.src.core.account_choices.service import (
    AccountChoicesService,
    register_account_choices_service,
)
from oss.src.dbs.postgres.account_choices.dao import AccountChoicesDAO


def bootstrap_access() -> AccessService:
    """Build and register the memberships, sharing and access services. Idempotent: a
    second call registers new instances."""

    memberships_service = MembershipsService(
        memberships_dao=MembershipsDAO(engine=get_transactions_engine()),
        policy=(
            MembershipPolicy.PROJECT_ROWS
            if is_ee()
            else MembershipPolicy.ORGANIZATION_WIDE
        ),
    )

    if is_ee():
        from ee.src.core.access.rbac import PlanRbacEntitlement  # noqa: PLC0415

        rbac = PlanRbacEntitlement()
    else:
        rbac = NoRbacEntitlement()

    principals_dao = PrincipalsDAO(engine=get_transactions_engine())

    sharing_service = SharingService(
        sharing_dao=SharingDAO(engine=get_transactions_engine()),
        memberships_service=memberships_service,
    )

    access_service = AccessService(
        memberships=memberships_service,
        rbac=rbac,
        principals=principals_dao,
        resource_policy=sharing_service,
    )

    register_memberships_service(memberships_service=memberships_service)
    # The run start of every process (API, workers) resolves a run's "user" accounts.
    register_account_choices_service(
        account_choices_service=AccountChoicesService(
            account_choices_dao=AccountChoicesDAO(engine=get_transactions_engine())
        )
    )
    register_sharing_service(sharing_service=sharing_service)
    register_access_service(access_service=access_service)

    return access_service

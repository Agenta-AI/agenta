"""The membership resolver and the four membership writers.

`MembershipsService.resolve` is the one place that decides "is this user a member of
this project, and with which role" (CONTRACT section 2). The edition policy is given at
construction (`entrypoints/access.py`): OSS reads the organization row for every project
of the organization; EE reads the project row and needs the organization row too.

Writers go through the DAO, which runs each one in its own transaction under the
organization advisory lock, then clear the access caches with
`invalidate_access_caches`. A membership change takes effect at the next decision. It
can take up to `AGENTA_CACHE_TTL` (300 s) in two known cases: the Redis invalidation
fails, or a read that started before the mutation committed refills the old entry after
the invalidation.
"""

from typing import List, Optional, Sequence
from uuid import UUID

from oss.src.core.memberships.dtos import (
    MembershipPolicy,
    MembershipRow,
    MembershipSource,
    OrganizationMember,
    ProjectListing,
    ProjectMembership,
    ProjectScope,
)
from oss.src.core.memberships.interfaces import MembershipsDAOInterface
from oss.src.core.memberships.types import MembershipsServiceNotRegistered
from oss.src.utils.caching import invalidate_cache
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


# Every namespace that caches a membership-derived answer per (user, project).
# `resolve_membership` is the M2 membership cache; clearing it here means every M1
# writer already clears it on the day M2 ships.
ACCESS_CACHE_NAMESPACES = (
    "check_action_access",
    "verify_bearer_token",
    "resolve_membership",
)


async def _invalidate(
    *,
    namespace: str,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    project_count: int = 0,
) -> None:
    if not env.agenta.api.caching.enabled:
        # Nothing is cached, so nothing can be stale.
        return
    try:
        cleared = await invalidate_cache(
            namespace=namespace,
            project_id=project_id,
            user_id=user_id,
        )
    except Exception:  # pylint: disable=broad-exception-caught
        cleared = None
    if cleared is None:
        log.warning(
            "[memberships] cache invalidation failed",
            namespace=namespace,
            user_id=user_id,
            project_count=project_count,
        )


async def invalidate_access_caches(
    *,
    user_ids: Sequence[UUID],
    project_ids: Sequence[UUID],
) -> None:
    """Clear the membership-derived cache entries of these users in these projects.

    Called after the commit. Each call is awaited, so a writer returns only after Redis
    holds no entry for the changed user and project. With no user, the entries of
    every user in the projects are cleared (a new project). A failure is logged and
    does not fail the writer.
    """

    project_count = len(project_ids)

    if not user_ids:
        for project_id in project_ids:
            for namespace in ACCESS_CACHE_NAMESPACES:
                await _invalidate(
                    namespace=namespace,
                    project_id=str(project_id),
                    project_count=project_count,
                )
        return

    for user_id in user_ids:
        for project_id in project_ids:
            for namespace in ACCESS_CACHE_NAMESPACES:
                await _invalidate(
                    namespace=namespace,
                    project_id=str(project_id),
                    user_id=str(user_id),
                    project_count=project_count,
                )
        # The Bearer state cached without a project (the default-project request).
        await _invalidate(
            namespace="verify_bearer_token",
            user_id=str(user_id),
            project_count=project_count,
        )


class MembershipsService:
    def __init__(
        self,
        *,
        memberships_dao: MembershipsDAOInterface,
        policy: MembershipPolicy,
    ):
        self._dao = memberships_dao
        self._policy = policy

    @property
    def policy(self) -> MembershipPolicy:
        return self._policy

    # -- readers: one DAO call each ----------------------------------------------------

    def _apply_policy(
        self,
        *,
        user_id: UUID,
        row: Optional[MembershipRow],
    ) -> Optional[ProjectMembership]:
        if row is None:
            return None

        # Both editions: no organization row, no membership.
        if not row.has_organization_row:
            return None

        if self._policy == MembershipPolicy.ORGANIZATION_WIDE:
            role = row.organization_role
            source = MembershipSource.ORGANIZATION
        else:
            # Row presence decides, not the role value: a present row with a null
            # role is a membership with no role.
            if not row.has_project_row:
                return None
            role = row.project_role
            source = MembershipSource.PROJECT

        summary = row.summary
        return ProjectMembership(
            project_id=summary.project_id,
            user_id=user_id,
            organization_id=summary.organization_id,
            role=role,
            source=source,
            is_organization_owner=summary.organization_owner_id == user_id,
        )

    async def _read_membership(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
    ) -> Optional[ProjectMembership]:
        row = await self._dao.fetch_membership_row(
            user_id=user_id,
            project_id=project_id,
        )
        return self._apply_policy(user_id=user_id, row=row)

    async def resolve(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
    ) -> Optional[ProjectMembership]:
        # M2 adds the `resolve_membership` cache here, around `_read_membership`.
        return await self._read_membership(user_id=user_id, project_id=project_id)

    async def is_member(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
    ) -> bool:
        return await self.resolve(user_id=user_id, project_id=project_id) is not None

    async def list_for_user(
        self,
        *,
        user_id: UUID,
    ) -> List[ProjectListing]:
        listings: List[ProjectListing] = []
        for row in await self._dao.list_membership_rows(user_id=user_id):
            membership = self._apply_policy(user_id=user_id, row=row)
            if membership is not None:
                listings.append(
                    ProjectListing(membership=membership, summary=row.summary)
                )
        return listings

    async def fetch_for_user(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
    ) -> Optional[ProjectListing]:
        row = await self._dao.fetch_membership_row(
            user_id=user_id,
            project_id=project_id,
        )
        membership = self._apply_policy(user_id=user_id, row=row)
        if membership is None:
            return None
        return ProjectListing(membership=membership, summary=row.summary)

    async def fetch_organization_member(
        self,
        *,
        organization_id: UUID,
        user_id: UUID,
    ) -> Optional[OrganizationMember]:
        """The user's oldest organization row: invite accept ("already accepted") and
        the role endpoints (the current organization role)."""

        return await self._dao.fetch_organization_member(
            organization_id=organization_id,
            user_id=user_id,
        )

    # -- writers: DAO write, then invalidation, then the audit event -------------------

    async def _invalidate_organization(
        self,
        *,
        organization_id: UUID,
        user_ids: Sequence[UUID],
    ) -> None:
        """Clear the users' entries in every project of the organization. Runs after
        the commit, so a failure here is logged and never fails the writer."""

        try:
            project_ids = [
                scope.project_id
                for scope in await self._dao.list_projects(
                    organization_ids=[organization_id]
                )
            ]
        except Exception:  # pylint: disable=broad-exception-caught
            log.warning(
                "[memberships] cache invalidation failed",
                namespace="*",
                user_id=",".join(str(u) for u in user_ids),
                project_count=0,
            )
            return

        await invalidate_access_caches(user_ids=user_ids, project_ids=project_ids)

    async def set_member_role(
        self,
        *,
        organization_id: UUID,
        user_id: UUID,
        role: str,
        #
        join_project_ids: Sequence[UUID] = (),
        join_all_projects: bool = False,
        must_exist: bool = False,
        actor_user_id: Optional[UUID] = None,
    ) -> None:
        result = await self._dao.set_member_role(
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            join_project_ids=join_project_ids,
            join_all_projects=join_all_projects,
            must_exist=must_exist,
        )

        await self._invalidate_organization(
            organization_id=organization_id, user_ids=[user_id]
        )

        log.info(
            "[memberships] role set",
            organization_id=str(organization_id),
            user_id=str(user_id),
            actor_user_id=str(actor_user_id) if actor_user_id else None,
            role=role,
            previous_role=result.previous_role,
            joined_project_count=result.inserted_count,
        )

    async def remove_member(
        self,
        *,
        organization_id: UUID,
        email: str,
        #
        actor_user_id: Optional[UUID] = None,
    ) -> Optional[UUID]:
        result = await self._dao.remove_member(
            organization_id=organization_id,
            email=email,
        )

        if result.user_id is not None:
            await self._invalidate_organization(
                organization_id=organization_id, user_ids=[result.user_id]
            )

        log.info(
            "[memberships] member removed",
            organization_id=str(organization_id),
            user_id=str(result.user_id) if result.user_id else None,
            actor_user_id=str(actor_user_id) if actor_user_id else None,
            invitation_count=result.deleted_invitation_count,
        )

        return result.user_id

    async def create_project(
        self,
        *,
        organization_id: UUID,
        workspace_id: UUID,
        name: str,
        is_default: bool,
        #
        actor_user_id: Optional[UUID] = None,
    ) -> ProjectScope:
        created = await self._dao.create_project(
            organization_id=organization_id,
            workspace_id=workspace_id,
            name=name,
            is_default=is_default,
        )

        # A cached denial for the new project id cannot exist yet, but clear it
        # anyway: the id is new, the call is cheap, and the rule stays "every writer
        # clears what it changed".
        await invalidate_access_caches(
            user_ids=(),
            project_ids=[created.scope.project_id],
        )

        log.info(
            "[memberships] project created",
            organization_id=str(organization_id),
            workspace_id=str(workspace_id),
            project_id=str(created.scope.project_id),
            actor_user_id=str(actor_user_id) if actor_user_id else None,
            seeded_count=created.seeded_count,
        )

        return created.scope

    async def transfer_ownership(
        self,
        *,
        organization_id: UUID,
        new_owner_id: UUID,
        current_owner_id: UUID,
    ) -> None:
        result = await self._dao.transfer_ownership(
            organization_id=organization_id,
            new_owner_id=new_owner_id,
            current_owner_id=current_owner_id,
        )

        await self._invalidate_organization(
            organization_id=organization_id,
            user_ids=[current_owner_id, new_owner_id],
        )

        log.info(
            "[memberships] ownership transferred",
            organization_id=str(organization_id),
            previous_owner_id=str(current_owner_id),
            new_owner_id=str(new_owner_id),
            seeded_count=result.inserted_count,
        )


_memberships_service: Optional[MembershipsService] = None


def register_memberships_service(*, memberships_service: MembershipsService) -> None:
    global _memberships_service
    _memberships_service = memberships_service


def get_memberships_service() -> MembershipsService:
    if _memberships_service is None:
        raise MembershipsServiceNotRegistered(
            "MembershipsService is not registered. "
            "Call entrypoints.access.bootstrap_access() at process startup."
        )
    return _memberships_service

from typing import Optional
from uuid import UUID

from oss.src.core.access.dtos import PrincipalKind, PrincipalRef, RunOrigin
from oss.src.core.access.interfaces import PrincipalsDAOInterface
from oss.src.core.memberships.service import MembershipsService
from oss.src.core.sharing.dtos import (
    OWNERLESS_PROJECT_POLICY,
    AccessPolicy,
    SharedItemKind,
    Visibility,
)
from oss.src.core.sharing.interfaces import SharingDAOInterface


# The origins where a turn's sender owns what the turn creates.
_SENDER_OWNS_ORIGINS = (RunOrigin.WEB, RunOrigin.API)
# The origins where a human principal owns what it creates without a sender.
_HUMAN_OWNS_ORIGINS = (RunOrigin.WEB, RunOrigin.SCHEDULE)


class SharingService:
    """The sharing domain: the ownership rule, the resource rules, the read scopes and
    the sharing writes. `bootstrap_access()` builds it before `WorkflowsService` exists,
    so it never reads revisions and never calls `AccessService` (it is the resource
    policy of `AccessService`)."""

    def __init__(
        self,
        *,
        sharing_dao: SharingDAOInterface,
        memberships_service: MembershipsService,
        principals_dao: PrincipalsDAOInterface,
    ):
        self._dao = sharing_dao
        self._memberships = memberships_service
        # For the principal-cache invalidation after a make-private deactivates
        # channel agents.
        self._principals_dao = principals_dao

    def initial_policy(
        self,
        *,
        principal: PrincipalRef,
        origin: RunOrigin,
        sender_user_id: Optional[UUID],
        #
        kind: SharedItemKind,
        requested: Optional[Visibility] = None,
    ) -> AccessPolicy:
        """The policy of a new agent or session (CONTRACT section 7). Pure, never
        raises.

        In this order: (1) a turn with a sender and origin `web` or `api`: the sender
        owns; (2) a human principal on `web` or `schedule`: that human owns; (3)
        anything else (API keys, installations even with a linked sender,
        subscriptions, child and evaluation runs) and every channel session: no owner,
        project-visible. An omitted visibility is PRIVATE when there is an owner. A
        requested PRIVATE without an owner is dropped."""

        owner = _owner(
            principal=principal,
            origin=origin,
            sender_user_id=sender_user_id,
            kind=kind,
        )
        if owner is None:
            return OWNERLESS_PROJECT_POLICY
        return AccessPolicy(
            visibility=requested or Visibility.PRIVATE,
            owner_user_id=owner,
        )


def _owner(
    *,
    principal: PrincipalRef,
    origin: RunOrigin,
    sender_user_id: Optional[UUID],
    kind: SharedItemKind,
) -> Optional[UUID]:
    if kind == SharedItemKind.CHANNEL_SESSION or origin == RunOrigin.INSTALLATION:
        return None
    if sender_user_id is not None and origin in _SENDER_OWNS_ORIGINS:
        return sender_user_id
    if principal.kind == PrincipalKind.HUMAN and origin in _HUMAN_OWNS_ORIGINS:
        return principal.id
    return None

"""The sharing routes: an agent's and a session's sharing state, the owner's sharing
writes, and the project members the share picker lists.

Every route checks its resource for the request's principal first. A caller that may
not read the item gets the canonical 404 `not_found` (the same body as an unknown id);
a caller that may read it but not change it gets 403 `access_denied`. The sharing
state reads and writes go to `SharingService`, which reads the policy uncached.
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Query, Request, status

from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION
from oss.src.apis.fastapi.sharing.models import (
    AgentSharingResponse,
    AgentTransferRequest,
    AgentVisibilityRequest,
    SessionGrantRequest,
    SessionSharingResponse,
    SessionVisibilityRequest,
    SharingMembersQueryRequest,
    SharingMembersResponse,
)
from oss.src.apis.fastapi.sharing.utils import (
    ResourceCheck,
    agent_resource,
    check_resource,
    handle_sharing_exceptions,
    not_found_exception,
    resource_denied_exception,
    session_resource,
)
from oss.src.core.access.context import get_request_access
from oss.src.core.access.dtos import RequestAccess, ResourceRef
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.service import AccessService, get_access_service
from oss.src.core.access.types import RequestAccessMissing
from oss.src.core.memberships.service import MembershipsService
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.core.sharing.disclosure import build_share_disclosure
from oss.src.core.sharing.dtos import (
    SessionGrantInput,
    SessionSharingChange,
    SessionSharingState,
    ShareDisclosure,
    Visibility,
)
from oss.src.core.sharing.service import SharingService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.workflows.types import AgentReferenceUnresolved
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)

# The page size of the members query when the request names none.
MEMBERS_PAGE_LIMIT = 50


class SharingRouter:
    def __init__(
        self,
        *,
        sharing_service: SharingService,
        memberships_service: MembershipsService,
        workflows_service: WorkflowsService,
        streams_service: SessionStreamsService,
    ):
        self.sharing_service = sharing_service
        self.memberships_service = memberships_service
        self.workflows_service = workflows_service
        self.streams_service = streams_service

        self.router = APIRouter()

        routes = (
            (
                "/workflows/{workflow_id}/sharing",
                self.fetch_agent_sharing,
                "GET",
                "fetch_agent_sharing",
                AgentSharingResponse,
            ),
            (
                "/workflows/{workflow_id}/sharing/visibility",
                self.set_agent_visibility,
                "POST",
                "set_agent_visibility",
                AgentSharingResponse,
            ),
            (
                "/workflows/{workflow_id}/sharing/transfer",
                self.transfer_agent,
                "POST",
                "transfer_agent",
                AgentSharingResponse,
            ),
            (
                "/workflows/{workflow_id}/sharing/take-ownership",
                self.take_agent_ownership,
                "POST",
                "take_agent_ownership",
                AgentSharingResponse,
            ),
            (
                "/sessions/{session_id}/sharing",
                self.fetch_session_sharing,
                "GET",
                "fetch_session_sharing",
                SessionSharingResponse,
            ),
            (
                "/sessions/{session_id}/sharing/grants",
                self.upsert_session_grant,
                "POST",
                "upsert_session_grant",
                SessionSharingResponse,
            ),
            (
                "/sessions/{session_id}/sharing/grants/{user_id}",
                self.revoke_session_grant,
                "DELETE",
                "revoke_session_grant",
                SessionSharingResponse,
            ),
            (
                "/sessions/{session_id}/sharing/visibility",
                self.set_session_visibility,
                "POST",
                "set_session_visibility",
                SessionSharingResponse,
            ),
            (
                "/sessions/{session_id}/sharing/only-me",
                self.restrict_session_to_owner,
                "POST",
                "restrict_session_to_owner",
                SessionSharingResponse,
            ),
            (
                "/sharing/members/query",
                self.query_sharing_members,
                "POST",
                "query_sharing_members",
                SharingMembersResponse,
            ),
        )
        for path, endpoint, method, operation_id, response_model in routes:
            self.router.add_api_route(
                path,
                endpoint,
                methods=[method],
                operation_id=operation_id,
                status_code=status.HTTP_200_OK,
                response_model=response_model,
                response_model_exclude_none=True,
            )

    # -- agents ----------------------------------------------------------------------------

    @intercept_exceptions()
    @handle_sharing_exceptions()
    async def fetch_agent_sharing(
        self,
        request: Request,
        *,
        workflow_id: UUID,
    ) -> AgentSharingResponse:
        await self._require(
            request,
            action=Permission.VIEW_WORKFLOWS,
            resource=agent_resource(workflow_id),
        )
        await self._require_agent(request, artifact_id=workflow_id)

        access = _request_access()
        state = await self.sharing_service.fetch_agent_sharing(
            project_id=_project_id(request),
            principal=access.principal,
            artifact_id=workflow_id,
        )
        if state.can_take_ownership:
            decision = await get_access_service().check_request(
                access=access,
                action=Permission.MANAGE_AGENT_OWNERSHIP,
                project_id=_project_id(request),
            )
            if not decision.allowed:
                state = state.model_copy(update={"can_take_ownership": False})

        return AgentSharingResponse(
            sharing=state,
            disclosure=await self._agent_disclosure(request, artifact_id=workflow_id),
        )

    @intercept_exceptions()
    @handle_sharing_exceptions()
    async def set_agent_visibility(
        self,
        request: Request,
        *,
        workflow_id: UUID,
        body: AgentVisibilityRequest,
    ) -> AgentSharingResponse:
        await self._require(
            request,
            action=Permission.EDIT_WORKFLOWS,
            resource=agent_resource(workflow_id),
        )
        await self._require_agent(request, artifact_id=workflow_id)

        state = await self.sharing_service.set_agent_visibility(
            **await _write_scope(request),
            artifact_id=workflow_id,
            visibility=body.visibility,
        )
        return AgentSharingResponse(
            sharing=state,
            disclosure=await self._agent_disclosure(request, artifact_id=workflow_id),
        )

    @intercept_exceptions()
    @handle_sharing_exceptions()
    async def transfer_agent(
        self,
        request: Request,
        *,
        workflow_id: UUID,
        body: AgentTransferRequest,
    ) -> AgentSharingResponse:
        await self._require(
            request,
            action=Permission.EDIT_WORKFLOWS,
            resource=agent_resource(workflow_id),
        )
        await self._require_agent(request, artifact_id=workflow_id)

        state = await self.sharing_service.transfer_agent(
            **await _write_scope(request),
            artifact_id=workflow_id,
            new_owner_user_id=body.user_id,
        )
        return AgentSharingResponse(
            sharing=state,
            disclosure=await self._agent_disclosure(request, artifact_id=workflow_id),
        )

    @intercept_exceptions()
    @handle_sharing_exceptions()
    async def take_agent_ownership(
        self,
        request: Request,
        *,
        workflow_id: UUID,
    ) -> AgentSharingResponse:
        await self._require(
            request,
            action=Permission.MANAGE_AGENT_OWNERSHIP,
            resource=agent_resource(workflow_id),
        )
        await self._require_agent(request, artifact_id=workflow_id)

        state = await self.sharing_service.take_agent_ownership(
            **await _write_scope(request),
            artifact_id=workflow_id,
        )
        return AgentSharingResponse(
            sharing=state,
            disclosure=await self._agent_disclosure(request, artifact_id=workflow_id),
        )

    # -- sessions --------------------------------------------------------------------------

    @intercept_exceptions()
    @handle_sharing_exceptions()
    async def fetch_session_sharing(
        self,
        request: Request,
        *,
        session_id: str,
    ) -> SessionSharingResponse:
        await self._require(
            request,
            action=Permission.VIEW_SESSIONS,
            resource=session_resource(session_id),
        )

        state = await self.sharing_service.fetch_session_sharing(
            project_id=_project_id(request),
            principal=_request_access().principal,
            session_id=session_id,
        )
        return await self._session_response(request, session_id=session_id, state=state)

    @intercept_exceptions()
    @handle_sharing_exceptions()
    async def upsert_session_grant(
        self,
        request: Request,
        *,
        session_id: str,
        body: SessionGrantRequest,
    ) -> SessionSharingResponse:
        return await self._change_session(
            request,
            session_id=session_id,
            change=SessionSharingChange(
                upsert_grants=[SessionGrantInput(user_id=body.user_id, role=body.role)]
            ),
        )

    @intercept_exceptions()
    @handle_sharing_exceptions()
    async def revoke_session_grant(
        self,
        request: Request,
        *,
        session_id: str,
        user_id: UUID,
    ) -> SessionSharingResponse:
        return await self._change_session(
            request,
            session_id=session_id,
            change=SessionSharingChange(remove_user_ids=[user_id]),
        )

    @intercept_exceptions()
    @handle_sharing_exceptions()
    async def set_session_visibility(
        self,
        request: Request,
        *,
        session_id: str,
        body: SessionVisibilityRequest,
    ) -> SessionSharingResponse:
        return await self._change_session(
            request,
            session_id=session_id,
            change=SessionSharingChange(visibility=body.visibility),
        )

    @intercept_exceptions()
    @handle_sharing_exceptions()
    async def restrict_session_to_owner(
        self,
        request: Request,
        *,
        session_id: str,
    ) -> SessionSharingResponse:
        # "Only me": private, and every grant removed, in one transaction.
        return await self._change_session(
            request,
            session_id=session_id,
            change=SessionSharingChange(
                visibility=Visibility.PRIVATE, remove_all_grants=True
            ),
        )

    # -- members ---------------------------------------------------------------------------

    @intercept_exceptions()
    @handle_sharing_exceptions()
    async def query_sharing_members(
        self,
        request: Request,
        *,
        body: Optional[SharingMembersQueryRequest] = None,
        search: Optional[str] = Query(default=None),
        limit: Optional[int] = Query(default=None, ge=1),
        next: Optional[UUID] = Query(default=None),  # noqa: A002 (the cursor's name)
    ) -> SharingMembersResponse:
        decision = await get_access_service().check_request(
            access=_request_access(),
            action=Permission.VIEW_SESSIONS,
            project_id=_project_id(request),
        )
        if not decision.allowed:
            raise FORBIDDEN_EXCEPTION

        query = _merge_members_query(body=body, search=search, limit=limit, next=next)
        page = query.windowing or Windowing()
        if not page.limit:
            page = page.model_copy(update={"limit": MEMBERS_PAGE_LIMIT})
        members = await self.memberships_service.query_project_members(
            project_id=_project_id(request),
            search=query.search,
            windowing=page,
        )

        # A "Can send" grant works only for a role that may send (rule S2 AND the
        # capability step): the dialog shows it per member.
        members = [
            member.model_copy(
                update={
                    "can_run_sessions": AccessService.role_allows(
                        role=member.role, action=Permission.RUN_SESSIONS
                    )
                }
            )
            for member in members
        ]

        windowing = None
        # A full page may have a next one: its cursor is the last member's id.
        if members and len(members) >= page.limit:
            windowing = Windowing(next=members[-1].user_id, limit=page.limit)

        return SharingMembersResponse(
            count=len(members),
            members=members,
            windowing=windowing,
        )

    # -- helpers ---------------------------------------------------------------------------

    async def _require(
        self,
        request: Request,
        *,
        action: Permission,
        resource: ResourceRef,
    ) -> None:
        """Go on only when the request may do `action` on the resource: HIDDEN is the
        canonical 404, FORBIDDEN is 403 `access_denied`, NO_CAPABILITY is today's
        `FORBIDDEN_EXCEPTION`."""

        check = await check_resource(request, action=action, resource=resource)
        if check == ResourceCheck.ALLOWED:
            return
        if check == ResourceCheck.HIDDEN:
            raise not_found_exception()
        if check == ResourceCheck.FORBIDDEN:
            raise resource_denied_exception(request)
        raise FORBIDDEN_EXCEPTION

    async def _require_agent(self, request: Request, *, artifact_id: UUID) -> None:
        """The artifact exists in the request's project and is an agent: no access row
        reads as a project-visible, ownerless agent, so an unknown id, and a prompt or
        an evaluator (no sharing), answer the canonical 404 here."""

        if not await self.workflows_service.is_agent_artifact(
            project_id=_project_id(request),
            artifact_id=artifact_id,
        ):
            raise not_found_exception()

    async def _agent_disclosure(
        self, request: Request, *, artifact_id: UUID
    ) -> ShareDisclosure:
        """What sharing the agent discloses, from its head revision's parameters."""

        revision = await self.workflows_service.fetch_workflow_revision(
            project_id=_project_id(request),
            workflow_ref=Reference(id=artifact_id),
        )
        data = getattr(revision, "data", None) if revision is not None else None
        return build_share_disclosure(parameters=getattr(data, "parameters", None))

    async def _session_disclosure(
        self, request: Request, *, session_id: str
    ) -> Optional[ShareDisclosure]:
        """The disclosure of the agent the session runs. None when the session names
        no agent, its agent does not resolve, or the caller may not see that agent
        (a private agent's configuration stays with its owner)."""

        project_id = _project_id(request)
        stream = await self.streams_service.fetch(
            project_id=project_id, session_id=session_id
        )
        if stream is None:
            return None
        try:
            artifact_id = await self.workflows_service.resolve_agent_artifact_id(
                project_id=project_id, references=stream.references
            )
        except AgentReferenceUnresolved:
            return None
        if artifact_id is None:
            return None
        check = await check_resource(
            request,
            action=Permission.VIEW_WORKFLOWS,
            resource=agent_resource(artifact_id),
        )
        if check != ResourceCheck.ALLOWED:
            return None
        return await self._agent_disclosure(request, artifact_id=artifact_id)

    async def _session_response(
        self,
        request: Request,
        *,
        session_id: str,
        state: SessionSharingState,
    ) -> SessionSharingResponse:
        """The response of a session route: `can_send` is rule S2 AND the full
        `RUN_SESSIONS` decision (deviation 10), and the disclosure of a shareable
        session."""

        if state.can_send:
            run = await check_resource(
                request,
                action=Permission.RUN_SESSIONS,
                resource=session_resource(session_id),
            )
            if run != ResourceCheck.ALLOWED:
                state = state.model_copy(update={"can_send": False})

        disclosure = (
            await self._session_disclosure(request, session_id=session_id)
            if state.shareable
            else None
        )
        return SessionSharingResponse(sharing=state, disclosure=disclosure)

    async def _change_session(
        self,
        request: Request,
        *,
        session_id: str,
        change: SessionSharingChange,
    ) -> SessionSharingResponse:
        await self._require(
            request,
            action=Permission.EDIT_SESSIONS,
            resource=session_resource(session_id),
        )
        state = await self.sharing_service.set_session_sharing(
            **await _write_scope(request),
            session_id=session_id,
            change=change,
        )
        return await self._session_response(request, session_id=session_id, state=state)


def _request_access() -> RequestAccess:
    access = get_request_access()
    if access is None:
        raise RequestAccessMissing()
    return access


def _project_id(request: Request) -> UUID:
    return UUID(str(request.state.project_id))


async def _write_scope(request: Request) -> dict:
    """The organization, project and request access a sharing write takes (the audit
    event needs all three). The organization comes from the request's auth state, or
    from the project when the state has none."""

    project_id = _project_id(request)
    organization_id = getattr(request.state, "organization_id", None)
    if organization_id:
        organization_id = UUID(str(organization_id))
    else:
        organization_id = await get_access_service().project_organization_id(
            project_id=project_id
        )
    if organization_id is None:
        raise not_found_exception()
    return {
        "organization_id": organization_id,
        "project_id": project_id,
        "access": _request_access(),
    }


def _merge_members_query(
    *,
    body: Optional[SharingMembersQueryRequest],
    search: Optional[str],
    limit: Optional[int],
    next: Optional[UUID],  # noqa: A002
) -> SharingMembersQueryRequest:
    """The body's query with the query parameters on top."""

    query = body.model_copy(deep=True) if body else SharingMembersQueryRequest()
    if search is not None:
        query.search = search
    if limit is not None or next is not None:
        windowing = query.windowing or Windowing()
        if limit is not None:
            windowing.limit = limit
        if next is not None:
            windowing.next = next
        query.windowing = windowing
    return query

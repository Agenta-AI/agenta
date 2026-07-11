from __future__ import annotations

from functools import wraps
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status

from oss.src.apis.fastapi.agent_secret_leases.models import (
    AgentSecretLeaseResponse,
    ClaimResponse,
    LeaseClaimRequest,
    LeaseMutationRequest,
    LeaseQueryRequest,
    LeaseReserveRequest,
    LeaseWindowing,
    LeasesResponse,
)
from oss.src.apis.fastapi.agent_secret_leases.utils import (
    janitor_requested,
    require_janitor,
    tenant_scope_from_context,
)
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.agent_secret_leases.dtos import (
    LeaseMutation,
    LeaseQuery,
    LeaseReserve,
)
from oss.src.core.agent_secret_leases.service import AgentSecretLeasesService
from oss.src.core.agent_secret_leases.types import (
    LeaseConflict,
    LeaseInvalid,
    LeaseNotFound,
)
from oss.src.utils.exceptions import intercept_exceptions


def handle_lease_errors(function):
    @wraps(function)
    async def wrapped(*args, **kwargs):
        try:
            return await function(*args, **kwargs)
        except LeaseNotFound as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="lease not found"
            ) from exc
        except LeaseConflict as exc:
            detail = {"code": exc.code}
            if exc.current_version is not None:
                detail["currentVersion"] = exc.current_version
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=detail
            ) from exc
        except LeaseInvalid as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": exc.code},
            ) from exc

    return wrapped


class AgentSecretLeasesRouter:
    def __init__(self, *, leases_service: AgentSecretLeasesService):
        self.leases_service = leases_service
        self.router = APIRouter()
        self.router.add_api_route(
            "/",
            self.reserve,
            methods=["POST"],
            operation_id="reserve_agent_secret_lease",
            response_model=AgentSecretLeaseResponse,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/query",
            self.query,
            methods=["POST"],
            operation_id="query_agent_secret_leases",
            response_model=LeasesResponse,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{lease_id}/claim",
            self.claim,
            methods=["POST"],
            operation_id="claim_agent_secret_lease",
            response_model=ClaimResponse,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{lease_id}",
            self.retrieve,
            methods=["GET"],
            operation_id="retrieve_agent_secret_lease",
            response_model=AgentSecretLeaseResponse,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{lease_id}",
            self.mutate,
            methods=["PATCH"],
            operation_id="mutate_agent_secret_lease",
            response_model=AgentSecretLeaseResponse,
            status_code=status.HTTP_200_OK,
        )

    @staticmethod
    async def _tenant_scope_with_access():
        scope = tenant_scope_from_context()
        if not await check_action_access(
            user_uid=str(scope.user_id),
            project_id=str(scope.project_id),
            permission=Permission.RUN_SESSIONS,
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="forbidden"
            )
        return scope

    @intercept_exceptions()
    @handle_lease_errors
    async def reserve(
        self, request: Request, body: LeaseReserveRequest
    ) -> AgentSecretLeaseResponse:
        del request
        scope = await self._tenant_scope_with_access()
        lease = await self.leases_service.reserve(
            scope=scope,
            reservation=LeaseReserve.model_validate(body.model_dump()),
        )
        return AgentSecretLeaseResponse.from_core(lease)

    @intercept_exceptions()
    @handle_lease_errors
    async def retrieve(
        self, request: Request, lease_id: UUID
    ) -> AgentSecretLeaseResponse:
        if janitor_requested(request):
            require_janitor(request)
            scope = None
        else:
            scope = await self._tenant_scope_with_access()
        lease = await self.leases_service.retrieve(lease_id=lease_id, scope=scope)
        return AgentSecretLeaseResponse.from_core(lease)

    @intercept_exceptions()
    @handle_lease_errors
    async def mutate(
        self, request: Request, lease_id: UUID, body: LeaseMutationRequest
    ) -> AgentSecretLeaseResponse:
        janitor = janitor_requested(request)
        if janitor:
            require_janitor(request)
            scope = None
        else:
            scope = await self._tenant_scope_with_access()
        lease = await self.leases_service.mutate(
            lease_id=lease_id,
            scope=scope,
            mutation=LeaseMutation.model_validate(body.model_dump()),
            janitor=janitor,
        )
        return AgentSecretLeaseResponse.from_core(lease)

    @intercept_exceptions()
    @handle_lease_errors
    async def query(self, request: Request, body: LeaseQueryRequest) -> LeasesResponse:
        janitor = janitor_requested(request)
        if janitor:
            require_janitor(request)
            scope = None
        else:
            scope = await self._tenant_scope_with_access()
        query = LeaseQuery.model_validate(body.model_dump())
        page = await self.leases_service.query(
            scope=scope, query=query, janitor=janitor
        )
        windowing: Optional[LeaseWindowing] = None
        if page.next_cursor is not None:
            windowing = LeaseWindowing(
                next=page.next_cursor, limit=query.windowing.limit
            )
        return LeasesResponse(
            count=len(page.leases),
            leases=[AgentSecretLeaseResponse.from_core(lease) for lease in page.leases],
            windowing=windowing,
        )

    @intercept_exceptions()
    @handle_lease_errors
    async def claim(
        self, request: Request, lease_id: UUID, body: LeaseClaimRequest
    ) -> ClaimResponse:
        require_janitor(request)
        claim = await self.leases_service.claim(
            lease_id=lease_id,
            claim_owner=body.claim_owner,
            ttl_seconds=body.ttl_seconds,
        )
        return ClaimResponse(**claim.model_dump())

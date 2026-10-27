from functools import wraps
from uuid import UUID
from typing import Awaitable, Callable, List, Literal, Optional, TypeVar

from oss.src.utils.logging import get_module_logger

from fastapi.responses import JSONResponse
from fastapi import APIRouter, Depends, Request, Response, status, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute

from oss.src.utils.exceptions import intercept_exceptions

from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    SecretValueRequiredError,
    UpdateSecretDTO,
    SecretResponseDTO,
    PublicSecretResponseDTO,
)
from oss.src.core.secrets.enums import SecretAvailability, SecretKind
from oss.src.core.secrets.managed import ManagedSecretReadOnlyError
from oss.src.core.secrets.redaction import (
    organization_connection_response,
    organization_secret_response,
    organization_subscription_for_runtime,
    project_secret_response,
)
from oss.src.core.secrets.subscription_service import (
    SubscriptionLoginAttemptView,
    SubscriptionLoginService,
)
from oss.src.core.secrets.types import (
    OrganizationSecretKindNotShareable,
    OrganizationSecretNotFound,
    OrganizationSecretNotServed,
    OrganizationSecretValueNotScannable,
    OrganizationSecretValueTooShort,
    ProjectLimitNotAllowed,
    ProjectNotInOrganization,
    SecretSlugConflict,
    ServerOwnedFieldNotWritable,
    SubscriptionLoginAttemptNotFound,
    SubscriptionLoginRunnerNotConfigured,
    SubscriptionLoginRunnerUnavailable,
    SubscriptionProviderConflict,
    SubscriptionProviderMismatch,
    SubscriptionSecretNotFound,
    SubscriptionTokenError,
    SubscriptionTokenRejected,
)

from oss.src.apis.fastapi.vault.models import (
    SecretProjectsRequest,
    SubscriptionLoginAttemptResponse,
    SubscriptionLoginFailureRequest,
    SubscriptionLoginFailureResponse,
    SubscriptionLoginOutcomeRequest,
    SubscriptionLoginPushRequest,
    SubscriptionLoginPushResponse,
    SubscriptionTokenRequest,
)
from oss.src.apis.fastapi.shared.runner_auth import assert_runner_token

from oss.src.core.access.context import get_request_access
from oss.src.core.access.organizations import OrganizationAction, decide_organization
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.permissions.service import check_action_access

from oss.src.middlewares.auth import SECRET_RESOLVE_GRANT, request_has_grant


log = get_module_logger(__name__)

T = TypeVar("T")

PROJECT_DENIED_MESSAGE = (
    "You do not have access to perform this action. Please contact your organization "
    "admin."
)
ORGANIZATION_DENIED_MESSAGE = (
    "Only owners and admins of the organization, signed in to the app, can manage "
    "organization credentials."
)

# A row that is not the caller's to address under this owner: the other owner is tried.
_ROW_NOT_FOUND = (SubscriptionSecretNotFound, OrganizationSecretNotFound)

_ORGANIZATION_UNPROCESSABLE = (
    OrganizationSecretKindNotShareable,
    OrganizationSecretNotServed,
    OrganizationSecretValueNotScannable,
    OrganizationSecretValueTooShort,
    ProjectNotInOrganization,
    ServerOwnedFieldNotWritable,
)


def handle_organization_secret_exceptions():
    """The refusals of organization connections as their HTTP answers, with the domain
    message only."""

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except _ORGANIZATION_UNPROCESSABLE as e:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=e.message
                ) from None
            except SecretSlugConflict as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail=e.message
                ) from None
            except SubscriptionProviderConflict as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        f"This organization already has a {e.provider} subscription "
                        "connection. Remove it before you add another one."
                    ),
                ) from None
            except ProjectLimitNotAllowed as e:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN, detail=e.message
                ) from None
            except OrganizationSecretNotFound as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail=e.message
                ) from None
            except SecretValueRequiredError as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail=e.message
                ) from None

        return wrapper

    return decorator


def handle_subscription_exceptions():
    """Turn the subscription domain failures into their HTTP answers.

    The runner hop has two distinct outcomes on purpose. Not configured is this
    deployment's own gap and stays a 503. Unreachable or refusing is an upstream failure
    and is a 502, so a caller can tell "sign-in is not available here" from "the runner is
    down right now".
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except (SubscriptionSecretNotFound, SubscriptionLoginAttemptNotFound) as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=e.message,
                ) from e
            except SubscriptionProviderMismatch as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=e.message,
                ) from e
            except SubscriptionTokenError as e:
                raise HTTPException(
                    status_code=(
                        status.HTTP_422_UNPROCESSABLE_ENTITY
                        if isinstance(e, SubscriptionTokenRejected)
                        else status.HTTP_502_BAD_GATEWAY
                    ),
                    detail={
                        "code": e.code,
                        "message": e.message,
                        "retryable": e.retryable,
                        "next_step": e.next_step,
                    },
                ) from e
            except SubscriptionLoginRunnerNotConfigured as e:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=e.message,
                ) from e
            except SubscriptionLoginRunnerUnavailable as e:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=e.message,
                ) from e

        return wrapper

    return decorator


def _attempt_response(view: SubscriptionLoginAttemptView):
    # Named field by field, not spread: a field added to the view never reaches a browser
    # by accident, and adding one here is a deliberate edit to this boundary.
    return SubscriptionLoginAttemptResponse(
        attempt_id=view.attempt_id,
        state=view.state,
        user_code=view.user_code,
        verification_uri=view.verification_uri,
        expires_at=view.expires_at,
        poll_after_ms=view.poll_after_ms,
        error=view.error,
    )


class SecretSafeRoute(APIRoute):
    """A route whose validation errors never echo what the caller sent.

    FastAPI's validation error carries an ``input`` field holding the offending value, so a
    malformed create put the submitted provider key straight back into the response body,
    into the caller's terminal, and into anything logging response bodies on this route. A
    builder hit it live with a real OpenAI key.

    Scoped by construction rather than by matching the request path: every route on this
    router gets it, and a later path change cannot silently switch it off. Validation
    behavior is unchanged, only the echo: the caller still learns which field was wrong and
    why, which is everything it needs, since it already knows what it sent.
    """

    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request):
            try:
                return await original(request)
            except RequestValidationError as e:
                raise RequestValidationError(
                    [
                        {key: value for key, value in error.items() if key != "input"}
                        for error in e.errors()
                    ]
                ) from None

        return handler


class VaultRouter:
    def __init__(
        self,
        vault_service: VaultService,
        subscription_login_service: SubscriptionLoginService,
    ):
        self.service = vault_service
        self.subscription_login_service = subscription_login_service

        self.router = APIRouter(route_class=SecretSafeRoute)

        self.router.add_api_route(
            "/secrets/",
            self.create_secret,
            methods=["POST"],
            operation_id="create_secret",
            response_model_exclude_none=True,
            response_model=PublicSecretResponseDTO,
        )
        self.router.add_api_route(
            "/secrets/",
            self.list_secrets,
            methods=["GET"],
            operation_id="list_secrets",
            response_model_exclude_none=True,
            response_model=List[PublicSecretResponseDTO],
        )
        self.router.add_api_route(
            "/secrets/{secret_id_or_slug}",
            self.read_secret,
            methods=["GET"],
            operation_id="read_secret",
            response_model_exclude_none=True,
            response_model=PublicSecretResponseDTO,
        )
        self.router.add_api_route(
            "/secrets/{secret_id}",
            self.update_secret,
            methods=["PUT"],
            operation_id="update_secret",
            response_model_exclude_none=True,
            response_model=PublicSecretResponseDTO,
        )
        self.router.add_api_route(
            "/secrets/{secret_id}/projects",
            self.set_secret_projects,
            methods=["PUT"],
            operation_id="set_secret_projects",
            response_model_exclude_none=True,
            response_model=PublicSecretResponseDTO,
        )
        self.router.add_api_route(
            "/secrets/{secret_id}/subscription-token",
            self.set_subscription_token,
            methods=["PUT"],
            operation_id="set_subscription_token",
            response_model_exclude_none=True,
            response_model=PublicSecretResponseDTO,
        )
        self.router.add_api_route(
            "/secrets/{secret_id}/login-attempts",
            self.start_subscription_login,
            methods=["POST"],
            operation_id="start_subscription_login",
            response_model=SubscriptionLoginAttemptResponse,
        )
        self.router.add_api_route(
            "/secrets/{secret_id}/login-attempts/{attempt_id}",
            self.read_subscription_login,
            methods=["GET"],
            operation_id="read_subscription_login",
            response_model=SubscriptionLoginAttemptResponse,
        )
        self.router.add_api_route(
            "/secrets/{secret_id}/login-attempts/{attempt_id}/cancel",
            self.cancel_subscription_login,
            methods=["POST"],
            operation_id="cancel_subscription_login",
            response_model=SubscriptionLoginAttemptResponse,
        )
        # A literal prefix with no secret id in front, because the auth middleware exempts
        # it by path prefix: the runner reports with its shared token only.
        self.router.add_api_route(
            "/secrets/subscription-login/attempts/{attempt_id}/outcome",
            self.report_subscription_login_outcome,
            methods=["POST"],
            operation_id="report_subscription_login_outcome",
            status_code=status.HTTP_204_NO_CONTENT,
            include_in_schema=False,
            # A dependency runs before body validation, so a caller without the token gets
            # 401 and never learns the body's shape from a 422.
            dependencies=[Depends(assert_runner_token)],
        )
        self.router.add_api_route(
            "/secrets/{secret_id}/subscription-login",
            self.push_subscription_login,
            methods=["POST"],
            operation_id="push_subscription_login",
            response_model=SubscriptionLoginPushResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/secrets/{secret_id}/subscription-login/failure",
            self.report_subscription_login_failure,
            methods=["POST"],
            operation_id="report_subscription_login_failure",
            response_model=SubscriptionLoginFailureResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/secrets/{secret_id}",
            self.delete_secret,
            status_code=status.HTTP_204_NO_CONTENT,
            methods=["DELETE"],
            operation_id="delete_secret",
        )

    @staticmethod
    def _for_caller(
        request: Request, secret_dto: SecretResponseDTO
    ) -> PublicSecretResponseDTO:
        """The response shape ``request``'s principal may see.

        Only the platform runtime (a Secret token carrying the ``secret-resolve`` grant)
        receives write-only values in plaintext. Every caller still receives the same
        public response type rather than the internal service DTO.
        """
        return project_secret_response(
            secret_dto,
            reveal_write_only=request_has_grant(request, SECRET_RESOLVE_GRANT),
        )

    @staticmethod
    def _organization_scope(request: Request, scope: str) -> Optional[UUID]:
        """The organization a run's login upkeep addresses (M5): its organization row,
        checked as available to the run's project by the service; None for a project row."""
        if scope != "organization":
            return None
        raw = getattr(request.state, "organization_id", None)
        if not raw:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Secret not found"
            )
        return UUID(str(raw))

    @staticmethod
    def _require_platform_runtime(request: Request) -> None:
        """Refuse a caller that is not the run's own credential.

        Both login-upkeep routes answer a stale call with the STORED login in plaintext, so
        they read a write-only value the way `_for_caller` does. RUN_SESSIONS plus
        USE_MOUNTS is a pair an ordinary editor holds, and permissions alone would hand that
        editor the access and refresh tokens. The `secret-resolve` grant rides only the
        Secret token the platform mints for a run (`core/workflows/service.py`), which is the
        same credential the run's own vault read uses, so a real subscription run keeps
        working and nobody else reaches these routes.
        """
        if not request_has_grant(request, SECRET_RESOLVE_GRANT):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "You do not have access to perform this action. Please contact "
                    "your organization admin."
                ),
            )

    @staticmethod
    async def _managed_organization(request: Request) -> Optional[UUID]:
        """The request's organization when the caller may manage its connections: a
        browser-session owner or admin (`decide_organization`), never project RBAC."""
        raw = getattr(request.state, "organization_id", None)
        if not raw:
            return None
        organization_id = UUID(str(raw))
        decision = await decide_organization(
            access=get_request_access(),
            organization_id=organization_id,
            action=OrganizationAction.MANAGE_ORGANIZATION_SECRETS,
        )
        return organization_id if decision.allowed else None

    @staticmethod
    def _organization_denied() -> JSONResponse:
        return JSONResponse({"detail": ORGANIZATION_DENIED_MESSAGE}, status_code=403)

    @staticmethod
    async def _allowed(request: Request, permission: Permission) -> bool:
        return await check_action_access(
            user_uid=str(request.state.user_id),
            project_id=str(request.state.project_id),
            permission=permission,
        )

    async def _by_owner(
        self,
        request: Request,
        permission: Permission,
        *,
        project: Callable[[], Awaitable[Optional[T]]],
        organization: Callable[[UUID], Awaitable[Optional[T]]],
    ) -> T:
        """A row addressed by id: the project's row under project RBAC, else the
        organization's row for an owner or admin of the organization. Each callable
        returns None (or raises a not-found) when the row is not its owner's."""
        allowed = await self._allowed(request, permission)
        not_found: Optional[Exception] = None
        if allowed:
            try:
                result = await project()
            except _ROW_NOT_FOUND as e:
                result, not_found = None, e
            if result is not None:
                return result
        organization_id = await self._managed_organization(request)
        if organization_id is not None:
            try:
                result = await organization(organization_id)
            except _ROW_NOT_FOUND:
                result = None
            if result is not None:
                return result
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail=PROJECT_DENIED_MESSAGE
            )
        if not_found is not None:
            raise not_found
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Secret not found"
        )

    @intercept_exceptions()
    @handle_organization_secret_exceptions()
    async def create_secret(self, request: Request, body: CreateSecretDTO):
        if body.scope == "organization":
            organization_id = await self._managed_organization(request)
            if organization_id is None:
                return self._organization_denied()
            secret = await self.service.create_organization_secret(
                organization_id=organization_id,
                create_secret_dto=body,
                user_id=UUID(str(request.state.user_id)),
                availability=body.availability or SecretAvailability.ALL_PROJECTS,
                project_ids=body.project_ids or [],
            )
            return organization_secret_response(secret)

        has_permission = await check_action_access(
            user_uid=str(request.state.user_id),
            project_id=str(request.state.project_id),
            permission=Permission.EDIT_SECRET,
        )

        if not has_permission:
            error_msg = "You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

        try:
            vault_secret = await self.service.create_secret(
                project_id=UUID(request.state.project_id),
                create_secret_dto=body,
                user_id=UUID(request.state.user_id),
            )
        except (SubscriptionProviderConflict, SecretSlugConflict) as e:
            # A taken slug is the caller's to change. Unmapped, it answered 500, which the
            # connect sheet's create-secret drawer showed as a server failure (#6928).
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=e.message
            ) from e
        except ServerOwnedFieldNotWritable as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=e.message
            ) from e

        return self._for_caller(request, vault_secret)

    @intercept_exceptions()
    async def list_secrets(
        self,
        request: Request,
        include_organization: bool = False,
        scope: Literal["project", "organization"] = "project",
    ):
        if scope == "organization":
            # Every connection of the organization, with the projects that may use it.
            organization_id = await self._managed_organization(request)
            if organization_id is None:
                return self._organization_denied()
            secrets = await self.service.list_organization_secrets(
                organization_id=organization_id
            )
            return [organization_secret_response(secret) for secret in secrets]

        has_permission = await check_action_access(
            user_uid=str(request.state.user_id),
            project_id=str(request.state.project_id),
            permission=Permission.VIEW_SECRET,
        )

        if not has_permission:
            error_msg = "You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

        project_id = UUID(request.state.project_id)

        if include_organization and request_has_grant(request, SECRET_RESOLVE_GRANT):
            # The runtime's plaintext read never receives an organization row (M5): the
            # parameter is ignored rather than refused, so such a caller keeps working.
            log.info(
                "[secrets] include_organization ignored for a resolve grant",
                project_id=str(project_id),
            )
            include_organization = False

        organization_id = getattr(request.state, "organization_id", None)
        if not include_organization or not organization_id:
            secrets_dtos = await self.service.list_secrets(project_id=project_id)
            return [
                self._for_caller(request, secret_dto) for secret_dto in secrets_dtos
            ]

        # The project's rows, then the organization connections an agent of this project
        # may name (by scope `organization` and slug), without values.
        (
            secrets_dtos,
            organization,
        ) = await self.service.list_project_and_organization_secrets(
            organization_id=UUID(str(organization_id)),
            project_id=project_id,
        )
        return [
            self._for_caller(request, secret_dto) for secret_dto in secrets_dtos
        ] + [organization_connection_response(secret) for secret in organization]

    async def _read_organization_subscription(self, request: Request, slug: str):
        """The organization subscription login a run named, for the platform runtime only:
        the run's own credential (`secret-resolve` grant) of a project the login is
        available to. The runner uses it like a project login."""
        self._require_platform_runtime(request)
        await self._require(request, Permission.VIEW_SECRET)
        organization_id = getattr(request.state, "organization_id", None)
        secret = (
            await self.service.get_organization_connection(
                organization_id=UUID(str(organization_id)),
                project_id=UUID(request.state.project_id),
                slug=slug,
            )
            if organization_id
            else None
        )
        if secret is None or secret.kind != SecretKind.SUBSCRIPTION_PROVIDER:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Secret not found"
            )
        log.info(
            "[secrets] organization subscription released to a run",
            project_id=str(request.state.project_id),
            secret_id=str(secret.id),
        )
        return organization_subscription_for_runtime(secret)

    @intercept_exceptions()
    @handle_organization_secret_exceptions()
    async def read_secret(
        self,
        request: Request,
        secret_id_or_slug: str,
        scope: Literal["project", "organization"] = "project",
    ):
        if scope == "organization":
            return await self._read_organization_subscription(
                request, secret_id_or_slug
            )

        # A valid UUID means it's an id; anything else is a slug.
        try:
            secret_id = UUID(secret_id_or_slug)
        except ValueError:
            secret_id = None

        if secret_id is not None:

            async def project():
                secret = await self.service.get_secret_by_id(
                    project_id=UUID(request.state.project_id), secret_id=secret_id
                )
                return self._for_caller(request, secret) if secret else None

            async def organization(organization_id: UUID):
                secret = await self.service.fetch_organization_secret(
                    organization_id=organization_id, secret_id=secret_id
                )
                return organization_secret_response(secret) if secret else None

            return await self._by_owner(
                request,
                Permission.VIEW_SECRET,
                project=project,
                organization=organization,
            )

        await self._require(request, Permission.VIEW_SECRET)
        secrets_dto = await self.service.get_secret_by_slug(
            project_id=UUID(request.state.project_id),
            secret_slug=secret_id_or_slug,
        )
        if secrets_dto is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Secret not found"
            )
        return self._for_caller(request, secrets_dto)

    @intercept_exceptions()
    @handle_organization_secret_exceptions()
    async def update_secret(
        self, request: Request, secret_id: str, body: UpdateSecretDTO
    ):
        async def project():
            try:
                secrets_dto = await self.service.update_secret(
                    project_id=UUID(request.state.project_id),
                    secret_id=UUID(secret_id),
                    update_secret_dto=body,
                    user_id=UUID(request.state.user_id),
                )
            except SecretValueRequiredError as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail=e.message
                ) from e
            except ManagedSecretReadOnlyError as e:
                # 409, not 400: the payload is well-formed; the stored row's managed state
                # is what forbids the change.
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail=e.message
                ) from e
            except ServerOwnedFieldNotWritable as e:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=e.message
                ) from e
            return self._for_caller(request, secrets_dto) if secrets_dto else None

        async def organization(organization_id: UUID):
            secret = await self.service.update_organization_secret(
                organization_id=organization_id,
                secret_id=UUID(secret_id),
                update_secret_dto=body,
                user_id=UUID(str(request.state.user_id)),
            )
            return organization_secret_response(secret) if secret else None

        return await self._by_owner(
            request, Permission.EDIT_SECRET, project=project, organization=organization
        )

    @intercept_exceptions()
    @handle_organization_secret_exceptions()
    async def set_secret_projects(
        self, request: Request, secret_id: UUID, body: SecretProjectsRequest
    ):
        organization_id = await self._managed_organization(request)
        if organization_id is None:
            return self._organization_denied()
        secret = await self.service.set_organization_secret_availability(
            organization_id=organization_id,
            secret_id=secret_id,
            availability=body.availability,
            project_ids=body.project_ids,
            user_id=UUID(str(request.state.user_id)),
        )
        if secret is None:
            raise OrganizationSecretNotFound()
        return organization_secret_response(secret)

    @intercept_exceptions()
    async def delete_secret(self, request: Request, secret_id: str):
        allowed = await self._allowed(request, Permission.EDIT_SECRET)
        if allowed:
            try:
                if await self.service.delete_secret(
                    project_id=UUID(request.state.project_id),
                    secret_id=UUID(secret_id),
                ):
                    return status.HTTP_204_NO_CONTENT
            except ManagedSecretReadOnlyError as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail=e.message
                ) from e

        organization_id = await self._managed_organization(request)
        if organization_id is not None:
            await self.service.delete_organization_secret(
                organization_id=organization_id,
                secret_id=UUID(secret_id),
                user_id=UUID(str(request.state.user_id)),
            )
        elif not allowed:
            return JSONResponse({"detail": PROJECT_DENIED_MESSAGE}, status_code=403)
        # An id that is no row of the caller deletes nothing and still answers 204, so the
        # answer never tells a project caller that an organization row exists.
        return status.HTTP_204_NO_CONTENT

    async def _require(self, request: Request, *permissions: Permission) -> None:
        for permission in permissions:
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=permission,
            )
            if not has_permission:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        "You do not have access to perform this action. Please contact "
                        "your organization admin."
                    ),
                )

    @intercept_exceptions()
    @handle_organization_secret_exceptions()
    @handle_subscription_exceptions()
    async def set_subscription_token(
        self,
        request: Request,
        secret_id: UUID,
        body: SubscriptionTokenRequest,
    ):
        user_id = UUID(str(request.state.user_id))

        async def project():
            secret = await self.subscription_login_service.set_subscription_token(
                project_id=UUID(request.state.project_id),
                secret_id=secret_id,
                token=body.token,
                user_id=user_id,
            )
            return self._for_caller(request, secret)

        async def organization(organization_id: UUID):
            secret = await self.subscription_login_service.set_subscription_token(
                organization_id=organization_id,
                secret_id=secret_id,
                token=body.token,
                user_id=user_id,
            )
            return organization_secret_response(secret)

        return await self._by_owner(
            request, Permission.EDIT_SECRET, project=project, organization=organization
        )

    async def _login_attempt(self, request: Request, call, **ids):
        """A device login route on either owner's subscription row."""
        user_id = UUID(str(request.state.user_id))

        async def project():
            return _attempt_response(
                await call(
                    project_id=UUID(request.state.project_id), user_id=user_id, **ids
                )
            )

        async def organization(organization_id: UUID):
            return _attempt_response(
                await call(organization_id=organization_id, user_id=user_id, **ids)
            )

        return await self._by_owner(
            request, Permission.EDIT_SECRET, project=project, organization=organization
        )

    @intercept_exceptions()
    @handle_organization_secret_exceptions()
    @handle_subscription_exceptions()
    async def start_subscription_login(self, request: Request, secret_id: UUID):
        return await self._login_attempt(
            request,
            self.subscription_login_service.start_attempt,
            secret_id=secret_id,
        )

    @intercept_exceptions()
    @handle_organization_secret_exceptions()
    @handle_subscription_exceptions()
    async def read_subscription_login(
        self,
        request: Request,
        secret_id: UUID,
        attempt_id: str,
    ):
        return await self._login_attempt(
            request,
            self.subscription_login_service.read_attempt,
            secret_id=secret_id,
            attempt_id=attempt_id,
        )

    @intercept_exceptions()
    @handle_organization_secret_exceptions()
    @handle_subscription_exceptions()
    async def cancel_subscription_login(
        self,
        request: Request,
        secret_id: UUID,
        attempt_id: str,
    ):
        return await self._login_attempt(
            request,
            self.subscription_login_service.cancel_attempt,
            secret_id=secret_id,
            attempt_id=attempt_id,
        )

    @intercept_exceptions()
    @handle_subscription_exceptions()
    async def report_subscription_login_outcome(
        self,
        attempt_id: str,
        body: SubscriptionLoginOutcomeRequest,
    ):
        """The runner pod that ran a device login reports how it ended.

        The runner token is the whole of the authorization: the runner holds no project
        credential for a device login. The body names the row, and the service applies
        the outcome only while that row still waits on this attempt id, which the runner
        minted. A report for an attempt the user cancelled or replaced is a 404 and
        changes nothing. The runner still retries a 404 within its bounded budget: a
        report can also arrive before the start answer stored the record.
        """
        await self.subscription_login_service.report_attempt_outcome(
            project_id=body.project_id,
            organization_id=body.organization_id,
            secret_id=body.secret_id,
            attempt_id=attempt_id,
            state=body.state,
            login=body.login,
            error=body.error,
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @intercept_exceptions()
    @handle_subscription_exceptions()
    async def push_subscription_login(
        self,
        request: Request,
        secret_id: UUID,
        body: SubscriptionLoginPushRequest,
        scope: Literal["project", "organization"] = "project",
    ):
        # The caller here is the run's own credential, not an editor, so this is the pair
        # the mount sign route uses rather than EDIT_SECRET. The grant is what proves the
        # caller IS that credential; a stale answer carries the stored login.
        self._require_platform_runtime(request)
        await self._require(request, Permission.RUN_SESSIONS, Permission.USE_MOUNTS)

        result = await self.subscription_login_service.push_login(
            project_id=UUID(request.state.project_id),
            organization_id=self._organization_scope(request, scope),
            secret_id=secret_id,
            login=body.login,
            version=body.version,
            generation=body.generation,
        )
        return SubscriptionLoginPushResponse(**result.model_dump())

    @intercept_exceptions()
    @handle_subscription_exceptions()
    async def report_subscription_login_failure(
        self,
        request: Request,
        secret_id: UUID,
        body: SubscriptionLoginFailureRequest,
        scope: Literal["project", "organization"] = "project",
    ):
        self._require_platform_runtime(request)
        await self._require(request, Permission.RUN_SESSIONS, Permission.USE_MOUNTS)

        result = await self.subscription_login_service.report_login_failure(
            project_id=UUID(request.state.project_id),
            organization_id=self._organization_scope(request, scope),
            secret_id=secret_id,
            version=body.version,
            generation=body.generation,
            reason=body.reason,
        )
        return SubscriptionLoginFailureResponse(**result.model_dump())

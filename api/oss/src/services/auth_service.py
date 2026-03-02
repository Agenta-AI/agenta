from typing import Optional
from uuid import UUID
from datetime import datetime, timezone, timedelta
import asyncio
import traceback

from pydantic import ValidationError
from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from supertokens_python.recipe.session.asyncio import get_session
from jwt import encode, decode, DecodeError, ExpiredSignatureError
from supertokens_python.recipe.session.exceptions import TryRefreshTokenError
from supertokens_python.asyncio import get_user as get_supertokens_user_by_id

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger
from oss.src.utils.caching import get_cache, set_cache

from oss.src.utils.common import is_ee
from oss.src.services import db_manager
from oss.src.services import api_key_service
from oss.src.services.exceptions import (
    UnauthorizedException,
    InternalServerErrorException,
    GatewayTimeoutException,
)

from oss.src.core.auth.service import AuthService

if is_ee():
    from ee.src.services import db_manager_ee

log = get_module_logger(__name__)


_BEARER_TOKEN_PREFIX = "Bearer "
_APIKEY_TOKEN_PREFIX = "ApiKey "
_SECRET_TOKEN_PREFIX = "Secret "
_ACCESS_TOKEN_PREFIX = "Access "

_ALLOWED_TOKENS = (
    _BEARER_TOKEN_PREFIX,
    _APIKEY_TOKEN_PREFIX,
    _SECRET_TOKEN_PREFIX,
)

_PUBLIC_ENDPOINTS = (
    # AGENTA
    "/health",
    "/docs",
    "/openapi.json",
    # API
    "/api/health",
    "/api/docs",
    "/api/openapi.json",
    # SUPERTOKENS
    "/auth",
    "/api/auth",
    # STRIPE
    "/billing/stripe/events/",
    "/api/billing/stripe/events/",
    # TOOLS — OAuth callback arrives from provider with no auth token
    "/preview/tools/connections/callback",
    "/api/preview/tools/connections/callback",
)

_ADMIN_ENDPOINT_IDENTIFIER = "/admin/"
_INVITE_ACCEPT_ENDPOINT_IDENTIFIER = "/invite/accept"
_INVITATION_POLICY_ENDPOINT_IDENTIFIERS = (
    _INVITE_ACCEPT_ENDPOINT_IDENTIFIER,
    "/invite/resend",
    "/invite",
)

_SECRET_KEY = env.agenta.auth_key
_SECRET_EXP = 15 * 60  # 15 minutes

_ZERO_UUID = "00000000-0000-0000-0000-000000000000"
_NULL_UUID = "null"

_SUPERTOKENS_TIMEOUT = 15  # 15 seconds or whatever you need


async def authentication_middleware(request: Request, call_next):
    """
    Middleware function for authentication.

    This function checks for an API key in the request headers, validates it using the `use_api_key`,
    and sets the user ID in the request state if the API key is valid. If no API key is found, it checks for a session token by supertokens in request cookies
    and proceeds accordingly. If neither an API key nor a user ID is found, it raises an error.

    Args:
        request (Request): The incoming request object.
        call_next: The next middleware or route handler.

    Returns:
        The response from the next middleware or route handler.

    Raises:
        HTTPException: If the API key is invalid or not provided.
        Exception: If any other error occurs.
    """

    try:
        await _check_authentication_token(request)

        await _check_organization_policy(request)

        response = await call_next(request)

        return response

    except TryRefreshTokenError:
        log.warn("Unauthorized: Refresh Token")

        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

    except RequestValidationError as exc:
        log.error("Unprocessable Content: %s", exc)

        return JSONResponse(status_code=422, content={"detail": exc.errors()})

    except ValidationError as exc:
        log.error("Bad Request: %s", exc)

        return JSONResponse(status_code=400, content={"detail": exc.errors()})

    except HTTPException as exc:
        # Only log server errors (5xx), not client errors like 401/403
        if exc.status_code >= 500:
            log.error("%s: %s", exc.status_code, exc.detail)
        elif 400 <= exc.status_code < 500:
            if exc.status_code in [401]:
                log.debug("%s: %s", exc.status_code, exc.detail)
            else:
                log.warn("%s: %s", exc.status_code, exc.detail)

        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    except ValueError as exc:
        log.error("Bad Request: %s", exc)

        return JSONResponse(status_code=400, content={"detail": str(exc)})

    except Exception as e:  # pylint: disable=bare-except
        log.error("Internal Server Error: %s", traceback.format_exc())
        status_code = e.status_code if hasattr(e, "status_code") else 500

        return JSONResponse(
            status_code=status_code,
            content={"detail": "An internal error has occurred."},
        )


async def _check_authentication_token(request: Request):
    try:
        if request.url.path.startswith(_PUBLIC_ENDPOINTS):
            return

        if _ADMIN_ENDPOINT_IDENTIFIER in request.url.path:
            auth_header = (
                request.headers.get("Authorization")
                or request.headers.get("authorization")
                or None
            )

            if not auth_header:
                raise UnauthorizedException()

            if not auth_header.startswith(_ACCESS_TOKEN_PREFIX):
                raise UnauthorizedException()

            access_token = auth_header[len(_ACCESS_TOKEN_PREFIX) :]

            return await verify_access_token(
                request=request,
                access_token=access_token,
            )

        auth_header = (
            request.headers.get("Authorization")
            or request.headers.get("authorization")
            or None
        )
        supertokens_access_token = request.cookies.get("sAccessToken")

        query_project_id = request.query_params.get("project_id")
        if query_project_id in [_ZERO_UUID, _NULL_UUID]:
            raise UnauthorizedException()

        query_workspace_id = request.query_params.get("workspace_id")
        if query_workspace_id in [_ZERO_UUID, _NULL_UUID]:
            raise UnauthorizedException()

        if not auth_header and not supertokens_access_token:
            raise UnauthorizedException()

        if auth_header:
            if not auth_header.startswith(_ALLOWED_TOKENS):
                # LEGACY / APIKEY TOKEN
                return await verify_apikey_token(
                    request=request,
                    apikey_token=auth_header,
                )

            elif auth_header.startswith(_ALLOWED_TOKENS):
                if auth_header.startswith(_BEARER_TOKEN_PREFIX):
                    # NEW / BEARER TOKEN
                    return await verify_bearer_token(
                        request=request,
                        bearer_token=auth_header[len(_BEARER_TOKEN_PREFIX) :],
                        query_project_id=query_project_id,
                        query_workspace_id=query_workspace_id,
                    )

                elif auth_header.startswith(_APIKEY_TOKEN_PREFIX):
                    # NEW / APIKEY TOKEN
                    return await verify_apikey_token(
                        request=request,
                        apikey_token=auth_header[len(_APIKEY_TOKEN_PREFIX) :],
                    )

                elif auth_header.startswith(_SECRET_TOKEN_PREFIX):
                    # NEW / SECRET TOKEN
                    return await verify_secret_token(
                        request=request,
                        secret_token=auth_header[len(_SECRET_TOKEN_PREFIX) :],
                    )

            else:
                # NEITHER LEGACY NOR NEW TOKEN
                raise UnauthorizedException()

        elif supertokens_access_token:
            # LEGACY / BEARER TOKEN
            await verify_bearer_token(
                request=request,
                bearer_token=supertokens_access_token,
                query_project_id=query_project_id,
                query_workspace_id=query_workspace_id,
            )

        else:
            # NEITHER LEGACY NOR NEW TOKEN
            raise UnauthorizedException()

    except HTTPException as exc:
        raise exc

    except Exception as exc:  # pylint: disable=bare-except
        raise UnauthorizedException() from exc


async def verify_access_token(
    request: Request,
    access_token: str,
):
    try:
        if not _SECRET_KEY:
            raise InternalServerErrorException()

        if access_token != _SECRET_KEY:
            raise UnauthorizedException()

        request.state.admin = True

        return

    except UnauthorizedException as exc:
        raise exc

    except Exception as exc:  # pylint: disable=bare-except
        raise UnauthorizedException() from exc


async def verify_bearer_token(
    request: Request,
    bearer_token: str,  # pylint: disable=unused-argument / NOT IMPLEMENTED YET
    query_project_id: Optional[str] = None,
    query_workspace_id: Optional[str] = None,
):
    user_id = None
    user_email = None
    organization_name = None
    cache_key = {}

    try:
        session = await get_session(request)  # type: ignore

        session_user_id = session.get_user_id()  # type: ignore

        cache_key = {}

        if not session_user_id:
            raise UnauthorizedException()

        user: dict = await get_cache(
            project_id=query_project_id,
            user_id=session_user_id,
            namespace="get_supertokens_user_by_id",
            key=cache_key,
        )
        # user = None

        user_id = user.get("user_id") if user else None
        user_email = user.get("user_email") if user else None

        if user is not None:
            if user.get("deny"):
                raise UnauthorizedException()

        else:
            try:
                user_info = await asyncio.wait_for(
                    get_supertokens_user_by_id(user_id=session_user_id),
                    timeout=_SUPERTOKENS_TIMEOUT,
                )
            except Exception as e:
                log.error("Timeout: get_user_from_supertokens()")

                raise GatewayTimeoutException(
                    detail="Failed to reach auth provider. Please try again later.",
                ) from e

            if not user_info:
                await set_cache(
                    project_id=query_project_id,
                    user_id=session_user_id,
                    namespace="get_supertokens_user_by_id",
                    key=cache_key,
                    value={"deny": True},
                )

                raise UnauthorizedException()

            user_email = user_info.emails[0] if user_info.emails else None

            if not user_email:
                await set_cache(
                    project_id=query_project_id,
                    user_id=session_user_id,
                    namespace="get_supertokens_user_by_id",
                    key=cache_key,
                    value={"deny": True},
                )

                raise UnauthorizedException()

            user = await db_manager.get_user_with_email(
                email=user_email,
            )

            if not user:
                await set_cache(
                    project_id=query_project_id,
                    user_id=session_user_id,
                    namespace="get_supertokens_user_by_id",
                    key=cache_key,
                    value={"deny": True},
                )

                raise UnauthorizedException()

            user_id = str(user.id)

            await set_cache(
                project_id=query_project_id,
                user_id=session_user_id,
                namespace="get_supertokens_user_by_id",
                key=cache_key,
                value={
                    "user_id": user_id,
                    "user_email": user_email,
                },
            )

        project_id = None
        workspace_id = None
        is_invite_accept_route = _INVITE_ACCEPT_ENDPOINT_IDENTIFIER in request.url.path
        cache_scope = "invite_accept" if is_invite_accept_route else "default"

        cache_key = {
            "u_id": user_id[-12:],  # Use last 12 characters of user_id for cache key
            "p_id": query_project_id[-12:] if query_project_id else "",
            "w_id": query_workspace_id[-12:] if query_workspace_id else "",
            "scope": cache_scope,
        }

        state = await get_cache(
            project_id=query_project_id,
            user_id=user_id,
            namespace="verify_bearer_token",
            key=cache_key,
        )
        # state = None

        if state is not None:
            if state.get("deny"):
                raise UnauthorizedException()

            request.state.user_id = state.get("user_id")
            request.state.user_email = state.get("user_email")
            request.state.project_id = state.get("project_id")
            request.state.workspace_id = state.get("workspace_id")
            request.state.organization_id = state.get("organization_id")
            request.state.organization_name = state.get("organization_name")
            request.state.credentials = state.get("credentials")

            return

        if query_project_id and query_workspace_id:
            project = await db_manager.get_project_by_id(
                project_id=query_project_id,
            )

            if not project:
                await set_cache(
                    project_id=query_project_id,
                    user_id=session_user_id,
                    namespace="verify_bearer_token",
                    key=cache_key,
                    value={"deny": True},
                )

                raise UnauthorizedException()

            workspace = await db_manager.get_workspace(
                workspace_id=query_workspace_id,
            )

            if not workspace:
                await set_cache(
                    project_id=query_project_id,
                    user_id=user_id,
                    namespace="verify_bearer_token",
                    key=cache_key,
                    value={"deny": True},
                )

                raise UnauthorizedException()

            if project.workspace_id != workspace.id:
                await set_cache(
                    project_id=query_project_id,
                    user_id=user_id,
                    namespace="verify_bearer_token",
                    key=cache_key,
                    value={"deny": True},
                )

                raise UnauthorizedException()

            project_id = query_project_id
            workspace_id = query_workspace_id
            organization_id = project.organization_id

        elif query_project_id and not query_workspace_id:
            project = await db_manager.get_project_by_id(
                project_id=query_project_id,
            )

            if not project:
                await set_cache(
                    project_id=query_project_id,
                    user_id=user_id,
                    namespace="verify_bearer_token",
                    key=cache_key,
                    value={"deny": True},
                )

                raise UnauthorizedException()

            project_id = query_project_id
            workspace_id = project.workspace_id
            organization_id = project.organization_id

        elif not query_project_id and query_workspace_id:
            workspace = await db_manager.get_workspace(
                workspace_id=query_workspace_id,
            )

            if not workspace:
                await set_cache(
                    project_id=query_project_id,
                    user_id=user_id,
                    namespace="verify_bearer_token",
                    key=cache_key,
                    value={"deny": True},
                )

                raise UnauthorizedException()

            workspace_id = query_workspace_id
            project_id = await db_manager.get_default_project_id_from_workspace(
                workspace_id=workspace_id
            )
            organization_id = workspace.organization_id

        else:
            if is_ee():
                workspace_id = await db_manager_ee.get_default_workspace_id(
                    user_id=user_id,
                )
            else:
                workspace_id = await db_manager.get_default_workspace_id_oss()

            project_id = await db_manager.get_default_project_id_from_workspace(
                workspace_id=workspace_id
            )

            workspace = await db_manager.get_workspace(
                workspace_id=workspace_id,
            )

            organization_id = workspace.organization_id

        project_id = str(project_id)
        workspace_id = str(workspace_id)
        organization_id = str(organization_id)

        if not (project_id and workspace_id):
            await set_cache(
                project_id=query_project_id,
                user_id=user_id,
                namespace="verify_bearer_token",
                key=cache_key,
                value={"deny": True},
            )

            raise UnauthorizedException()

        # Verify the authenticated user is a member of the requested project
        # or workspace.  This is required whenever the caller supplied an
        # explicit project_id or workspace_id (in the latter case we check
        # workspace membership since the default project was resolved from it).
        if (
            is_ee()
            and (query_project_id or query_workspace_id)
            and not is_invite_accept_route
        ):
            if query_project_id:
                is_member = await db_manager_ee.project_member_exists(
                    project_id=project_id,
                    user_id=user_id,
                )
            else:
                is_member = await db_manager_ee.workspace_member_exists(
                    workspace_id=workspace_id,
                    user_id=user_id,
                )

            if not is_member:
                await set_cache(
                    project_id=query_project_id,
                    user_id=user_id,
                    namespace="verify_bearer_token",
                    key=cache_key,
                    value={"deny": True},
                )

                raise UnauthorizedException()

        # ----------------------------------------------------------------------
        try:
            _cache_key = {}

            organization_name = await get_cache(
                project_id=project_id,
                namespace="get_organization_name",
                key=_cache_key,
            )

            if not organization_name:
                project = await db_manager.get_project_by_id(
                    project_id=project_id,
                )

                if not project:
                    raise UnauthorizedException()

                organization_name = project.organization.name

                await set_cache(
                    project_id=project_id,
                    namespace="get_organization_name",
                    key=_cache_key,
                    value=organization_name,
                )
        except Exception as exc:  # pylint: disable=bare-except
            log.error("Failed to get organization name: %s", exc)
        # ----------------------------------------------------------------------

        secret_token = await sign_secret_token(
            user_id=user_id,
            user_email=user_email,
            project_id=project_id,
            workspace_id=workspace_id,
            organization_id=organization_id,
            organization_name=organization_name,
        )

        state = {
            "user_id": user_id,
            "user_email": user_email,
            "project_id": project_id,
            "workspace_id": workspace_id,
            "organization_id": organization_id,
            "organization_name": organization_name,
            "credentials": f"{_SECRET_TOKEN_PREFIX}{secret_token}",
        }

        if not is_invite_accept_route:
            await set_cache(
                project_id=query_project_id,
                user_id=user_id,
                namespace="verify_bearer_token",
                key=cache_key,
                value=state,
            )

        request.state.user_id = state.get("user_id")
        request.state.user_email = state.get("user_email")
        request.state.project_id = state.get("project_id")
        request.state.workspace_id = state.get("workspace_id")
        request.state.organization_id = state.get("organization_id")
        request.state.organization_name = state.get("organization_name")
        request.state.credentials = state.get("credentials")

    except GatewayTimeoutException as exc:
        raise exc

    except UnauthorizedException as exc:
        await set_cache(
            project_id=query_project_id,
            user_id=user_id,
            namespace="verify_bearer_token",
            key=cache_key,
            value={"deny": True},
        )

        raise exc

    except Exception as exc:  # pylint: disable=bare-except
        await set_cache(
            project_id=query_project_id,
            user_id=user_id,
            namespace="verify_bearer_token",
            key=cache_key,
            value={"deny": True},
        )

        raise UnauthorizedException() from exc


async def verify_apikey_token(
    request: Request,
    apikey_token: str,
):
    try:
        cache_key = {
            "apikey_token": apikey_token,
        }

        state = await get_cache(
            namespace="verify_apikey_token",
            key=cache_key,
        )

        if state is not None:
            if state.get("deny"):
                raise UnauthorizedException()

            request.state.user_id = state.get("user_id")
            request.state.user_email = state.get("user_email")
            request.state.project_id = state.get("project_id")
            request.state.workspace_id = state.get("workspace_id")
            request.state.organization_id = state.get("organization_id")
            request.state.organization_name = state.get("organization_name")
            request.state.credentials = state.get("credentials")

            return

        api_key_obj = await api_key_service.use_api_key(
            key=apikey_token,
        )

        if not api_key_obj:
            await set_cache(
                namespace="verify_apikey_token",
                key=cache_key,
                value={"deny": True},
            )

            raise UnauthorizedException()

        apikey_project_db = await db_manager.get_project_by_id(
            project_id=str(api_key_obj.project_id),
        )

        user_id = str(api_key_obj.created_by_id)
        user_email = api_key_obj.user.email
        project_id = str(api_key_obj.project_id)
        workspace_id = str(apikey_project_db.workspace_id)
        organization_id = str(apikey_project_db.organization_id)
        organization_name = None
        if is_ee():
            organization_name = apikey_project_db.organization.name

        state = {
            "user_id": user_id,
            "user_email": user_email,
            "project_id": project_id,
            "workspace_id": workspace_id,
            "organization_id": organization_id,
            "organization_name": organization_name,
            "credentials": f"{_APIKEY_TOKEN_PREFIX}{apikey_token}",
        }

        await set_cache(
            namespace="verify_apikey_token",
            key=cache_key,
            value=state,
        )

        request.state.user_id = state.get("user_id")
        request.state.user_email = state.get("user_email")
        request.state.project_id = state.get("project_id")
        request.state.workspace_id = state.get("workspace_id")
        request.state.organization_id = state.get("organization_id")
        request.state.organization_name = state.get("organization_name")
        request.state.credentials = state.get("credentials")

    except Exception as exc:
        log.error(exc)
        import traceback

        traceback.print_exc()
        raise exc


async def verify_secret_token(
    request: Request,
    secret_token: str,
):
    try:
        if not _SECRET_KEY:
            raise InternalServerErrorException()

        auth_context = decode(
            jwt=secret_token,
            key=_SECRET_KEY,
            algorithms=["HS256"],
        )

        request.state.user_id = auth_context.get("user_id")
        request.state.user_email = auth_context.get("user_email")
        request.state.project_id = auth_context.get("project_id")
        request.state.workspace_id = auth_context.get("workspace_id")
        request.state.organization_id = auth_context.get("organization_id")
        request.state.organization_name = auth_context.get("organization_name")
        request.state.credentials = f"{_SECRET_TOKEN_PREFIX}{secret_token}"

    except DecodeError as exc:
        raise UnauthorizedException() from exc

    except ExpiredSignatureError as exc:
        raise UnauthorizedException() from exc

    except Exception as exc:  # pylint: disable=bare-except
        raise InternalServerErrorException() from exc


async def sign_secret_token(
    user_id: Optional[str] = None,
    user_email: Optional[str] = None,
    project_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    organization_id: Optional[str] = None,
    organization_name: Optional[str] = None,
):
    try:
        if not _SECRET_KEY:
            raise InternalServerErrorException()

        _exp = int(
            (datetime.now(timezone.utc) + timedelta(seconds=_SECRET_EXP)).timestamp()
        )

        auth_context = {
            "user_id": user_id,
            "user_email": user_email,
            "project_id": project_id,
            "workspace_id": workspace_id,
            "organization_id": organization_id,
            "organization_name": organization_name,
            "exp": _exp,
        }

        secret_token = encode(
            payload=auth_context,
            key=_SECRET_KEY,
            algorithm="HS256",
        )

        return secret_token

    except Exception as exc:  # pylint: disable=bare-except
        raise InternalServerErrorException() from exc


async def _check_organization_policy(request: Request):
    """
    Check organization authentication policy for EE mode.

    This is called after authentication to ensure the user's authentication method
    is allowed by the organization's policy flags.

    Skips policy checks for:
    - Admin endpoints (using ACCESS_TOKEN)
    - Invitation-related routes to allow users to accept invitations
    """
    if not is_ee():
        return

    if hasattr(request.state, "admin") and request.state.admin:
        return

    # Skip policy check for invitation routes
    # Users must be able to accept invitations regardless of org auth policies
    if any(
        path in request.url.path for path in _INVITATION_POLICY_ENDPOINT_IDENTIFIERS
    ):
        return

    # Skip policy checks for org-agnostic endpoints (no explicit org context).
    # This prevents SSO logins from being blocked by the default org policy
    # before the frontend can redirect to the intended SSO org.
    if (
        request.url.path in {"/api/profile", "/api/organizations"}
        or request.url.path.startswith("/api/projects")
        or request.url.path.startswith("/api/organizations/")
    ):
        # NOTE: These endpoints are hit during initial login bootstrap before the FE
        # redirects to the intended org (e.g., SSO org). Enforcing org policy here
        # can incorrectly fail against the default org and log the user out.
        return

    organization_id = (
        request.state.organization_id
        if hasattr(request.state, "organization_id")
        else None
    )
    user_id = request.state.user_id if hasattr(request.state, "user_id") else None

    if not organization_id or not user_id:
        return

    # Get identities from session
    try:
        session = await get_session(request)  # type: ignore
        payload = session.get_access_token_payload() if session else {}  # type: ignore
        session_identities = payload.get("session_identities") or []
        user_identities = payload.get("user_identities", [])
    except Exception:
        session_identities = []
        user_identities = []
        return  # Skip policy check on session errors

    auth_service = AuthService()
    policy_error = await auth_service.check_organization_access(
        UUID(user_id), UUID(organization_id), session_identities
    )

    if policy_error:
        # Only enforce auth policy errors; skip membership errors (route handlers handle those)
        error_code = policy_error.get("error")
        if error_code in {
            "AUTH_UPGRADE_REQUIRED",
            "AUTH_SSO_DENIED",
            "AUTH_DOMAIN_DENIED",
        }:
            detail = {
                "error": policy_error.get("error"),
                "message": policy_error.get(
                    "message",
                    "Authentication method not allowed for this organization",
                ),
                "required_methods": policy_error.get("required_methods", []),
                "session_identities": session_identities,
                "user_identities": user_identities,
                "sso_providers": policy_error.get("sso_providers", []),
                "current_domain": policy_error.get("current_domain"),
                "allowed_domains": policy_error.get("allowed_domains", []),
            }
            raise HTTPException(status_code=403, detail=detail)
        # If NOT_A_MEMBER, skip - let route handlers deal with it

import traceback
from typing import Optional
from datetime import datetime, timezone, timedelta

from pydantic import ValidationError
from fastapi import Request, HTTPException, Response
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
from oss.src.utils.logging import get_module_logger
from oss.src.services import api_key_service
from oss.src.services.exceptions import (
    UnauthorizedException,
    TooManyRequestsException,
    InternalServerErrorException,
)

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
    # STRIPE
    "/billing/stripe/events/",
)

_ADMIN_ENDPOINT_PREFIX = "/admin/"

_SECRET_KEY = env.AGENTA_AUTH_KEY
_SECRET_EXP = 15 * 60  # 15 minutes

_ZERO_UUID = "00000000-0000-0000-0000-000000000000"
_NULL_UUID = "null"


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
        await _authenticate(request)

        response = await call_next(request)

        return response

    except TryRefreshTokenError:
        log.warn("Unauthorized: Refresh Token")

        return Response(status_code=401, content="Unauthorized")

    except RequestValidationError as exc:
        log.error("Unprocessable Content: %s", exc)

        return Response(status_code=422, content=exc.errors())

    except ValidationError as exc:
        log.error("Bad Request: %s", exc)

        return Response(status_code=400, content=exc.errors())

    except HTTPException as exc:
        log.error("%s: %s", exc.status_code, exc.detail)

        return Response(status_code=exc.status_code, content=exc.detail)

    except Exception as e:  # pylint: disable=bare-except
        log.error("Internal Server Error: %s", traceback.format_exc())
        status_code = e.status_code if hasattr(e, "status_code") else 500

        return Response(
            status_code=status_code,
            content={"detail": "An internal error has occurred."},
        )


async def _authenticate(request: Request):
    try:
        if request.url.path.startswith(_PUBLIC_ENDPOINTS):
            return

        if is_ee():
            if request.url.path.startswith(_ADMIN_ENDPOINT_PREFIX):
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
    access_token: str,
):
    try:
        if not _SECRET_KEY:
            raise InternalServerErrorException()

        if access_token != _SECRET_KEY:
            raise UnauthorizedException()

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
    try:
        session = await get_session(request)  # type: ignore

        session_user_id = session.get_user_id()  # type: ignore

        if not session_user_id:
            raise UnauthorizedException()

        cache_key = {}

        user_id = await get_cache(
            project_id=query_project_id,
            user_id=session_user_id,
            namespace="get_supertokens_user_by_id",
            key=cache_key,
        )

        if user_id is not None:
            if user_id.get("deny"):
                raise UnauthorizedException()

            user_id = user_id.get("user_id")

        else:
            user_info = await get_supertokens_user_by_id(user_id=session_user_id)

            if not user_info:
                await set_cache(
                    project_id=query_project_id,
                    user_id=session_user_id,
                    namespace="get_supertokens_user_by_id",
                    key=cache_key,
                    value={"deny": True},
                    ttl=15 * 60,  # seconds
                )

                raise UnauthorizedException()

            user = await db_manager.get_user_with_email(user_info.emails[0])

            if not user:
                await set_cache(
                    project_id=query_project_id,
                    user_id=session_user_id,
                    namespace="get_supertokens_user_by_id",
                    key=cache_key,
                    value={"deny": True},
                    ttl=15 * 60,  # seconds
                )

                raise UnauthorizedException()

            user_id = str(user.id)

            await set_cache(
                project_id=query_project_id,
                user_id=session_user_id,
                namespace="get_supertokens_user_by_id",
                key=cache_key,
                value={"user_id": user_id},
                ttl=5 * 60,  # seconds
            )

        project_id = None
        workspace_id = None

        cache_key = {
            "user_id": user_id,
            "query_project_id": query_project_id,
            "query_workspace_id": query_workspace_id,
        }

        state = await get_cache(
            project_id=query_project_id,
            user_id=user_id,
            namespace="verify_bearer_token",
            key=cache_key,
        )

        if state is not None:
            if state.get("deny"):
                raise UnauthorizedException()

            request.state.user_id = state.get("user_id")
            request.state.project_id = state.get("project_id")
            request.state.workspace_id = state.get("workspace_id")
            request.state.organization_id = state.get("organization_id")
            request.state.credentials = state.get("credentials")

            return

        if query_project_id and query_workspace_id:
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
                    ttl=15 * 60,  # seconds
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
                    ttl=15 * 60,  # seconds
                )

                raise UnauthorizedException()

            if project.workspace_id != workspace.id:
                await set_cache(
                    project_id=query_project_id,
                    user_id=user_id,
                    namespace="verify_bearer_token",
                    key=cache_key,
                    value={"deny": True},
                    ttl=15 * 60,  # seconds
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
                    ttl=15 * 60,  # seconds
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
                    ttl=15 * 60,  # seconds
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
                workspaces = await db_manager.get_workspaces()

                assert (
                    len(workspaces) == 1
                ), "You can only have a single workspace in OSS."
                workspace_id = str(workspaces[0].id)

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
                ttl=15 * 60,  # seconds
            )

            raise UnauthorizedException()

        secret_token = await sign_secret_token(
            user_id=user_id,
            project_id=project_id,
            workspace_id=workspace_id,
            organization_id=organization_id,
        )

        state = {
            "user_id": user_id,
            "project_id": project_id,
            "workspace_id": workspace_id,
            "organization_id": organization_id,
            "credentials": f"{_SECRET_TOKEN_PREFIX}{secret_token}",
        }

        await set_cache(
            project_id=query_project_id,
            user_id=user_id,
            namespace="verify_bearer_token",
            key=cache_key,
            value=state,
            ttl=5 * 60,  # seconds
        )

        request.state.user_id = state.get("user_id")
        request.state.project_id = state.get("project_id")
        request.state.workspace_id = state.get("workspace_id")
        request.state.organization_id = state.get("organization_id")
        request.state.credentials = state.get("credentials")

    except UnauthorizedException as exc:
        await set_cache(
            project_id=query_project_id,
            user_id=user_id,
            namespace="verify_bearer_token",
            key=cache_key,
            value={"deny": True},
            ttl=15 * 60,  # seconds
        )

        raise exc

    except Exception as exc:  # pylint: disable=bare-except
        await set_cache(
            project_id=query_project_id,
            user_id=user_id,
            namespace="verify_bearer_token",
            key=cache_key,
            value={"deny": True},
            ttl=15 * 60,  # seconds
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
            project_id=None,
            user_id=None,
            namespace="verify_apikey_token",
            key=cache_key,
        )

        if state is not None:
            if state.get("deny"):
                raise UnauthorizedException()

            request.state.user_id = state.get("user_id")
            request.state.project_id = state.get("project_id")
            request.state.workspace_id = state.get("workspace_id")
            request.state.organization_id = state.get("organization_id")
            request.state.credentials = state.get("credentials")

            return

        api_key_obj = await api_key_service.use_api_key(
            key=apikey_token,
        )

        if not api_key_obj:
            await set_cache(
                project_id=None,
                user_id=None,
                namespace="verify_apikey_token",
                key=cache_key,
                value={"deny": True},
                ttl=15 * 60,  # seconds
            )

            raise UnauthorizedException()

        apikey_project_db = await db_manager.get_project_by_id(
            project_id=str(api_key_obj.project_id),
        )

        state = {
            "user_id": str(api_key_obj.created_by_id),
            "project_id": str(api_key_obj.project_id),
            "workspace_id": str(apikey_project_db.workspace_id),
            "organization_id": str(apikey_project_db.organization_id),
            "credentials": f"{_APIKEY_TOKEN_PREFIX}{apikey_token}",
        }

        await set_cache(
            project_id=None,
            user_id=None,
            namespace="verify_apikey_token",
            key=cache_key,
            value=state,
            ttl=5 * 60,  # seconds
        )

        request.state.user_id = state.get("user_id")
        request.state.project_id = state.get("project_id")
        request.state.workspace_id = state.get("workspace_id")
        request.state.organization_id = state.get("organization_id")
        request.state.credentials = state.get("credentials")
    except Exception as exc:
        log.error(exc)
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
        request.state.project_id = auth_context.get("project_id")
        request.state.workspace_id = auth_context.get("workspace_id")
        request.state.organization_id = auth_context.get("organization_id")
        request.state.credentials = f"{_SECRET_TOKEN_PREFIX}{secret_token}"

    except DecodeError as exc:
        raise UnauthorizedException() from exc

    except ExpiredSignatureError as exc:
        raise UnauthorizedException() from exc

    except Exception as exc:  # pylint: disable=bare-except
        raise InternalServerErrorException() from exc


async def sign_secret_token(
    user_id: Optional[str] = None,
    project_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    organization_id: Optional[str] = None,
):
    try:
        if not _SECRET_KEY:
            raise InternalServerErrorException()

        _exp = int(
            (datetime.now(timezone.utc) + timedelta(seconds=_SECRET_EXP)).timestamp()
        )

        auth_context = {
            "user_id": user_id,
            "project_id": project_id,
            "workspace_id": workspace_id,
            "organization_id": organization_id,
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

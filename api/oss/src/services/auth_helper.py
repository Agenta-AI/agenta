import os
import logging
import traceback
from typing import Optional
from datetime import datetime, timezone, timedelta

from pydantic import ValidationError
from fastapi import Request, HTTPException, Response
from fastapi.exceptions import RequestValidationError
from supertokens_python.recipe.session.asyncio import get_session
from jwt import encode, decode, DecodeError, ExpiredSignatureError
from supertokens_python.asyncio import get_user as get_supertokens_user_by_id

from oss.src.services import db_manager
from oss.src.services import api_key_service
from oss.src.services.exceptions import (
    UnauthorizedException,
    TooManyRequestsException,
    InternalServerErrorException,
    code_to_phrase,
)
from oss.src.utils.project_utils import retrieve_project_id_from_request
from oss.src.services.db_manager import fetch_default_project, NoResultFound


logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


_BEARER_TOKEN_PREFIX = "Bearer "
_APIKEY_TOKEN_PREFIX = "ApiKey "
_SECRET_TOKEN_PREFIX = "Secret "

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
)

_PRIVATE_UNAUTHENTICATED_ENDPOINTS = (
    "/invite/accept"
    # API
)

_SECRET_KEY = "AGENTA_AUTH_KEY"
_SECRET_EXP = 15 * 60  # 15 minutes


async def authentication_middleware(request: Request, call_next):
    try:
        await _authenticate(request=request)

        response = await call_next(request)
        return response

    except Exception as e:
        logger.error("Internal Server Error: %s", traceback.format_exc())
        status_code = e.status_code if hasattr(e, "status_code") else 500
        return Response(status_code=status_code, content={"detail": "An internal error has occurred."})

    except RequestValidationError as exc:
        logger.error("Unprocessable Content: %s", exc)

        return Response(status_code=422, content=exc.errors())

    except ValidationError as exc:
        logger.error("Bad Request: %s", exc)

        return Response(status_code=400, content=exc.errors())

    except HTTPException as exc:
        logger.error("%s: %s", exc.status_code, exc.detail)

        return Response(status_code=exc.status_code, content=exc.detail)


async def _authenticate(request: Request):
    project_id = await retrieve_project_id_from_request(request=request)
    if project_id and not hasattr(request.state, "project_id"):
        setattr(request.state, "project_id", project_id)

    elif not project_id:
        logger.info("Retrieving default project from database...")
        project = await fetch_default_project()  # Fetch the default project
        if project is None:
            raise NoResultFound("Default project not found.")

        project_id = str(project.id)
        setattr(request.state, "project_id", project_id)
        logger.info(f"Default project fetched: {project_id} and set in request.state")

    if _PRIVATE_UNAUTHENTICATED_ENDPOINTS in request.url.path:
        return True

    elif not request.url.path.startswith(_PUBLIC_ENDPOINTS):
        auth_header = (
            request.headers.get("Authorization")
            or request.headers.get("authorization")
            or None
        )
        supertokens_access_token = request.cookies.get("sAccessToken")

        if not auth_header and not supertokens_access_token:
            raise HTTPException(status_code=401, detail="Unauthorized")

        if auth_header and auth_header.startswith(_ALLOWED_TOKENS):
            if auth_header.startswith(_BEARER_TOKEN_PREFIX):
                # NEW / BEARER TOKEN
                await verify_bearer_token(request=request, project_id=project_id)

            elif auth_header.startswith(_APIKEY_TOKEN_PREFIX):
                # NEW / APIKEY TOKEN
                await verify_apikey_token(
                    request=request,
                    apikey_token=auth_header[len(_APIKEY_TOKEN_PREFIX) :],
                )

        elif auth_header and not auth_header.startswith(_ALLOWED_TOKENS):
            if auth_header and auth_header.startswith(_SECRET_TOKEN_PREFIX):
                # NEW / SECRET TOKEN
                await verify_secret_token(
                    request=request,
                    secret_token=auth_header[len(_SECRET_TOKEN_PREFIX) :],
                )

            elif auth_header and not auth_header.startswith(_APIKEY_TOKEN_PREFIX):
                # LEGACY / APIKEY TOKEN
                await verify_apikey_token(
                    request=request,
                    apikey_token=auth_header[len(_APIKEY_TOKEN_PREFIX) : 1],
                )

        elif supertokens_access_token:
            # NEW / BEARER TOKEN
            await verify_bearer_token(request=request, project_id=project_id)


async def verify_bearer_token(request: Request, project_id: str):
    try:
        session = await get_session(request)
        if not session:
            raise HTTPException(status_code=401, detail="Unauthorized")

        user_session_id = session.get_user_id()
        if not user_session_id:
            raise HTTPException(status_code=401, detail="Unauthorized")

        user_info = await get_supertokens_user_by_id(user_id=user_session_id)
        if not user_info:
            raise HTTPException(status_code=401, detail="Unauthorized")

        user = await db_manager.get_user_with_email(email=user_info.emails[0])
        if not user:
            raise HTTPException(status_code=401, detail="Unauthorized")

        if not hasattr(request.state, "user_id"):
            setattr(request.state, "user_id", str(user.id))

        secret_token = await sign_secret_token(
            user_id=str(user.id), project_id=project_id
        )

        request.state.user_id = str(user.id)
        request.state.project_id = project_id
        request.state.credentials = f"{_SECRET_TOKEN_PREFIX}{secret_token}"

    except HTTPException as exc:
        raise exc


async def sign_secret_token(
    user_id: Optional[str] = None,
    project_id: Optional[str] = None,
):
    try:
        secret_key = os.getenv(_SECRET_KEY)
        if not secret_key:
            raise HTTPException(status_code=401, detail="Unauthorized")

        _exp = int(
            (datetime.now(timezone.utc) + timedelta(seconds=_SECRET_EXP)).timestamp()
        )

        auth_context = {
            "user_id": user_id,
            "project_id": project_id,
            "exp": _exp,
        }

        secret_token = encode(
            payload=auth_context,
            key=secret_key,
            algorithm="HS256",
        )

        return secret_token

    except Exception as exc:  # pylint: disable=bare-except
        logger.error("Internal Server Error: %s", traceback.format_exc())

        raise HTTPException(status_code=401, detail=str(exc))


async def verify_secret_token(
    request: Request,
    secret_token: str,
):
    try:
        secret_key = os.getenv(_SECRET_KEY)
        if not secret_key:
            raise HTTPException(status_code=401, detail="Unauthorized")

        auth_context = decode(
            jwt=secret_token,
            key=secret_key,
            algorithms=["HS256"],
        )

        request.state.user_id = auth_context.get("user_id")
        request.state.project_id = auth_context.get("project_id")
        request.state.credentials = f"{_SECRET_TOKEN_PREFIX}{secret_token}"

    except DecodeError as exc:
        raise HTTPException(status_code=401, detail=str(exc))

    except ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail=str(exc))

    except Exception as exc:  # pylint: disable=bare-except
        logger.error("Internal Server Error: %s", traceback.format_exc())

        raise HTTPException(status_code=401, detail="Unauthorized")


async def verify_apikey_token(
    request: Request,
    apikey_token: str,
):
    api_key_obj = await api_key_service.use_api_key(
        key=apikey_token,
    )

    if not api_key_obj:
        raise UnauthorizedException()

    # Check rate limiting
    cache_key = f"apikey_rate_limit:{apikey_token}"

    rate_limit_exceeded = await api_key_service.check_rate_limit(
        api_key_obj=api_key_obj,
        cache_key=cache_key,
    )

    if rate_limit_exceeded:
        raise TooManyRequestsException()

    # Update the last usage timestamp
    await db_manager.update_api_key_timestamp(
        api_key_id=str(api_key_obj.id),
    )

    request.state.user_id = str(api_key_obj.created_by_id)
    request.state.project_id = str(api_key_obj.project_id)
    request.state.credentials = f"{_APIKEY_TOKEN_PREFIX}{apikey_token}"

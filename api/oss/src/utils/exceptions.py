from typing import Any, Optional, List
from uuid import uuid4
from functools import wraps
from traceback import format_exc
from contextlib import AbstractContextManager

from fastapi import Request, HTTPException

from oss.src.utils.logging import get_module_logger
from oss.src.core.shared.exceptions import EntityCreationConflict


log = get_module_logger(__name__)


def build_entity_creation_conflict_message(
    *,
    conflict: Optional[dict],
    default_message: str,
) -> str:
    """Build a user-friendly conflict message from unique-key conflict data."""
    if not conflict:
        return default_message

    slug = conflict.get("slug")
    if slug:
        return f"A resource with slug '{slug}' already exists in this project."

    name = conflict.get("name")
    if name:
        return f"A resource named '{name}' already exists in this project."

    return default_message


class suppress(AbstractContextManager):  # pylint: disable=invalid-name
    def __init__(
        self,
        message: Optional[str] = "",
        verbose: Optional[bool] = True,
        exclude: Optional[List[type]] = None,
    ):
        self.verbose = verbose
        self.message = message
        self.exclude = exclude or []

    def __enter__(self):
        pass

    def __exit__(self, exc_type, exc_value, exc_tb):
        if exc_type is not None:
            support_id = str(uuid4())

            if self.verbose is True:
                if any(isinstance(exc_value, excl) for excl in self.exclude):
                    raise exc_value

                log.warn(
                    f"[SUPPRESSED] {self.message}\n{format_exc()}",
                    support_id=support_id,
                )

        return True


def suppress_exceptions(
    default: Optional[Any] = None,
    message: Optional[str] = "",
    verbose: Optional[bool] = True,
    exclude: Optional[List[type]] = None,
):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)

            except Exception as exc:  # pylint: disable=broad-exception-caught
                if any(isinstance(exc, excl) for excl in exclude or []):
                    raise

                support_id = str(uuid4())
                operation_id = func.__name__ if hasattr(func, "__name__") else None

                if verbose is True:
                    log.warn(
                        f"[SUPPRESSED] {message}\n{format_exc()}",
                        support_id=support_id,
                        operation_id=operation_id,
                    )

                return default

        return wrapper

    return decorator


def intercept_exceptions(
    verbose: Optional[bool] = True,
):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)

            except HTTPException as e:
                raise e

            except Exception as e:
                if isinstance(e, EntityCreationConflict):
                    e: EntityCreationConflict

                    raise ConflictException(
                        message=build_entity_creation_conflict_message(
                            conflict=e.conflict,
                            default_message=e.message,
                        ),
                        conflict=e.conflict,
                    ) from e

                support_id = str(uuid4())
                operation_id = func.__name__ if hasattr(func, "__name__") else None

                user_id = None
                organization_id = None
                workspace_id = None
                project_id = None
                request_path = None
                # request_query = None
                # request_headers = None
                # request_body = None

                with suppress(verbose=False):
                    request = kwargs.pop("request", None)
                    request = request if isinstance(request, Request) else None
                    state = request.state if request else None
                    user_id = state.user_id if state else None
                    organization_id = state.organization_id if state else None
                    workspace_id = state.workspace_id if state else None
                    project_id = state.project_id if state else None
                    request_path = request.url.path if request else None
                    # request_query = request.url.query if request else None
                    # request_headers = request.headers if request else None
                    # request_body = kwargs if "secrets" not in request_path else None

                message = (
                    "An unexpected error occurred. "
                    + "Please try again later or contact support."
                )

                status_code = 500
                detail = {
                    "message": message,
                    "support_id": support_id,
                    "operation_id": operation_id,
                }

                if verbose is True:
                    log.error(
                        f"[INTERCEPTED]\n{format_exc()}",
                        support_id=support_id,
                        operation_id=operation_id,
                        user_id=user_id,
                        organization_id=organization_id,
                        workspace_id=workspace_id,
                        project_id=project_id,
                        request_path=request_path,
                        # request_query=request_query,
                        # request_headers=request_headers,
                        # request_body=request_body,
                    )

                raise HTTPException(status_code=status_code, detail=detail) from e

        return wrapper

    return decorator


class BaseHTTPException(HTTPException):
    default_code: int = 500
    default_message: str = "Internal Server Error"

    def __init__(
        self,
        code: int = None,
        message: Any = None,
        **kwargs: Any,
    ):
        self.code = code or self.default_code
        self.message = message or self.default_message
        self.kwargs = kwargs

        self.detail = {"message": self.message, **self.kwargs}

        super().__init__(status_code=self.code, detail=self.detail)


class BadRequestException(BaseHTTPException):
    default_code = 400
    default_message = "Bad Request"


class UnauthorizedException(BaseHTTPException):
    default_code = 401
    default_message = "Unauthorized"


class ForbiddenException(BaseHTTPException):
    default_code = 403
    default_message = "Forbidden"


class NotFoundException(BaseHTTPException):
    default_code = 404
    default_message = "Not Found"


class ConflictException(BaseHTTPException):
    default_code = 409
    default_message = "Conflict"


class UnprocessableContentException(BaseHTTPException):
    default_code = 422
    default_message = "Unprocessable Content"


class TooManyRequestsException(BaseHTTPException):
    default_code = 429
    default_message = "Too Many Requests"


class InternalServerErrorException(BaseHTTPException):
    default_code = 500
    default_message = "Internal Server Error"


class ServiceUnavailableException(BaseHTTPException):
    default_code = 503
    default_message = "Service Unavailable"


class GatewayTimeoutException(BaseHTTPException):
    default_code = 504
    default_message = "Gateway Timeout"

from typing import Any, Optional
from uuid import uuid4
from functools import wraps
from traceback import format_exc
from contextlib import AbstractContextManager

from fastapi import Request, HTTPException

from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


class suppress(AbstractContextManager):  # pylint: disable=invalid-name
    def __init__(
        self,
        message: Optional[str] = "",
        verbose: Optional[bool] = True,
    ):
        self.verbose = verbose
        self.message = message

    def __enter__(self):
        pass

    def __exit__(self, exc_type, exc_value, exc_tb):
        if exc_type is not None:
            support_id = str(uuid4())

            if self.verbose is True:
                log.warn(
                    f"[SUPPRESSED] {self.message}\n{format_exc()}",
                    support_id=support_id,
                )

        return True


def suppress_exceptions(
    message: Optional[str] = "",
    default: Optional[Any] = None,
    verbose: Optional[bool] = True,
):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)

            except Exception:  # pylint: disable=broad-exception-caught
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
                support_id = str(uuid4())
                operation_id = func.__name__ if hasattr(func, "__name__") else None

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

                log.debug(kwargs)

                message = (
                    "An unexpected error occurred. "
                    + "Please try again later or contact support."
                )

                _detail = {
                    "message": message,
                    "support_id": support_id,
                    "operation_id": operation_id,
                }

                status_code = e.status_code if hasattr(e, "status_code") else 500
                detail = e.detail if hasattr(e, "detail") else _detail

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

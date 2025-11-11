from uuid import uuid4
from contextlib import AbstractContextManager
from traceback import format_exc
from functools import wraps
from fastapi import HTTPException

from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class suppress(AbstractContextManager):
    def __init__(self, verbose: bool = False):
        self.verbose = verbose

    def __enter__(self):
        pass

    def __exit__(self, exc_type, exc_value, exc_tb):
        if exc_type is None:
            return True
        else:
            if self.verbose:
                log.warn("--- SUPPRESSING EXCEPTION ---")
                log.warn(format_exc())
                log.warn("-----------------------------")
            return True


def handle_exceptions():
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except HTTPException as e:
                raise e
            except Exception:
                support_id = str(uuid4())

                log.error("--- HANDLING EXCEPTION ---")
                log.error(f"support_id={support_id} & operation_id={func.__name__}")
                log.error(f"{format_exc()}")
                log.error("--------------------------")

                raise HTTPException(
                    status_code=500,
                    detail=f"An unexpected error occurred with operation_id={func.__name__}. Please contact support with support_id={support_id}.",
                )

        return wrapper

    return decorator

from contextlib import AbstractContextManager
from traceback import format_exc
from logging import getLogger, INFO
from functools import wraps
from fastapi import HTTPException
from uuid import uuid4

logger = getLogger(__name__)
logger.setLevel(INFO)


class suppress(AbstractContextManager):
    def __init__(self):
        pass

    def __enter__(self):
        pass

    def __exit__(self, exc_type, exc_value, exc_tb):
        if exc_type is None:
            return True
        else:
            logger.error("--- SUPPRESSING EXCEPTION ---")
            logger.error(format_exc())
            logger.error("-----------------------------")
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

                logger.error("--- HANDLING EXCEPTION ---")
                logger.error(f"support_id={support_id} & operation_id={func.__name__}")
                logger.error(f"{format_exc()}")
                logger.error("--------------------------")

                raise HTTPException(
                    status_code=500,
                    detail=f"An unexpected error occurred with operation_id={func.__name__}. Please contact support with support_id={support_id}.",
                )

        return wrapper

    return decorator

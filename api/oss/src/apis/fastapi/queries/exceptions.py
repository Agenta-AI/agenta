from functools import wraps

from fastapi import HTTPException

from oss.src.core.tracing.dtos import FilteringException


def handle_filtering_exceptions():
    """Answer 400 when a saved query holds a filter that cannot be applied."""

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except FilteringException as e:
                raise HTTPException(status_code=400, detail=str(e)) from e

        return wrapper

    return decorator

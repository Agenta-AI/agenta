"""Typed HTTP exceptions and a translation decorator for embed-resolution errors.

Mirrors ``api/oss/src/apis/fastapi/git/exceptions.py`` for ``oss.src.core.embeds.exceptions``.
An embed error is a bad configuration, not a server fault. Place the decorator inside
``@intercept_exceptions()`` so the typed HTTP exception is the one re-raised.
"""

from functools import wraps

from fastapi import HTTPException

from oss.src.core.embeds.exceptions import EmbedError, EmbedNotFoundError


class EmbedNotFoundException(HTTPException):
    def __init__(self, message: str = "Referenced entity not found."):
        super().__init__(status_code=404, detail=message)


class EmbedResolutionException(HTTPException):
    def __init__(self, message: str = "Embedded references could not be resolved."):
        super().__init__(status_code=400, detail=message)


def handle_embed_exceptions():
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except EmbedNotFoundError as e:
                raise EmbedNotFoundException(message=str(e)) from e
            except EmbedError as e:
                raise EmbedResolutionException(message=str(e)) from e

        return wrapper

    return decorator

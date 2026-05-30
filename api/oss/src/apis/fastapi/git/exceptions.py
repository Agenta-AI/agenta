"""Typed HTTP exceptions and a translation decorator for git-domain errors.

The git pattern (artifact/variant/revision) is shared across six routers
(workflows, applications, evaluators, testsets, queries, environments).
Each router previously translated the same set of core exceptions to HTTP
400 inline, multiplying boilerplate. This module centralizes that mapping
so new domain exceptions need updates in one place.

Any new exception added to `oss.src.core.git.types` must be registered
below: add a typed `*Exception` and a `except` arm in
`handle_git_exceptions`. The decorator is paired with the existing
`@intercept_exceptions()` and `@suppress_exceptions(exclude=[HTTPException])`
on each route; place it on the inside of those decorators so the typed
HTTP exception is the one re-raised.
"""

from functools import wraps

from fastapi import HTTPException

from oss.src.core.git.types import (
    InitialRevisionConflict,
    RetrieveRefsInconsistent,
    RetrieveRefsInsufficient,
    VariantForkError,
)


class InitialRevisionConflictException(HTTPException):
    def __init__(
        self,
        message: str = "An initial revision already exists for this variant.",
    ):
        super().__init__(status_code=409, detail=message)


class VariantForkErrorException(HTTPException):
    def __init__(self, message: str = "Variant fork request cannot be fulfilled."):
        super().__init__(status_code=400, detail=message)


class RetrieveRefsInsufficientException(HTTPException):
    def __init__(
        self,
        message: str = "References are insufficient to identify a single revision.",
    ):
        super().__init__(status_code=400, detail=message)


class RetrieveRefsInconsistentException(HTTPException):
    def __init__(
        self,
        message: str = "References disagree with the resolved revision.",
    ):
        super().__init__(status_code=400, detail=message)


def handle_git_exceptions():
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except InitialRevisionConflict as e:
                raise InitialRevisionConflictException(message=e.message) from e
            except VariantForkError as e:
                raise VariantForkErrorException(message=e.message) from e
            except RetrieveRefsInsufficient as e:
                raise RetrieveRefsInsufficientException(message=e.message) from e
            except RetrieveRefsInconsistent as e:
                raise RetrieveRefsInconsistentException(message=e.message) from e

        return wrapper

    return decorator

"""Typed HTTP exceptions and a translation decorator for workflow-domain errors.

Mirrors ``api/oss/src/apis/fastapi/git/exceptions.py`` but for workflow-specific domain errors
(``oss.src.core.workflows.types``) that the shared git pattern does not cover. Place the decorator
inside ``@intercept_exceptions()`` so the typed HTTP exception is the one re-raised.
"""

from functools import wraps

from fastapi import HTTPException

from oss.src.core.embeds.exceptions import NonEmbeddableWorkflowReferenceError
from oss.src.core.workflows.types import StaticWorkflowSlug


class StaticWorkflowSlugException(HTTPException):
    def __init__(
        self,
        message: str = "The slug prefix '__ag__' is reserved for static workflows.",
    ):
        super().__init__(status_code=400, detail=message)


class NonEmbeddableWorkflowReferenceException(HTTPException):
    def __init__(
        self,
        message: str = "This static workflow cannot be embedded.",
    ):
        super().__init__(status_code=400, detail=message)


def handle_workflow_exceptions():
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except StaticWorkflowSlug as e:
                raise StaticWorkflowSlugException(message=e.message) from e
            except NonEmbeddableWorkflowReferenceError as e:
                raise NonEmbeddableWorkflowReferenceException(message=str(e)) from e

        return wrapper

    return decorator

"""Typed HTTP exceptions and a translation decorator for workflow-domain errors.

Mirrors ``api/oss/src/apis/fastapi/git/exceptions.py`` but for workflow-specific domain errors
(``oss.src.core.workflows.types``) that the shared git pattern does not cover. Place the decorator
inside ``@intercept_exceptions()`` so the typed HTTP exception is the one re-raised.
"""

from functools import wraps

from fastapi import HTTPException

from oss.src.core.embeds.exceptions import (
    CircularEmbedError,
    EmbedNotFoundError,
    MaxDepthExceededError,
    MaxEmbedsExceededError,
    MixedEntityTypesError,
    NonEmbeddableWorkflowReferenceError,
    PathExtractionError,
    UnsupportedReferenceTypeError,
)
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


class CircularEmbedException(HTTPException):
    def __init__(self, message: str = "Circular embed detected."):
        super().__init__(status_code=400, detail=message)


class MaxDepthExceededException(HTTPException):
    def __init__(self, message: str = "Max embed depth exceeded."):
        super().__init__(status_code=400, detail=message)


class MaxEmbedsExceededException(HTTPException):
    def __init__(self, message: str = "Max embed count exceeded."):
        super().__init__(status_code=400, detail=message)


class EmbedNotFoundException(HTTPException):
    def __init__(self, message: str = "Referenced entity not found."):
        super().__init__(status_code=400, detail=message)


class UnsupportedReferenceTypeException(HTTPException):
    def __init__(self, message: str = "Unsupported reference type."):
        super().__init__(status_code=400, detail=message)


class MixedEntityTypesException(HTTPException):
    def __init__(self, message: str = "References span multiple entity families."):
        super().__init__(status_code=400, detail=message)


class PathExtractionException(HTTPException):
    def __init__(self, message: str = "Path not found in configuration."):
        super().__init__(status_code=400, detail=message)


def handle_workflow_exceptions():
    """Return a decorator that translates workflow-domain errors into typed HTTP 400 exceptions."""

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            """Await the wrapped route handler, converting known domain errors to HTTP exceptions."""
            try:
                return await func(*args, **kwargs)
            except StaticWorkflowSlug as e:
                raise StaticWorkflowSlugException(message=e.message) from e
            except NonEmbeddableWorkflowReferenceError as e:
                raise NonEmbeddableWorkflowReferenceException(message=str(e)) from e
            except CircularEmbedError as e:
                raise CircularEmbedException(message=str(e)) from e
            except MaxDepthExceededError as e:
                raise MaxDepthExceededException(message=str(e)) from e
            except MaxEmbedsExceededError as e:
                raise MaxEmbedsExceededException(message=str(e)) from e
            except EmbedNotFoundError as e:
                raise EmbedNotFoundException(message=str(e)) from e
            except UnsupportedReferenceTypeError as e:
                raise UnsupportedReferenceTypeException(message=str(e)) from e
            except MixedEntityTypesError as e:
                raise MixedEntityTypesException(message=str(e)) from e
            except PathExtractionError as e:
                raise PathExtractionException(message=str(e)) from e

        return wrapper

    return decorator

"""Typed HTTP exceptions and a translation decorator for workflow-domain errors.

Mirrors ``api/oss/src/apis/fastapi/git/exceptions.py`` but for workflow-specific domain errors
(``oss.src.core.workflows.types``) that the shared git pattern does not cover. Place the decorator
inside ``@intercept_exceptions()`` so the typed HTTP exception is the one re-raised.
"""

from functools import wraps
from typing import Any, Dict, List

from fastapi import HTTPException

from oss.src.core.workflows.types import AgentTemplateInvalid, StaticWorkflowSlug


class StaticWorkflowSlugException(HTTPException):
    def __init__(
        self,
        message: str = "The slug prefix '__ag__' is reserved for static workflows.",
    ):
        super().__init__(status_code=400, detail=message)


class AgentTemplateInvalidException(HTTPException):
    """A 400 whose detail names every offending ``parameters.agent`` field path.

    The commit caller is often a model that must self-remediate, so the body carries both a
    summary ``message`` and the structured ``errors`` list (``loc`` / ``msg`` / ``type``).
    """

    def __init__(
        self,
        errors: List[Dict[str, Any]],
        message: str = "The agent template configuration failed validation.",
    ):
        super().__init__(
            status_code=400,
            detail={"message": message, "errors": errors},
        )


def handle_workflow_exceptions():
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except StaticWorkflowSlug as e:
                raise StaticWorkflowSlugException(message=e.message) from e
            except AgentTemplateInvalid as e:
                raise AgentTemplateInvalidException(
                    errors=e.errors,
                    message=e.message,
                ) from e

        return wrapper

    return decorator

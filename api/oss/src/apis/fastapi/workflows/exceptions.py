"""Typed HTTP exceptions and a translation decorator for workflow-domain errors.

Mirrors ``api/oss/src/apis/fastapi/git/exceptions.py`` but for workflow-specific domain errors
(``oss.src.core.workflows.types``) that the shared git pattern does not cover. Place the decorator
inside ``@intercept_exceptions()`` so the typed HTTP exception is the one re-raised.
"""

from functools import wraps

from fastapi import HTTPException

from oss.src.apis.fastapi.sharing.utils import agent_creation_failed_exception
from oss.src.core.embeds.exceptions import (
    EmbedError,
    NonEmbeddableWorkflowReferenceError,
)
from oss.src.core.sharing.types import AgentCreationFailed
from oss.src.core.workflows.types import (
    InvalidAgentConfigurationError,
    InvalidAgentConnectionError,
    InvalidAgentHarnessError,
    InvalidAgentInstructionsError,
    StaticWorkflowSlug,
)


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


class EmbedException(HTTPException):
    # Every embed resolution error (cycle, depth or count limit, missing or unsupported
    # reference, mixed families, bad path) comes from the request's configuration.
    def __init__(self, message: str = "The embedded references could not be resolved."):
        super().__init__(status_code=400, detail=message)


class InvalidAgentConfigurationException(HTTPException):
    # 422: the request is well-formed, the agent configuration in it cannot run.
    def __init__(
        self,
        error: InvalidAgentConfigurationError
        | InvalidAgentHarnessError
        | InvalidAgentInstructionsError,
    ):
        super().__init__(status_code=422, detail=error.to_detail())


class InvalidAgentConnectionException(HTTPException):
    def __init__(self, error: InvalidAgentConnectionError):
        super().__init__(status_code=422, detail=error.to_detail())


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
            except EmbedError as e:
                raise EmbedException(message=str(e)) from e
            except (
                InvalidAgentConfigurationError,
                InvalidAgentHarnessError,
                InvalidAgentInstructionsError,
            ) as e:
                raise InvalidAgentConfigurationException(e) from e
            except InvalidAgentConnectionError as e:
                raise InvalidAgentConnectionException(e) from e
            except AgentCreationFailed as e:
                raise agent_creation_failed_exception(e) from e

        return wrapper

    return decorator

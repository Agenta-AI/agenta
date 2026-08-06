"""Workflow-domain exceptions.

These are raised by the workflows service and translated to HTTP responses at the API boundary
(see ``api/oss/src/apis/fastapi/workflows/exceptions.py``). Per the api layering rules, services
never raise ``HTTPException`` directly.
"""

from typing import Optional

# Reserved-slug detection is canonical in the SDK (it also drives is_static inference there). The
# API re-exports it so every write path can reject a reserved slug and every read path can
# short-circuit it, all off one definition. Independent of any StaticWorkflowProvider so the
# guard holds even when no catalogue is wired into WorkflowsService (evaluators, migrations, worker).
from agenta.sdk.engines.running.utils import (  # noqa: F401
    STATIC_SLUG_PREFIX,
    is_static_workflow_slug,
)


class WorkflowError(Exception):
    """Base exception for workflow-domain errors."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class StaticWorkflowSlug(WorkflowError):
    """Raised when a user tries to create, edit, or commit a workflow whose slug is in the
    reserved static namespace (``__ag__*``).

    Static workflows are served from code by the ``StaticWorkflowCatalog``; a user must not be
    able to author or shadow one. Translated to HTTP 400 at the router.
    """

    def __init__(self, slug: str, message: Optional[str] = None):
        self.slug = slug
        super().__init__(
            message
            or (
                f"The slug prefix '__ag__' is reserved for static workflows. "
                f"Choose a different slug than '{slug}'."
            )
        )


class WorkflowServiceUrlMissing(WorkflowError):
    """Raised when a revision has no runnable service URL to invoke (batch or detached)."""

    def __init__(self, message: Optional[str] = None):
        super().__init__(message or "Workflow revision has no runnable service URL.")


class WorkflowDetachedStartFailed(WorkflowError):
    """Raised when a detached invoke could not obtain the started/accepted handshake."""

    def __init__(self, message: Optional[str] = None):
        super().__init__(message or "Detached workflow run failed to start.")

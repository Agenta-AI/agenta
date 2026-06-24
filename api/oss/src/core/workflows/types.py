"""Workflow-domain exceptions.

These are raised by the workflows service and translated to HTTP responses at the API boundary
(see ``api/oss/src/apis/fastapi/workflows/exceptions.py``). Per the api layering rules, services
never raise ``HTTPException`` directly.
"""

from typing import Optional


# Slugs in this namespace are platform-owned: served from code by the catalogue, never the
# database. The detection is a pure function (no catalogue instance) so every write path can
# reject a reserved slug and every read path can short-circuit it even when no catalogue is
# injected. The current slug grammar already allows a leading `_`, `.`, and `-`.
RESERVED_SLUG_PREFIX = "_agenta."


def is_reserved_workflow_slug(slug: Optional[str]) -> bool:
    """Whether ``slug`` is in the reserved platform namespace (``_agenta.*``).

    Independent of any ``PlatformWorkflowProvider`` so the guard holds even when no catalogue is
    wired into ``WorkflowsService`` (evaluators, migrations, the worker).
    """
    return bool(slug) and slug.startswith(RESERVED_SLUG_PREFIX)


class WorkflowError(Exception):
    """Base exception for workflow-domain errors."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class ReservedWorkflowSlug(WorkflowError):
    """Raised when a user tries to create, edit, or commit a workflow whose slug is in the
    reserved platform namespace (``_agenta.*``).

    Platform workflows are served from code by the ``PlatformWorkflowCatalog``; a user must not be
    able to author or shadow one. Translated to HTTP 400 at the router.
    """

    def __init__(self, slug: str, message: Optional[str] = None):
        self.slug = slug
        super().__init__(
            message
            or (
                f"The slug prefix '_agenta.' is reserved for platform workflows. "
                f"Choose a different slug than '{slug}'."
            )
        )

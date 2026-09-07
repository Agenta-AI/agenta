"""Workflow-domain exceptions.

These are raised by the workflows service and translated to HTTP responses at the API boundary
(see ``api/oss/src/apis/fastapi/workflows/exceptions.py``). Per the api layering rules, services
never raise ``HTTPException`` directly.
"""

from math import isfinite
from typing import Any, Dict, Optional

# Reserved-slug detection is canonical in the SDK (it also drives is_static inference there). The
# API re-exports it so every write path can reject a reserved slug and every read path can
# short-circuit it, all off one definition. Independent of any StaticWorkflowProvider so the
# guard holds even when no catalogue is wired into WorkflowsService (evaluators, migrations, worker).
from agenta.sdk.engines.running.utils import (  # noqa: F401
    STATIC_SLUG_PREFIX,
    is_static_workflow_slug,
)
from agenta.sdk.agents import HarnessKind


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


def _json_safe_echo(value: Any) -> Any:
    """A value echoed back to the caller must survive JSON serialization.

    Python's json parser accepts the non-standard `NaN` and `Infinity` literals in a request
    body, so a caller really can send one as a harness kind. Starlette serializes a response
    with `allow_nan=False`, so echoing that float verbatim would raise inside the response and
    turn this refusal into exactly the 500 it exists to replace.
    """
    if isinstance(value, float) and not isfinite(value):
        return repr(value)
    if isinstance(value, (str, int, float)):
        return value
    return str(value)


class InvalidAgentHarnessError(Exception):
    """The commit carries an agent configuration whose harness the runtime cannot read.

    A config with an unreadable ``harness.kind`` can never run, so storing it only moves the
    failure somewhere less useful: the commit answered 200 and the invoke died on the enum's
    bare ``ValueError`` as an unhandled 500 (finding F4). The write boundary is the outermost
    place the caller can still be told which field is wrong, so it is refused here.

    Deliberately NOT a :class:`WorkflowError`. That base takes a positional message and exists
    for the failures ``handle_workflow_exceptions`` translates one by one; this one carries a
    value and an agent-actionable envelope, and the commit route maps it to 422 itself. Joining
    the family would change nothing today and would put it in the path of any future broad
    ``except WorkflowError``, which is a behavior change this move does not want to make.
    """

    code = "invalid_harness_kind"

    def __init__(self, *, value: Any, message: str) -> None:
        super().__init__(message)
        self.value = value
        self.message = message

    def to_detail(self) -> Dict[str, Any]:
        """The canonical agent-actionable envelope. See `api/AGENTS.md`.

        NOT retryable: the same bytes carry the same unreadable value forever. The caller has
        a way forward, which is the `next_step`, so the allowed values travel in `details`
        rather than only inside the message.
        """
        return {
            "code": self.code,
            "message": self.message,
            "retryable": False,
            "next_step": (
                "Set agent.harness.kind to one of the allowed harnesses and send the "
                "commit again."
            ),
            "details": {
                "field": "parameters.agent.harness.kind",
                "value": _json_safe_echo(self.value),
                "allowed": sorted(kind.value for kind in HarnessKind),
            },
        }


class WorkflowServiceUrlMissing(WorkflowError):
    """Raised when a revision has no runnable service URL to invoke (batch or detached)."""

    def __init__(self, message: Optional[str] = None):
        super().__init__(message or "Workflow revision has no runnable service URL.")


class WorkflowDetachedStartFailed(WorkflowError):
    """Raised when a detached invoke could not obtain the started/accepted handshake."""

    def __init__(self, message: Optional[str] = None):
        super().__init__(message or "Detached workflow run failed to start.")

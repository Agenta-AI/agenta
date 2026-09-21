"""Workflow-domain exceptions.

These are raised by the workflows service and translated to HTTP responses at the API boundary
(see ``api/oss/src/apis/fastapi/workflows/exceptions.py``). Per the api layering rules, services
never raise ``HTTPException`` directly.
"""

from math import isfinite
from typing import Any, Dict, Optional

import httpx

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


class WorkflowDetachedStartNeverSent(WorkflowDetachedStartFailed):
    """A detached start whose response proves the workflow service never saw the request.

    A subclass, so every existing handler of ``WorkflowDetachedStartFailed`` is unaffected and
    only a caller asking the narrower question has to know about it.
    """


# The statuses that mean the run was not accepted, whoever answered.
#
# 404: no route matched. From a reverse proxy this is the catch-all picking up the path after the
# service's router disappeared (a stopped container), and from the service itself it is "Workflow
# not found", raised before anything runs.
#
# 503: emitted instead of forwarding. A proxy or load balancer returns it when it has no healthy
# backend to send to, and the three places the service itself returns 503 (session admission
# unavailable, and the auth and vault middlewares failing to reach the API) all sit in front of
# the workflow, so none of them can follow an accepted run.
#
# 502 and 504 are deliberately NOT here. Both mean the gateway did forward and then gave up on the
# answer, so the run may have been accepted.
_NEVER_DISPATCHED_STATUSES = frozenset({404, 503})

# Any response the workflow service builds itself carries at least `x-ag-version`, and a run whose
# own envelope sets a non-2xx status still goes out through that same stamping. So an `x-ag-`
# header on a 404 or a 503 means the service did answer, and the status stops being proof.
_SERVICE_HEADER_PREFIX = "x-ag-"


def detached_start_never_sent(response: httpx.Response) -> bool:
    """True when this non-2xx response proves the workflow service never saw the request."""
    if response.status_code not in _NEVER_DISPATCHED_STATUSES:
        return False
    return not any(
        name.lower().startswith(_SERVICE_HEADER_PREFIX) for name in response.headers
    )


# Transport failures where no byte reached the address we aimed at: the request never left this
# process (an unusable URL, an unknown scheme), never got a connection to write on (pool timeout),
# or never established one (refused, unresolvable host, connect timeout — httpx reports all three
# as ConnectError/ConnectTimeout). A read timeout and a write error part-way through the body are
# absent on purpose: both mean bytes were already on the wire.
_NEVER_SENT_TRANSPORT = (
    httpx.InvalidURL,
    httpx.UnsupportedProtocol,
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.PoolTimeout,
)


def transport_never_sent(error: Exception, *, url: str) -> bool:
    """True when a transport failure hit the request we sent, rather than a redirect of it.

    The detached invoke follows redirects, so httpx may issue up to twenty requests. A connect
    failure on the second one says nothing about the first: an intermediary answered that, and a
    proxy that redirects a POST may have forwarded it. Only a failure on the request we addressed
    proves nothing was delivered, and the exception carries the address it actually attempted.

    Compared as `httpx.URL`, because the raw strings differ for an explicit default port or an
    uppercase host, and reading those as a redirect would strand the claim this exists to free.
    """
    if not isinstance(error, _NEVER_SENT_TRANSPORT):
        return False
    try:
        attempted = error.request.url
    except (AttributeError, RuntimeError):
        # No request was ever bound to the error, so none was ever sent.
        return True
    return httpx.URL(url) == attempted


# What the caller of a detached invoke may treat as never dispatched. Both are raised by this
# domain, from the one scope that can prove it: the URL check before any request is built, and
# the transport and response classification inside the detached start. A bare httpx error is
# deliberately not here. Reaching the caller unclassified, it can only have come from a redirect
# hop or from outside the send, and neither proves anything.
_NEVER_DISPATCHED = (
    WorkflowServiceUrlMissing,
    WorkflowDetachedStartNeverSent,
)


def invoke_never_dispatched(error: BaseException) -> bool:
    """True only when a failed invoke provably never reached the workflow service.

    A caller holding a one-shot dispatch claim uses this to decide whether releasing the claim
    is safe. A false positive lets a retry start a turn the service already accepted, so every
    outcome that cannot be proven never-sent answers False. `asyncio.CancelledError` is one of
    those: a cancel can land with the request already on the wire.
    """
    return isinstance(error, _NEVER_DISPATCHED)

"""Workflow-domain exceptions.

These are raised by the workflows service and translated to HTTP responses at the API boundary
(see ``api/oss/src/apis/fastapi/workflows/exceptions.py``). Per the api layering rules, services
never raise ``HTTPException`` directly.
"""

import json

from math import isfinite
from typing import Any, Dict, List, Optional

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

from oss.src.core.sharing.types import HOME_DRIVE_NOT_ALLOWED


class WorkflowError(Exception):
    """Base exception for workflow-domain errors."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class AgentReferenceUnresolved(WorkflowError):
    """A reference names an agent (a key of `AGENT_REFERENCE_KEYS`) and nothing
    resolves: the agent is unknown, deleted, archived, or in another project. Also raised
    when an idempotent create's retry finds an agent the caller's read scope hides. Callers
    answer it as an unknown agent."""

    def __init__(self, message: str = "Not found."):
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


class StaticWorkflowReadOnly(WorkflowError):
    """Raised when a write names a static workflow by id: an edit, an archive, a fork, a
    variant or a revision created outside the commit, or a commit from an agent's tool.

    A static workflow is defined in code. A project may commit only the editable fields of
    one that lists them, through the commit endpoint; every other write is refused. A
    sibling of :class:`StaticWorkflowSlug`, which refuses a reserved slug the caller sent.
    """

    code = "static_workflow_read_only"

    _NEXT_STEP = (
        "Commit only the workflow's editable fields through the commit endpoint, or "
        "leave this workflow unchanged."
    )
    # For an agent's commit tool, which may never change a static workflow.
    AGENT_NEXT_STEP = (
        "An agent's tools cannot change this workflow. Leave it unchanged and do not "
        "send this change again."
    )

    def __init__(self, slug: str, *, next_step: Optional[str] = None):
        self.slug = slug
        self.next_step = next_step or self._NEXT_STEP
        super().__init__(
            f"The workflow '{slug}' is defined by Agenta and cannot be changed here."
        )

    def to_detail(self) -> Dict[str, Any]:
        """The canonical agent-actionable envelope. See `api/AGENTS.md`."""
        return {
            "code": self.code,
            "message": self.message,
            "retryable": False,
            "next_step": self.next_step,
            "details": {"slug": self.slug},
        }


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


class StaticFieldNotEditableError(Exception):
    """A delta commit on a static workflow targets a field outside its ``editable`` list.

    A static workflow is defined in code; a project may commit only the fields its catalogue
    entry lists as editable. A full-data commit drops the other fields instead, so this is
    raised only for a delta, which names its target.
    """

    code = "static_field_not_editable"

    def __init__(self, *, field: str, editable: List[str]) -> None:
        self.field = field
        self.editable = list(editable)
        self.message = f"'{field}' cannot be changed on this workflow."
        super().__init__(self.message)

    def to_detail(self) -> Dict[str, Any]:
        """The canonical agent-actionable envelope. See `api/AGENTS.md`."""
        return {
            "code": self.code,
            "message": self.message,
            "retryable": False,
            "next_step": (
                "Change only the fields in `details.editable` and send the commit again."
            ),
            "details": {"field": self.field, "editable": self.editable},
        }


class InvalidAgentInstructionsError(Exception):
    """The commit carries ``parameters.agent.instructions`` in a shape the runtime cannot read.

    The runtime takes the prompt only from ``instructions.agents_md``. A bare string stored
    there committed with 200 and the agent then ran with no prompt at all, silently. Refused
    at the write boundary for the same reason as :class:`InvalidAgentHarnessError`, and kept
    outside the :class:`WorkflowError` family for the same reason too.
    """

    code = "invalid_agent_instructions"

    def __init__(self, *, received_type: str, message: str) -> None:
        super().__init__(message)
        self.received_type = received_type
        self.message = message

    def to_detail(self) -> Dict[str, Any]:
        """The canonical agent-actionable envelope. See `api/AGENTS.md`.

        The value itself is not echoed: it is usually the whole prompt.
        """
        return {
            "code": self.code,
            "message": self.message,
            "retryable": False,
            "next_step": (
                'Set agent.instructions to {"agents_md": "<the full AGENTS.md text>"} '
                "and send the call again."
            ),
            "details": {
                "field": "parameters.agent.instructions",
                "received_type": self.received_type,
                "expected": {"agents_md": "string"},
            },
        }


class InvalidAgentConnectionError(Exception):
    """The commit carries ``parameters.agent.llm.connection`` that the runtime cannot use.

    Refused at the write boundary, for the reason :class:`InvalidAgentInstructionsError`
    gives: an organization connection that does not name its slug with scope and namespace
    ``organization``.
    """

    code = "invalid_agent_connection"

    def __init__(self, *, reason: str, message: str, next_step: str) -> None:
        super().__init__(message)
        self.reason = reason
        self.message = message
        self.next_step = next_step

    def to_detail(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": False,
            "next_step": self.next_step,
            "details": {
                "field": "parameters.agent.llm.connection",
                "reason": self.reason,
            },
        }


class InvalidAgentConfigurationError(Exception):
    """The commit carries an agent configuration the runtime refuses to parse.

    Before every run the runtime parses ``parameters`` with ``AgentTemplate.from_params``. A
    skill without ``body`` was stored with 200, and then every run of the agent failed with a
    500. Refused at the write boundary for the same reason as
    :class:`InvalidAgentHarnessError`, and kept outside the :class:`WorkflowError` family for
    the same reason too.

    The rule reads the RESULT, not the change. An agent stored before this rule existed can
    hold such a field, and then a change to any other field is refused too, until the same
    change corrects it. The issues name the field, so the caller knows what to correct.

    ``message`` is plain text for a person and names no field path; the paths are in
    ``details.issues``.
    """

    code = "invalid_agent_configuration"

    def __init__(self, *, issues: List[str]) -> None:
        message = "This agent's setup is not valid, so it cannot run."
        super().__init__(message)
        self.issues = list(issues)
        self.message = message

    def to_detail(self) -> Dict[str, Any]:
        """The canonical agent-actionable envelope. See `api/AGENTS.md`."""
        return {
            "code": self.code,
            "message": self.message,
            "retryable": False,
            "next_step": (
                "Correct the fields listed in `details.issues` and send the call again. "
                "If the stored agent already holds one of them, correct it in the same "
                "change: no other change is accepted until it is corrected."
            ),
            "details": {"issues": self.issues},
        }


class AgentDriveError(Exception):
    """The commit carries ``parameters.agent.drives``, ``home_drive`` or ``has_session_drive``
    that no run can use. Kept outside :class:`WorkflowError` for the reason :class:`InvalidAgentHarnessError`
    gives; the commit routes map every subclass to 422."""

    code: str

    def __init__(self, *, field: str, value: Any, message: str, next_step: str) -> None:
        super().__init__(message)
        self.field = field
        self.value = value
        self.message = message
        self.next_step = next_step

    def to_detail(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": False,
            "next_step": self.next_step,
            "details": {
                "field": f"parameters.agent.{self.field}",
                "value": _json_safe_echo(self.value),
            },
        }


class InvalidAgentDrivesError(AgentDriveError):
    """A drive entry breaks a rule of the SDK's ``validate_agent_drives``."""

    code = "invalid_drive_entry"


class InvalidSessionDriveError(AgentDriveError):
    """``has_session_drive`` is not a boolean."""

    code = "invalid_session_drive"


class InvalidHomeDriveError(AgentDriveError):
    """``home_drive`` names no entry of ``drives``, or a read entry."""

    code = "invalid_home_drive"


class AgentDriveNotFoundError(AgentDriveError):
    """An entry names no active drive in this project, or a private drive the saver may
    not use."""

    code = "drive_not_found"


class AgentDriveNotSharedError(AgentDriveError):
    """A shared agent lists a private drive of the saver."""

    code = "drive_not_shared"


class HomeDriveNotAllowedError(AgentDriveError):
    """A private agent's home drive is not a private drive of the agent's owner."""

    code = HOME_DRIVE_NOT_ALLOWED


class MountLookupMissing(WorkflowError):
    """The service was built without the mount lookup, so it cannot check the drives of
    an agent. A wiring fault of the server, never the caller's."""

    def __init__(self, message: Optional[str] = None):
        super().__init__(message or "Drives cannot be checked: no mount lookup.")


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


class WorkflowDetachedStartRejected(WorkflowDetachedStartFailed):
    """The service itself answered the start with a failure: a stamped non-2xx response, or a
    failure as the first record. The stamp proves who answered, not that nothing ran. For an
    agent turn it does: the agent handler starts the harness only after the stream commits
    200, so a non-2xx answer comes before any agent work. A gateway 502 or 504 is not this."""

    def __init__(
        self,
        message: Optional[str] = None,
        *,
        failure_code: Optional[str] = None,
        failure_details: Optional[dict] = None,
    ):
        super().__init__(message)
        # The service's own failure class (`status.failure_code`) and its structured facts
        # (`status.details`), when the answer carried them.
        self.failure_code = failure_code
        self.failure_details = failure_details


def service_failure_status(raw: bytes) -> dict:
    """The `status` object of a workflow service error body, or an empty dict."""
    try:
        body = json.loads(raw)
    except (ValueError, TypeError):
        return {}
    status = body.get("status") if isinstance(body, dict) else None
    return status if isinstance(status, dict) else {}


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

# The header is the second half of the proof, and it is not true that every response the service
# builds carries it: the three 503 sites named above are bare JSONResponses with no header at all.
# What holds is the pair.
#
# A failure INSIDE a run is always stamped. It leaves as a batch response whose status is >= 400,
# which goes out through `_make_json_response`, which sets `x-ag-version`
# (`sdks/python/agenta/sdk/decorators/routing.py`). A run that has begun streaming has already
# committed 200, so it cannot present a failure as a status at all. Pinned on the SDK side by
# `sdks/python/oss/tests/pytest/unit/test_invoke_error_response_headers_routing.py`, because this
# rule fails OPEN: an unstamped in-run 503 would read as never-sent and let a retry run a turn
# that already executed its tool calls.
#
# The unstamped 404 and 503 answers are the ones listed above, and every one of them sits in
# front of the workflow. That is a property of where those sites are, which no check here can
# hold still, so the SDK test above is what keeps the two halves from drifting into one.
_SERVICE_HEADER_PREFIX = "x-ag-"


def answered_by_service(response: httpx.Response) -> bool:
    """True when the workflow service built this response (it carries the service's stamp)."""
    return any(
        name.lower().startswith(_SERVICE_HEADER_PREFIX) for name in response.headers
    )


def detached_start_never_sent(response: httpx.Response) -> bool:
    """True when this non-2xx response proves the workflow service never saw the request."""
    if response.status_code not in _NEVER_DISPATCHED_STATUSES:
        return False
    return not answered_by_service(response)


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

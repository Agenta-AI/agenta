"""A turn the runner refused at admission answers 409, 503 or 422, never 500.

The runner refuses a turn before it starts in three cases, and names which one in the terminal
result's ``errorDetail.code`` (`services/runner/src/sessions/admission.ts`):

* ``session_turn_in_use``: another turn owns the session. The caller waits for it: 409.
* ``session_admission_unconfirmed``: the platform did not answer the admission beat (throttled or
  restarting). The caller sends again later: 503 with ``Retry-After``.
* ``session_admission_rejected``: the platform answered the beat with a request error. Sending
  again fails the same way: 422.

Before this, all three reached ``POST /services/agent/v0/invoke`` as 500. The web chat and the
channels inbox key their "not sent, send again" state on ``failure_code: session_turn_in_use``,
so the two busy cases keep that code, and the message stays the runner's own sentence.
"""

from __future__ import annotations

import json

import pytest

from agenta.sdk.agents import AgentRunFailed, AgentTurnAdmissionRefused
from agenta.sdk.agents.errors import ADMISSION_RETRY_AFTER_SECONDS
from agenta.sdk.agents.utils.wire import result_from_wire
from agenta.sdk.decorators.routing import _make_json_response, handle_invoke_failure
from agenta.sdk.middlewares.running.normalizer import NormalizerMiddleware
from agenta.sdk.models.workflows import WorkflowBatchResponse, retry_after_of

IN_USE_MESSAGE = (
    "This session is already running a turn. Your message was not sent. "
    "Wait for the reply, or stop the turn, then send again."
)
UNCONFIRMED_MESSAGE = (
    "The platform is busy and could not start this turn. Your message was not sent. "
    "Send it again in a moment."
)
REJECTED_MESSAGE = (
    "The platform refused to start this turn because the request was not valid. "
    "Your message was not sent."
)


def _refused(code: str, message: str, retryable: bool = True, **extra) -> dict:
    """The runner's terminal result for a turn it refused at admission."""
    return {
        "ok": False,
        "error": message,
        "errorDetail": {
            "code": code,
            "message": message,
            "retryable": retryable,
            **extra,
        },
        "events": [],
    }


IN_USE = _refused("session_turn_in_use", IN_USE_MESSAGE)
UNCONFIRMED = _refused("session_admission_unconfirmed", UNCONFIRMED_MESSAGE)
REJECTED = _refused(
    "session_admission_rejected",
    REJECTED_MESSAGE,
    retryable=False,
    details={"status": 422},
)


def _raised(result: dict) -> AgentRunFailed:
    with pytest.raises(AgentRunFailed) as caught:
        result_from_wire(result)
    return caught.value


# ------------------------------------------------------------- the wire raises the right error


@pytest.mark.parametrize(
    "result, status_code, failure_code, retry_after",
    [
        (IN_USE, 409, "session_turn_in_use", None),
        (
            UNCONFIRMED,
            503,
            "session_turn_in_use",
            ADMISSION_RETRY_AFTER_SECONDS,
        ),
        (REJECTED, 422, "session_admission_rejected", None),
    ],
)
def test_an_admission_refusal_carries_its_status(
    result, status_code, failure_code, retry_after
):
    error = _raised(result)

    assert isinstance(error, AgentTurnAdmissionRefused)
    assert error.status_code == status_code
    assert error.failure_code == failure_code
    assert error.retry_after == retry_after
    # No "Agent run failed:" prefix: the web chat matches the runner's sentence exactly.
    assert str(error) == result["error"]


def test_a_refusal_without_error_detail_stays_a_plain_run_failure():
    # A runner that predates `errorDetail` on refusals sends only the sentence. Nothing tells the
    # two busy cases apart then, so the failure keeps its old shape and its old 500.
    error = _raised({"ok": False, "error": IN_USE_MESSAGE, "events": []})

    assert not isinstance(error, AgentTurnAdmissionRefused)
    assert not hasattr(error, "status_code")


def test_a_gateway_refusal_is_not_an_admission_refusal():
    error = _raised(
        _refused("model_not_allowed", "That model is not allowed.", retryable=False)
    )

    assert not isinstance(error, AgentTurnAdmissionRefused)
    assert error.failure_code == "model_not_allowed"


# ------------------------------------------------------- the invoke routing layer's error body


async def _invoke_failure(result: dict):
    response = await handle_invoke_failure(_raised(result))
    return response, json.loads(bytes(response.body))


async def test_another_turn_owning_the_session_answers_409():
    response, body = await _invoke_failure(IN_USE)

    assert response.status_code == 409
    assert body["status"]["code"] == 409
    assert body["status"]["failure_code"] == "session_turn_in_use"
    assert body["status"]["message"] == IN_USE_MESSAGE
    assert "retry-after" not in response.headers
    assert "retry_after" not in body["status"]


async def test_an_unconfirmed_admission_answers_503_with_retry_after():
    response, body = await _invoke_failure(UNCONFIRMED)

    assert response.status_code == 503
    assert response.headers["retry-after"] == str(ADMISSION_RETRY_AFTER_SECONDS)
    assert body["status"]["retry_after"] == ADMISSION_RETRY_AFTER_SECONDS
    # Same class as an owned session: the client keeps the text and sends it again.
    assert body["status"]["failure_code"] == "session_turn_in_use"
    assert body["status"]["message"] == UNCONFIRMED_MESSAGE
    # The API reads a 503 WITHOUT an `x-ag-` header as "the service never saw it".
    assert "x-ag-version" in response.headers


async def test_a_rejected_admission_answers_422_and_is_not_busy():
    response, body = await _invoke_failure(REJECTED)

    assert response.status_code == 422
    assert body["status"]["failure_code"] == "session_admission_rejected"
    assert body["status"]["message"] == REJECTED_MESSAGE
    assert "retry-after" not in response.headers


# ------------------------------------------------------------ the normalizer's own error body


async def _normalized(result: dict) -> WorkflowBatchResponse:
    """The body a HANDLER's exception produces. This is the agent invoke path."""
    return await NormalizerMiddleware()._normalize_exception(_raised(result))


@pytest.mark.parametrize(
    "result, code, failure_code",
    [
        (IN_USE, 409, "session_turn_in_use"),
        (UNCONFIRMED, 503, "session_turn_in_use"),
        (REJECTED, 422, "session_admission_rejected"),
    ],
)
async def test_the_normalizer_answers_the_same_status(result, code, failure_code):
    status = (await _normalized(result)).status

    assert status.code == code
    assert status.failure_code == failure_code
    assert status.message == result["error"]


async def test_the_normalizer_body_gets_the_retry_after_header():
    response = _make_json_response(await _normalized(UNCONFIRMED))

    assert response.status_code == 503
    assert response.headers["retry-after"] == str(ADMISSION_RETRY_AFTER_SECONDS)


async def test_an_ordinary_failure_gets_no_retry_after():
    response = _make_json_response(
        await NormalizerMiddleware()._normalize_exception(RuntimeError("boom"))
    )

    assert response.status_code == 500
    assert "retry-after" not in response.headers
    assert "retry_after" not in json.loads(bytes(response.body))["status"]


@pytest.mark.parametrize("value", [None, -1, True, 2.5, "5"])
def test_only_a_non_negative_int_is_a_retry_after(value):
    class _Odd(RuntimeError):
        retry_after = value

    assert retry_after_of(_Odd()) is None

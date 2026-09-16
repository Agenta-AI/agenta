"""XP-3: the invoke remap must give documented errors their documented HTTP status.

``handle_invoke_failure`` reads ``status_code`` off the exception and otherwise falls through
to 500. ``qa/matrix.md`` documents ``UnsupportedDeployment`` as HTTP 422 (and calls anything
else a finding), so the exception must carry the status.

The same file also pins ``status.failure_code``: the stable slug a client branches on. TWO
sites build an error body from a raised exception, and a handler's OWN exception reaches the
normalizer, never ``handle_invoke_failure``, so both are asserted here. A code that appeared
on only one of them would be invisible for exactly the failures that matter.
"""

from __future__ import annotations

import json

from agenta.sdk.agents.connections import (
    EndpointResolutionError,
    SubscriptionLoginRequiredError,
    UnsupportedDeploymentError,
    UnsupportedProviderError,
)
from agenta.sdk.decorators import routing
from agenta.sdk.decorators.routing import handle_invoke_failure
from agenta.sdk.middlewares.running import normalizer
from agenta.sdk.middlewares.running.normalizer import NormalizerMiddleware


async def _status_and_body(exception: Exception) -> tuple[int, dict]:
    response = await handle_invoke_failure(exception)
    return response.status_code, json.loads(bytes(response.body))


async def test_unsupported_deployment_remaps_to_422():
    status, body = await _status_and_body(
        UnsupportedDeploymentError(deployment="bedrock", harness="claude")
    )
    assert status == 422
    assert "bedrock" in json.dumps(body)


async def test_unsupported_provider_remaps_to_422():
    status, body = await _status_and_body(
        UnsupportedProviderError(provider="cohere", harness="claude")
    )
    assert status == 422
    assert "cohere" in json.dumps(body)


async def test_endpoint_resolution_error_remaps_to_422():
    # A chosen custom connection with no usable base URL is a config problem, not a server fault.
    status, body = await _status_and_body(
        EndpointResolutionError("custom connection 'my-ollama' cannot be resolved")
    )
    assert status == 422
    assert "my-ollama" in json.dumps(body)


async def test_unremarkable_exception_still_remaps_to_500():
    # The fallback must stay 500 — 422 is opt-in via `status_code`, not the new default.
    status, _ = await _status_and_body(RuntimeError("boom"))
    assert status == 500


async def test_subscription_login_error_carries_a_machine_readable_code():
    # Connection resolution runs BEFORE the stream opens, so a not-ready subscription can only
    # be reported through this envelope. The client branches on the slug, never on the prose.
    status, body = await _status_and_body(
        SubscriptionLoginRequiredError(slug="chatgpt", provider="chatgpt")
    )

    assert status == 422
    assert body["status"]["code"] == 422
    assert body["status"]["failure_code"] == "subscription_login_required"
    assert body["status"]["message"] == (
        "The ChatGPT sign-in is not ready. Sign in from AI providers."
    )
    # The same slug the runner puts on its own error frame, so the client learns one word.
    assert body["status"]["failure_code"] == SubscriptionLoginRequiredError.failure_code


async def test_an_exception_without_a_code_keeps_the_old_body():
    # `failure_code` is opt-in: every error that names none must serialize exactly as before.
    _, body = await _status_and_body(
        UnsupportedProviderError(provider="cohere", harness="claude")
    )
    assert "failure_code" not in body["status"]

    _, plain = await _status_and_body(RuntimeError("boom"))
    assert "failure_code" not in plain["status"]


async def test_a_non_string_failure_code_is_ignored():
    # Only a real slug reaches the client; anything else falls back to naming no class.
    class _Odd(RuntimeError):
        status_code = 422
        failure_code = 17

    _, body = await _status_and_body(_Odd("boom"))
    assert "failure_code" not in body["status"]


# ------------------------------------------------------- the normalizer's own error body


async def _normalized_status(exception: Exception) -> dict:
    """The status a HANDLER's exception produces. This is the agent invoke path."""
    response = await NormalizerMiddleware()._normalize_exception(exception)
    return response.model_dump(mode="json", exclude_none=True)["status"]


async def test_normalizer_carries_the_same_failure_code():
    # `_agent` raises the resolution error inside the handler call, so THIS is the site that
    # answers a not-ready subscription. It must name the same slug as the routing twin.
    status = await _normalized_status(
        SubscriptionLoginRequiredError(slug="chatgpt", provider="chatgpt")
    )

    assert status["code"] == 422
    assert status["failure_code"] == "subscription_login_required"


async def test_normalizer_omits_the_code_when_the_exception_names_none():
    status = await _normalized_status(RuntimeError("boom"))
    assert status["code"] == 500
    assert "failure_code" not in status


async def test_both_error_sites_agree_on_one_exception():
    # The two twins are hand-mirrored, so pin that they answer identically. Drift here is what
    # makes a client work on one route and silently fail on the other.
    exception = SubscriptionLoginRequiredError(slug="chatgpt", provider="chatgpt")

    _, routed = await _status_and_body(exception)
    normalized = await _normalized_status(exception)

    assert routed["status"]["failure_code"] == normalized["failure_code"]
    assert routed["status"]["code"] == normalized["code"]
    assert routed["status"]["message"] == normalized["message"]


# ------------------------------------------------------ what the refusal body carries


_TRACEBACK_MARKERS = ("Traceback (most recent call last)", 'File "', ", line ")


def _looks_like_a_traceback(body: str) -> bool:
    return any(marker in body for marker in _TRACEBACK_MARKERS)


async def test_a_refusal_body_carries_no_traceback(monkeypatch):
    """This body answers `POST /services/agent/v0/invoke`, which the playground calls from
    a browser, so it was shipping module paths and the service's own layout to a page."""
    monkeypatch.delenv("AGENTA_SDK_ERRORS_INCLUDE_STACKTRACE", raising=False)

    def raise_deep():
        raise RuntimeError("the handler blew up")

    try:
        raise_deep()
    except RuntimeError as exception:
        status = await _normalized_status(exception)

    assert "stacktrace" not in status
    assert not _looks_like_a_traceback(json.dumps(status))
    # And the parts a client branches on are all still there.
    assert status["code"] == 500
    assert status["message"] == "the handler blew up"
    assert status["type"]


async def test_a_refusal_the_sdk_authored_carries_no_traceback_either(monkeypatch):
    """The other branch: an `ErrorStatus` the SDK raised with a stacktrace of its own."""
    monkeypatch.delenv("AGENTA_SDK_ERRORS_INCLUDE_STACKTRACE", raising=False)

    status = await _normalized_status(
        SubscriptionLoginRequiredError(slug="chatgpt", provider="chatgpt")
    )

    assert "stacktrace" not in status
    assert status["failure_code"] == "subscription_login_required"


async def test_the_traceback_is_returned_when_a_developer_asks_for_it(monkeypatch):
    """Local development keeps the old body, deliberately and explicitly."""
    monkeypatch.setenv("AGENTA_SDK_ERRORS_INCLUDE_STACKTRACE", "true")

    def raise_deep():
        raise RuntimeError("the handler blew up")

    try:
        raise_deep()
    except RuntimeError as exception:
        status = await _normalized_status(exception)

    assert _looks_like_a_traceback(json.dumps(status["stacktrace"]))


async def test_a_withheld_traceback_is_logged_rather_than_dropped(monkeypatch):
    """Turning the switch off must cost an operator nothing: the same text lands on the
    failure line this path already writes, so they read one record rather than two."""
    monkeypatch.delenv("AGENTA_SDK_ERRORS_INCLUDE_STACKTRACE", raising=False)
    recorded: list = []
    monkeypatch.setattr(
        normalizer.log,
        "warning",
        lambda *args, **kwargs: recorded.append(kwargs),
    )

    try:
        raise RuntimeError("the handler blew up")
    except RuntimeError as exception:
        await _normalized_status(exception)

    assert recorded, "the traceback was withheld and not logged"
    assert _looks_like_a_traceback(json.dumps(recorded[-1]["stacktrace"]))
    assert recorded[-1]["status_code"] == 500


# ---------------------------------------------------------------------------
# D68: the invoke routing layer answers the same request, so it answers the same way
# ---------------------------------------------------------------------------


async def _routed_body(exception: Exception) -> dict:
    _, body = await _status_and_body(exception)
    return body


async def test_the_routing_layers_refusal_body_carries_no_traceback(monkeypatch):
    """The other half of the same request. A handler's own exception is caught by the
    normalizer, and everything raised around it by this layer, so a caller that could not
    read a traceback from one could still read one from the other."""
    monkeypatch.delenv("AGENTA_SDK_ERRORS_INCLUDE_STACKTRACE", raising=False)

    def raise_deep():
        raise RuntimeError("the route blew up")

    try:
        raise_deep()
    except RuntimeError as exception:
        body = await _routed_body(exception)

    assert "stacktrace" not in body["status"]
    assert not _looks_like_a_traceback(json.dumps(body))
    # And the parts a client branches on are all still there.
    assert body["status"]["code"] == 500
    assert body["status"]["message"] == "the route blew up"
    assert body["status"]["type"]


async def test_the_routing_layers_authored_refusal_carries_no_traceback_either(
    monkeypatch,
):
    """The `ErrorStatus` branch, which returned whatever stacktrace the raiser attached."""
    monkeypatch.delenv("AGENTA_SDK_ERRORS_INCLUDE_STACKTRACE", raising=False)

    body = await _routed_body(
        SubscriptionLoginRequiredError(slug="chatgpt", provider="chatgpt")
    )

    assert "stacktrace" not in body["status"]
    assert body["status"]["failure_code"] == "subscription_login_required"


async def test_the_routing_layer_returns_the_traceback_when_asked(monkeypatch):
    """One switch, so a developer who turns it on gets both paths, not one of them."""
    monkeypatch.setenv("AGENTA_SDK_ERRORS_INCLUDE_STACKTRACE", "true")

    def raise_deep():
        raise RuntimeError("the route blew up")

    try:
        raise_deep()
    except RuntimeError as exception:
        body = await _routed_body(exception)

    assert _looks_like_a_traceback(json.dumps(body["status"]["stacktrace"]))


async def test_the_routing_layer_logs_the_traceback_it_withholds(monkeypatch):
    """This path wrote no failure line at all, so withholding the traceback would have
    been the only record of it disappearing."""
    monkeypatch.delenv("AGENTA_SDK_ERRORS_INCLUDE_STACKTRACE", raising=False)
    recorded: list = []
    monkeypatch.setattr(
        routing.log,
        "warning",
        lambda *args, **kwargs: recorded.append(kwargs),
    )

    try:
        raise RuntimeError("the route blew up")
    except RuntimeError as exception:
        await _routed_body(exception)

    assert recorded, "the traceback was withheld and not logged"
    assert _looks_like_a_traceback(json.dumps(recorded[-1]["stacktrace"]))
    assert recorded[-1]["status_code"] == 500


async def test_both_error_sites_withhold_and_return_together(monkeypatch):
    """The reason the switch lives beside `failure_code_of` rather than in either module:
    one request must not be able to get two different answers."""
    monkeypatch.delenv("AGENTA_SDK_ERRORS_INCLUDE_STACKTRACE", raising=False)

    try:
        raise RuntimeError("boom")
    except RuntimeError as exception:
        assert "stacktrace" not in (await _routed_body(exception))["status"]
        assert "stacktrace" not in await _normalized_status(exception)

        monkeypatch.setenv("AGENTA_SDK_ERRORS_INCLUDE_STACKTRACE", "1")
        assert (await _routed_body(exception))["status"]["stacktrace"]
        assert (await _normalized_status(exception))["stacktrace"]

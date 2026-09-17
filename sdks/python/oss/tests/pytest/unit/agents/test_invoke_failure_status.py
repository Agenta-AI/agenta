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
from agenta.sdk.decorators.routing import handle_invoke_failure
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

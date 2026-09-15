"""Which gateway planes the DEPLOYMENT under test serves.

An acceptance suite runs against a stack it did not configure, and `AGENTA_LLM_GATEWAY_ENABLED`
ships off, so a test that drives a model through the LLM gateway has to ask before it assumes.
Reading this process's own environment would answer about the test runner, not about the
deployment, and the two are different machines in CI.

Why it matters concretely: with the plane off the agent SDK resolves a model from the project's
vault key instead of the gateway, which is the correct pre-gateway behaviour and exactly what
the release intends. A suite asserting on a gateway refusal then sees no gateway refusal, and
fails describing a symptom (`failure_code` was `None`) rather than the cause.
"""

import pytest


def _llm_gateway_disabled(response) -> bool:
    """Whether this response is the API saying the LLM plane does not serve.

    Narrow on purpose. Only the typed refusal counts, so an ordinary 403 from a permission
    check, or any other failure, leaves the suite running and failing as it should.
    """
    if response.status_code != 403:
        return False
    try:
        body = response.json()
    except ValueError:
        return False
    detail = body.get("detail") if isinstance(body, dict) else None
    if not isinstance(detail, dict):
        return False
    return detail.get("code") == "llm_gateway_disabled"


@pytest.fixture(scope="module")
def llm_gateway_plane(mod_api) -> bool:
    """True when the deployment serves the LLM gateway.

    Module-scoped, matching `mod_api`: one probe per suite. Any LLM gateway route refuses the
    same way while the plane is off; listing endpoints is the cheapest and changes nothing.
    """
    return not _llm_gateway_disabled(mod_api("GET", "/gateways/llms/endpoints/"))


def skip_unless_llm_gateway(llm_gateway_plane: bool) -> None:
    """Skip the caller when the deployment has the LLM gateway switched off.

    A function rather than a fixture so a provisioning fixture can call it at the top of its
    own body. A fixture-ordering skip is not enough: these suites register endpoints through
    the very routes that are refused, so the skip has to run inside the fixture that registers
    them, not merely before the test.
    """
    if not llm_gateway_plane:
        pytest.skip(
            "the LLM gateway plane is disabled on this deployment "
            "(set AGENTA_LLM_GATEWAY_ENABLED=true to run it)"
        )

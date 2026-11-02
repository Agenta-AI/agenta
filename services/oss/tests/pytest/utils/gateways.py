"""Which gateway planes the DEPLOYMENT under test serves.

An acceptance suite runs against a stack it did not configure, and `AGENTA_LLM_GATEWAY_ENABLED`
ships off, so a test that drives a model through the LLM gateway has to ask before it assumes.
Reading this process's own environment would answer about the test runner, not about the
deployment, and the two are different machines in CI.

Asking is not the same as accepting the answer. A deployment that should serve the plane and
does not is a failed run, not a quiet one, so the check below fails unless the run says it
expected a stack with the plane off (D77).

Why it matters concretely: with the plane off the agent SDK resolves a model from the project's
vault key instead of the gateway, which is the correct pre-gateway behaviour and exactly what
the release intends. A suite asserting on a gateway refusal then sees no gateway refusal, and
fails describing a symptom (`failure_code` was `None`) rather than the cause.
"""

from os import environ

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


# Whether the deployment under test is expected to serve the LLM gateway.
#
# Default yes, because these suites exist only to prove that a gateway refusal reaches the
# caller, and a run that covers none of that has not passed, it has not happened. Skipping
# said otherwise: it reported green, and the one place that noticed wrote the problem down
# rather than fixing it — `hosting/railway/oss/template/template.json` turns the plane on
# because "without this the previews would be green while covering nothing" (D77).
#
# The opt-out is for a run deliberately pointed at a stack with the plane off, which is the
# product default. It has to be said out loud, because the whole defect was a configuration
# nobody had to say anything about.
_EXPECT_ENV_VAR = "AGENTA_TESTS_EXPECT_LLM_GATEWAY"
_FALSY = frozenset({"0", "false", "no", "off"})


def _llm_gateway_expected() -> bool:
    return (environ.get(_EXPECT_ENV_VAR) or "").strip().lower() not in _FALSY


def require_llm_gateway(llm_gateway_plane: bool) -> None:
    """Stop the caller when the deployment has the LLM gateway switched off.

    Fails, rather than skips, unless the run said it expected a stack without the plane. A
    misconfigured deployment and a deliberate one look identical from here, and only one of
    them should be quiet.

    A function rather than a fixture so a provisioning fixture can call it at the top of its
    own body. A fixture-ordering check is not enough: these suites register endpoints through
    the very routes that are refused, so it has to run inside the fixture that registers them,
    not merely before the test.
    """
    if llm_gateway_plane:
        return

    if _llm_gateway_expected():
        pytest.fail(
            "the LLM gateway plane is disabled on this deployment, so this suite would "
            "cover nothing. Set AGENTA_LLM_GATEWAY_ENABLED=true on the deployment, or "
            f"{_EXPECT_ENV_VAR}=false on this run to skip the gateway suites deliberately.",
            pytrace=False,
        )

    pytest.skip(
        "the LLM gateway plane is disabled on this deployment and this run said it "
        f"expected that ({_EXPECT_ENV_VAR} is off)"
    )

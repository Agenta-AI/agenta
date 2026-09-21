"""Fixtures for the gateway data plane.

The data plane reads `X-AG-Credentials` and nothing else (D31), so its calls cannot use the
shared `authed_api`, which sets `Authorization`. That header is deliberately absent here:
on a data-plane request it belongs to the upstream, and sending one would exercise
pass-through rather than the path under test.
"""

import os

import pytest
import requests

from oss.src.utils.env import env  # noqa: F401  — keeps env import ordering with the suite

BASE_TIMEOUT = 60


@pytest.fixture
def gateway_api(cls_account):
    """Authenticated data-plane requests: our credentials in our own header."""
    api_url = cls_account["api_url"]
    credentials = cls_account["credentials"]

    def _request(method: str, endpoint: str, **kwargs):
        headers = kwargs.pop("headers", {})
        headers.setdefault("X-AG-Credentials", credentials)

        return requests.request(
            method=method,
            url=f"{api_url}{endpoint}",
            headers=headers,
            timeout=BASE_TIMEOUT,
            **kwargs,
        )

    return _request


@pytest.fixture(scope="class")
def llm_gateway_plane(cls_account) -> bool:
    """Whether the DEPLOYMENT under test serves the LLM gateway plane.

    Read from the deployment, not from this process's environment. An acceptance suite runs
    against a stack it did not configure, and `AGENTA_LLM_GATEWAY_ENABLED` defaults off, so
    the only trustworthy answer is the one the API gives. Any management route refuses the
    same way; listing endpoints is the cheapest and changes nothing.

    Class-scoped, matching `cls_account`, which is both the widest scope available to it and
    the scope it has to reach: a suite's class-scoped setup fixture provisions endpoints
    through the very routes this answers about, and a function-scoped skip runs too late to
    save it. One probe per class.
    """
    response = requests.get(
        f"{cls_account['api_url']}/gateways/llms/endpoints/",
        headers={"Authorization": cls_account["credentials"]},
        timeout=BASE_TIMEOUT,
    )
    if response.status_code != 403:
        return True

    try:
        detail = response.json().get("detail")
    except ValueError:
        return True
    code = detail.get("code") if isinstance(detail, dict) else None
    return code != "llm_gateway_disabled"


# Whether the deployment under test is expected to serve the LLM gateway.
#
# The same variable, the same vocabulary and the same default as the services side reads in
# `services/oss/tests/pytest/utils/gateways.py`. It is copied rather than imported because
# `api` and `services` are separate packages with separate environments and neither installs
# the other; the only thing both import is the SDK, and a test-harness switch does not belong
# in a shipped library. The two copies are held together by a case that loads the services
# helper and compares them, so a change to one that is not made to the other fails rather
# than drifting (D93).
#
# Default yes, because these suites exist only to prove that a gateway refusal reaches the
# caller with its code, and a run that covers none of that has not passed, it has not
# happened. Skipping said otherwise: it reported green. The opt-out is for a run deliberately
# pointed at a stack with the plane off, which is the product default, and it has to be said
# out loud, because the whole defect was a configuration nobody had to say anything about.
_EXPECT_ENV_VAR = "AGENTA_TESTS_EXPECT_LLM_GATEWAY"
_FALSY = frozenset({"0", "false", "no", "off"})


def llm_gateway_expected() -> bool:
    return (os.environ.get(_EXPECT_ENV_VAR) or "").strip().lower() not in _FALSY


def require_llm_gateway(llm_gateway_plane: bool) -> None:
    """Stop the caller when the deployment has the LLM gateway switched off.

    Fails, rather than skips, unless the run said it expected a stack without the plane. A
    misconfigured deployment and a deliberate one look identical from here, and only one of
    them should be quiet.

    A callable as well as the fixture below, because a class-scoped setup fixture that
    provisions through the LLM management routes is refused before any function-scoped check
    runs, so those fixtures have to ask the question themselves. One reason, one wording,
    wherever it is asked.
    """
    if llm_gateway_plane:
        return

    if llm_gateway_expected():
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


@pytest.fixture
def requires_llm_gateway(llm_gateway_plane: bool) -> None:
    require_llm_gateway(llm_gateway_plane)


@pytest.fixture
def requires_llm_gateway_off(llm_gateway_plane: bool) -> None:
    """The mirror: suites that prove the pre-gateway path, which need the plane OFF.

    Only one of these two families can run against one stack, so skipping when the plane is
    on is correct rather than a defect. What is not correct is skipping when the run declared
    it expected a stack with the plane off and found one with it on: that is the same
    mismatch in the other direction, and it is how a preview covers nothing quietly.
    """
    if not llm_gateway_plane:
        return

    if not llm_gateway_expected():
        pytest.fail(
            "this run said it expected the LLM gateway plane to be off "
            f"({_EXPECT_ENV_VAR} is off) and the deployment has it on, so this suite "
            "would cover nothing. Fix the deployment or the run.",
            pytrace=False,
        )

    pytest.skip(
        "the LLM gateway plane is enabled on this deployment "
        "(unset AGENTA_LLM_GATEWAY_ENABLED to run the legacy vault path)"
    )

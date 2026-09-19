"""The gateway suites must not report green against a stack that serves no gateway.

`require_llm_gateway` used to skip whenever the plane was off, which made a deployment
someone forgot to configure indistinguishable from one deliberately left alone. Both read as
a pass. These cases pin which of the two is quiet (D77).
"""

import pytest

from utils.gateways import require_llm_gateway


_EXPECT = "AGENTA_TESTS_EXPECT_LLM_GATEWAY"


def test_a_serving_deployment_is_let_through(monkeypatch):
    monkeypatch.delenv(_EXPECT, raising=False)

    require_llm_gateway(True)


def test_a_deployment_that_should_serve_and_does_not_fails_the_run(monkeypatch):
    """The defect. Nothing was said about the plane, so the suite is owed a gateway."""
    monkeypatch.delenv(_EXPECT, raising=False)

    # `Failed` and `Skipped` derive from BaseException, not Exception.
    with pytest.raises(BaseException) as raised:
        require_llm_gateway(False)

    assert raised.typename == "Failed", "the run was skipped rather than failed"
    # And the message says what to change, on the deployment or on the run.
    assert "AGENTA_LLM_GATEWAY_ENABLED=true" in str(raised.value)
    assert _EXPECT in str(raised.value)


@pytest.mark.parametrize("said", ["false", "0", "no", "off", "False", " off "])
def test_a_run_that_expected_no_gateway_still_skips(monkeypatch, said):
    """The product ships the plane off, so pointing a run at such a stack on purpose stays
    possible. It just has to be said."""
    monkeypatch.setenv(_EXPECT, said)

    # `Failed` and `Skipped` derive from BaseException, not Exception.
    with pytest.raises(BaseException) as raised:
        require_llm_gateway(False)

    assert raised.typename == "Skipped"


@pytest.mark.parametrize("said", ["", "true", "1", "yes", "anything else"])
def test_anything_short_of_saying_so_is_not_saying_so(monkeypatch, said):
    monkeypatch.setenv(_EXPECT, said)

    # `Failed` and `Skipped` derive from BaseException, not Exception.
    with pytest.raises(BaseException) as raised:
        require_llm_gateway(False)

    assert raised.typename == "Failed"

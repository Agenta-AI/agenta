"""Unit test for the out-of-credit classification boundary (run: `pytest
test_out_of_credit_skip.py`, or `uv run --no-sync pytest` from `api/`).

The trap this pins: an exhausted provider key is an ENVIRONMENT condition, and both incident
cells used to render it in the shape their docstrings reserve for a real defect -- C5 as "turn
failed for another reason", check_secrets_teardown as "the journey never ran". That costs a
reviewer's attention on a topped-up balance, and worse, it teaches the reader that these cells'
FAILs are sometimes noise, which is how a genuine regression gets waved through later.

The boundary has to be narrow in BOTH directions, so this tests both:

  a credit or billing signature  -> SKIP "environment: provider key out of credit"
  anything else                  -> the FAIL is kept

In particular a bare 401, a rate limit, and the placeholder refusal the whole C5 cell exists for
must all stay FAIL. Nothing here reaches a network; the cells are driven with stubs.
"""

import importlib
import sys
from pathlib import Path

import pytest

CREDIT_ERRORS = [
    # The runner's own user-facing credits copy, both variants.
    "Your free Agenta credits are used up. Add your own provider key to keep going.",
    "Free Agenta credits are paused right now. Add your own provider key to continue.",
    "Agenta credits are temporarily unavailable. Try again in a moment.",
    # The provider's billing refusal, which the runner classifies as a plain `runner_error`, so
    # the code alone cannot catch it.
    "claude: the model provider account has insufficient credit (check ANTHROPIC_API_KEY).",
    "RateLimitError: You exceeded your current quota, please check your plan and billing",
    "insufficient_quota",
    "your credit balance is too low to access the Anthropic API",
    "no credits remaining on this key",
    # LiteLLM's admission-time refusal.
    "ExceededBudget: Crossed spend within budget_exceeded for key",
]

NON_CREDIT_ERRORS = [
    # A bare auth failure. The key may be perfectly funded and simply wrong.
    "claude: model authentication failed -- add ANTHROPIC_API_KEY to the project vault.",
    "HTTP 401: Unauthorized",
    # Throttling is not a billing stop, and calling it one is the exact confusion errors.ts
    # warns about.
    "Too many requests right now. Try again in a moment.",
    "rate_limit_error: please slow down",
    # The placeholder race. This is the defect C5 exists to catch; it must never become a SKIP.
    "LiteLLM Virtual Key expected. Received=dtn_secret_abc123",  # gitleaks:allow
    "A temporary issue kept this run's credentials from reaching the model. Send the message again.",
    # Ordinary failures.
    "agent run failed",
    "sandbox create timed out after 120s",
    "",
]


def _lib(monkeypatch):
    monkeypatch.setenv("AGENTA_BASE", "http://localhost:9999")
    monkeypatch.setenv("AGENTA_PROJECT_ID", "proj-1")
    monkeypatch.setenv("AGENTA_API_KEY", "test-key")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.modules.pop("qa_matrix_lib", None)
    return importlib.import_module("qa_matrix_lib")


# --------------------------------------------------------------------------- the classifier


@pytest.mark.parametrize("text", CREDIT_ERRORS)
def test_credit_signatures_are_recognized(monkeypatch, text):
    m = _lib(monkeypatch)
    assert m.out_of_credit(text) == "environment: provider key out of credit"


@pytest.mark.parametrize("text", NON_CREDIT_ERRORS)
def test_everything_else_is_not_a_credit_failure(monkeypatch, text):
    m = _lib(monkeypatch)
    assert m.out_of_credit(text) is None


@pytest.mark.parametrize(
    "code", ["starter_credits_exhausted", "starter_credits_program_paused"]
)
def test_starter_credit_codes_are_recognized_without_prose(monkeypatch, code):
    m = _lib(monkeypatch)
    reason = m.out_of_credit("", [code])
    assert reason == f"environment: provider key out of credit ({code})"


def test_an_unrelated_code_is_not_a_credit_failure(monkeypatch):
    m = _lib(monkeypatch)
    assert m.out_of_credit("agent run failed", ["runner_error"]) is None
    assert m.out_of_credit("", ["credential_delivery_failed"]) is None


# --------------------------------------------------------------------------- the cells


class _Turn:
    """The parts of `qa_matrix_lib.Turn` the two cells read."""

    def __init__(self, errors=(), frames=(), reply=""):
        self.errors = list(errors)
        self.raw_frames = list(frames)
        self.frames = [f.get("type", "") for f in self.raw_frames]
        self.reply = reply
        self.tool_calls = []


def _c5(monkeypatch, turn):
    monkeypatch.setenv("AGENTA_BASE", "http://localhost:9999")
    monkeypatch.setenv("AGENTA_PROJECT_ID", "proj-1")
    monkeypatch.setenv("AGENTA_API_KEY", "test-key")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.modules.pop("qa_matrix_lib", None)
    sys.modules.pop("matrix_c5_first_call_race", None)
    mod = importlib.import_module("matrix_c5_first_call_race")
    monkeypatch.setattr(mod, "create_workflow", lambda *a, **k: ("wf-1", "var-1"))
    monkeypatch.setattr(mod, "seed_and_baseline", lambda *a, **k: ("rev-1", 1))
    monkeypatch.setattr(mod, "refs", lambda *a, **k: {})
    monkeypatch.setattr(mod, "archive", lambda *a, **k: None)
    monkeypatch.setattr(mod, "invoke", lambda *a, **k: turn)
    monkeypatch.setattr(mod, "turn_ledger", lambda *a, **k: [{"sandbox_id": "sb-1"}])
    monkeypatch.setattr(
        mod, "count_proxy_placeholder_refusals", lambda *a, **k: (None, "n/a")
    )
    monkeypatch.setattr(mod.time, "sleep", lambda *a: None)
    return mod


def test_c5_skips_an_exhausted_key(monkeypatch):
    turn = _Turn(
        errors=["claude: the model provider account has insufficient credit (check X)."]
    )
    mod = _c5(monkeypatch, turn)
    r = mod.c5_first_call_race()
    assert r["status"] == "SKIP"
    assert "environment: provider key out of credit" in r["why"]


def test_c5_keeps_fail_for_an_unrelated_error(monkeypatch):
    turn = _Turn(errors=["sandbox create timed out after 120s"])
    mod = _c5(monkeypatch, turn)
    r = mod.c5_first_call_race()
    assert r["status"] == "FAIL"


def test_c5_still_fails_the_incident_even_when_the_copy_names_credits(monkeypatch):
    """The incident is more specific than a credits failure and must win.

    Add-a-key copy over a placeholder refusal is the production bug this whole cell exists for.
    The out-of-credit SKIP must not swallow it just because the wording mentions credits.
    """
    turn = _Turn(
        errors=["LiteLLM Virtual Key expected. Received=dtn_secret_abc"],
        frames=[
            {
                "type": "data-agent-error",
                "data": {
                    "code": "starter_credits_exhausted",
                    "errorText": "Your free Agenta credits are used up. Add your own provider key to keep going.",
                },
            }
        ],
    )
    mod = _c5(monkeypatch, turn)
    r = mod.c5_first_call_race()
    assert r["status"] == "FAIL"
    assert "reported as the user's key problem" in r["why"]


def _teardown(monkeypatch, turn):
    monkeypatch.setenv("AGENTA_BASE", "http://localhost:9999")
    monkeypatch.setenv("AGENTA_PROJECT_ID", "proj-1")
    monkeypatch.setenv("AGENTA_API_KEY", "test-key")
    monkeypatch.setenv("DAYTONA_API_KEY", "test-daytona-key")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.modules.pop("qa_matrix_lib", None)
    sys.modules.pop("check_secrets_teardown", None)
    mod = importlib.import_module("check_secrets_teardown")
    monkeypatch.setattr(mod, "list_secret_ids_by_name", lambda *a, **k: {})
    monkeypatch.setattr(mod, "create_workflow", lambda *a, **k: ("wf-1", "var-1"))
    monkeypatch.setattr(mod, "seed_and_baseline", lambda *a, **k: ("rev-1", 1))
    monkeypatch.setattr(mod, "refs", lambda *a, **k: {})
    monkeypatch.setattr(mod, "archive", lambda *a, **k: None)
    monkeypatch.setattr(mod, "invoke", lambda *a, **k: turn)
    return mod


def test_teardown_skips_an_exhausted_key(monkeypatch):
    turn = _Turn(
        errors=["Your free Agenta credits are used up. Add your own provider key."]
    )
    mod = _teardown(monkeypatch, turn)
    with pytest.raises(mod.SkipCheck) as e:
        mod.secrets_teardown(settle_seconds=1)
    assert "environment: provider key out of credit" in str(e.value)


def test_teardown_keeps_fail_for_an_unrelated_error(monkeypatch):
    turn = _Turn(errors=["sandbox create timed out after 120s"])
    mod = _teardown(monkeypatch, turn)
    r = mod.secrets_teardown(settle_seconds=1)
    assert r["status"] == "FAIL"
    assert "the journey never ran" in r["why"]

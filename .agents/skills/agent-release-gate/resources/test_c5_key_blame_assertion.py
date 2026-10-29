"""Unit test for C5's body-independent add-a-key assertion (run: `pytest
test_c5_key_blame_assertion.py`).

The trap this pins: the first version of `matrix_c5_first_call_race.py` only failed when the
refusal BODY echoed the placeholder, so it could not see the path that matters most. Only the
litellm credits proxy echoes ("Received=dtn_****"). `api.anthropic.com` answers an unsubstituted
placeholder with "Invalid bearer token" and echoes nothing; OpenAI's echo is masked past the
literal `dtn_secret_`. On a direct provider the echo test is blind, and F6 shipped a user-blaming
401 straight through the cell that was supposed to catch exactly that.

The assertion therefore keys on what is true regardless of body: this cell's sandbox is
necessarily fresh, so a credential refusal on it must never advise adding a key. The boundary has
to be narrow in both directions, so this tests both — a refusal that is NOT credential-shaped, and
a success, must not be dragged in.

The error bodies are the ones captured live from the real providers during the F6 investigation
(2026-08-31), with a synthetic probe token; no real credential appears here.
"""

import importlib
import sys
from pathlib import Path

import pytest


def _c5(monkeypatch):
    monkeypatch.setenv("AGENTA_BASE", "http://localhost:9999")
    monkeypatch.setenv("AGENTA_PROJECT_ID", "proj-1")
    monkeypatch.setenv("AGENTA_API_KEY", "test-key")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.modules.pop("qa_matrix_lib", None)
    sys.modules.pop("matrix_c5_first_call_race", None)
    return importlib.import_module("matrix_c5_first_call_race")


ANTHROPIC_BLAME = (
    "claude: model authentication failed — add the project's Anthropic key to the "
    "project vault, or log in (OAuth). HTTP 401: Invalid bearer token"
)
OPENAI_BLAME = (
    "codex: model authentication failed — add the project's OpenAI key to the project "
    "vault. HTTP 401: Incorrect API key provided: dtn_secr***************cdef"
)
PROXY_BLAME = (
    "HTTP 401: LiteLLM Virtual Key expected. Received=dtn_****. "
    "Add your own provider key to keep going."
)
HONEST = (
    "A temporary issue kept this run's credentials from reaching the model. "
    "Send the message again."
)


def test_anthropic_direct_blame_fails_without_any_echo(monkeypatch):
    """The F6 case: no placeholder anywhere in the body, and it must still fail."""
    m = _c5(monkeypatch)
    v = m.key_blame_verdict([], ANTHROPIC_BLAME, placeholder_seen=False)
    assert v is not None
    assert v["status"] == "FAIL"
    assert "FRESH Daytona sandbox" in v["why"]


def test_openai_masked_echo_blame_fails(monkeypatch):
    m = _c5(monkeypatch)
    v = m.key_blame_verdict([], OPENAI_BLAME, placeholder_seen=False)
    assert v["status"] == "FAIL"


def test_the_original_echo_case_still_fails_with_its_own_message(monkeypatch):
    """Condition 1 keeps its stronger wording: the refusal itself proved the placeholder went out."""
    m = _c5(monkeypatch)
    v = m.key_blame_verdict([], PROXY_BLAME, placeholder_seen=True)
    assert v["status"] == "FAIL"
    assert "placeholder refusal" in v["why"]


def test_a_starter_credits_code_counts_as_blame(monkeypatch):
    m = _c5(monkeypatch)
    v = m.key_blame_verdict(
        ["starter_credits_exhausted"], "HTTP 401 Unauthorized", placeholder_seen=False
    )
    assert v["status"] == "FAIL"


def test_the_honest_classification_is_not_blame(monkeypatch):
    """With #6408 in, this is the expected outcome and must produce no verdict at all."""
    m = _c5(monkeypatch)
    assert (
        m.key_blame_verdict(
            ["credential_delivery_failed"], HONEST, placeholder_seen=False
        )
        is None
    )


def test_a_non_credential_failure_is_never_dragged_in(monkeypatch):
    """A timeout that happens to mention a key must not trip the assertion."""
    m = _c5(monkeypatch)
    assert (
        m.key_blame_verdict(
            [], "sandbox create timed out after 120s", placeholder_seen=False
        )
        is None
    )
    # Blame wording without a credential refusal: not this assertion's business.
    assert (
        m.key_blame_verdict(
            [], "please add the project's Anthropic key at your convenience", False
        )
        is None
    )


def test_a_clean_run_produces_no_verdict(monkeypatch):
    m = _c5(monkeypatch)
    assert m.key_blame_verdict([], "", placeholder_seen=False) is None


@pytest.mark.parametrize(
    "text",
    [
        "HTTP 401: Invalid bearer token",
        "HTTP 401 Unauthorized",
        "authentication failed",
        "authentication_error",
        "invalid api key",
        "invalid x-api-key",
    ],
)
def test_auth_class_recognizes_every_provider_wording(monkeypatch, text):
    m = _c5(monkeypatch)
    assert m.AUTH_CLASS.search(text), text


def test_auth_class_does_not_match_a_bare_number(monkeypatch):
    # `401` inside a longer number (a timestamp-derived id) is not a status code. The runner's
    # own classifier guards the same way, and a false match here would fail honest runs.
    m = _c5(monkeypatch)
    assert not m.AUTH_CLASS.search("run id 1774014010 finished")


class TestPre6408:
    """Against an older runner the assertion fails by construction; say so, never silently pass."""

    def test_downgrades_the_body_independent_case_to_skip(self, monkeypatch):
        m = _c5(monkeypatch)
        v = m.key_blame_verdict(
            [], ANTHROPIC_BLAME, placeholder_seen=False, pre_6408=True
        )
        assert v["status"] == "SKIP"
        assert "#6408" in v["why"]

    def test_never_softens_the_original_echo_case(self, monkeypatch):
        # Every shipped version has been expected to catch an echoed placeholder. The flag
        # excuses the new assertion only, never the one that already worked.
        m = _c5(monkeypatch)
        v = m.key_blame_verdict([], PROXY_BLAME, placeholder_seen=True, pre_6408=True)
        assert v["status"] == "FAIL"

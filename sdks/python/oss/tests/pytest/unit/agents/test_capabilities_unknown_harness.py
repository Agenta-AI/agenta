"""PY-A6/F3: an unknown harness must get NO capability (closed), not a permissive default."""

from __future__ import annotations

from agenta.sdk.agents.capabilities import (
    harness_allows_deployment,
    harness_allows_mode,
    harness_allows_provider,
)


def test_unknown_harness_denies_provider() -> None:
    assert harness_allows_provider("totally_unknown_harness", "openai") is False


def test_unknown_harness_denies_mode() -> None:
    assert harness_allows_mode("totally_unknown_harness", "agenta") is False


def test_unknown_harness_denies_deployment() -> None:
    assert harness_allows_deployment("totally_unknown_harness", "direct") is False


# TODO(PY-F3): the other half — ensuring vault/secret resolution never runs for a harness that
# fails selector validation — is ordering in services/oss/src/agent/app.py (service side), out
# of this batch's file scope. _check_harness_pre_resolve already runs before resolve_connection
# there; verify with a service-side test when that file is in scope.

"""``select_backend``: the service routes a run to the sandbox-agent runner.

Routing precedence is the agent config's ``uri`` (allowlist-gated) -> ``AGENTA_AGENT_RUNNER_URL``
-> the local runner CLI. A caller-supplied ``uri`` is honored only when its origin is on
``AGENTA_AGENT_RUNNER_URI_ALLOWLIST`` (default empty = feature off, every override rejected). A
disallowed ``uri`` fails loud (no silent fallback). The per-run sandbox selector is gone: the
sidecar is configured local-or-Daytona by its own env, so the backend always carries the constant
``local`` sandbox default.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenta.sdk.agents import (
    AgentConfig,
    AgentRunnerConfigurationError,
    SandboxAgentBackend,
)

from oss.src.agent.app import select_backend
from oss.src.agent.config import UnsupportedRunnerUriError


@pytest.fixture
def runner_wrapper(tmp_path: Path) -> Path:
    cli = tmp_path / "src" / "cli.ts"
    cli.parent.mkdir()
    cli.write_text("console.log('runner')\n", encoding="utf-8")
    return tmp_path


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch, runner_wrapper: Path):
    # Start every case from a known-empty deployment environment (no env URL, empty allowlist).
    monkeypatch.delenv("AGENTA_AGENT_RUNNER_URL", raising=False)
    monkeypatch.delenv("AGENTA_AGENT_RUNNER_URI_ALLOWLIST", raising=False)
    monkeypatch.setenv("AGENTA_AGENT_RUNNER_DIR", str(runner_wrapper))


def _sel(harness="pi_core", uri=None):
    return AgentConfig(harness=harness, uri=uri)


@pytest.mark.parametrize("harness", ["pi_core", "pi_agenta", "claude"])
def test_all_harnesses_use_sandbox_agent_backend(harness):
    assert isinstance(select_backend(_sel(harness)), SandboxAgentBackend)


def test_backend_always_carries_the_constant_local_sandbox():
    # No per-run sandbox selector anymore; the wire sandbox is a constant default.
    assert select_backend(_sel("pi_core"))._sandbox == "local"


def test_runner_url_selects_http_transport(monkeypatch):
    monkeypatch.setenv("AGENTA_AGENT_RUNNER_URL", "http://sandbox-agent:8765")

    backend = select_backend(_sel("pi_core"))

    assert backend._url == "http://sandbox-agent:8765"


def test_no_runner_url_uses_subprocess_transport():
    # Unset URL and unset uri means the backend will spawn the runner CLI from a local checkout.
    assert select_backend(_sel("pi_core"))._url is None


def test_no_runner_url_requires_runner_assets(monkeypatch, tmp_path: Path):
    missing_wrapper = tmp_path / "missing-wrapper"
    missing_wrapper.mkdir()
    monkeypatch.setenv("AGENTA_AGENT_RUNNER_DIR", str(missing_wrapper))

    with pytest.raises(AgentRunnerConfigurationError, match="src/cli.ts"):
        select_backend(_sel("pi_core"))


def test_allowlisted_uri_routes_to_the_override(monkeypatch):
    monkeypatch.setenv(
        "AGENTA_AGENT_RUNNER_URI_ALLOWLIST", "http://trusted-sidecar:8765"
    )

    backend = select_backend(_sel("pi_core", uri="http://trusted-sidecar:8765/run"))

    assert backend._url == "http://trusted-sidecar:8765/run"


def test_allowlisted_uri_beats_the_env_var(monkeypatch):
    monkeypatch.setenv("AGENTA_AGENT_RUNNER_URL", "http://env-sidecar:8765")
    monkeypatch.setenv(
        "AGENTA_AGENT_RUNNER_URI_ALLOWLIST", "http://trusted-sidecar:8765"
    )

    backend = select_backend(_sel("pi_core", uri="http://trusted-sidecar:8765"))

    assert backend._url == "http://trusted-sidecar:8765"


def test_uri_unset_falls_back_to_env_var(monkeypatch):
    monkeypatch.setenv("AGENTA_AGENT_RUNNER_URL", "http://env-sidecar:8765")

    backend = select_backend(_sel("pi_core", uri=None))

    assert backend._url == "http://env-sidecar:8765"


def test_disallowed_uri_raises_no_silent_fallback(monkeypatch):
    # Env var set AND a uri given, but the uri is not allowlisted -> raise, do NOT fall back.
    monkeypatch.setenv("AGENTA_AGENT_RUNNER_URL", "http://env-sidecar:8765")
    monkeypatch.setenv(
        "AGENTA_AGENT_RUNNER_URI_ALLOWLIST", "http://trusted-sidecar:8765"
    )

    with pytest.raises(UnsupportedRunnerUriError):
        select_backend(_sel("pi_core", uri="http://evil.com:8765"))


def test_uri_with_empty_allowlist_is_rejected_feature_off():
    # Default: empty allowlist -> every override rejected (feature ships off).
    with pytest.raises(UnsupportedRunnerUriError):
        select_backend(_sel("pi_core", uri="http://trusted-sidecar:8765"))


def test_origin_match_not_substring(monkeypatch):
    # A trusted substring smuggled in the query/path must not pass an origin check.
    monkeypatch.setenv(
        "AGENTA_AGENT_RUNNER_URI_ALLOWLIST", "http://trusted-sidecar:8765"
    )

    with pytest.raises(UnsupportedRunnerUriError):
        select_backend(
            _sel("pi_core", uri="http://evil.com/?x=http://trusted-sidecar:8765")
        )


def test_non_http_scheme_rejected(monkeypatch):
    monkeypatch.setenv("AGENTA_AGENT_RUNNER_URI_ALLOWLIST", "file:///etc/passwd")

    with pytest.raises(UnsupportedRunnerUriError):
        select_backend(_sel("pi_core", uri="file:///etc/passwd"))

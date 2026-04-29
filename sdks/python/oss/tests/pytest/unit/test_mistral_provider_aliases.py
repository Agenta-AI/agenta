from types import SimpleNamespace

from agenta.sdk.contexts.running import RunningContext
from agenta.sdk.managers.secrets import SecretsManager
from agenta.sdk.workflows.runners.daytona import DaytonaRunner


def test_secrets_manager_accepts_mistralai_secret_for_mistral_model(monkeypatch):
    monkeypatch.setattr(
        SecretsManager,
        "get_from_route",
        staticmethod(
            lambda scope="all": [
                {
                    "kind": "provider_key",
                    "data": {
                        "kind": "mistralai",
                        "provider": {"key": "TEST_KEY"},
                    },
                }
            ]
        ),
    )

    settings = SecretsManager.get_provider_settings("mistral/mistral-small")

    assert settings is not None
    assert settings["model"] == "mistral/mistral-small"
    assert settings["api_key"] == "TEST_KEY"


def test_daytona_runner_exports_canonical_mistral_env_var(monkeypatch):
    monkeypatch.setenv("DAYTONA_API_KEY", "test-daytona-key")
    runner = DaytonaRunner()
    monkeypatch.setattr(
        RunningContext,
        "get",
        staticmethod(
            lambda: SimpleNamespace(
                vault_secrets=[
                    {
                        "kind": "provider_key",
                        "data": {
                            "kind": "mistralai",
                            "provider": {"key": "TEST_KEY"},
                        },
                    }
                ]
            )
        ),
    )

    env_vars = runner._get_provider_env_vars()

    assert env_vars["MISTRAL_API_KEY"] == "TEST_KEY"

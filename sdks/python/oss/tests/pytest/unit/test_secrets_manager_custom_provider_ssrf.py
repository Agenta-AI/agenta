"""SSRF guard on custom_provider.url -> litellm api_base (SecretsManager)."""

from agenta.sdk.managers.secrets import SecretsManager


def _custom_provider_secret(url: str) -> dict:
    return {
        "kind": "custom_provider",
        "data": {
            "kind": "custom",
            "provider_slug": "my-gw",
            "provider": {
                "url": url,
                "version": None,
                "key": None,
                "extras": {},
            },
            "models": ["gpt-4o-mini"],
            "model_keys": ["my-gw/custom/gpt-4o-mini"],
        },
    }


def test_custom_provider_private_url_is_dropped_from_api_base(monkeypatch):
    monkeypatch.setattr(
        SecretsManager,
        "get_from_route",
        staticmethod(
            lambda scope="all": [_custom_provider_secret("http://169.254.169.254/v1")]
        ),
    )

    settings = SecretsManager.get_provider_settings("my-gw/custom/gpt-4o-mini")

    # extras is empty (no "extras" AND "url" pair survives), so no api_base leaks through.
    assert settings is None or "api_base" not in settings


def test_custom_provider_loopback_url_is_dropped_from_api_base(monkeypatch):
    monkeypatch.setattr(
        SecretsManager,
        "get_from_route",
        staticmethod(
            lambda scope="all": [_custom_provider_secret("https://127.0.0.1/v1")]
        ),
    )

    settings = SecretsManager.get_provider_settings("my-gw/custom/gpt-4o-mini")

    assert settings is None or "api_base" not in settings


def test_custom_provider_public_url_passes_through_as_api_base(monkeypatch):
    monkeypatch.setattr(
        SecretsManager,
        "get_from_route",
        staticmethod(
            lambda scope="all": [_custom_provider_secret("https://93.184.216.34/v1")]
        ),
    )

    settings = SecretsManager.get_provider_settings("my-gw/custom/gpt-4o-mini")

    assert settings is not None
    assert settings["api_base"] == "https://93.184.216.34/v1"


def test_custom_provider_ssrf_guard_defaults_secure_with_no_env_var(monkeypatch):
    # net._ALLOW_INSECURE is a module-level constant read at import time; assert the
    # constant itself defaults False rather than relying on env-var presence at test time.
    from agenta.sdk.utils import net

    assert net._ALLOW_INSECURE is False

    monkeypatch.setattr(net, "_ALLOW_INSECURE", False)
    monkeypatch.setattr(
        SecretsManager,
        "get_from_route",
        staticmethod(
            lambda scope="all": [_custom_provider_secret("http://10.0.0.5/v1")]
        ),
    )

    settings = SecretsManager.get_provider_settings("my-gw/custom/gpt-4o-mini")

    assert settings is None or "api_base" not in settings

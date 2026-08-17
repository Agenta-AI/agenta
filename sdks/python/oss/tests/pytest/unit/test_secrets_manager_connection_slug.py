"""Slug-first credential resolution in ``SecretsManager``.

Both context paths (``get_provider_settings`` over ``RoutingContext``, and
``get_provider_settings_from_workflow`` over ``RunningContext``) share one resolver, so every
case here runs against both.

The precedence under test:
  1. an explicit connection slug selects that record outright (standard or custom);
  2. an unknown slug fails loud instead of falling back to another connection's key;
  3. a slug from one provider family cannot run another family's model;
  4. with no slug, a connection whose saved model list names the model wins over a bare
     family match;
  5. with no slug and no saved lists, the first record of the family wins — the behavior that
     predates named connections.
"""

from types import SimpleNamespace

import pytest

from agenta.sdk.engines.running.errors import (
    ConnectionModelMismatchV0Error,
    UnknownConnectionV0Error,
)
from agenta.sdk.managers.secrets import SecretsManager


def _provider_key(*, slug=None, kind="openai", key="sk-x", models=None):
    data = {"kind": kind, "provider": {"key": key}}
    if models is not None:
        data["models"] = [{"slug": model} for model in models]
    return {"kind": "provider_key", "slug": slug, "data": data}


def _custom_provider(*, slug=None, provider_slug="my-gw", kind="custom", url=None):
    return {
        "kind": "custom_provider",
        "slug": slug,
        "data": {
            "kind": kind,
            "provider_slug": provider_slug,
            "provider": {
                "url": url or "https://93.184.216.34/v1",
                "version": None,
                "extras": {"api_key": "sk-gateway"},
            },
            "models": [{"slug": "gpt-4o-mini"}],
            "model_keys": [f"{provider_slug}/{kind}/gpt-4o-mini"],
        },
    }


@pytest.fixture(params=["route", "workflow"])
def resolve(request, monkeypatch):
    """Resolve through one of the two contexts, so every case covers both duplicated paths."""

    def _resolve(secrets, model, connection=None):
        if request.param == "route":
            monkeypatch.setattr(
                SecretsManager,
                "get_from_route",
                staticmethod(lambda scope="all": secrets),
            )
            return SecretsManager.get_provider_settings(model, connection=connection)

        monkeypatch.setattr(
            "agenta.sdk.managers.secrets.RunningContext",
            SimpleNamespace(
                get=lambda: SimpleNamespace(
                    secrets=secrets, vault_secrets=secrets, local_secrets=[]
                )
            ),
        )
        return SecretsManager.get_provider_settings_from_workflow(
            model, connection=connection
        )

    return _resolve


def test_slug_picks_one_of_two_same_family_connections(resolve):
    secrets = [
        _provider_key(slug="openai", key="sk-first"),
        _provider_key(slug="openai-2", key="sk-second"),
    ]

    assert resolve(secrets, "gpt-4o-mini", "openai-2") == {
        "model": "gpt-4o-mini",
        "api_key": "sk-second",
    }
    assert resolve(secrets, "gpt-4o-mini", "openai") == {
        "model": "gpt-4o-mini",
        "api_key": "sk-first",
    }


def test_slug_picks_a_custom_connection_and_rewrites_the_model(resolve):
    secrets = [
        _provider_key(slug="openai", key="sk-first"),
        _custom_provider(slug="my-gw"),
    ]

    settings = resolve(secrets, "my-gw/custom/gpt-4o-mini", "my-gw")

    # A custom provider is an OpenAI-compatible endpoint, so litellm gets `openai/<model>`.
    assert settings["model"] == "openai/gpt-4o-mini"
    assert settings["api_key"] == "sk-gateway"
    assert settings["api_base"] == "https://93.184.216.34/v1"


def test_custom_connection_is_addressable_by_its_name_before_slugs_existed(resolve):
    secrets = [_custom_provider(slug=None, provider_slug="my-gw")]

    settings = resolve(secrets, "my-gw/custom/gpt-4o-mini", "my-gw")

    assert settings["model"] == "openai/gpt-4o-mini"


def test_a_custom_connection_rejects_a_model_from_another_namespace(resolve):
    # What a renamed custom connection leaves behind: the stored model key still names the old
    # provider_slug, so the litellm rewrite would mangle it. Resolve to nothing (the caller
    # raises InvalidSecrets) instead of calling out with a bad model name.
    secrets = [_custom_provider(slug="my-gw", provider_slug="renamed-gw")]

    assert resolve(secrets, "my-gw/custom/gpt-4o-mini", "my-gw") is None


def test_unknown_slug_raises_rather_than_falling_back(resolve):
    secrets = [_provider_key(slug="openai", key="sk-first")]

    with pytest.raises(UnknownConnectionV0Error) as excinfo:
        resolve(secrets, "gpt-4o-mini", "openai-9")

    error = excinfo.value
    # A configuration mistake, not a server fault: it carries a 4xx and no stacktrace.
    assert error.code == 400
    assert error.stacktrace is None
    assert "openai-9" in error.message
    # The message names what IS available, and never a key.
    assert "openai" in error.message
    assert "sk-first" not in error.message


def test_a_slug_cannot_run_another_familys_model(resolve):
    secrets = [
        _provider_key(slug="anthropic", kind="anthropic", key="sk-ant"),
        _provider_key(slug="openai", kind="openai", key="sk-oai"),
    ]

    with pytest.raises(ConnectionModelMismatchV0Error) as excinfo:
        resolve(secrets, "gpt-4o-mini", "anthropic")

    error = excinfo.value
    assert error.code == 400
    assert "anthropic" in error.message and "gpt-4o-mini" in error.message
    assert "sk-ant" not in error.message


def test_a_model_the_catalog_does_not_know_still_resolves(resolve):
    # Manual ids and freshly released models are absent from the catalog; the slug is the
    # user's explicit choice and must keep working for them.
    secrets = [_provider_key(slug="openai", key="sk-oai")]

    assert resolve(secrets, "gpt-9-unreleased", "openai") == {
        "model": "gpt-9-unreleased",
        "api_key": "sk-oai",
    }


def test_saved_model_membership_decides_between_two_connections(resolve):
    secrets = [
        _provider_key(slug="openai", key="sk-general", models=["gpt-4o"]),
        _provider_key(slug="openai-2", key="sk-mini", models=["gpt-4o-mini"]),
    ]

    assert resolve(secrets, "gpt-4o-mini")["api_key"] == "sk-mini"
    assert resolve(secrets, "gpt-4o")["api_key"] == "sk-general"


def test_saved_model_list_beats_a_bare_family_match(resolve):
    secrets = [
        # No saved list: eligible for the family, but not an explicit claim on this model.
        _provider_key(slug="openai", key="sk-default"),
        _provider_key(slug="openai-2", key="sk-explicit", models=["gpt-4o-mini"]),
    ]

    assert resolve(secrets, "gpt-4o-mini")["api_key"] == "sk-explicit"


def test_no_slug_with_one_legacy_record_is_unchanged(resolve):
    secrets = [_provider_key(slug=None, key="sk-legacy")]

    assert resolve(secrets, "gpt-4o-mini") == {
        "model": "gpt-4o-mini",
        "api_key": "sk-legacy",
    }


def test_no_slug_with_two_listless_records_takes_the_first(resolve):
    secrets = [
        _provider_key(slug="openai", key="sk-first"),
        _provider_key(slug="openai-2", key="sk-second"),
    ]

    assert resolve(secrets, "gpt-4o-mini")["api_key"] == "sk-first"


def test_a_legacy_standard_record_is_addressable_by_its_provider_family(resolve):
    secrets = [_provider_key(slug=None, kind="anthropic", key="sk-ant")]

    assert resolve(secrets, "anthropic/claude-haiku-4-5", "anthropic") == {
        "model": "anthropic/claude-haiku-4-5",
        "api_key": "sk-ant",
    }


def test_a_slug_pointing_at_a_keyless_record_resolves_to_nothing(resolve):
    secrets = [{"kind": "provider_key", "slug": "openai", "data": {"kind": "openai"}}]

    assert resolve(secrets, "gpt-4o-mini", "openai") is None


def test_no_secrets_still_resolves_to_nothing(resolve):
    assert resolve([], "gpt-4o-mini") is None
    assert resolve([], "gpt-4o-mini", "openai") is None

"""The model in resolved provider settings reaches litellm with its family prefix.

`provider_settings["model"]` is the string litellm routes on — the handler drops the request's
own model and passes this one — so a bare id like "claude-fable-5" that never picks up its
"anthropic/" prefix is dispatched as if it were an OpenAI model. `SecretsManager` normalizes it
on both resolver paths (an explicit connection slug, and the no-slug provider-family fallback).

The hard rule under test: custom-provider connections are exempt. Their model string is
`provider_slug/kind/model` and `_get_compatible_model` has already rewritten it into the form
litellm wants (`openai/<model>` for OpenAI-compatible gateways, `<kind>/<model>` otherwise).
Prefixing that a second time would corrupt it, so the normalizer is never called for them.
"""

from types import SimpleNamespace

import pytest

import agenta.sdk.managers.secrets as secrets_module
from agenta.sdk.engines.running.errors import ConnectionModelMismatchV0Error
from agenta.sdk.managers.secrets import SecretsManager


def _provider_key(*, slug=None, kind="openai", key="sk-x", models=None):
    data = {"kind": kind, "provider": {"key": key}}
    if models is not None:
        data["models"] = [{"slug": model} for model in models]
    return {"kind": "provider_key", "slug": slug, "data": data}


def _custom_provider(*, slug, kind, models, extras=None, url=None):
    """A custom connection. `models` are bare names; the stored keys are namespaced."""
    provider = {"extras": extras if extras is not None else {"api_key": "sk-gateway"}}
    if url is not None:
        provider["url"] = url
        provider["version"] = None
    return {
        "kind": "custom_provider",
        "slug": slug,
        "data": {
            "kind": kind,
            "provider_slug": slug,
            "provider": provider,
            "models": [{"slug": model} for model in models],
            "model_keys": [f"{slug}/{kind}/{model}" for model in models],
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


# ----------------------------------------------------------------------------------
# Standard connections, resolved by slug
# ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "kind, model, expected",
    [
        # A bare id picks up the prefix of the connection it was addressed to.
        ("anthropic", "claude-fable-5", "anthropic/claude-fable-5"),
        ("gemini", "gemini-2.5-flash", "gemini/gemini-2.5-flash"),
        ("perplexityai", "sonar-pro", "perplexity/sonar-pro"),
        ("minimax", "MiniMax-M3", "minimax/MiniMax-M3"),
        # The record kind is the Secrets API spelling; the alias still resolves the family.
        ("mistralai", "mistral-small", "mistral/mistral-small"),
        # Already prefixed: unchanged.
        ("anthropic", "anthropic/claude-haiku-4-5", "anthropic/claude-haiku-4-5"),
        ("mistral", "mistral/mistral-small", "mistral/mistral-small"),
        # OpenAI ids stay bare — the handler's responses bridge keys off having no "/".
        ("openai", "gpt-4o-mini", "gpt-4o-mini"),
        ("openai", "gpt-9-unreleased", "gpt-9-unreleased"),
        # A stored kind litellm has no provider for: the resolver leaves the model alone rather
        # than inventing a prefix that would not route it either.
        ("alephalpha", "luminous-base", "luminous-base"),
        # OpenRouter ids are `vendor/model`, which is not "already prefixed".
        (
            "openrouter",
            "deepseek/deepseek-v4-flash",
            "openrouter/deepseek/deepseek-v4-flash",
        ),
        (
            "openrouter",
            "openrouter/deepseek/deepseek-v4-flash",
            "openrouter/deepseek/deepseek-v4-flash",
        ),
    ],
)
def test_slug_path_normalizes_the_model(resolve, kind, model, expected):
    secrets = [_provider_key(slug="conn", kind=kind, key="sk-conn")]

    assert resolve(secrets, model, "conn") == {"model": expected, "api_key": "sk-conn"}


def test_slug_path_checks_the_family_before_normalizing(resolve):
    """Order matters: the mismatch check reads the model as the caller sent it.

    Normalizing first would turn "gpt-4o-mini" into "anthropic/gpt-4o-mini" on an Anthropic
    connection, which the catalog cannot place — the check would pass and litellm would be
    handed an OpenAI model with an Anthropic key.
    """
    secrets = [_provider_key(slug="ant", kind="anthropic", key="sk-ant")]

    with pytest.raises(ConnectionModelMismatchV0Error):
        resolve(secrets, "gpt-4o-mini", "ant")


def test_slug_path_leaves_a_keyless_record_resolving_to_nothing(resolve):
    secrets = [{"kind": "provider_key", "slug": "ant", "data": {"kind": "anthropic"}}]

    assert resolve(secrets, "claude-fable-5", "ant") is None


# ----------------------------------------------------------------------------------
# Standard connections, resolved by provider family (no slug)
# ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "kind, model",
    [
        ("anthropic", "anthropic/claude-haiku-4-5"),
        ("mistralai", "mistral/mistral-small"),
        ("perplexityai", "perplexity/sonar"),
        ("openrouter", "openrouter/z-ai/glm-5"),
        ("minimax", "minimax/MiniMax-M3"),
        # Bare by design, and it stays bare.
        ("openai", "gpt-4o-mini"),
    ],
)
def test_family_path_leaves_a_catalog_id_alone(resolve, kind, model):
    """Every shipped catalog id is already correct, so the safety net must be a no-op."""
    secrets = [_provider_key(slug=None, kind=kind, key="sk-family")]

    assert resolve(secrets, model) == {"model": model, "api_key": "sk-family"}


def test_family_path_prefixes_a_bare_id_when_the_family_is_known(resolve, monkeypatch):
    """The family fallback runs the same normalizer as the slug path.

    Today every non-OpenAI catalog id ships pre-prefixed, so this stands in a bare id for one
    of them: the family fallback learns the family from the catalog, and whatever the catalog
    hands back has to come out prefixed.
    """
    monkeypatch.setitem(
        secrets_module._standard_providers,
        "claude-fable-5",
        "anthropic",
    )
    secrets = [_provider_key(slug=None, kind="anthropic", key="sk-ant")]

    assert resolve(secrets, "claude-fable-5") == {
        "model": "anthropic/claude-fable-5",
        "api_key": "sk-ant",
    }


def test_a_saved_list_claims_its_model_across_the_two_spellings(resolve):
    """The tiebreak has to survive the two halves spelling a model differently.

    A connection's saved list stores the provider's spelling ("claude-haiku-4-5"); the config
    stores litellm's ("anthropic/claude-haiku-4-5"). Compared raw these never match, so the
    connection that explicitly claims the model loses to whichever record happens to be first —
    the wrong API key, and no error to show for it.
    """
    secrets = [
        _provider_key(
            slug="ant", kind="anthropic", key="sk-first", models=["claude-opus-4-5"]
        ),
        _provider_key(
            slug="ant-2",
            kind="anthropic",
            key="sk-claimed",
            models=["claude-haiku-4-5"],
        ),
    ]

    assert resolve(secrets, "anthropic/claude-haiku-4-5")["api_key"] == "sk-claimed"


def test_a_saved_list_already_in_litellm_spelling_still_claims_its_model(resolve):
    """Records written by anything that stores the litellm spelling keep working."""
    secrets = [
        _provider_key(
            slug="ant", kind="anthropic", key="sk-first", models=["claude-opus-4-5"]
        ),
        _provider_key(
            slug="ant-2",
            kind="anthropic",
            key="sk-claimed",
            models=["anthropic/claude-haiku-4-5"],
        ),
    ]

    assert resolve(secrets, "anthropic/claude-haiku-4-5")["api_key"] == "sk-claimed"


def test_a_saved_list_that_claims_nothing_still_falls_back_to_the_first_record(resolve):
    """Normalizing the comparison may only ADD matches, never move an unclaimed model."""
    secrets = [
        _provider_key(
            slug="ant", kind="anthropic", key="sk-first", models=["claude-opus-4-5"]
        ),
        _provider_key(
            slug="ant-2",
            kind="anthropic",
            key="sk-second",
            models=["claude-sonnet-4-5"],
        ),
    ]

    assert resolve(secrets, "anthropic/claude-haiku-4-5")["api_key"] == "sk-first"


def test_family_path_still_ignores_a_model_no_family_claims(resolve):
    secrets = [_provider_key(slug=None, kind="anthropic", key="sk-ant")]

    assert resolve(secrets, "claude-fable-5") is None


# ----------------------------------------------------------------------------------
# Custom connections: exempt, on both paths
# ----------------------------------------------------------------------------------


CUSTOM_GATEWAY = _custom_provider(
    slug="mygw",
    kind="custom",
    models=["llama3"],
    extras={"api_key": "sk-gateway"},
    url="https://93.184.216.34/v1",
)

CUSTOM_BEDROCK = _custom_provider(
    slug="mybedrock",
    kind="bedrock",
    models=["anthropic.claude-3-sonnet"],
    extras={
        "aws_access_key_id": "AKIAEXAMPLE",
        "aws_secret_access_key": "secret",
        "aws_region_name": "us-east-1",
    },
)

CUSTOM_VERTEX = _custom_provider(
    slug="myvertex",
    kind="vertex_ai",
    models=["gemini-2.5-pro"],
    extras={"vertex_project": "proj", "vertex_location": "us-central1"},
)

# The collision case: a custom connection whose kind is also a standard family, and one of the
# two families whose kind and litellm prefix are spelled differently. `_get_compatible_model`
# leaves `perplexityai/sonar`; normalizing that would produce "perplexity/perplexityai/sonar".
CUSTOM_PERPLEXITY = _custom_provider(
    slug="mypx",
    kind="perplexityai",
    models=["sonar"],
    extras={"api_key": "sk-px"},
)


@pytest.mark.parametrize(
    "secret, model, expected",
    [
        # An OpenAI-compatible gateway: `slug/custom/model` becomes `openai/model`.
        (CUSTOM_GATEWAY, "mygw/custom/llama3", "openai/llama3"),
        # Everything else keeps its kind as the litellm prefix, with the slug stripped.
        (
            CUSTOM_BEDROCK,
            "mybedrock/bedrock/anthropic.claude-3-sonnet",
            "bedrock/anthropic.claude-3-sonnet",
        ),
        (
            CUSTOM_VERTEX,
            "myvertex/vertex_ai/gemini-2.5-pro",
            "vertex_ai/gemini-2.5-pro",
        ),
        (CUSTOM_PERPLEXITY, "mypx/perplexityai/sonar", "perplexityai/sonar"),
    ],
)
def test_custom_connection_by_slug_is_not_prefixed(resolve, secret, model, expected):
    settings = resolve([secret], model, secret["slug"])

    assert settings["model"] == expected


@pytest.mark.parametrize(
    "secret, model, expected",
    [
        (CUSTOM_GATEWAY, "mygw/custom/llama3", "openai/llama3"),
        (
            CUSTOM_BEDROCK,
            "mybedrock/bedrock/anthropic.claude-3-sonnet",
            "bedrock/anthropic.claude-3-sonnet",
        ),
        (
            CUSTOM_VERTEX,
            "myvertex/vertex_ai/gemini-2.5-pro",
            "vertex_ai/gemini-2.5-pro",
        ),
        (CUSTOM_PERPLEXITY, "mypx/perplexityai/sonar", "perplexityai/sonar"),
    ],
)
def test_custom_connection_by_family_is_not_prefixed(resolve, secret, model, expected):
    settings = resolve([secret], model)

    assert settings["model"] == expected


def test_custom_connection_keeps_its_credentials_alongside_the_model(resolve):
    settings = resolve([CUSTOM_GATEWAY], "mygw/custom/llama3", "mygw")

    assert settings["model"] == "openai/llama3"
    assert settings["api_key"] == "sk-gateway"
    assert settings["api_base"] == "https://93.184.216.34/v1"


def test_custom_connection_is_exempt_even_if_the_catalog_knows_its_rewritten_id(
    resolve, monkeypatch
):
    """The exemption is structural, not a lucky catalog miss.

    The normalizer is catalog-first, so a rewritten custom model string that happened to be a
    catalog key would be prefixed a second time — "mistral/openai/mistral-small" — if the
    custom branch called it at all. It does not, so the rewrite stands.
    """
    monkeypatch.setitem(
        secrets_module._standard_providers,
        "openai/mistral-small",
        "mistral",
    )
    secret = _custom_provider(
        slug="mygw",
        kind="custom",
        models=["mistral-small"],
        extras={"api_key": "sk-gateway"},
    )

    assert resolve([secret], "mygw/custom/mistral-small", "mygw")["model"] == (
        "openai/mistral-small"
    )
    assert resolve([secret], "mygw/custom/mistral-small")["model"] == (
        "openai/mistral-small"
    )


def test_a_custom_and_a_standard_connection_coexist(resolve):
    """Mixed vaults are the normal case; each record resolves by its own rule."""
    secrets = [
        _provider_key(slug="ant", kind="anthropic", key="sk-ant"),
        CUSTOM_GATEWAY,
    ]

    assert (
        resolve(secrets, "claude-fable-5", "ant")["model"] == "anthropic/claude-fable-5"
    )
    assert resolve(secrets, "mygw/custom/llama3", "mygw")["model"] == "openai/llama3"

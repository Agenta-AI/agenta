"""A request runs on the project's own provider credentials.

Two rules, both about where a provider key may come from:

- The provider keys in the services environment (`OPENAI_API_KEY`, ...) serve requests only
  where `AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED` allows it. The OSS edition allows it by
  default and the EE edition does not. Once held, they never stay in the process environment,
  where litellm and the OpenAI client would pick them up for a call that carries no key.
- A model of a custom connection takes its key and its endpoint from that connection alone. A
  key saved for a provider's own endpoint is never paired with a custom connection's URL, and a
  custom connection that needs a key and has none is refused before any call.
"""

import pytest

from agenta.sdk.engines.running.errors import InvalidConfigurationParameterV0Error
from agenta.sdk.managers.secrets import SecretsManager
from agenta.sdk.middlewares.running import vault
from agenta.sdk.redaction import strip_echoed_key_fragments


ENV_KEY = "sk-env-platform-0000"
TENANT_URL = "https://93.184.216.34/v1"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv("AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED", raising=False)
    monkeypatch.delenv("AGENTA_LICENSE", raising=False)
    for name in vault.env_provider_key_names():
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(vault, "_held_env_provider_keys", None)
    vault.invalidate_secrets_cache(None)
    yield
    vault.invalidate_secrets_cache(None)


class _Response:
    status_code = 200

    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


@pytest.fixture
def fetch(monkeypatch):
    """Run `get_secrets` against a canned `/secrets/` payload."""

    async def _fetch(vault_payload):
        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return False

            async def get(self, *_args, **_kwargs):
                return _Response(vault_payload)

        monkeypatch.setattr(vault.httpx, "AsyncClient", _Client)
        vault.invalidate_secrets_cache(None)
        return await vault.get_secrets("http://api", None)

    return _fetch


# --- env provider keys --------------------------------------------------------------------


@pytest.mark.parametrize(
    "license_, flag, expected",
    [
        (None, None, True),
        ("oss", None, True),
        ("ee", None, False),
        ("ee", "true", True),
        ("oss", "false", False),
        (None, "off", False),
    ],
)
def test_env_provider_keys_default_by_edition(monkeypatch, license_, flag, expected):
    if license_:
        monkeypatch.setenv("AGENTA_LICENSE", license_)
    if flag:
        monkeypatch.setenv("AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED", flag)

    assert vault.env_provider_keys_enabled() is expected


async def test_ee_does_not_use_env_keys(monkeypatch, fetch):
    monkeypatch.setenv("AGENTA_LICENSE", "ee")
    monkeypatch.setenv("OPENAI_API_KEY", ENV_KEY)

    secrets, vault_secrets, local_secrets = await fetch([])

    assert secrets == []
    assert vault_secrets == []
    assert local_secrets == []


async def test_oss_still_uses_env_keys(monkeypatch, fetch):
    monkeypatch.setenv("OPENAI_API_KEY", ENV_KEY)

    secrets, _, local_secrets = await fetch([])

    assert [s["data"]["provider"]["key"] for s in local_secrets] == [ENV_KEY]
    assert [s["data"]["provider"]["key"] for s in secrets] == [ENV_KEY]


async def test_held_keys_leave_the_environment_and_still_serve_when_allowed(
    monkeypatch, fetch
):
    monkeypatch.setenv("OPENAI_API_KEY", ENV_KEY)

    assert vault.hold_env_provider_keys() == ["OPENAI_API_KEY"]
    assert "OPENAI_API_KEY" not in vault.environ

    _, _, local_secrets = await fetch([])

    assert [s["data"]["provider"]["key"] for s in local_secrets] == [ENV_KEY]


def test_every_deployed_provider_key_is_held():
    # The `llm.*` keys the Helm chart and the compose env files can set on the services pod.
    deployed = {
        f"{name}_API_KEY"
        for name in (
            "ALEPHALPHA ANTHROPIC ANYSCALE COHERE DEEPINFRA GEMINI GROQ MINIMAX MISTRAL "
            "OPENAI OPENROUTER PERPLEXITYAI TOGETHERAI XAI"
        ).split()
    }

    assert deployed <= set(vault.env_provider_key_names())
    # Not deployed by the chart, but litellm and the OpenAI client read them from the
    # environment for Azure, Vertex and Bedrock calls.
    assert {
        "AZURE_API_KEY",
        "AZURE_OPENAI_API_KEY",
        "AZURE_AD_TOKEN",
        "AZURE_OPENAI_AD_TOKEN",
        "VERTEXAI_CREDENTIALS",
        "VERTEX_CREDENTIALS",
        "AWS_BEARER_TOKEN_BEDROCK",
        "BEDROCK_MANTLE_API_KEY",
    } <= set(vault.env_provider_key_names())


async def test_held_keys_do_not_serve_when_not_allowed(monkeypatch, fetch):
    monkeypatch.setenv("AGENTA_LICENSE", "ee")
    monkeypatch.setenv("OPENAI_API_KEY", ENV_KEY)

    vault.hold_env_provider_keys()

    assert "OPENAI_API_KEY" not in vault.environ
    secrets, _, local_secrets = await fetch([])
    assert secrets == []
    assert local_secrets == []


# --- custom connections never borrow a standard key ----------------------------------------


def _local_openai() -> dict:
    # The shape `get_secrets` builds for an env-var key: no slug, no models.
    return {
        "kind": "provider_key",
        "data": {"kind": "openai", "provider": {"key": ENV_KEY}},
    }


def _vault_openai(key: str) -> dict:
    return {
        "kind": "provider_key",
        "slug": "openai",
        "data": {"kind": "openai", "provider": {"key": key}},
    }


def _custom_openai(extras: dict) -> dict:
    return {
        "kind": "custom_provider",
        "slug": "my-gw",
        "data": {
            "kind": "openai",
            "provider_slug": "my-gw",
            "provider": {"url": TENANT_URL, "version": None, "extras": extras},
            "model_keys": ["my-gw/openai/gpt-4o"],
        },
    }


def _settings(monkeypatch, secrets, model):
    monkeypatch.setattr(
        SecretsManager, "get_from_route", staticmethod(lambda scope="all": secrets)
    )
    return SecretsManager.get_provider_settings(model)


def test_custom_connection_without_a_key_gets_no_standard_key(monkeypatch):
    with pytest.raises(InvalidConfigurationParameterV0Error) as error:
        _settings(
            monkeypatch, [_local_openai(), _custom_openai({})], "my-gw/openai/gpt-4o"
        )

    assert ENV_KEY not in error.value.message


def test_custom_connection_without_a_key_ignores_a_stored_standard_key(monkeypatch):
    with pytest.raises(InvalidConfigurationParameterV0Error) as error:
        _settings(
            monkeypatch,
            [_vault_openai("sk-project-openai"), _custom_openai({})],
            "my-gw/openai/gpt-4o",
        )

    assert "sk-project-openai" not in error.value.message


def test_custom_connection_uses_its_own_key(monkeypatch):
    settings = _settings(
        monkeypatch,
        [_local_openai(), _custom_openai({"api_key": "sk-gateway"})],
        "my-gw/openai/gpt-4o",
    )

    assert settings == {
        "model": "openai/gpt-4o",
        "api_key": "sk-gateway",
        "api_base": TENANT_URL,
        "api_version": None,
    }


def test_standard_model_never_takes_a_custom_endpoint(monkeypatch):
    settings = _settings(
        monkeypatch,
        [_vault_openai("sk-project-openai"), _custom_openai({"api_key": "sk-gateway"})],
        "gpt-4o",
    )

    assert settings == {"model": "gpt-4o", "api_key": "sk-project-openai"}


# --- provider error echoes ----------------------------------------------------------------


@pytest.mark.parametrize(
    "message",
    [
        "litellm.AuthenticationError: OpenAIException - Incorrect API key provided: "
        "sk-DaqwP***...qajU. You can find your API key at https://platform.openai.com.",
        "Error code: 401 - {'error': {'message': 'Incorrect API key provided: "
        "sk-proj-****************abcd', 'type': 'invalid_request_error'}}",
    ],
)
def test_echoed_key_fragments_are_removed(message):
    out = strip_echoed_key_fragments(message)

    assert "qajU" not in out
    assert "abcd" not in out
    assert "sk-" not in out
    assert "Incorrect API key provided: [ag:redacted]" in out


def test_messages_without_a_key_are_unchanged():
    message = "No API key found for model 'gpt-4o'. Please add your provider's API key."

    assert strip_echoed_key_fragments(message) == message
    assert strip_echoed_key_fragments(None) is None


async def test_invoke_failure_does_not_echo_a_key_fragment():
    from agenta.sdk.decorators.routing import handle_invoke_failure

    class _ProviderAuthError(Exception):
        status_code = 401

    response = await handle_invoke_failure(
        _ProviderAuthError("Incorrect API key provided: sk-DaqwP***...qajU.")
    )

    assert response.status_code == 424
    assert b"qajU" not in response.body
    assert b"[ag:redacted]" in response.body


async def test_returned_stacktrace_does_not_echo_a_key_fragment(monkeypatch):
    from agenta.sdk.decorators.routing import handle_invoke_failure

    monkeypatch.setenv("AGENTA_SDK_ERRORS_INCLUDE_STACKTRACE", "true")

    class _ProviderAuthError(Exception):
        status_code = 401

    try:
        raise _ProviderAuthError("Incorrect API key provided: sk-abc***wxyz.")
    except _ProviderAuthError as error:
        response = await handle_invoke_failure(error)

    assert b"stacktrace" in response.body
    assert b"wxyz" not in response.body


async def test_azure_call_never_sends_a_deployment_ad_token(monkeypatch):
    """The Azure client prefers an AD token from the environment over the call's own key."""
    import httpx
    from openai import AsyncAzureOpenAI

    monkeypatch.setenv("AZURE_OPENAI_AD_TOKEN", "deployment-token-fixture")
    vault.hold_env_provider_keys()

    sent = []

    def _handler(request):
        sent.append(
            request.headers.get("authorization") or request.headers.get("api-key")
        )
        return httpx.Response(
            200,
            json={
                "id": "x",
                "object": "chat.completion",
                "created": 0,
                "model": "gpt-4o",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "stop",
                        "message": {"role": "assistant", "content": "ok"},
                    }
                ],
            },
        )

    client = AsyncAzureOpenAI(
        api_key="tenant-azure-key",
        api_version="2024-06-01",
        azure_endpoint="https://tenant.example.com",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(_handler)),
    )
    await client.chat.completions.create(
        model="gpt-4o", messages=[{"role": "user", "content": "hi"}]
    )

    assert sent == ["tenant-azure-key"]

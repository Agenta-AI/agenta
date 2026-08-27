from uuid import uuid4

import pytest
from pydantic import ValidationError

from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    CustomProviderDTO,
    CustomSecretDTO,
    OAuthGrantDTO,
    OAuthProviderDTO,
    SecretResponseDTO,
    StandardProviderDTO,
    UpdateSecretDTO,
)
from oss.src.core.secrets.enums import (
    LLMProviderKind,
    LLMStandardProviderKind,
    MCPProviderKind,
    MCPStandardProviderKind,
    SecretKind,
    StandardProviderKind,
)


def test_provider_categories_keep_llm_and_mcp_catalogues_separate():
    assert {kind.value for kind in LLMProviderKind} == {"builtin", "standard", "custom"}
    assert {kind.value for kind in MCPProviderKind} == {"builtin", "standard", "custom"}
    assert MCPStandardProviderKind.COMPOSIO.value not in {
        kind.value for kind in LLMStandardProviderKind
    }


def test_create_secret_normalizes_mistralai_standard_provider_payload():
    payload = {
        "header": {"name": "Mistral AI", "description": ""},
        "secret": {
            "kind": "provider_key",
            "data": {
                "kind": "mistralai",
                "provider": {
                    "key": "TEST_KEY",
                },
            },
        },
    }

    secret = CreateSecretDTO.model_validate(payload)

    assert secret.secret.data.kind == "mistral"
    assert secret.secret.data.provider.key == "TEST_KEY"


def test_update_secret_normalizes_mistralai_standard_provider_payload():
    payload = {
        "secret": {
            "kind": "provider_key",
            "data": {
                "kind": "mistralai",
                "provider": {
                    "key": "TEST_KEY",
                },
            },
        },
    }

    secret = UpdateSecretDTO.model_validate(payload)

    assert secret.secret.data.kind == "mistral"
    assert secret.secret.data.provider.key == "TEST_KEY"


def test_create_secret_rejects_missing_standard_provider_kind():
    payload = {
        "header": {"name": "Mistral AI", "description": ""},
        "secret": {
            "kind": "provider_key",
            "data": {
                "provider": {
                    "key": "TEST_KEY",
                },
            },
        },
    }

    with pytest.raises(ValidationError, match="LLM or MCP provider key"):
        CreateSecretDTO.model_validate(payload)


def _custom_secret_payload(content, fmt):
    return {
        "header": {"name": "GITHUB_TOKEN", "description": ""},
        "secret": {
            "kind": "custom_secret",
            "data": {"secret": {"format": fmt, "content": content}},
        },
    }


def test_create_text_custom_secret():
    secret = CreateSecretDTO.model_validate(
        _custom_secret_payload("ghp_abc123", "text")
    )

    assert isinstance(secret.secret.data, CustomSecretDTO)
    assert secret.secret.data.secret.content == "ghp_abc123"


def test_text_custom_secret_stored_verbatim_not_reserialized():
    # A JSON-looking string handed to a text secret is kept as-is.
    raw = '{"a": 1}'
    secret = CreateSecretDTO.model_validate(_custom_secret_payload(raw, "text"))

    assert secret.secret.data.secret.content == raw


def test_create_json_custom_secret_flat():
    content = {"A": "1", "B": 2, "C": True, "D": None}
    secret = CreateSecretDTO.model_validate(_custom_secret_payload(content, "json"))

    assert isinstance(secret.secret.data, CustomSecretDTO)
    assert secret.secret.data.secret.content == content


def test_json_custom_secret_rejects_nested_object():
    with pytest.raises(ValidationError, match="flat"):
        CreateSecretDTO.model_validate(_custom_secret_payload({"A": {"x": 1}}, "json"))


def test_json_custom_secret_rejects_array_value():
    with pytest.raises(ValidationError, match="flat"):
        CreateSecretDTO.model_validate(_custom_secret_payload({"A": [1, 2]}, "json"))


def test_text_custom_secret_rejects_non_string_content():
    with pytest.raises(ValidationError, match="string content"):
        CreateSecretDTO.model_validate(_custom_secret_payload({"a": 1}, "text"))


def test_custom_secret_rejects_unknown_format():
    with pytest.raises(ValidationError, match="'text' or 'json'"):
        CreateSecretDTO.model_validate(_custom_secret_payload("x", "yaml"))


def test_custom_secret_rejects_missing_content():
    payload = {
        "header": {"name": "GITHUB_TOKEN", "description": ""},
        "secret": {
            "kind": "custom_secret",
            "data": {"secret": {"format": "text"}},
        },
    }
    with pytest.raises(ValidationError, match="format, content"):
        CreateSecretDTO.model_validate(payload)


def _custom_provider_payload(url):
    return {
        "header": {"name": "my-gw", "description": ""},
        "secret": {
            "kind": "custom_provider",
            "data": {
                "kind": "custom",
                "provider": {"url": url, "key": "sk-gw"},
                "models": [{"slug": "gpt-4o-mini"}],
            },
        },
    }


@pytest.mark.parametrize(
    "url",
    [
        "http://169.254.169.254/v1",
        "https://127.0.0.1/v1",
        "https://10.0.0.5/v1",
        "https://192.168.1.1/v1",
        "https://localhost/v1",
        "ftp://93.184.216.34/v1",
    ],
)
def test_create_secret_rejects_ssrf_custom_provider_url(url):
    with pytest.raises(ValidationError, match="custom_provider.url is invalid"):
        CreateSecretDTO.model_validate(_custom_provider_payload(url))


def test_create_secret_accepts_public_custom_provider_url():
    secret = CreateSecretDTO.model_validate(
        _custom_provider_payload("https://93.184.216.34/v1")
    )
    assert secret.secret.data.provider.url == "https://93.184.216.34/v1"


def test_create_secret_allows_missing_custom_provider_url():
    payload = _custom_provider_payload(None)
    secret = CreateSecretDTO.model_validate(payload)
    assert secret.secret.data.provider.url is None


def test_update_secret_rejects_ssrf_custom_provider_url():
    payload = {
        "secret": {
            "kind": "custom_provider",
            "data": {
                "kind": "custom",
                "provider": {"url": "http://10.0.0.5/v1", "key": "sk-gw"},
                "models": [{"slug": "gpt-4o-mini"}],
            },
        },
    }
    with pytest.raises(ValidationError, match="custom_provider.url is invalid"):
        UpdateSecretDTO.model_validate(payload)


def _standard_provider_payload(**data):
    return {
        "header": {"name": "OpenAI", "description": ""},
        "secret": {
            "kind": "provider_key",
            "data": {"kind": "openai", "provider": {"key": "sk-openai"}, **data},
        },
    }


def test_standard_provider_round_trips_models_and_harnesses():
    secret = CreateSecretDTO.model_validate(
        _standard_provider_payload(
            models=[{"slug": "gpt-5.6-luna"}, {"slug": "gpt-5.6-sol"}],
            harnesses=["pi_core", "codex"],
        )
    )

    data = secret.secret.data
    assert [model.slug for model in data.models] == ["gpt-5.6-luna", "gpt-5.6-sol"]
    assert data.harnesses == ["pi_core", "codex"]


def test_standard_provider_without_the_new_fields_defaults_to_none():
    secret = CreateSecretDTO.model_validate(_standard_provider_payload())

    data = secret.secret.data
    assert data.models is None
    assert data.harnesses is None
    # An old record stores neither field, so the resolver still reads its defaults.
    assert data.model_dump(exclude_none=True) == {
        "kind": StandardProviderKind.OPENAI,
        "provider": {"key": "sk-openai"},
    }


def test_standard_provider_keeps_an_empty_model_list_distinct_from_a_missing_one():
    secret = CreateSecretDTO.model_validate(_standard_provider_payload(models=[]))

    assert secret.secret.data.models == []
    assert "models" in secret.secret.data.model_dump(exclude_none=True)


def test_custom_provider_round_trips_harnesses():
    payload = _custom_provider_payload("https://93.184.216.34/v1")
    payload["secret"]["data"]["harnesses"] = ["claude"]

    secret = CreateSecretDTO.model_validate(payload)

    assert secret.secret.data.harnesses == ["claude"]


def test_custom_provider_without_harnesses_defaults_to_none():
    secret = CreateSecretDTO.model_validate(
        _custom_provider_payload("https://93.184.216.34/v1")
    )

    assert secret.secret.data.harnesses is None


def test_secret_kind_decides_the_data_shape_when_both_would_validate():
    # A key-only custom provider matches the standard shape field for field; the kind is what
    # keeps `provider_slug` and per-model extras from being dropped.
    secret = CreateSecretDTO.model_validate(
        {
            "header": {"name": "my-gw", "description": ""},
            "secret": {
                "kind": "custom_provider",
                "data": {
                    "kind": "openai",
                    "provider": {"key": "sk-gw"},
                    "models": [{"slug": "gpt-4o-mini", "extras": {"ctx": "8k"}}],
                },
            },
        }
    )

    assert isinstance(secret.secret.data, CustomProviderDTO)
    assert secret.secret.data.models[0].extras == {"ctx": "8k"}
    assert secret.secret.data.provider_slug == "my-gw"


def test_response_round_trips_a_standard_connection_through_read():
    response = SecretResponseDTO.model_validate(
        {
            "id": uuid4(),
            "slug": "openai-2-abcdef123456",
            "kind": "provider_key",
            "header": {"name": "OpenAI 2"},
            "data": {
                "kind": "openai",
                "provider": {"key": "sk-openai"},
                "models": [{"slug": "gpt-5.6-luna"}],
                "harnesses": ["pi_core"],
            },
        }
    )

    assert isinstance(response.data, StandardProviderDTO)
    assert response.slug == "openai-2-abcdef123456"
    assert [model.slug for model in response.data.models] == ["gpt-5.6-luna"]
    assert response.data.harnesses == ["pi_core"]


def _payload_without_a_header(kind):
    payloads = {
        "custom_provider": _custom_provider_payload("https://93.184.216.34/v1"),
        "custom_secret": {
            "header": {},
            "secret": {
                "kind": "custom_secret",
                "data": {"secret": {"format": "text", "content": "s3cret"}},
            },
        },
        "sso_provider": {
            "header": {},
            "secret": {
                "kind": "sso_provider",
                "data": {
                    "provider": {
                        "client_id": "id",
                        "client_secret": "secret",
                        "issuer_url": "https://issuer.example",
                        "scopes": ["openid"],
                    }
                },
            },
        },
        "webhook_provider": {
            "header": {},
            "secret": {
                "kind": "webhook_provider",
                "data": {"provider": {"key": "whsec"}},
            },
        },
        "oauth_provider": {
            "header": {},
            "secret": {
                "kind": "oauth_provider",
                "data": {
                    "provider": {
                        "client_id": "id",
                        "client_secret": "secret",
                        "issuer_url": "https://issuer.example",
                        "scopes": ["openid"],
                    }
                },
            },
        },
        "oauth_grant": {
            "header": {},
            "secret": {
                "kind": "oauth_grant",
                "data": {
                    "grant": {
                        "server": "https://issuer.example",
                        "access_token": "at-123",
                        "scopes": ["openid"],
                    }
                },
            },
        },
    }
    payload = payloads[kind]
    payload["header"] = {}
    return payload


@pytest.mark.parametrize(
    "kind",
    [
        "custom_provider",
        "custom_secret",
        "sso_provider",
        "webhook_provider",
        "oauth_provider",
        "oauth_grant",
    ],
)
def test_create_secret_rejects_an_empty_header(kind):
    with pytest.raises(ValidationError, match="Header cannot be empty"):
        CreateSecretDTO.model_validate(_payload_without_a_header(kind))


def test_create_secret_allows_an_empty_header_for_a_provider_key():
    # The one kind that may arrive unnamed: the service names it after its provider on create.
    secret = CreateSecretDTO.model_validate(
        {
            "header": {},
            "secret": {
                "kind": "provider_key",
                "data": {"kind": "openai", "provider": {"key": "sk-openai"}},
            },
        }
    )

    assert secret.header.name is None


def _oauth_provider_payload(**provider):
    return {
        "header": {"name": "GitHub OAuth", "description": ""},
        "secret": {
            "kind": "oauth_provider",
            "data": {
                "provider": {
                    "client_id": "id",
                    "client_secret": "secret",
                    "issuer_url": "https://issuer.example",
                    "scopes": ["openid"],
                    **provider,
                }
            },
        },
    }


def test_create_oauth_provider_secret():
    secret = CreateSecretDTO.model_validate(_oauth_provider_payload())

    assert isinstance(secret.secret.data, OAuthProviderDTO)
    assert secret.secret.data.provider.client_id == "id"
    assert secret.secret.data.provider.issuer_url == "https://issuer.example"
    assert secret.secret.data.provider.scopes == ["openid"]


def test_oauth_provider_kind_decides_shape_though_sso_provider_shares_it():
    # OAuthProviderDTO and SSOProviderDTO have an identical shape; the kind, not the union,
    # must decide which class the data resolves to.
    secret = CreateSecretDTO.model_validate(_oauth_provider_payload())

    assert type(secret.secret.data) is OAuthProviderDTO


@pytest.mark.parametrize(
    "missing", ["client_id", "client_secret", "issuer_url", "scopes"]
)
def test_create_oauth_provider_rejects_missing_field(missing):
    payload = _oauth_provider_payload()
    del payload["secret"]["data"]["provider"][missing]

    with pytest.raises(ValidationError, match="OAuthProviderSettingsDTO"):
        CreateSecretDTO.model_validate(payload)


def _oauth_grant_payload(**grant):
    return {
        "header": {"name": "GitHub grant", "description": ""},
        "secret": {
            "kind": "oauth_grant",
            "data": {
                "grant": {
                    "server": "https://issuer.example",
                    "access_token": "at-123",
                    "scopes": ["openid"],
                    **grant,
                }
            },
        },
    }


def test_create_oauth_grant_secret():
    secret = CreateSecretDTO.model_validate(
        _oauth_grant_payload(refresh_token="rt-456", expires_at=1893456000)
    )

    assert isinstance(secret.secret.data, OAuthGrantDTO)
    assert secret.secret.data.grant.server == "https://issuer.example"
    assert secret.secret.data.grant.access_token == "at-123"
    assert secret.secret.data.grant.refresh_token == "rt-456"
    assert secret.secret.data.grant.expires_at == 1893456000


def test_create_oauth_grant_without_refresh_token_defaults_to_none():
    secret = CreateSecretDTO.model_validate(_oauth_grant_payload())

    assert secret.secret.data.grant.refresh_token is None
    assert secret.secret.data.grant.expires_at is None


@pytest.mark.parametrize("missing", ["server", "access_token", "scopes"])
def test_create_oauth_grant_rejects_missing_field(missing):
    payload = _oauth_grant_payload()
    del payload["secret"]["data"]["grant"][missing]

    with pytest.raises(ValidationError, match="OAuthGrantSettingsDTO"):
        CreateSecretDTO.model_validate(payload)


def test_secret_kind_enum_keeps_existing_members_appended_only():
    # New kinds append without renumbering or reordering the existing set,
    # so parallel work adding kinds to this same enum merges cleanly.
    expected_prefix = [
        "provider_key",
        "custom_provider",
        "sso_provider",
        "webhook_provider",
        "custom_secret",
    ]
    actual_prefix = [member.value for member in SecretKind][: len(expected_prefix)]

    assert actual_prefix == expected_prefix
    assert "oauth_provider" in [member.value for member in SecretKind]
    assert "oauth_grant" in [member.value for member in SecretKind]

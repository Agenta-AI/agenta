import pytest
from pydantic import ValidationError

from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    CustomSecretDTO,
    UpdateSecretDTO,
)


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

    with pytest.raises(ValidationError, match="StandardProviderKind"):
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

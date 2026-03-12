import pytest
from pydantic import ValidationError

from oss.src.core.secrets.dtos import CreateSecretDTO


def test_create_secret_accepts_mistralai_standard_provider_payload():
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

    assert secret.secret.data.kind == "mistralai"
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

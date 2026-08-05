from types import SimpleNamespace

import pytest

from oss.src.core.secrets.enums import StandardProviderKind
from oss.src.core.secrets.utils import (
    get_system_llm_providers_secrets,
    get_user_llm_providers_secrets,
)


class _FakeVaultService:
    def __init__(self, *_args, **_kwargs):
        pass

    async def list_secrets(self, project_id):
        del project_id
        return [
            SimpleNamespace(
                kind="provider_key",
                model_dump=lambda include=None: {
                    "data": {
                        "kind": StandardProviderKind.MISTRALAI,
                        "provider": {"key": "mistral-key"},
                    }
                },
            ),
            SimpleNamespace(
                kind="provider_key",
                model_dump=lambda include=None: {
                    "data": {
                        "kind": StandardProviderKind.TOGETHERAI,
                        "provider": {"key": "together-key"},
                    }
                },
            ),
            SimpleNamespace(
                kind="provider_key",
                model_dump=lambda include=None: {
                    "data": {
                        "kind": StandardProviderKind.MINIMAX,
                        "provider": {"key": "minimax-vault-key"},
                    }
                },
            ),
        ]


@pytest.mark.asyncio
async def test_get_user_llm_providers_secrets_normalizes_legacy_provider_slugs(
    monkeypatch,
):
    monkeypatch.setattr("oss.src.core.secrets.utils.VaultService", _FakeVaultService)

    secrets = await get_user_llm_providers_secrets(
        "00000000-0000-0000-0000-000000000000"
    )

    assert secrets["MISTRAL_API_KEY"] == "mistral-key"
    assert "MISTRALAI_API_KEY" not in secrets
    assert secrets["TOGETHERAI_API_KEY"] == "together-key"
    assert "TOGETHER_AI_API_KEY" not in secrets
    assert secrets["MINIMAX_API_KEY"] == "minimax-vault-key"


@pytest.mark.asyncio
async def test_get_system_llm_providers_secrets_reads_legacy_mistralai_env(monkeypatch):
    monkeypatch.delenv("MISTRAL_API_KEY", raising=False)
    monkeypatch.setenv("MISTRALAI_API_KEY", "legacy-mistral-key")

    secrets = await get_system_llm_providers_secrets()

    assert secrets["MISTRAL_API_KEY"] == "legacy-mistral-key"
    assert "MISTRALAI_API_KEY" not in secrets

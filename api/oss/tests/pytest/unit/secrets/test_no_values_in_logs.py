"""No credential value reaches a log record (M5, Task 4, P8).

A sentinel value sits inside every credential here. Every captured record (the `[cache]`
warnings and the `[INTERCEPTED]` error log included) and the captured console output are
searched for it.
"""

from uuid import uuid4

import pytest
from pydantic import BaseModel, ValidationError

from oss.src.core.secrets import dtos as secret_dtos
from oss.src.core.secrets.dtos import CachedEffectiveSecrets, SecretResponseDTO
from oss.src.core.secrets.inheritance import InheritedSecret
from oss.src.core.secrets.services import VaultService
from oss.src.utils import caching
from oss.tests.pytest.utils.organization_secrets import (
    SENTINEL_KEY,
    InMemorySecretsDAO,
    install_cache_engine,
)


def _assert_clean(caplog, capsys):
    for record in caplog.records:
        assert SENTINEL_KEY not in record.getMessage()
        assert SENTINEL_KEY not in str(record.__dict__)
    captured = capsys.readouterr()
    assert SENTINEL_KEY not in captured.out
    assert SENTINEL_KEY not in captured.err


def _malformed_entry(project_id) -> bytes:
    # A provider_key whose key is not a string: validation fails on the value.
    return caching._serialize(
        {
            "project_id": str(project_id),
            "organization_id": str(uuid4()),
            "secrets": [
                {
                    "id": str(uuid4()),
                    "kind": "provider_key",
                    "data": {"kind": "openai", "provider": {"key": [SENTINEL_KEY]}},
                    "header": {"name": "x"},
                }
            ],
        }
    )


async def test_malformed_cache_entry_logs_no_value(monkeypatch, caplog, capsys):
    engine = install_cache_engine(monkeypatch)
    project_id = uuid4()
    name = caching._pack(
        namespace="effective_secrets",
        project_id=str(project_id),
        key={"p": str(project_id)},
    )
    engine.store[name] = _malformed_entry(project_id)
    dao = InMemorySecretsDAO(projects={project_id: uuid4()})

    with caplog.at_level("DEBUG"):
        secrets = await VaultService(dao).list_secrets(project_id=project_id)

    assert secrets == []  # a malformed entry is a miss, refilled from the DAO
    assert any("[cache]" in r.getMessage() for r in caplog.records)
    _assert_clean(caplog, capsys)


async def test_malformed_stored_row_logs_no_value(caplog, capsys):
    from types import SimpleNamespace

    from oss.src.dbs.postgres.secrets.mappings import map_secrets_dbe_to_dto

    row = SimpleNamespace(
        id=uuid4(),
        slug="x",
        kind="PROVIDER_KEY",
        data='{"kind": "openai", "provider": {"key": ["' + SENTINEL_KEY + '"]}}',
        project_id=uuid4(),
        organization_id=None,
        name="x",
        description=None,
        created_at=None,
        updated_at=None,
        availability="all_projects",
    )
    with caplog.at_level("DEBUG"):
        with pytest.raises(ValidationError) as excinfo:
            map_secrets_dbe_to_dto(secrets_dbe=row)
    assert SENTINEL_KEY not in str(excinfo.value)
    assert SENTINEL_KEY not in repr(excinfo.value)
    _assert_clean(caplog, capsys)


async def test_intercepted_error_logs_no_value(caplog, capsys):
    from oss.src.core.secrets.types import SecretStorageError
    from oss.src.utils.exceptions import intercept_exceptions

    @intercept_exceptions()
    async def route():
        try:
            raise RuntimeError(f"INSERT ... pgp_sym_encrypt('{SENTINEL_KEY}')")
        except RuntimeError:
            raise SecretStorageError() from None

    with caplog.at_level("DEBUG"):
        with pytest.raises(Exception):
            await route()
    assert any("INTERCEPTED" in r.getMessage() for r in caplog.records)
    _assert_clean(caplog, capsys)


_VALUE_HOLDING = [
    secret_dtos._SecretResponseBaseDTO,
    secret_dtos.SecretResponseDTO,
    secret_dtos.PublicSecretResponseDTO,
    secret_dtos.CachedEffectiveSecrets,
    secret_dtos.CreateSecretDTO,
    secret_dtos.UpdateSecretDTO,
    secret_dtos.SecretDTO,
    secret_dtos.UpdateSecretPayloadDTO,
    secret_dtos.StandardProviderSettingsDTO,
    secret_dtos.StandardProviderDTO,
    secret_dtos.CustomProviderSettingsDTO,
    secret_dtos.CustomProviderDTO,
    secret_dtos.CustomSecretSettingsDTO,
    secret_dtos.OAuthProviderSettingsDTO,
    secret_dtos.OAuthGrantSettingsDTO,
    InheritedSecret,
]


@pytest.mark.parametrize("model", _VALUE_HOLDING, ids=lambda m: m.__name__)
def test_every_value_holding_model_hides_inputs(model: type[BaseModel]):
    assert model.model_config.get("hide_input_in_errors") is True


def test_a_validation_error_of_a_cached_entry_names_no_value():
    with pytest.raises(ValidationError) as excinfo:
        CachedEffectiveSecrets.model_validate_json(_malformed_entry(uuid4()).decode())
    assert SENTINEL_KEY not in str(excinfo.value)
    with pytest.raises(ValidationError) as excinfo:
        SecretResponseDTO.model_validate(
            {
                "id": str(uuid4()),
                "kind": "provider_key",
                "data": {"kind": "openai", "provider": {"key": {"v": SENTINEL_KEY}}},
                "header": {"name": "x"},
            }
        )
    assert SENTINEL_KEY not in str(excinfo.value)

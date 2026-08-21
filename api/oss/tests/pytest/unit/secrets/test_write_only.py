"""Write-only secrets: the value can be set and replaced, never read back by a user.

Covers the three layers below the router: the service (default-on at create, value
carry-over on update, the one-way flag), the redaction helper (per-kind value stripping,
has_key/key_preview), and the postgres mappings (the flag rides inside the encrypted data
JSON and never leaks into the payload DTOs).
"""

from uuid import uuid4

import pytest

from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    SecretResponseDTO,
    UpdateSecretDTO,
    WriteOnlyCannotBeDisabledError,
)
from oss.src.core.secrets.redaction import (
    mask_secret_value,
    redact_secret_response,
)
from oss.src.core.secrets.services import VaultService
from oss.src.dbs.postgres.secrets.mappings import (
    map_secrets_dbe_to_dto,
    map_secrets_dto_to_dbe,
    map_secrets_dto_to_dbe_update,
)


PROJECT_ID = uuid4()


class _FakeSecretsDAO:
    """In-memory DAO: stores what the service hands it, like the real mapping would."""

    def __init__(self):
        self.records: dict = {}

    async def create(self, project_id, organization_id, create_secret_dto):
        record = SecretResponseDTO(
            id=uuid4(),
            slug=create_secret_dto.slug,
            kind=create_secret_dto.secret.kind,
            data=create_secret_dto.secret.data.model_dump(exclude_none=True),
            header=create_secret_dto.header,
            write_only=bool(create_secret_dto.write_only),
        )
        self.records[record.id] = record
        return record

    async def list(self, project_id, organization_id):
        return list(self.records.values())

    async def get_by_id(self, secret_id, project_id, organization_id):
        return self.records.get(secret_id)

    async def update(
        self, secret_id, update_secret_dto, project_id, organization_id, user_id=None
    ):
        stored = self.records.get(secret_id)
        if stored is None:
            return None

        write_only = update_secret_dto.write_only
        if write_only is None:
            write_only = stored.write_only

        updated = stored.model_copy(
            update={
                "header": update_secret_dto.header or stored.header,
                "write_only": write_only,
            }
        )
        if update_secret_dto.secret is not None:
            updated.kind = update_secret_dto.secret.kind
            updated.data = update_secret_dto.secret.data

        self.records[secret_id] = updated
        return updated


@pytest.fixture(name="service")
def _service():
    return VaultService(_FakeSecretsDAO())


def _provider_key_create(key="sk-test-openai-key-bc", write_only=None):
    return CreateSecretDTO(
        header={"name": "OpenAI"},
        secret={
            "kind": "provider_key",
            "data": {"kind": "openai", "provider": {"key": key}},
        },
        write_only=write_only,
    )


# --- service: create ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_defaults_to_write_only(service):
    created = await service.create_secret(
        project_id=PROJECT_ID, create_secret_dto=_provider_key_create()
    )

    assert created.write_only is True


@pytest.mark.asyncio
async def test_create_accepts_explicit_false_as_escape_hatch(service):
    created = await service.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_provider_key_create(write_only=False),
    )

    assert created.write_only is False


# --- service: keep-stored-on-omit ------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("omitted_key", [None, ""])
async def test_update_without_provider_key_keeps_the_stored_one(service, omitted_key):
    created = await service.create_secret(
        project_id=PROJECT_ID, create_secret_dto=_provider_key_create()
    )

    update = UpdateSecretDTO(
        header={"name": "OpenAI (renamed)"},
        secret={
            "kind": "provider_key",
            "data": {"kind": "openai", "provider": {"key": omitted_key}},
        },
    )
    updated = await service.update_secret(
        secret_id=created.id, project_id=PROJECT_ID, update_secret_dto=update
    )

    assert updated.data.provider.key == "sk-test-openai-key-bc"
    assert updated.header.name == "OpenAI (renamed)"


@pytest.mark.asyncio
async def test_update_with_a_new_provider_key_replaces_the_stored_one(service):
    created = await service.create_secret(
        project_id=PROJECT_ID, create_secret_dto=_provider_key_create()
    )

    update = UpdateSecretDTO(
        secret={
            "kind": "provider_key",
            "data": {"kind": "openai", "provider": {"key": "sk-test-rotated"}},
        },
    )
    updated = await service.update_secret(
        secret_id=created.id, project_id=PROJECT_ID, update_secret_dto=update
    )

    assert updated.data.provider.key == "sk-test-rotated"


@pytest.mark.asyncio
async def test_update_without_custom_provider_key_and_extras_keeps_stored_values(
    service,
):
    created = await service.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=CreateSecretDTO(
            header={"name": "my-gateway"},
            secret={
                "kind": "custom_provider",
                "data": {
                    "kind": "openai",
                    "provider": {
                        "url": "https://gateway.example.com/v1",
                        "key": "gw-test-key",
                        "extras": {
                            "api_key": "extra-key-123456",
                            "region": "eu-west-1",
                        },
                    },
                    "models": [{"slug": "gpt-5"}],
                },
            },
        ),
    )

    update = UpdateSecretDTO(
        secret={
            "kind": "custom_provider",
            "data": {
                "kind": "openai",
                "provider": {"url": "https://gateway.example.com/v2"},
                "models": [{"slug": "gpt-5"}],
            },
        },
    )
    updated = await service.update_secret(
        secret_id=created.id, project_id=PROJECT_ID, update_secret_dto=update
    )

    assert updated.data.provider.url == "https://gateway.example.com/v2"
    assert updated.data.provider.key == "gw-test-key"
    # Omitted extras carry over whole: replace-only forms must not wipe them.
    assert updated.data.provider.extras["api_key"] == "extra-key-123456"
    assert updated.data.provider.extras["region"] == "eu-west-1"


@pytest.mark.asyncio
async def test_update_with_partial_extras_refills_credential_keys_only(service):
    created = await service.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=CreateSecretDTO(
            header={"name": "my-gateway"},
            secret={
                "kind": "custom_provider",
                "data": {
                    "kind": "openai",
                    "provider": {
                        "url": "https://gateway.example.com/v1",
                        "key": "gw-test-key",
                        "extras": {
                            "api_key": "extra-key-123456",
                            "region": "eu-west-1",
                        },
                    },
                    "models": [{"slug": "gpt-5"}],
                },
            },
        ),
    )

    update = UpdateSecretDTO(
        secret={
            "kind": "custom_provider",
            "data": {
                "kind": "openai",
                "provider": {
                    "url": "https://gateway.example.com/v1",
                    "extras": {"region": "us-east-1"},
                },
                "models": [{"slug": "gpt-5"}],
            },
        },
    )
    updated = await service.update_secret(
        secret_id=created.id, project_id=PROJECT_ID, update_secret_dto=update
    )

    # The submitted config wins; only the credential keys refill from storage.
    assert updated.data.provider.extras["region"] == "us-east-1"
    assert updated.data.provider.extras["api_key"] == "extra-key-123456"


@pytest.mark.asyncio
async def test_update_without_custom_secret_content_keeps_the_stored_one(service):
    created = await service.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=CreateSecretDTO(
            header={"name": "gh-token"},
            secret={
                "kind": "custom_secret",
                "data": {
                    "secret": {"format": "text", "content": "ghp_example_token_xyz"}
                },
            },
        ),
    )

    update = UpdateSecretDTO(
        header={"name": "gh-token (renamed)"},
        secret={
            "kind": "custom_secret",
            "data": {"secret": {"format": "text"}},
        },
    )
    updated = await service.update_secret(
        secret_id=created.id, project_id=PROJECT_ID, update_secret_dto=update
    )

    assert updated.data.secret.content == "ghp_example_token_xyz"


# --- service: the flag is one-way ------------------------------------------------------


@pytest.mark.asyncio
async def test_write_only_cannot_be_turned_off(service):
    created = await service.create_secret(
        project_id=PROJECT_ID, create_secret_dto=_provider_key_create()
    )

    with pytest.raises(WriteOnlyCannotBeDisabledError):
        await service.update_secret(
            secret_id=created.id,
            project_id=PROJECT_ID,
            update_secret_dto=UpdateSecretDTO(write_only=False),
        )


@pytest.mark.asyncio
async def test_readable_secret_can_be_tightened_to_write_only(service):
    created = await service.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_provider_key_create(write_only=False),
    )

    updated = await service.update_secret(
        secret_id=created.id,
        project_id=PROJECT_ID,
        update_secret_dto=UpdateSecretDTO(write_only=True),
    )

    assert updated.write_only is True


# --- redaction -------------------------------------------------------------------------


def _response(kind, data, write_only=True):
    return SecretResponseDTO(
        id=uuid4(),
        slug="s",
        kind=kind,
        data=data,
        header={"name": "n"},
        write_only=write_only,
    )


def test_mask_hides_short_values_entirely_and_previews_long_ones():
    assert mask_secret_value("short") == "****"
    assert mask_secret_value("elevenchars") == "****"
    assert mask_secret_value("sk-live-1234567890abc9Qa") == "sk-****9Qa"


def test_redacts_provider_key_and_reports_presence():
    secret = _response(
        "provider_key",
        {"kind": "openai", "provider": {"key": "sk-live-1234567890abc"}},
    )

    redacted = redact_secret_response(secret)

    assert redacted.data.provider.key is None
    assert redacted.has_key is True
    assert redacted.key_preview == "sk-****abc"
    # The input is never mutated: internal readers keep their plaintext DTO.
    assert secret.data.provider.key == "sk-test-openai-key-bc"


def test_redacts_custom_provider_key_and_credential_extras():
    secret = _response(
        "custom_provider",
        {
            "kind": "openai",
            "provider": {
                "url": "https://gateway.example.com/v1",
                "key": None,
                "extras": {"api_key": "extra-key-123456", "region": "eu-west-1"},
            },
            "models": [{"slug": "gpt-5"}],
        },
    )

    redacted = redact_secret_response(secret)

    assert redacted.data.provider.key is None
    assert "api_key" not in redacted.data.provider.extras
    assert redacted.data.provider.extras["region"] == "eu-west-1"
    assert redacted.data.provider.url == "https://gateway.example.com/v1"
    assert redacted.has_key is True
    assert redacted.key_preview == "ext****456"


def test_redacts_text_custom_secret_content():
    secret = _response(
        "custom_secret",
        {"secret": {"format": "text", "content": "ghp_abcdef1234567890"}},
    )

    redacted = redact_secret_response(secret)

    assert redacted.data.secret.content is None
    assert redacted.has_key is True
    assert redacted.key_preview == "ghp****890"


def test_redacts_json_custom_secret_without_a_preview():
    secret = _response(
        "custom_secret",
        {"secret": {"format": "json", "content": {"token": "abc", "user": "x"}}},
    )

    redacted = redact_secret_response(secret)

    assert redacted.data.secret.content is None
    assert redacted.has_key is True
    # A structured value has no single previewable string.
    assert redacted.key_preview is None


def test_readable_secret_passes_through_unchanged():
    secret = _response(
        "provider_key",
        {"kind": "openai", "provider": {"key": "sk-test-openai-key-bc"}},
        write_only=False,
    )

    redacted = redact_secret_response(secret)

    assert redacted is secret
    assert redacted.data.provider.key == "sk-test-openai-key-bc"
    assert redacted.has_key is None
    assert redacted.key_preview is None


def test_write_only_without_a_value_reports_has_key_false():
    secret = _response(
        "custom_provider",
        {
            "kind": "openai",
            "provider": {"url": "https://gateway.example.com/v1"},
            "models": [],
        },
    )

    redacted = redact_secret_response(secret)

    assert redacted.has_key is False
    assert redacted.key_preview is None


# --- postgres mappings -----------------------------------------------------------------


def test_mapping_round_trips_the_flag_through_the_data_json():
    import json

    dbe = map_secrets_dto_to_dbe(
        project_id=PROJECT_ID,
        organization_id=None,
        secret_dto=_provider_key_create(write_only=True),
    )

    stored = json.loads(dbe.data)
    assert stored["write_only"] is True
    assert stored["provider"]["key"] == "sk-test-openai-key-bc"

    dbe.id = uuid4()
    dto = map_secrets_dbe_to_dto(secrets_dbe=dbe)

    assert dto.write_only is True
    # The flag never leaks into the payload shape.
    assert not hasattr(dto.data, "write_only")
    assert dto.data.provider.key == "sk-test-openai-key-bc"


def test_mapping_reads_legacy_rows_as_readable():
    dbe = map_secrets_dto_to_dbe(
        project_id=PROJECT_ID,
        organization_id=None,
        secret_dto=_provider_key_create(write_only=False),
    )
    dbe.id = uuid4()

    assert map_secrets_dbe_to_dto(secrets_dbe=dbe).write_only is False


def test_update_mapping_preserves_the_stored_flag_when_unspecified():
    import json

    dbe = map_secrets_dto_to_dbe(
        project_id=PROJECT_ID,
        organization_id=None,
        secret_dto=_provider_key_create(write_only=True),
    )

    map_secrets_dto_to_dbe_update(
        secrets_dbe=dbe,
        update_secret_dto=UpdateSecretDTO(
            secret={
                "kind": "provider_key",
                "data": {
                    "kind": "openai",
                    "provider": {"key": "sk-test-rotated"},
                },
            },
        ),
    )

    stored = json.loads(dbe.data)
    assert stored["write_only"] is True
    assert stored["provider"]["key"] == "sk-test-rotated"


def test_update_mapping_applies_a_tightening_flag(monkeypatch):
    import json

    dbe = map_secrets_dto_to_dbe(
        project_id=PROJECT_ID,
        organization_id=None,
        secret_dto=_provider_key_create(write_only=False),
    )

    map_secrets_dto_to_dbe_update(
        secrets_dbe=dbe,
        update_secret_dto=UpdateSecretDTO(write_only=True),
    )

    stored = json.loads(dbe.data)
    assert stored["write_only"] is True
    assert stored["provider"]["key"] == "sk-live-1234567890abc"

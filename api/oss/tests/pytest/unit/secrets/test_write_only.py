"""Write-only secrets: the value can be set and replaced, never read back by a user.

Covers the three layers below the router: the service (default-on at create, value
carry-over on update, the immutable creation policy), the redaction helper (per-kind
value stripping and value_status), and the postgres mappings (the flag rides inside the encrypted data
JSON and never leaks into the payload DTOs).
"""

from uuid import uuid4

import pytest

from agenta.sdk.agents.connections.credentials import secret_value_configured

import oss.src.core.secrets.services as secrets_services_module
from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    SecretResponseDTO,
    SecretValueRequiredError,
    UpdateSecretDTO,
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
        self,
        secret_id,
        update_secret_dto,
        project_id,
        organization_id,
        user_id=None,
        resolve_update=None,
    ):
        stored = self.records.get(secret_id)
        if stored is None:
            return None

        # Production resolves the update against the row under the write lock; the fake
        # does the same at the same point, so keep-on-omit is exercised, not skipped.
        if resolve_update is not None:
            update_secret_dto = resolve_update(stored, update_secret_dto)

        updated = stored.model_copy(
            update={
                "header": update_secret_dto.header or stored.header,
            }
        )
        if update_secret_dto.secret is not None:
            updated.kind = update_secret_dto.secret.kind
            updated.data = update_secret_dto.secret.data

        self.records[secret_id] = updated
        return updated

    async def delete(
        self, secret_id, project_id, organization_id, authorize_delete=None
    ):
        stored = self.records.get(secret_id)
        if stored is not None and authorize_delete is not None:
            authorize_delete(stored)
        self.records.pop(secret_id, None)


@pytest.fixture(name="service")
def _service():
    return VaultService(_FakeSecretsDAO())


def _provider_key_create(key="sk-test-openai-key-bc", write_only=True):
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
@pytest.mark.parametrize("explicit", [False, True])
async def test_an_explicit_create_value_is_preserved(service, explicit):
    created = await service.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_provider_key_create(write_only=explicit),
    )

    assert created.write_only is explicit


# --- service: keep-stored-on-omit ------------------------------------------------------


@pytest.mark.asyncio
async def test_project_list_cache_stores_the_canonical_plaintext_dto(
    service, monkeypatch
):
    cached = None
    dao_calls = 0

    original_list = service.secrets_dao.list

    async def counted_list(*args, **kwargs):
        nonlocal dao_calls
        dao_calls += 1
        return await original_list(*args, **kwargs)

    async def fake_get_cache(**kwargs):
        assert kwargs["namespace"] == "list_secrets"
        assert kwargs["project_id"] == str(PROJECT_ID)
        assert kwargs["key"] == {}
        assert kwargs["model"] is SecretResponseDTO
        assert kwargs["is_list"] is True
        return cached

    async def fake_set_cache(**kwargs):
        nonlocal cached
        assert kwargs["namespace"] == "list_secrets"
        assert kwargs["project_id"] == str(PROJECT_ID)
        assert kwargs["key"] == {}
        cached = kwargs["value"]
        return True

    monkeypatch.setattr(service.secrets_dao, "list", counted_list)
    monkeypatch.setattr(secrets_services_module, "get_cache", fake_get_cache)
    monkeypatch.setattr(secrets_services_module, "set_cache", fake_set_cache)

    await service.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_provider_key_create(),
    )
    first = await service.list_secrets(project_id=PROJECT_ID)
    second = await service.list_secrets(project_id=PROJECT_ID)

    assert dao_calls == 1
    assert first == second
    assert cached[0].data.provider.key == "sk-test-openai-key-bc"


@pytest.mark.asyncio
async def test_service_mutations_invalidate_the_project_cache(service, monkeypatch):
    invalidated = []

    async def fake_invalidate_cache(**kwargs):
        invalidated.append(kwargs)
        return True

    monkeypatch.setattr(
        secrets_services_module,
        "invalidate_cache",
        fake_invalidate_cache,
    )

    created = await service.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_provider_key_create(),
    )
    await service.update_secret(
        secret_id=created.id,
        project_id=PROJECT_ID,
        update_secret_dto=UpdateSecretDTO(header={"name": "Renamed"}),
    )
    await service.delete_secret(secret_id=created.id, project_id=PROJECT_ID)

    assert invalidated == [{"project_id": str(PROJECT_ID)}] * 3


class _RotatingDAO(_FakeSecretsDAO):
    """A DAO where another writer commits a rotation while this update waits for the lock.

    The real DAO takes ``SELECT ... FOR UPDATE`` and only then resolves the update, so a
    writer that committed while we waited is visible. This fake reproduces that window by

    rotating the stored row immediately before it resolves.
    """

    def __init__(self, rotated_key: str):
        super().__init__()
        self.rotated_key = rotated_key

    async def update(
        self,
        secret_id,
        update_secret_dto,
        project_id,
        organization_id,
        user_id=None,
        resolve_update=None,
    ):
        stored = self.records.get(secret_id)
        if stored is not None:
            rotated = stored.model_dump()
            rotated["data"]["provider"]["key"] = self.rotated_key
            self.records[secret_id] = SecretResponseDTO(**rotated)

        return await super().update(
            secret_id=secret_id,
            update_secret_dto=update_secret_dto,
            project_id=project_id,
            organization_id=organization_id,
            user_id=user_id,
            resolve_update=resolve_update,
        )


@pytest.mark.asyncio
async def test_an_omitted_key_keeps_the_value_a_racing_rotation_just_stored():
    # A rotation that lands between "read the row" and "write the row" must not be undone.
    # Resolving the omitted credential against a snapshot taken before the lock wrote the
    # OLD key back over the new one, silently reverting the rotation.
    dao = _RotatingDAO(rotated_key="sk-test-rotated")
    service = VaultService(dao)

    created = await service.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_provider_key_create(write_only=True),
    )

    updated = await service.update_secret(
        secret_id=created.id,
        project_id=PROJECT_ID,
        update_secret_dto=UpdateSecretDTO(
            secret={
                "kind": "provider_key",
                "data": {"kind": "openai", "provider": {}},
            }
        ),
    )

    assert updated.data.provider.key == "sk-test-rotated"


@pytest.mark.asyncio
async def test_update_without_provider_key_keeps_the_stored_one(service):
    created = await service.create_secret(
        project_id=PROJECT_ID, create_secret_dto=_provider_key_create()
    )

    update = UpdateSecretDTO(
        header={"name": "OpenAI (renamed)"},
        secret={
            "kind": "provider_key",
            "data": {"kind": "openai", "provider": {}},
        },
    )
    updated = await service.update_secret(
        secret_id=created.id, project_id=PROJECT_ID, update_secret_dto=update
    )

    assert updated.data.provider.key == "sk-test-openai-key-bc"
    assert updated.header.name == "OpenAI (renamed)"


@pytest.mark.asyncio
async def test_update_with_an_explicit_blank_provider_key_is_rejected(service):
    created = await service.create_secret(
        project_id=PROJECT_ID, create_secret_dto=_provider_key_create()
    )

    update = UpdateSecretDTO(
        secret={
            "kind": "provider_key",
            "data": {"kind": "openai", "provider": {"key": ""}},
        },
    )

    with pytest.raises(
        SecretValueRequiredError,
        match=(
            "Credential values cannot be blank. Omit an unchanged credential field or provide "
            "a new value."
        ),
    ):
        await service.update_secret(
            secret_id=created.id, project_id=PROJECT_ID, update_secret_dto=update
        )


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
async def test_explicit_empty_custom_provider_credential_extra_is_rejected(service):
    created = await service.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=CreateSecretDTO(
            header={"name": "Bedrock"},
            secret={
                "kind": "custom_provider",
                "data": {
                    "kind": "bedrock",
                    "provider": {
                        "extras": {
                            "AWS_ACCESS_KEY_ID": "AKIA123",
                            "AWS_SECRET_ACCESS_KEY": "stored-secret",
                            "AWS_REGION": "eu-west-1",
                        }
                    },
                    "models": [{"slug": "claude"}],
                },
            },
        ),
    )

    update = UpdateSecretDTO(
        secret={
            "kind": "custom_provider",
            "data": {
                "kind": "bedrock",
                "provider": {
                    "extras": {
                        "AWS_SECRET_ACCESS_KEY": "",
                        "AWS_REGION": "us-east-1",
                    }
                },
                "models": [{"slug": "claude"}],
            },
        },
    )

    with pytest.raises(SecretValueRequiredError):
        await service.update_secret(
            secret_id=created.id,
            project_id=PROJECT_ID,
            update_secret_dto=update,
        )


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


def test_write_only_is_not_an_update_field():
    with pytest.raises(ValueError, match="cannot be updated"):
        UpdateSecretDTO.model_validate({"write_only": False})

    with pytest.raises(ValueError, match="cannot be updated"):
        UpdateSecretDTO.model_validate({"write_only": True})


@pytest.mark.parametrize(
    ("kind", "data"),
    [
        (
            "provider_key",
            {"kind": "openai", "provider": {"key": ""}},
        ),
        (
            "webhook_provider",
            {"provider": {"key": ""}},
        ),
        (
            "sso_provider",
            {
                "provider": {
                    "client_id": "client",
                    "client_secret": "",
                    "issuer_url": "https://issuer.example.com",
                    "scopes": ["openid"],
                }
            },
        ),
    ],
)
def test_create_rejects_empty_credentials(kind, data):
    with pytest.raises(ValueError):
        CreateSecretDTO(
            header={"name": "Connection"},
            secret={"kind": kind, "data": data},
        )


@pytest.mark.asyncio
async def test_update_cannot_keep_a_missing_value_from_a_legacy_row(service):
    legacy = SecretResponseDTO(
        id=uuid4(),
        slug="legacy-openai",
        kind="provider_key",
        data={"kind": "openai", "provider": {}},
        header={"name": "Legacy"},
        write_only=False,
    )
    service.secrets_dao.records[legacy.id] = legacy

    with pytest.raises(SecretValueRequiredError):
        await service.update_secret(
            secret_id=legacy.id,
            project_id=PROJECT_ID,
            update_secret_dto=UpdateSecretDTO(
                header={"name": "Renamed"},
                secret={
                    "kind": "provider_key",
                    "data": {"kind": "openai", "provider": {}},
                },
            ),
        )


# --- service: keep-on-omit is identity-local -------------------------------------------


@pytest.mark.asyncio
async def test_provider_family_change_with_omitted_key_is_rejected(service):
    created = await service.create_secret(
        project_id=PROJECT_ID, create_secret_dto=_provider_key_create()
    )

    # OpenAI -> Anthropic without a new key must never reuse the OpenAI credential.
    update = UpdateSecretDTO(
        secret={
            "kind": "provider_key",
            "data": {"kind": "anthropic", "provider": {"key": ""}},
        },
    )

    with pytest.raises(SecretValueRequiredError):
        await service.update_secret(
            secret_id=created.id, project_id=PROJECT_ID, update_secret_dto=update
        )


@pytest.mark.asyncio
async def test_provider_family_change_with_a_new_key_is_allowed(service):
    created = await service.create_secret(
        project_id=PROJECT_ID, create_secret_dto=_provider_key_create()
    )

    update = UpdateSecretDTO(
        secret={
            "kind": "provider_key",
            "data": {"kind": "anthropic", "provider": {"key": "sk-ant-new-key-123"}},
        },
    )
    updated = await service.update_secret(
        secret_id=created.id, project_id=PROJECT_ID, update_secret_dto=update
    )

    assert updated.data.provider.key == "sk-ant-new-key-123"


@pytest.mark.asyncio
async def test_kind_change_with_omitted_content_is_rejected(service):
    created = await service.create_secret(
        project_id=PROJECT_ID, create_secret_dto=_provider_key_create()
    )

    # provider_key -> custom_secret with no content would irreversibly replace the
    # stored credential with nothing.
    update = UpdateSecretDTO(
        secret={
            "kind": "custom_secret",
            "data": {"secret": {"format": "text"}},
        },
    )

    with pytest.raises(SecretValueRequiredError):
        await service.update_secret(
            secret_id=created.id, project_id=PROJECT_ID, update_secret_dto=update
        )


@pytest.mark.asyncio
async def test_a_format_change_with_omitted_content_is_rejected(service):
    # text -> json with no content used to carry the stored STRING into the json shape.
    # The payload validators never saw it (they ran before the carry-over filled it in),
    # so an invalid row reached the database: a json secret holding a string.
    created = await service.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=CreateSecretDTO(
            header={"name": "Token"},
            secret={
                "kind": "custom_secret",
                "data": {
                    "secret": {"format": "text", "content": "ghp_example_token_xyz"}
                },
            },
            write_only=True,
        ),
    )

    update = UpdateSecretDTO(
        secret={"kind": "custom_secret", "data": {"secret": {"format": "json"}}},
    )

    with pytest.raises(SecretValueRequiredError):
        await service.update_secret(
            secret_id=created.id, project_id=PROJECT_ID, update_secret_dto=update
        )

    stored = await service.get_secret_by_id(created.id, project_id=PROJECT_ID)
    assert stored.data.secret.format.value == "text"
    assert stored.data.secret.content == "ghp_example_token_xyz"


@pytest.mark.asyncio
async def test_a_format_change_with_a_new_value_is_allowed(service):
    created = await service.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=CreateSecretDTO(
            header={"name": "Token"},
            secret={
                "kind": "custom_secret",
                "data": {
                    "secret": {"format": "text", "content": "ghp_example_token_xyz"}
                },
            },
            write_only=True,
        ),
    )

    updated = await service.update_secret(
        secret_id=created.id,
        project_id=PROJECT_ID,
        update_secret_dto=UpdateSecretDTO(
            secret={
                "kind": "custom_secret",
                "data": {
                    "secret": {"format": "json", "content": {"token": "ghp-example"}}
                },
            },
        ),
    )

    assert updated.data.secret.format.value == "json"
    assert updated.data.secret.content == {"token": "ghp-example"}


@pytest.mark.asyncio
async def test_an_omitted_content_still_keeps_the_stored_one_within_a_format(service):
    created = await service.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=CreateSecretDTO(
            header={"name": "Token"},
            secret={
                "kind": "custom_secret",
                "data": {"secret": {"format": "json", "content": {"token": "abc"}}},
            },
            write_only=True,
        ),
    )

    updated = await service.update_secret(
        secret_id=created.id,
        project_id=PROJECT_ID,
        update_secret_dto=UpdateSecretDTO(
            secret={"kind": "custom_secret", "data": {"secret": {"format": "json"}}},
        ),
    )

    assert updated.data.secret.content == {"token": "abc"}


@pytest.mark.asyncio
async def test_family_change_does_not_carry_credential_extras(service):
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
                        "extras": {"api_key": "extra-key-123456"},
                    },
                    "models": [{"slug": "gpt-5"}],
                },
            },
        ),
    )

    # Family change WITH an explicit new key: allowed, but the old family's extras
    # credentials must not ride along.
    update = UpdateSecretDTO(
        secret={
            "kind": "custom_provider",
            "data": {
                "kind": "anthropic",
                "provider": {
                    "url": "https://gateway.example.com/v1",
                    "key": "sk-ant-new-key-123",
                },
                "models": [{"slug": "claude"}],
            },
        },
    )
    updated = await service.update_secret(
        secret_id=created.id, project_id=PROJECT_ID, update_secret_dto=update
    )

    assert updated.data.provider.key == "sk-ant-new-key-123"
    assert not (updated.data.provider.extras or {}).get("api_key")


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


def test_mask_boundaries_pin_the_preview_policy():
    # Under 20 characters: fully masked. From 20: at most 3+3, never more than 25%.
    assert mask_secret_value("x" * 11) == "****"
    assert mask_secret_value("x" * 12) == "****"
    assert mask_secret_value("x" * 19) == "****"
    assert mask_secret_value("abcdefghijklmnopqrst") == "abc****st"  # 20 chars -> 5
    assert mask_secret_value("sk-example-credential9Qa") == "sk-****9Qa"  # 24 -> 3+3
    assert mask_secret_value("x" * 400) == "xxx****xxx"  # cap stays 3+3


def test_redacts_provider_key_and_reports_presence():
    secret = _response(
        "provider_key",
        {"kind": "openai", "provider": {"key": "sk-test-openai-key-bc"}},
    )

    redacted = redact_secret_response(secret)

    assert redacted.data.provider.key is None
    assert redacted.value_status.configured is True
    assert redacted.value_status.preview == "sk-****bc"
    payload = redacted.model_dump(mode="json", exclude_none=True)
    assert secret_value_configured(payload) is True
    assert "has_key" not in payload
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
    assert redacted.value_status.configured is True
    # Only the primary value field gets a preview; extras credentials never do.
    assert redacted.value_status.preview is None


def test_redacts_every_sdk_credential_extras_key():
    # The classifier is shared with the SDK resolver, so everything the resolver would
    # inject as a credential must come back stripped — including uppercase env-style
    # keys and the bedrock/azure/anthropic tokens the first pass missed.
    extras = {
        "ANTHROPIC_AUTH_TOKEN": "tok-a",
        "AWS_BEARER_TOKEN_BEDROCK": "tok-b",
        "AWS_SECRET_ACCESS_KEY": "tok-c",
        "AZURE_OPENAI_API_KEY": "tok-d",
        "aws_bearer_token_bedrock": "tok-e",
        "vertex_ai_credentials": '{"type": "service_account"}',
        # Config survives.
        "AWS_REGION": "eu-west-1",
        "vertex_ai_project": "my-project",
    }
    secret = _response(
        "custom_provider",
        {
            "kind": "bedrock",
            "provider": {"url": None, "extras": dict(extras)},
            "models": [{"slug": "claude"}],
        },
    )

    redacted = redact_secret_response(secret)

    assert redacted.data.provider.extras == {
        "AWS_REGION": "eu-west-1",
        "vertex_ai_project": "my-project",
    }
    assert redacted.value_status.configured is True
    assert redacted.value_status.preview is None


def test_aws_only_secret_reports_configured_true():
    secret = _response(
        "custom_provider",
        {
            "kind": "bedrock",
            "provider": {
                "extras": {
                    "aws_access_key_id": "AKIA123",
                    "aws_secret_access_key": "shhh",
                    "aws_region_name": "eu-west-1",
                }
            },
            "models": [],
        },
    )

    redacted = redact_secret_response(secret)

    assert redacted.value_status.configured is True
    assert "aws_secret_access_key" not in redacted.data.provider.extras
    assert redacted.data.provider.extras["aws_region_name"] == "eu-west-1"


def test_redacts_sso_client_secret():
    secret = _response(
        "sso_provider",
        {
            "provider": {
                "client_id": "client-1",
                "client_secret": "super-secret-value-123",
                "issuer_url": "https://issuer.example.com",
                "scopes": ["openid"],
            }
        },
    )

    redacted = redact_secret_response(secret)

    assert redacted.data.provider.client_secret is None
    assert redacted.data.provider.client_id == "client-1"
    assert redacted.value_status.configured is True


def test_redacts_text_custom_secret_content():
    secret = _response(
        "custom_secret",
        {"secret": {"format": "text", "content": "ghp_example_token_xyz"}},
    )

    redacted = redact_secret_response(secret)

    assert redacted.data.secret.content is None
    assert redacted.value_status.configured is True
    assert redacted.value_status.preview == "ghp****yz"


def test_redacts_json_custom_secret_without_a_preview():
    secret = _response(
        "custom_secret",
        {"secret": {"format": "json", "content": {"token": "abc", "user": "x"}}},
    )

    redacted = redact_secret_response(secret)

    assert redacted.data.secret.content is None
    assert redacted.value_status.configured is True
    # A structured value has no single previewable string.
    assert redacted.value_status.preview is None


def test_readable_secret_passes_through_unchanged():
    secret = _response(
        "provider_key",
        {"kind": "openai", "provider": {"key": "sk-test-openai-key-bc"}},
        write_only=False,
    )

    redacted = redact_secret_response(secret)

    assert redacted is not secret
    assert redacted.data.provider.key == "sk-test-openai-key-bc"
    assert redacted.value_status.configured is True
    assert redacted.value_status.preview is None


def test_write_only_without_a_value_reports_configured_false():
    secret = _response(
        "custom_provider",
        {
            "kind": "openai",
            "provider": {"url": "https://gateway.example.com/v1"},
            "models": [],
        },
    )

    redacted = redact_secret_response(secret)

    assert redacted.value_status.configured is False
    assert redacted.value_status.preview is None


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


# --- the update-path payload type, at every call site ----------------------------------


def test_update_call_sites_build_the_update_path_payload():
    """`UpdateSecretDTO.secret` is `UpdateSecretPayloadDTO`, and pydantic rejects the
    parent `SecretDTO` there — a caller that builds the parent breaks that write path at
    runtime, not at import time. This walks the source so a new call site cannot
    reintroduce the mismatch (it caught webhook secret rotation and SSO provider updates).
    """
    import ast
    from pathlib import Path

    source_roots = [
        Path(__file__).resolve().parents[5] / "oss" / "src",
        Path(__file__).resolve().parents[5] / "ee" / "src",
    ]

    offenders = []

    for root in source_roots:
        if not root.exists():  # EE is absent in an OSS-only checkout.
            continue

        for path in root.rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))

            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                if getattr(node.func, "id", None) != "UpdateSecretDTO":
                    continue

                for keyword in node.keywords:
                    if keyword.arg != "secret":
                        continue
                    if not isinstance(keyword.value, ast.Call):
                        continue  # a dict or a variable: validated by pydantic as data.

                    built = getattr(keyword.value.func, "id", None)
                    if built != "UpdateSecretPayloadDTO":
                        offenders.append(f"{path}:{node.lineno} builds {built}")

    assert not offenders, (
        "UpdateSecretDTO(secret=...) must be built with UpdateSecretPayloadDTO: "
        + "; ".join(offenders)
    )


def test_primary_credential_fields_cover_every_secret_kind():
    # The redaction, the presence report, and the carry-over all key off this map, so a
    # kind missing from it silently stops being redacted.
    from oss.src.core.secrets.redaction import PRIMARY_CREDENTIAL_FIELDS

    assert set(PRIMARY_CREDENTIAL_FIELDS) == {
        "provider_key",
        "custom_provider",
        "webhook_provider",
        "sso_provider",
        "custom_secret",
    }

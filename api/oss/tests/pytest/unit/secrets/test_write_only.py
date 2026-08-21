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
    SecretValueRequiredError,
    UpdateSecretDTO,
    WriteOnlyCannotBeDisabledError,
)
from oss.src.core.secrets.redaction import (
    mask_secret_value,
    redact_secret_response,
)
from oss.src.core.secrets.services import VaultService
from oss.src.utils.env import env
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


@pytest.fixture(name="write_only_gate")
def _write_only_gate(monkeypatch):
    def set_gate(value: bool):
        monkeypatch.setattr(env.agenta.vault, "write_only_default", value)

    return set_gate


@pytest.mark.asyncio
async def test_create_defaults_off_while_the_gate_is_off(service, write_only_gate):
    # Today's behavior until the web UI ships replace-only forms.
    write_only_gate(False)

    created = await service.create_secret(
        project_id=PROJECT_ID, create_secret_dto=_provider_key_create()
    )

    assert created.write_only is False


@pytest.mark.asyncio
async def test_create_defaults_to_write_only_when_the_gate_is_on(
    service, write_only_gate
):
    write_only_gate(True)

    created = await service.create_secret(
        project_id=PROJECT_ID, create_secret_dto=_provider_key_create()
    )

    assert created.write_only is True


@pytest.mark.asyncio
@pytest.mark.parametrize("gate", [False, True])
@pytest.mark.parametrize("explicit", [False, True])
async def test_an_explicit_request_value_always_wins_over_the_gate(
    service, write_only_gate, gate, explicit
):
    write_only_gate(gate)

    created = await service.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=_provider_key_create(write_only=explicit),
    )

    assert created.write_only is explicit


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
        project_id=PROJECT_ID, create_secret_dto=_provider_key_create(write_only=True)
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
    assert redacted.has_key is True
    assert redacted.key_preview == "sk-****bc"
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
    # Only the primary value field gets a preview; extras credentials never do.
    assert redacted.key_preview is None


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
    assert redacted.has_key is True
    assert redacted.key_preview is None


def test_aws_only_secret_reports_has_key_true():
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

    assert redacted.has_key is True
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
    assert redacted.has_key is True


def test_redacts_text_custom_secret_content():
    secret = _response(
        "custom_secret",
        {"secret": {"format": "text", "content": "ghp_example_token_xyz"}},
    )

    redacted = redact_secret_response(secret)

    assert redacted.data.secret.content is None
    assert redacted.has_key is True
    assert redacted.key_preview == "ghp****yz"


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


def test_update_mapping_applies_a_tightening_flag():
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


def test_update_mapping_never_clears_the_flag_on_a_stale_explicit_false():
    # Concurrency guard: a racing update that read write_only=False before another
    # request tightened the secret must not resurrect readability at the mapper.
    import json

    dbe = map_secrets_dto_to_dbe(
        project_id=PROJECT_ID,
        organization_id=None,
        secret_dto=_provider_key_create(write_only=True),
    )

    map_secrets_dto_to_dbe_update(
        secrets_dbe=dbe,
        update_secret_dto=UpdateSecretDTO(
            write_only=False,
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
    assert stored["provider"]["key"] == "sk-rotated-9876543210xyz"


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
